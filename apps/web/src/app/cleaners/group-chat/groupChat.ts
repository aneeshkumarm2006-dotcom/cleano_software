"use server";

import { fireEffects } from "@/server/effects";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { db } from "@/lib/org-db";
import { writeAppSetting } from "@/lib/app-setting-write";
import { actorFromSession, type Actor } from "@/server/actor";
import {
  accessibleChannel,
  listTeamChannels,
  markTeamChannelRead,
  moderateTeamMessage,
  openDirectChannel,
  readTeamChatSettings,
  sendTeamMessage,
  teamDirectory,
  TEAM_MESSAGE_SELECT,
} from "@/server/messages/team-chat";

// ---- Types ----------------------------------------------------------------

export interface GroupChannelDTO {
  id: string;
  name: string;
  isDefault: boolean;
  isDirect: boolean;
  /** Messages in this channel newer than the caller's read cursor. */
  unreadCount: number;
}

export interface GroupMessageDTO {
  id: string;
  channelId: string;
  senderId: string;
  senderName: string;
  /** Empty when deleted: a deleted message's text is never sent. */
  body: string;
  createdAt: string;
  /** When its sender last edited it (from the app); null or absent if never. */
  editedAt?: string | null;
  /** Deleted by its sender or removed by the office: shown as a placeholder. */
  deleted?: boolean;
}

export interface ChannelMemberDTO {
  userId: string;
  name: string;
}

export interface CleanerDirectoryEntryDTO {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
}

export interface TeamChatSettingsDTO {
  dmEnabled: boolean;
  showContactInfo: boolean;
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
  // No role means no access. This used to default to EMPLOYEE, which would
  // have handed chat to any session that reached here without one.
  if (!user.role) return { error: "Not authorized" };
  return { user, role: user.role as AppRole };
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

/**
 * The session user as a service Actor. Channel access, sending, direct
 * messages and the directory are server/messages/team-chat.ts, shared with
 * the phone's API, so the two can't drift.
 */
function actorOf(user: SessionUser, role: AppRole): Actor {
  return actorFromSession({ id: user.id, name: user.name, email: "", role });
}

// ---- Team chat settings (AppSetting, key "team.chat") ------------------------

const TEAM_CHAT_KEY = "team.chat";

/** Current team-chat settings. Any staff member may read (gates cleaner UI). */
export async function getTeamChatSettings(): Promise<Result<TeamChatSettingsDTO>> {
  const a = await requireUser();
  if ("error" in a) return { success: false, error: a.error };
  if (!canParticipate(a.role)) return { success: false, error: "Not authorized" };
  return { success: true, data: await readTeamChatSettings() };
}

/** Update team-chat settings. Admin only. */
export async function updateTeamChatSettings(
  input: Partial<TeamChatSettingsDTO>
): Promise<Result<TeamChatSettingsDTO>> {
  const a = await requireUser();
  if ("error" in a) return { success: false, error: a.error };
  if (!isAdminRole(a.role)) return { success: false, error: "Not authorized" };

  const current = await readTeamChatSettings();
  const next: TeamChatSettingsDTO = {
    dmEnabled:
      typeof input.dmEnabled === "boolean" ? input.dmEnabled : current.dmEnabled,
    showContactInfo:
      typeof input.showContactInfo === "boolean"
        ? input.showContactInfo
        : current.showContactInfo,
  };

  await writeAppSetting(TEAM_CHAT_KEY, "team", next as never);

  return { success: true, data: next };
}

// ---- Default channel -------------------------------------------------------

// The default channel is created lazily by ensureDefaultChannel
// (server/messages/team-chat.ts). Not re-exported: every export of a
// "use server" file is a public endpoint, and it does no auth check of its own.

// ---- Reads -----------------------------------------------------------------

/**
 * Channels visible to the caller: default channel for all staff, custom
 * channels for admins + their members, DMs for their two members (admins see
 * them too, for moderation). Default first, then groups, then DMs.
 */
export async function listGroupChannels(): Promise<Result<GroupChannelDTO[]>> {
  const a = await requireUser();
  if ("error" in a) return { success: false, error: a.error };
  if (!canParticipate(a.role)) return { success: false, error: "Not authorized" };

  const res = await listTeamChannels(actorOf(a.user, a.role));
  if (!res.ok) return { success: false, error: res.message };
  return {
    success: true,
    data: res.value.items.map((c) => ({
      id: c.id,
      name: c.name,
      isDefault: c.kind === "DEFAULT",
      isDirect: c.kind === "DIRECT",
      unreadCount: c.unreadCount,
    })),
  };
}

/**
 * Stamp the caller's read cursor for a channel to now, clearing its unread
 * badge. Idempotent — safe to call every time a channel opens. Team-chat read
 * state is tracked separately from job chat and 1:1 admin chat.
 */
export async function markChannelRead(
  channelId: string
): Promise<Result<{ channelId: string }>> {
  const a = await requireUser();
  if ("error" in a) return { success: false, error: a.error };
  if (!canParticipate(a.role)) return { success: false, error: "Not authorized" };

  const res = await markTeamChannelRead(actorOf(a.user, a.role), channelId, new Date());
  if (!res.ok) return { success: false, error: "Channel not found" };
  return { success: true, data: res.value };
}

/**
 * A channel's messages, oldest first. Members only. A deleted message keeps
 * its place with no text (`deleted`), as the phone shows it; its original body
 * never leaves the server.
 */
export async function getGroupMessages(
  channelId: string
): Promise<Result<GroupMessageDTO[]>> {
  const a = await requireUser();
  if ("error" in a) return { success: false, error: a.error };
  if (!canParticipate(a.role)) return { success: false, error: "Not authorized" };

  const channel = await accessibleChannel(actorOf(a.user, a.role), channelId);
  if (!channel) return { success: false, error: "Channel not found" };

  const messages = await db.groupMessage.findMany({
    where: { channelId: channel.id },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: TEAM_MESSAGE_SELECT,
  });

  return {
    success: true,
    data: messages.map((m) => ({
      id: m.id,
      channelId: m.channelId,
      senderId: m.senderId,
      senderName: m.senderName,
      body: m.deletedAt ? "" : m.body,
      createdAt: m.createdAt.toISOString(),
      editedAt: m.editedAt ? m.editedAt.toISOString() : null,
      deleted: !!m.deletedAt,
    })),
  };
}

/** Members of a custom channel (with names). Admin only — powers the editor. */
export async function getChannelMembers(
  channelId: string
): Promise<Result<ChannelMemberDTO[]>> {
  const a = await requireUser();
  if ("error" in a) return { success: false, error: a.error };
  if (!isAdminRole(a.role)) return { success: false, error: "Not authorized" };

  const channel = await db.groupChannel.findUnique({
    where: { id: channelId },
    include: { members: { select: { userId: true }, orderBy: { createdAt: "asc" } } },
  });
  if (!channel) return { success: false, error: "Channel not found" };

  const users = channel.members.length
    ? await db.user.findMany({
        where: { id: { in: channel.members.map((m) => m.userId) } },
        select: { id: true, name: true },
      })
    : [];
  const nameById = new Map(users.map((u) => [u.id, u.name]));

  return {
    success: true,
    data: channel.members.map((m) => ({
      userId: m.userId,
      name: nameById.get(m.userId) ?? "Unknown",
    })),
  };
}

/** Active cleaners an admin can add to a custom channel. Admin only. */
export async function listCleanersForChannel(): Promise<
  Result<ChannelMemberDTO[]>
> {
  const a = await requireUser();
  if ("error" in a) return { success: false, error: a.error };
  if (!isAdminRole(a.role)) return { success: false, error: "Not authorized" };

  const cleaners = await db.user.findMany({
    where: { role: "EMPLOYEE", isActive: true, deletedAt: null },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  return {
    success: true,
    data: cleaners.map((c) => ({ userId: c.id, name: c.name })),
  };
}

/**
 * Directory of other active cleaners for the "start a chat" flow. Contact
 * info is included only when the admin setting allows it; when DMs are
 * disabled the directory is empty (server-side gate, not just UI).
 */
export async function listCleanerDirectory(): Promise<
  Result<{ dmEnabled: boolean; showContactInfo: boolean; cleaners: CleanerDirectoryEntryDTO[] }>
> {
  const a = await requireUser();
  if ("error" in a) return { success: false, error: a.error };
  if (!canParticipate(a.role)) return { success: false, error: "Not authorized" };

  const res = await teamDirectory(actorOf(a.user, a.role));
  if (!res.ok) return { success: false, error: res.message };
  return {
    success: true,
    data: {
      dmEnabled: res.value.dmEnabled,
      showContactInfo: res.value.showContactInfo,
      cleaners: res.value.items,
    },
  };
}

// ---- Writes ----------------------------------------------------------------

/** Post a message to a channel. Members only (default channel: all staff). */
export async function sendGroupMessage(
  channelId: string,
  body: string
): Promise<Result<GroupMessageDTO>> {
  const a = await requireUser();
  if ("error" in a) return { success: false, error: a.error };
  if (!canParticipate(a.role)) return { success: false, error: "Not authorized" };
  if (typeof channelId !== "string" || typeof body !== "string") {
    return { success: false, error: "Channel not found" };
  }

  const res = await sendTeamMessage(actorOf(a.user, a.role), channelId, { body, now: new Date() });
  if (!res.ok) {
    return { success: false, error: res.status === 404 ? "Channel not found" : res.message };
  }
  fireEffects(res.effects);
  const m = res.value.row;
  return {
    success: true,
    data: {
      id: m.id,
      channelId: m.channelId,
      senderId: m.senderId,
      senderName: m.senderName,
      body: m.body,
      createdAt: m.createdAt.toISOString(),
      editedAt: null,
      deleted: false,
    },
  };
}

/**
 * Create an additional channel, optionally with an initial member list.
 * Admin only. Member ids are validated against active cleaners — unknown or
 * inactive ids are silently dropped.
 */
export async function createGroupChannel(
  name: string,
  memberIds: string[] = []
): Promise<Result<GroupChannelDTO>> {
  const a = await requireUser();
  if ("error" in a) return { success: false, error: a.error };
  if (!isAdminRole(a.role)) return { success: false, error: "Not authorized" };

  const trimmed = name.trim();
  if (!trimmed) return { success: false, error: "Channel name is required" };
  if (trimmed.length > 60) {
    return { success: false, error: "Channel name is too long (max 60 characters)" };
  }

  const requested = Array.isArray(memberIds)
    ? [...new Set(memberIds.filter((id) => typeof id === "string" && id))]
    : [];
  if (requested.length > 200) {
    return { success: false, error: "Too many members" };
  }

  const validUsers = requested.length
    ? await db.user.findMany({
        where: {
          id: { in: requested },
          role: { in: ["EMPLOYEE", "FIELD_LEAD", "OPS_MANAGER", "ADMIN", "OWNER"] },
          isActive: true,
          deletedAt: null,
        },
        select: { id: true },
      })
    : [];

  const channel = await db.groupChannel.create({
    data: {
      name: trimmed,
      isDefault: false,
      isActive: true,
      createdById: a.user.id,
      members: { create: validUsers.map((u) => ({ userId: u.id })) },
    },
  });

  return {
    success: true,
    data: {
      id: channel.id,
      name: channel.name,
      isDefault: channel.isDefault,
      isDirect: channel.isDirect,
      unreadCount: 0,
    },
  };
}

/** Add a member to a custom (non-default, non-direct) channel. Admin only. */
export async function addChannelMember(
  channelId: string,
  userId: string
): Promise<Result<{ userId: string }>> {
  const a = await requireUser();
  if ("error" in a) return { success: false, error: a.error };
  if (!isAdminRole(a.role)) return { success: false, error: "Not authorized" };

  const channel = await db.groupChannel.findUnique({ where: { id: channelId } });
  if (!channel || !channel.isActive) {
    return { success: false, error: "Channel not found" };
  }
  if (channel.isDefault) {
    return { success: false, error: "Everyone already belongs to the default channel" };
  }
  if (channel.isDirect) {
    return { success: false, error: "Direct conversations cannot be edited" };
  }

  const user = await db.user.findFirst({
    where: {
      id: userId,
      role: { in: ["EMPLOYEE", "FIELD_LEAD", "OPS_MANAGER", "ADMIN", "OWNER"] },
      isActive: true,
      deletedAt: null,
    },
    select: { id: true },
  });
  if (!user) return { success: false, error: "User not found" };

  await db.groupChannelMember.upsert({
    where: { channelId_userId: { channelId, userId } },
    create: { channelId, userId },
    update: {},
  });

  return { success: true, data: { userId } };
}

/** Remove a member from a custom channel. Admin only. */
export async function removeChannelMember(
  channelId: string,
  userId: string
): Promise<Result<{ userId: string }>> {
  const a = await requireUser();
  if ("error" in a) return { success: false, error: a.error };
  if (!isAdminRole(a.role)) return { success: false, error: "Not authorized" };

  const channel = await db.groupChannel.findUnique({ where: { id: channelId } });
  if (!channel) return { success: false, error: "Channel not found" };
  if (channel.isDefault) {
    return { success: false, error: "The default channel has no member list" };
  }
  if (channel.isDirect) {
    return { success: false, error: "Direct conversations cannot be edited" };
  }

  await db.groupChannelMember.deleteMany({ where: { channelId, userId } });

  return { success: true, data: { userId } };
}

/**
 * Open (or create) the 1:1 direct conversation between the caller and another
 * staff member. Enforces the team-chat DM setting server-side, and is
 * race-safe: one direct conversation per pair.
 */
export async function getOrCreateDirectChannel(
  otherUserId: string
): Promise<Result<GroupChannelDTO>> {
  const a = await requireUser();
  if ("error" in a) return { success: false, error: a.error };
  if (!canParticipate(a.role)) return { success: false, error: "Not authorized" };

  const res = await openDirectChannel(actorOf(a.user, a.role), otherUserId);
  if (!res.ok) {
    return { success: false, error: res.status === 404 ? "User not found" : res.message };
  }
  return {
    success: true,
    data: { id: res.value.id, name: res.value.name, isDefault: false, isDirect: true, unreadCount: res.value.unreadCount },
  };
}

/**
 * Soft-delete (moderate) a message. Moderators only (isAdminRole: OWNER,
 * ADMIN, OPS_MANAGER). The shared moderation service
 * (server/messages/team-chat.ts moderateTeamMessage), the one the phone's
 * DELETE /manager/team/channels/:c/messages/:m runs.
 */
export async function deleteGroupMessage(
  messageId: string
): Promise<Result<{ id: string }>> {
  const a = await requireUser();
  if ("error" in a) return { success: false, error: a.error };
  if (!isAdminRole(a.role)) return { success: false, error: "Not authorized" };

  if (typeof messageId !== "string" || !messageId) {
    return { success: false, error: "Message not found" };
  }
  const res = await moderateTeamMessage(
    actorOf(a.user, a.role),
    null,
    messageId,
    new Date(),
    "web",
  );
  if (!res.ok) return { success: false, error: res.status === 404 ? "Message not found" : res.message };
  return { success: true, data: { id: res.value.id } };
}
