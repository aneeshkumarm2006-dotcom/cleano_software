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

/** All announcements, pinned first then newest, with the caller's reaction. */
export async function listAnnouncements(): Promise<Result<AnnouncementDTO[]>> {
  const a = await requireUser();
  if ("error" in a) return { success: false, error: a.error };
  if (!canParticipate(a.role)) return { success: false, error: "Not authorized" };

  const announcements = await db.announcement.findMany({
    orderBy: [{ pinned: "desc" }, { createdAt: "desc" }],
    include: { reactions: { select: { userId: true, emoji: true } } },
  });

  return {
    success: true,
    data: announcements.map((an) => {
      const { reactions, myReaction } = countReactions(an.reactions, a.user.id);
      return {
        id: an.id,
        title: an.title,
        body: an.body,
        pinned: an.pinned,
        authorName: an.authorName ?? "Team Cleano",
        createdAt: an.createdAt.toISOString(),
        reactions,
        myReaction,
      };
    }),
  };
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
    },
  };
}

/** Edit an announcement's title/body/pin. Admin only. */
export async function updateAnnouncement(
  id: string,
  input: { title?: string; body?: string; pinned?: boolean }
): Promise<Result<{ id: string }>> {
  const a = await requireUser();
  if ("error" in a) return { success: false, error: a.error };
  if (!isAdminRole(a.role)) return { success: false, error: "Not authorized" };

  const existing = await db.announcement.findUnique({ where: { id } });
  if (!existing) return { success: false, error: "Announcement not found" };

  const data: { title?: string; body?: string; pinned?: boolean } = {};
  if (typeof input.title === "string") {
    const title = input.title.trim();
    if (!title) return { success: false, error: "Title is required" };
    if (title.length > 120) {
      return { success: false, error: "Title is too long (max 120 characters)" };
    }
    data.title = title;
  }
  if (typeof input.body === "string") {
    const body = input.body.trim();
    if (!body) return { success: false, error: "Message is required" };
    if (body.length > 5000) {
      return { success: false, error: "Message is too long (max 5000 characters)" };
    }
    data.body = body;
  }
  if (typeof input.pinned === "boolean") data.pinned = input.pinned;

  await db.announcement.update({ where: { id }, data });

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
    data: { pinned: !existing.pinned },
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
