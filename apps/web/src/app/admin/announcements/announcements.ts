"use server";

import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { db } from "@/lib/org-db";

// ---- Types ----------------------------------------------------------------

export interface AnnouncementDTO {
  id: string;
  title: string;
  body: string;
  pinned: boolean;
  authorName: string;
  createdAt: string;
  /** Emoji → count of users who reacted with it. */
  reactions: Record<string, number>;
  /** The calling user's current reaction, if any. */
  myReaction: string | null;
  /**
   * Has the caller opened this announcement at all? Drives the "New" marker.
   *
   * Deliberately NOT tied to the latest edit. Re-flagging the whole crew
   * because somebody fixed a typo is how a noticeboard teaches people to
   * dismiss the badge without reading it, so an edit only re-flags when the
   * admin explicitly asks for it (see `renotify` on updateAnnouncement).
   */
  readByMe: boolean;
  /**
   * How many people have seen the text that is on the card RIGHT NOW. Reads
   * taken before the last edit are counted in `staleReadCount` instead: an
   * admin who has just rewritten a notice must never be told "Seen by 3"
   * about words nobody has opened.
   */
  readCount: number;
  /** Reads that predate the last edit — those people saw different wording. */
  staleReadCount: number;
  /**
   * The caller's own read predates the last edit. Not a badge: it is what
   * tells the client to re-stamp this person's read once they have the new
   * text in front of them, so the register recovers as the crew comes back.
   */
  myReadStale: boolean;
  /** When the text last changed, or null if it still reads as published. */
  editedAt: string | null;
  /**
   * Who saw it and who reacted, with names and times. Admin-only and null for
   * everyone else: a cleaner does not need a list of which colleagues have
   * read the notice, and handing them one turns a noticeboard into a register.
   */
  audience: AnnouncementAudienceDTO | null;
}

export interface AnnouncementAudienceDTO {
  /** `stale` = read before the last edit, so that person saw older wording. */
  reads: { name: string; at: string; stale: boolean }[];
  reactions: { name: string; emoji: string; at: string }[];
  /** Team members who have not opened it yet. */
  unread: string[];
}

export interface ReactionStateDTO {
  reactions: Record<string, number>;
  myReaction: string | null;
}

type Ok<T> = { success: true; data: T };
type Err = { success: false; error: string };
type Result<T> = Ok<T> | Err;

// ---- Auth helpers (same pattern as groupChat.ts) -----------------------------

type SessionUser = { id: string; name: string; role?: string };
type AppRole =
  | "OWNER"
  | "ADMIN"
  | "OPS_MANAGER"
  | "FIELD_LEAD"
  | "EMPLOYEE"
  | "CLIENT";

async function requireUser(): Promise<
  { error: string } | { user: SessionUser; role: AppRole }
> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return { error: "Not authenticated" };
  const user = session.user as SessionUser;
  return { user, role: (user.role as AppRole | undefined) ?? "EMPLOYEE" };
}

// Can read + react: any staff member (everyone but clients).
function canParticipate(role: AppRole): boolean {
  return (
    role === "OWNER" ||
    role === "ADMIN" ||
    role === "OPS_MANAGER" ||
    role === "FIELD_LEAD" ||
    role === "EMPLOYEE"
  );
}

// Can publish / edit / delete / pin: office roles only.
function isAdminRole(role: AppRole): boolean {
  return role === "OWNER" || role === "ADMIN" || role === "OPS_MANAGER";
}

// ---- Reactions -------------------------------------------------------------

// Allow-list — must match REACTION_SET in the client.
const REACTION_EMOJIS = new Set(["👍", "🎉", "❤️"]);

function countReactions(
  rows: { userId: string; emoji: string }[],
  userId: string
): ReactionStateDTO {
  const reactions: Record<string, number> = {};
  let myReaction: string | null = null;
  for (const r of rows) {
    reactions[r.emoji] = (reactions[r.emoji] ?? 0) + 1;
    if (r.userId === userId) myReaction = r.emoji;
  }
  return { reactions, myReaction };
}

// ---- Reads -----------------------------------------------------------------

/**
 * When this announcement's text last changed, or null if it still says exactly
 * what it said when it was published.
 *
 * `updatedAt` carries the answer. It is the only timestamp the row has, and
 * the write paths below keep it truthful: togglePin and a save that leaves the
 * wording alone both carry the previous value forward instead of letting
 * @updatedAt stamp an edit that never happened. So a moved `updatedAt` means
 * the words moved, which is the thing the read rows have to be measured
 * against — a read is only evidence about the text that existed when it was
 * taken.
 */
function revisedAt(an: { createdAt: Date; updatedAt: Date }): Date | null {
  // Publishing writes both stamps from the same statement; a stray millisecond
  // between them is not an edit.
  return an.updatedAt.getTime() - an.createdAt.getTime() > 1000
    ? an.updatedAt
    : null;
}

/** All announcements, pinned first then newest, with the caller's reaction. */
export async function listAnnouncements(): Promise<Result<AnnouncementDTO[]>> {
  const a = await requireUser();
  if ("error" in a) return { success: false, error: a.error };
  if (!canParticipate(a.role)) return { success: false, error: "Not authorized" };

  const announcements = await db.announcement.findMany({
    orderBy: [{ pinned: "desc" }, { createdAt: "desc" }],
    include: {
      reactions: { select: { userId: true, emoji: true, createdAt: true } },
      reads: { select: { userId: true, readAt: true } },
    },
  });

  // Names are resolved once for the whole page rather than per announcement:
  // the alternative is a query per row per reader, which is how a noticeboard
  // becomes the slowest page in the app.
  const forAdmin = isAdminRole(a.role);
  const names = new Map<string, string>();
  let team: { id: string; name: string }[] = [];
  if (forAdmin) {
    team = await db.user.findMany({
      where: { role: { not: "CLIENT" }, deletedAt: null },
      select: { id: true, name: true },
    });
    for (const u of team) names.set(u.id, u.name);
  }
  const nameOf = (id: string) => names.get(id) ?? "Someone";

  return {
    success: true,
    data: announcements.map((an) => {
      const { reactions, myReaction } = countReactions(an.reactions, a.user.id);
      const readerIds = new Set(an.reads.map((r) => r.userId));
      // Split the register at the last edit. Everything after it is a read of
      // the words currently on the card; everything before it is somebody who
      // saw a version that no longer exists, and saying otherwise is the bug.
      const rev = revisedAt(an);
      const isStale = (readAt: Date) =>
        rev !== null && readAt.getTime() < rev.getTime();
      const staleReadCount = an.reads.filter((r) => isStale(r.readAt)).length;
      const myRead = an.reads.find((r) => r.userId === a.user.id);
      return {
        id: an.id,
        title: an.title,
        body: an.body,
        pinned: an.pinned,
        authorName: an.authorName ?? "Team Cleano",
        createdAt: an.createdAt.toISOString(),
        reactions,
        myReaction,
        readByMe: readerIds.has(a.user.id),
        readCount: an.reads.length - staleReadCount,
        staleReadCount,
        myReadStale: myRead ? isStale(myRead.readAt) : false,
        editedAt: rev ? rev.toISOString() : null,
        audience: forAdmin
          ? {
              reads: an.reads
                .map((r) => ({
                  name: nameOf(r.userId),
                  at: r.readAt.toISOString(),
                  stale: isStale(r.readAt),
                }))
                .sort((x, y) => x.at.localeCompare(y.at)),
              reactions: an.reactions
                .map((r) => ({
                  name: nameOf(r.userId),
                  emoji: r.emoji,
                  at: r.createdAt.toISOString(),
                }))
                .sort((x, y) => x.at.localeCompare(y.at)),
              unread: team
                .filter((u) => !readerIds.has(u.id))
                .map((u) => u.name)
                .sort(),
            }
          : null,
      };
    }),
  };
}

/**
 * Record that the caller has seen these announcements.
 *
 * Idempotent by the unique pair, so opening the page twice does not move the
 * timestamp: "when did they first see it" is the question an admin is
 * actually asking, and a refresh must not answer it wrongly.
 *
 * An EDIT is the exception. A stamp from before the rewrite answers a question
 * about wording that no longer exists, so re-opening an edited card moves it
 * forward — otherwise a reader who did come back and read the new text would
 * be filed under "saw an earlier version" for good, and the register would
 * never recover from a single typo fix.
 */
export async function markAnnouncementsRead(
  ids: string[]
): Promise<Result<{ marked: number }>> {
  const a = await requireUser();
  if ("error" in a) return { success: false, error: a.error };
  if (!canParticipate(a.role)) return { success: false, error: "Not authorized" };
  if (ids.length === 0) return { success: true, data: { marked: 0 } };

  const wanted = ids.slice(0, 200);
  const res = await db.announcementRead.createMany({
    data: wanted.map((announcementId) => ({
      announcementId,
      userId: a.user.id,
    })),
    skipDuplicates: true,
  });

  // Only announcements that have actually been edited can hold a stamp worth
  // moving, and almost none of them have been, so this costs one lookup and
  // usually no writes at all.
  const edited = (
    await db.announcement.findMany({
      where: { id: { in: wanted } },
      select: { id: true, createdAt: true, updatedAt: true },
    })
  ).flatMap((an) => {
    const rev = revisedAt(an);
    return rev ? [{ id: an.id, rev }] : [];
  });
  for (const { id, rev } of edited) {
    await db.announcementRead.updateMany({
      where: { announcementId: id, userId: a.user.id, readAt: { lt: rev } },
      data: { readAt: new Date() },
    });
  }

  return { success: true, data: { marked: res.count } };
}

// ---- Writes ----------------------------------------------------------------

/** Publish an announcement. Admin/office only. */
export async function createAnnouncement(input: {
  title: string;
  body: string;
  pinned?: boolean;
}): Promise<Result<AnnouncementDTO>> {
  const a = await requireUser();
  if ("error" in a) return { success: false, error: a.error };
  if (!isAdminRole(a.role)) return { success: false, error: "Not authorized" };

  const title = (input.title ?? "").trim();
  const body = (input.body ?? "").trim();
  if (!title) return { success: false, error: "Title is required" };
  if (title.length > 120) {
    return { success: false, error: "Title is too long (max 120 characters)" };
  }
  if (!body) return { success: false, error: "Message is required" };
  if (body.length > 5000) {
    return { success: false, error: "Message is too long (max 5000 characters)" };
  }

  const created = await db.announcement.create({
    data: {
      title,
      body,
      pinned: input.pinned === true,
      authorId: a.user.id,
      authorName: a.user.name ?? "Team Cleano",
    },
  });

  return {
    success: true,
    data: {
      id: created.id,
      title: created.title,
      body: created.body,
      pinned: created.pinned,
      authorName: created.authorName ?? "Team Cleano",
      createdAt: created.createdAt.toISOString(),
      reactions: {},
      myReaction: null,
      // Brand new: nobody has seen it, including its author, and there is no
      // earlier version anybody could have seen instead.
      readByMe: false,
      readCount: 0,
      staleReadCount: 0,
      myReadStale: false,
      editedAt: null,
      audience: { reads: [], reactions: [], unread: [] },
    },
  };
}

/**
 * Edit an announcement's title/body/pin. Admin only.
 *
 * Two deliberate things here, both about keeping the read register honest
 * across an edit.
 *
 * First, `updatedAt` is this row's "the words changed" marker (see revisedAt),
 * so a save that does not actually change the wording — reopening the dialog
 * and pressing Save, or flipping only the pin — carries the previous value
 * forward rather than letting @updatedAt invent an edit. Otherwise every
 * no-op save would quietly void a register that was still correct.
 *
 * Second, clearing the reads is the admin's call rather than ours. A rewritten
 * shift policy and a fixed typo both count as "the text changed", and wiping
 * the crew's read state for the second one is how people learn to swipe the
 * badge away unread. So reads survive by default and are merely reported as
 * predating the edit, and `renotify` is the explicit "make everyone look
 * again".
 */
export async function updateAnnouncement(
  id: string,
  input: {
    title?: string;
    body?: string;
    pinned?: boolean;
    /** Clear the read register so the crew is flagged unread again. */
    renotify?: boolean;
  }
): Promise<Result<{ id: string }>> {
  const a = await requireUser();
  if ("error" in a) return { success: false, error: a.error };
  if (!isAdminRole(a.role)) return { success: false, error: "Not authorized" };

  const existing = await db.announcement.findUnique({ where: { id } });
  if (!existing) return { success: false, error: "Announcement not found" };

  const data: {
    title?: string;
    body?: string;
    pinned?: boolean;
    updatedAt?: Date;
  } = {};
  let textChanged = false;
  if (typeof input.title === "string") {
    const title = input.title.trim();
    if (!title) return { success: false, error: "Title is required" };
    if (title.length > 120) {
      return { success: false, error: "Title is too long (max 120 characters)" };
    }
    if (title !== existing.title) {
      data.title = title;
      textChanged = true;
    }
  }
  if (typeof input.body === "string") {
    const body = input.body.trim();
    if (!body) return { success: false, error: "Message is required" };
    if (body.length > 5000) {
      return { success: false, error: "Message is too long (max 5000 characters)" };
    }
    if (body !== existing.body) {
      data.body = body;
      textChanged = true;
    }
  }
  if (typeof input.pinned === "boolean") data.pinned = input.pinned;

  // Nothing anybody reads has moved, so neither does the marker.
  if (!textChanged) data.updatedAt = existing.updatedAt;

  await db.announcement.update({ where: { id }, data });

  if (input.renotify === true) {
    // Start the register again: everyone is unread until they open the new
    // text, and the badge comes back. Reactions are left alone — those were
    // about the notice, not about one wording of it.
    await db.announcementRead.deleteMany({ where: { announcementId: id } });
  }

  return { success: true, data: { id } };
}

/** Delete an announcement (reactions cascade). Admin only. */
export async function deleteAnnouncement(
  id: string
): Promise<Result<{ id: string }>> {
  const a = await requireUser();
  if ("error" in a) return { success: false, error: a.error };
  if (!isAdminRole(a.role)) return { success: false, error: "Not authorized" };

  const existing = await db.announcement.findUnique({ where: { id } });
  if (!existing) return { success: true, data: { id } }; // idempotent

  await db.announcement.delete({ where: { id } });

  return { success: true, data: { id } };
}

/** Pin/unpin an announcement. Admin only. */
export async function togglePin(id: string): Promise<Result<{ id: string; pinned: boolean }>> {
  const a = await requireUser();
  if ("error" in a) return { success: false, error: a.error };
  if (!isAdminRole(a.role)) return { success: false, error: "Not authorized" };

  const existing = await db.announcement.findUnique({ where: { id } });
  if (!existing) return { success: false, error: "Announcement not found" };

  const updated = await db.announcement.update({
    where: { id },
    // Pinning moves the card, not the words on it, so the previous
    // `updatedAt` is carried forward: it is the "text last changed" marker the
    // read register is measured against, and a pin must not void reads that
    // are still perfectly accurate.
    data: { pinned: !existing.pinned, updatedAt: existing.updatedAt },
  });

  return { success: true, data: { id, pinned: updated.pinned } };
}

/**
 * React to an announcement — one reaction per user, enforced by the
 * @@unique([announcementId, userId]) constraint:
 *   no existing row  → create it
 *   same emoji again → remove it (toggle off)
 *   different emoji  → switch to the new one
 * Returns fresh counts so the client can reconcile.
 */
export async function reactToAnnouncement(
  announcementId: string,
  emoji: string
): Promise<Result<ReactionStateDTO>> {
  const a = await requireUser();
  if ("error" in a) return { success: false, error: a.error };
  if (!canParticipate(a.role)) return { success: false, error: "Not authorized" };

  if (!REACTION_EMOJIS.has(emoji)) {
    return { success: false, error: "Unsupported reaction" };
  }

  const announcement = await db.announcement.findUnique({
    where: { id: announcementId },
  });
  if (!announcement) return { success: false, error: "Announcement not found" };

  const existing = await db.announcementReaction.findUnique({
    where: {
      announcementId_userId: { announcementId, userId: a.user.id },
    },
  });

  try {
    if (!existing) {
      await db.announcementReaction.create({
        data: { announcementId, userId: a.user.id, emoji },
      });
    } else if (existing.emoji === emoji) {
      await db.announcementReaction.delete({ where: { id: existing.id } });
    } else {
      await db.announcementReaction.update({
        where: { id: existing.id },
        data: { emoji },
      });
    }
  } catch {
    // Unique-constraint race (double click) — fall through to the fresh read.
  }

  const rows = await db.announcementReaction.findMany({
    where: { announcementId },
    select: { userId: true, emoji: true },
  });

  return { success: true, data: countReactions(rows, a.user.id) };
}
