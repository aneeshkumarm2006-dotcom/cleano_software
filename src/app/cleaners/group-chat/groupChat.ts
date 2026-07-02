"use server";

import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { db } from "@/db";

// ---- Types ----------------------------------------------------------------

export interface GroupChannelDTO {
  id: string;
  name: string;
  isDefault: boolean;
}

export interface GroupMessageDTO {
  id: string;
  channelId: string;
  senderId: string;
  senderName: string;
  body: string;
  createdAt: string;
}

type Ok<T> = { success: true; data: T };
type Err = { success: false; error: string };
type Result<T> = Ok<T> | Err;

// ---- Auth helpers ----------------------------------------------------------

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

// Can participate in group chat: any staff member (everyone but clients).
function canParticipate(role: AppRole): boolean {
  return (
    role === "OWNER" ||
    role === "ADMIN" ||
    role === "OPS_MANAGER" ||
    role === "FIELD_LEAD" ||
    role === "EMPLOYEE"
  );
}

// Can moderate / manage channels: office roles only.
function isAdminRole(role: AppRole): boolean {
  return role === "OWNER" || role === "ADMIN" || role === "OPS_MANAGER";
}

// ---- Default channel -------------------------------------------------------

const DEFAULT_CHANNEL_NAME = "All Cleaners";

/**
 * Lazily returns the single default group channel, creating it if none exists.
 * Idempotent — safe to call on every read.
 */
export async function ensureDefaultChannel() {
  const existing = await db.groupChannel.findFirst({
    where: { isDefault: true },
  });
  if (existing) return existing;
  return db.groupChannel.create({
    data: { name: DEFAULT_CHANNEL_NAME, isDefault: true, isActive: true },
  });
}

// ---- Reads -----------------------------------------------------------------

/** Active channels, default first then newest. */
export async function listGroupChannels(): Promise<Result<GroupChannelDTO[]>> {
  const a = await requireUser();
  if ("error" in a) return { success: false, error: a.error };
  if (!canParticipate(a.role)) return { success: false, error: "Not authorized" };

  await ensureDefaultChannel();

  const channels = await db.groupChannel.findMany({
    where: { isActive: true },
    orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
  });

  return {
    success: true,
    data: channels.map((c) => ({
      id: c.id,
      name: c.name,
      isDefault: c.isDefault,
    })),
  };
}

/** Non-deleted messages for a channel, oldest first. */
export async function getGroupMessages(
  channelId: string
): Promise<Result<GroupMessageDTO[]>> {
  const a = await requireUser();
  if ("error" in a) return { success: false, error: a.error };
  if (!canParticipate(a.role)) return { success: false, error: "Not authorized" };

  const channel = await db.groupChannel.findUnique({ where: { id: channelId } });
  if (!channel) return { success: false, error: "Channel not found" };

  const messages = await db.groupMessage.findMany({
    where: { channelId, deletedAt: null },
    orderBy: { createdAt: "asc" },
  });

  return {
    success: true,
    data: messages.map((m) => ({
      id: m.id,
      channelId: m.channelId,
      senderId: m.senderId,
      senderName: m.senderName,
      body: m.body,
      createdAt: m.createdAt.toISOString(),
    })),
  };
}

// ---- Writes ----------------------------------------------------------------

/** Post a message to a channel. Any staff member may post. */
export async function sendGroupMessage(
  channelId: string,
  body: string
): Promise<Result<GroupMessageDTO>> {
  const a = await requireUser();
  if ("error" in a) return { success: false, error: a.error };
  if (!canParticipate(a.role)) return { success: false, error: "Not authorized" };

  const trimmed = body.trim();
  if (!trimmed) return { success: false, error: "Message cannot be empty" };
  if (trimmed.length > 4000) {
    return { success: false, error: "Message is too long (max 4000 characters)" };
  }

  const channel = await db.groupChannel.findUnique({ where: { id: channelId } });
  if (!channel || !channel.isActive) {
    return { success: false, error: "Channel not found" };
  }

  const message = await db.groupMessage.create({
    data: {
      channelId,
      senderId: a.user.id,
      senderName: a.user.name ?? "Unknown",
      body: trimmed,
    },
  });

  return {
    success: true,
    data: {
      id: message.id,
      channelId: message.channelId,
      senderId: message.senderId,
      senderName: message.senderName,
      body: message.body,
      createdAt: message.createdAt.toISOString(),
    },
  };
}

/** Create an additional channel. Admin only. */
export async function createGroupChannel(
  name: string
): Promise<Result<GroupChannelDTO>> {
  const a = await requireUser();
  if ("error" in a) return { success: false, error: a.error };
  if (!isAdminRole(a.role)) return { success: false, error: "Not authorized" };

  const trimmed = name.trim();
  if (!trimmed) return { success: false, error: "Channel name is required" };
  if (trimmed.length > 60) {
    return { success: false, error: "Channel name is too long (max 60 characters)" };
  }

  const channel = await db.groupChannel.create({
    data: { name: trimmed, isDefault: false, isActive: true },
  });

  return {
    success: true,
    data: { id: channel.id, name: channel.name, isDefault: channel.isDefault },
  };
}

/** Soft-delete (moderate) a message. Admin only. */
export async function deleteGroupMessage(
  messageId: string
): Promise<Result<{ id: string }>> {
  const a = await requireUser();
  if ("error" in a) return { success: false, error: a.error };
  if (!isAdminRole(a.role)) return { success: false, error: "Not authorized" };

  const message = await db.groupMessage.findUnique({ where: { id: messageId } });
  if (!message) return { success: false, error: "Message not found" };
  if (message.deletedAt) return { success: true, data: { id: messageId } };

  await db.groupMessage.update({
    where: { id: messageId },
    data: { deletedAt: new Date() },
  });

  return { success: true, data: { id: messageId } };
}
