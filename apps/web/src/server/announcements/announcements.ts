// The office's noticeboard, as the crew reads it: the list with the caller's
// own read and reaction state, marking read, and reacting.
//
// Shared by the web's admin/announcements/announcements.ts (listAnnouncements,
// markAnnouncementsRead, reactToAnnouncement are adapters over these) and the
// phone's /api/v1/announcements routes (packages/api/src/v1/announcements.ts).
// Publishing, editing and the read register stay web-only.
import "server-only";

import type { Announcement, AnnouncementsResponse, ReactionKind, ReactionState } from "@bookmops/api/v1";
import type { Prisma } from "@prisma/client";

import { db } from "@/lib/org-db";

import type { Actor } from "../actor";
import { failure, notFound, ok, type Result } from "../result";
import { workspaceName } from "@/lib/workspace-name";

// ── Vocabulary ──────────────────────────────────────────────────────────────

/** The web's allow-list, and the names the phone uses for it. */
export const REACTION_EMOJI: Record<ReactionKind, string> = {
  THUMBS_UP: "👍",
  PARTY: "🎉",
  HEART: "❤️",
};
const KIND_OF_EMOJI = new Map(Object.entries(REACTION_EMOJI).map(([k, e]) => [e, k as ReactionKind]));
export const REACTION_EMOJIS = new Set(Object.values(REACTION_EMOJI));

/** Can read and react: every staff role, never a client or applicant. */
export function canParticipate(role: string | null | undefined): boolean {
  return role === "OWNER" || role === "ADMIN" || role === "OPS_MANAGER" || role === "FIELD_LEAD" || role === "EMPLOYEE";
}

/** Can publish, edit, delete, pin, and see the register: the office. */
export function isAdminRole(role: string | null | undefined): boolean {
  return role === "OWNER" || role === "ADMIN" || role === "OPS_MANAGER";
}

/** How many ids one mark-read call takes, on both doors. */
export const MARK_READ_LIMIT = 200;

// ── Pure rules ──────────────────────────────────────────────────────────────

/**
 * When this announcement's text last changed, or null if it still says exactly
 * what it said when it was published.
 *
 * `updatedAt` carries the answer. It is the only timestamp the row has, and
 * the web's write paths keep it truthful: togglePin and a save that leaves the
 * wording alone both carry the previous value forward instead of letting
 * @updatedAt stamp an edit that never happened. So a moved `updatedAt` means
 * the words moved, which is the thing the read rows have to be measured
 * against — a read is only evidence about the text that existed when it was
 * taken.
 */
export function revisedAt(an: { createdAt: Date; updatedAt: Date }): Date | null {
  // Publishing writes both stamps from the same statement; a stray millisecond
  // between them is not an edit.
  return an.updatedAt.getTime() - an.createdAt.getTime() > 1000 ? an.updatedAt : null;
}

/** Emoji → count, and the caller's own. The web's shape. */
export function countReactions(
  rows: { userId: string; emoji: string }[],
  userId: string,
): { reactions: Record<string, number>; myReaction: string | null } {
  const reactions: Record<string, number> = {};
  let myReaction: string | null = null;
  for (const r of rows) {
    reactions[r.emoji] = (reactions[r.emoji] ?? 0) + 1;
    if (r.userId === userId) myReaction = r.emoji;
  }
  return { reactions, myReaction };
}

/** The same, in the phone's names. Emoji outside the allow-list are left out. */
export function reactionState(rows: { userId: string; emoji: string }[], userId: string): ReactionState {
  const counts = new Map<ReactionKind, number>();
  let myReaction: ReactionKind | null = null;
  for (const r of rows) {
    const kind = KIND_OF_EMOJI.get(r.emoji);
    if (!kind) continue;
    counts.set(kind, (counts.get(kind) ?? 0) + 1);
    if (r.userId === userId) myReaction = kind;
  }
  const order = Object.keys(REACTION_EMOJI) as ReactionKind[];
  return {
    reactions: order.filter((k) => counts.has(k)).map((k) => ({ kind: k, count: counts.get(k)! })),
    myReaction,
  };
}

// ── Listing (phone) ─────────────────────────────────────────────────────────

export const ANNOUNCEMENT_PAGE_SIZE = 20;

interface AnnouncementCursor {
  p: boolean;
  c: string;
  id: string;
}

function encodeCursor(c: AnnouncementCursor): string {
  return Buffer.from(JSON.stringify(c)).toString("base64url");
}

function decodeCursor(raw: string | undefined): AnnouncementCursor | null | "invalid" {
  if (!raw) return null;
  try {
    const v = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as unknown;
    if (!v || typeof v !== "object") return "invalid";
    const { p, c, id } = v as Record<string, unknown>;
    if (typeof p !== "boolean" || typeof c !== "string" || typeof id !== "string" || id.length > 64) return "invalid";
    if (Number.isNaN(new Date(c).getTime())) return "invalid";
    return { p, c, id };
  } catch {
    return "invalid";
  }
}

/** Announcements the caller has never opened. */
export async function unreadCountFor(userId: string): Promise<number> {
  return db.announcement.count({ where: { reads: { none: { userId } } } });
}

/**
 * Pinned first, then newest. Only the caller's own read and reaction state:
 * never who else read or reacted, never read counts. Reading marks nothing.
 */
export async function listAnnouncementsFor(
  actor: Actor,
  cursorRaw: string | undefined,
): Promise<Result<AnnouncementsResponse>> {
  // An announcement with no named author is from the company, by name.
  const teamName = `Team ${await workspaceName()}`;
  if (!canParticipate(actor.role)) return failure(403, "FORBIDDEN", "Not authorized");
  const cursor = decodeCursor(cursorRaw);
  if (cursor === "invalid") return failure(400, "VALIDATION_FAILED", "That page link isn't valid. Refresh and try again.");

  // Keyset on (pinned desc, createdAt desc, id desc).
  let where: Prisma.AnnouncementWhereInput = {};
  if (cursor) {
    const at = new Date(cursor.c);
    const sameGroup: Prisma.AnnouncementWhereInput = {
      pinned: cursor.p,
      OR: [{ createdAt: { lt: at } }, { createdAt: at, id: { lt: cursor.id } }],
    };
    where = cursor.p ? { OR: [sameGroup, { pinned: false }] } : sameGroup;
  }

  const [rows, unreadCount] = await Promise.all([
    db.announcement.findMany({
      where,
      orderBy: [{ pinned: "desc" }, { createdAt: "desc" }, { id: "desc" }],
      take: ANNOUNCEMENT_PAGE_SIZE + 1,
      select: {
        id: true,
        title: true,
        body: true,
        pinned: true,
        authorName: true,
        createdAt: true,
        updatedAt: true,
        reactions: { select: { userId: true, emoji: true } },
        // Only the caller's own read row is ever loaded.
        reads: { where: { userId: actor.userId }, select: { readAt: true } },
      },
    }),
    unreadCountFor(actor.userId),
  ]);

  const more = rows.length > ANNOUNCEMENT_PAGE_SIZE;
  const pageRows = more ? rows.slice(0, ANNOUNCEMENT_PAGE_SIZE) : rows;
  const last = pageRows[pageRows.length - 1];

  const items: Announcement[] = pageRows.map((an) => {
    const rev = revisedAt(an);
    const myRead = an.reads[0];
    return {
      id: an.id,
      title: an.title,
      body: an.body,
      pinned: an.pinned,
      authorName: an.authorName ?? teamName,
      createdAt: an.createdAt.toISOString(),
      editedAt: rev ? rev.toISOString() : null,
      readByMe: !!myRead,
      myReadStale: !!myRead && rev !== null && myRead.readAt.getTime() < rev.getTime(),
      ...reactionState(an.reactions, actor.userId),
    };
  });

  return ok({
    items,
    nextCursor: more && last ? encodeCursor({ p: last.pinned, c: last.createdAt.toISOString(), id: last.id }) : null,
    unreadCount,
  });
}

// ── Marking read (both doors) ───────────────────────────────────────────────

/**
 * Record that the caller has seen these announcements.
 *
 * Idempotent by the unique pair, so opening the page twice does not move the
 * timestamp: "when did they first see it" is the question an admin is
 * actually asking. An EDIT is the exception: a stamp from before the rewrite
 * is moved forward, so the register recovers.
 *
 * Only ids of this company's announcements are written; unknown ids and
 * another company's are ignored (the scoped lookup doesn't find them). At most
 * MARK_READ_LIMIT ids are considered.
 */
export async function markAnnouncementsReadFor(
  actor: Actor,
  ids: string[],
  now: Date,
): Promise<Result<{ marked: number }>> {
  if (!canParticipate(actor.role)) return failure(403, "FORBIDDEN", "Not authorized");
  const wanted = Array.from(new Set(ids.filter((id) => typeof id === "string" && id.length > 0 && id.length <= 64))).slice(
    0,
    MARK_READ_LIMIT,
  );
  if (wanted.length === 0) return ok({ marked: 0 });

  const found = await db.announcement.findMany({
    where: { id: { in: wanted } },
    select: { id: true, createdAt: true, updatedAt: true },
  });
  if (found.length === 0) return ok({ marked: 0 });

  const res = await db.announcementRead.createMany({
    data: found.map((an) => ({ announcementId: an.id, userId: actor.userId, readAt: now })),
    skipDuplicates: true,
  });

  // Only announcements that have actually been edited can hold a stamp worth
  // moving, and almost none of them have been, so this is usually no writes.
  for (const an of found) {
    const rev = revisedAt(an);
    if (!rev) continue;
    await db.announcementRead.updateMany({
      where: { announcementId: an.id, userId: actor.userId, readAt: { lt: rev } },
      data: { readAt: now },
    });
  }

  return ok({ marked: res.count });
}

// ── Reacting (both doors) ───────────────────────────────────────────────────

/**
 * SET the caller's reaction to `emoji`, or remove it with null. One per person
 * per announcement (the unique pair); only the caller's row is written.
 * Returns every reaction row on the announcement for the caller to count.
 */
export async function setAnnouncementReaction(
  actor: Actor,
  announcementId: string,
  emoji: string | null,
): Promise<Result<{ userId: string; emoji: string }[]>> {
  if (!canParticipate(actor.role)) return failure(403, "FORBIDDEN", "Not authorized");
  if (emoji !== null && !REACTION_EMOJIS.has(emoji)) {
    return failure(400, "VALIDATION_FAILED", "Unsupported reaction");
  }

  const announcement = await db.announcement.findUnique({ where: { id: announcementId }, select: { id: true } });
  if (!announcement) return notFound("Announcement not found");

  if (emoji === null) {
    await db.announcementReaction.deleteMany({ where: { announcementId, userId: actor.userId } });
  } else {
    const changed = await db.announcementReaction.updateMany({
      where: { announcementId, userId: actor.userId },
      data: { emoji },
    });
    if (changed.count === 0) {
      // skipDuplicates: a concurrent set that created the row first wins the
      // insert, and this one's emoji is applied by the update below.
      await db.announcementReaction.createMany({
        data: [{ announcementId, userId: actor.userId, emoji }],
        skipDuplicates: true,
      });
      await db.announcementReaction.updateMany({
        where: { announcementId, userId: actor.userId, NOT: { emoji } },
        data: { emoji },
      });
    }
  }

  const rows = await db.announcementReaction.findMany({
    where: { announcementId },
    select: { userId: true, emoji: true },
  });
  return ok(rows);
}

/** The web's toggle, on top of the set: the same emoji again removes it. */
export async function toggleAnnouncementReaction(
  actor: Actor,
  announcementId: string,
  emoji: string,
): Promise<Result<{ userId: string; emoji: string }[]>> {
  if (!canParticipate(actor.role)) return failure(403, "FORBIDDEN", "Not authorized");
  if (!REACTION_EMOJIS.has(emoji)) return failure(400, "VALIDATION_FAILED", "Unsupported reaction");
  const existing = await db.announcementReaction.findFirst({
    where: { announcementId, userId: actor.userId },
    select: { emoji: true },
  });
  return setAnnouncementReaction(actor, announcementId, existing?.emoji === emoji ? null : emoji);
}
