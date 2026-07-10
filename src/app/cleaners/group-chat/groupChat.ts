"use server";

import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { db } from "@/db";

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
  body: string;
  createdAt: string;
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

/**
 * Server-side channel access check. The default channel is open to all staff;
 * admins see everything (moderation); everyone else must have a member row.
 */
async function canAccessChannel(
  channel: { id: string; isDefault: boolean },
  userId: string,
  role: AppRole
): Promise<boolean> {
  if (!canParticipate(role)) return false;
  if (channel.isDefault) return true;
  if (isAdminRole(role)) return true;
  const member = await db.groupChannelMember.findUnique({
    where: { channelId_userId: { channelId: channel.id, userId } },
  });
  return !!member;
}

// ---- Team chat settings (AppSetting, key "team.chat") ------------------------

const TEAM_CHAT_KEY = "team.chat";

const DEFAULT_TEAM_CHAT: TeamChatSettingsDTO = {
  dmEnabled: true,
  showContactInfo: false,
};

async function readTeamChatSettings(): Promise<TeamChatSettingsDTO> {
  try {
    const row = await db.appSetting.findUnique({
      where: { key: TEAM_CHAT_KEY },
    });
    const raw = (row?.value ?? null) as {
      dmEnabled?: unknown;
      showContactInfo?: unknown;
    } | null;
    return {
      dmEnabled:
        typeof raw?.dmEnabled === "boolean"
          ? raw.dmEnabled
          : DEFAULT_TEAM_CHAT.dmEnabled,
      showContactInfo:
        typeof raw?.showContactInfo === "boolean"
          ? raw.showContactInfo
          : DEFAULT_TEAM_CHAT.showContactInfo,
    };
  } catch {
    // Fail safe: defaults keep chat usable and contact info hidden.
    return { ...DEFAULT_TEAM_CHAT };
  }
}

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

  await db.appSetting.upsert({
    where: { key: TEAM_CHAT_KEY },
    create: { key: TEAM_CHAT_KEY, category: "team", value: next as never },
    update: { category: "team", value: next as never },
  });

  return { success: true, data: next };
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

/**
 * Channels visible to the caller: default channel for all staff, custom
 * channels for admins + their members, DMs for their two members (admins see
 * them too, for moderation). Default first, then groups, then DMs.
 */
export async function listGroupChannels(): Promise<Result<GroupChannelDTO[]>> {
  const a = await requireUser();
  if ("error" in a) return { success: false, error: a.error };
  if (!canParticipate(a.role)) return { success: false, error: "Not authorized" };

  await ensureDefaultChannel();

  const admin = isAdminRole(a.role);
  const channels = await db.groupChannel.findMany({
    where: {
      isActive: true,
      ...(admin
        ? {}
        : {
            OR: [
              { isDefault: true },
              { members: { some: { userId: a.user.id } } },
            ],
          }),
    },
    orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
    include: { members: { select: { userId: true } } },
  });

  // Resolve names for DM participants so direct channels can be titled with
  // the other member's name (or both names for a moderating admin).
  const dmUserIds = new Set<string>();
  for (const c of channels) {
    if (c.isDirect) for (const m of c.members) dmUserIds.add(m.userId);
  }
  const nameById = new Map<string, string>();
  if (dmUserIds.size > 0) {
    const users = await db.user.findMany({
      where: { id: { in: [...dmUserIds] } },
      select: { id: true, name: true },
    });
    for (const u of users) nameById.set(u.id, u.name);
  }

  const sorted = [...channels].sort((x, y) => {
    if (x.isDefault !== y.isDefault) return x.isDefault ? -1 : 1;
    if (x.isDirect !== y.isDirect) return x.isDirect ? 1 : -1;
    return x.createdAt.getTime() - y.createdAt.getTime();
  });

  // Per-channel unread badge: messages newer than the caller's read cursor
  // (GroupChannelRead.lastReadAt) that the caller did not send themselves.
  // No cursor yet → every message from others counts as unread.
  const reads = await db.groupChannelRead.findMany({
    where: { userId: a.user.id, channelId: { in: sorted.map((c) => c.id) } },
    select: { channelId: true, lastReadAt: true },
  });
  const lastReadById = new Map(reads.map((r) => [r.channelId, r.lastReadAt]));
  const unreadById = new Map<string, number>();
  await Promise.all(
    sorted.map(async (c) => {
      const lastReadAt = lastReadById.get(c.id);
      const count = await db.groupMessage.count({
        where: {
          channelId: c.id,
          deletedAt: null,
          senderId: { not: a.user.id },
          ...(lastReadAt ? { createdAt: { gt: lastReadAt } } : {}),
        },
      });
      unreadById.set(c.id, count);
    })
  );

  return {
    success: true,
    data: sorted.map((c) => {
      let name = c.name;
      if (c.isDirect) {
        const others = c.members.filter((m) => m.userId !== a.user.id);
        if (others.length !== c.members.length) {
          // Caller is a member — title the DM with the other person's name.
          name = others.map((m) => nameById.get(m.userId) ?? "Unknown").join(", ") || c.name;
        } else {
          // Moderating admin who is not a member — show both participants.
          name = c.members
            .map((m) => nameById.get(m.userId) ?? "Unknown")
            .join(" ↔ ") || c.name;
        }
      }
      return {
        id: c.id,
        name,
        isDefault: c.isDefault,
        isDirect: c.isDirect,
        unreadCount: unreadById.get(c.id) ?? 0,
      };
    }),
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

  const channel = await db.groupChannel.findUnique({ where: { id: channelId } });
  if (!channel) return { success: false, error: "Channel not found" };
  if (!(await canAccessChannel(channel, a.user.id, a.role))) {
    return { success: false, error: "Not authorized" };
  }

  const now = new Date();
  await db.groupChannelRead.upsert({
    where: { channelId_userId: { channelId, userId: a.user.id } },
    create: { channelId, userId: a.user.id, lastReadAt: now },
    update: { lastReadAt: now },
  });

  return { success: true, data: { channelId } };
}

/** Non-deleted messages for a channel, oldest first. Members only. */
export async function getGroupMessages(
  channelId: string
): Promise<Result<GroupMessageDTO[]>> {
  const a = await requireUser();
  if ("error" in a) return { success: false, error: a.error };
  if (!canParticipate(a.role)) return { success: false, error: "Not authorized" };

  const channel = await db.groupChannel.findUnique({ where: { id: channelId } });
  if (!channel) return { success: false, error: "Channel not found" };
  if (!(await canAccessChannel(channel, a.user.id, a.role))) {
    return { success: false, error: "Not authorized" };
  }

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

  const settings = await readTeamChatSettings();
  if (!settings.dmEnabled && !isAdminRole(a.role)) {
    return {
      success: true,
      data: { dmEnabled: false, showContactInfo: settings.showContactInfo, cleaners: [] },
    };
  }

  const cleaners = await db.user.findMany({
    where: {
      role: "EMPLOYEE",
      isActive: true,
      deletedAt: null,
      id: { not: a.user.id },
    },
    select: { id: true, name: true, phone: true, email: true },
    orderBy: { name: "asc" },
  });

  return {
    success: true,
    data: {
      dmEnabled: settings.dmEnabled,
      showContactInfo: settings.showContactInfo,
      cleaners: cleaners.map((c) => ({
        id: c.id,
        name: c.name,
        phone: settings.showContactInfo ? c.phone ?? null : null,
        email: settings.showContactInfo ? c.email : null,
      })),
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

  const trimmed = body.trim();
  if (!trimmed) return { success: false, error: "Message cannot be empty" };
  if (trimmed.length > 4000) {
    return { success: false, error: "Message is too long (max 4000 characters)" };
  }

  const channel = await db.groupChannel.findUnique({ where: { id: channelId } });
  if (!channel || !channel.isActive) {
    return { success: false, error: "Channel not found" };
  }
  if (!(await canAccessChannel(channel, a.user.id, a.role))) {
    return { success: false, error: "Not authorized" };
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
 * staff member. Enforces the team-chat DM setting server-side.
 */
export async function getOrCreateDirectChannel(
  otherUserId: string
): Promise<Result<GroupChannelDTO>> {
  const a = await requireUser();
  if ("error" in a) return { success: false, error: a.error };
  if (!canParticipate(a.role)) return { success: false, error: "Not authorized" };

  if (typeof otherUserId !== "string" || !otherUserId) {
    return { success: false, error: "User is required" };
  }
  if (otherUserId === a.user.id) {
    return { success: false, error: "You cannot message yourself" };
  }

  const settings = await readTeamChatSettings();
  if (!settings.dmEnabled && !isAdminRole(a.role)) {
    return { success: false, error: "Direct messages are disabled" };
  }

  const other = await db.user.findFirst({
    where: {
      id: otherUserId,
      role: { in: ["EMPLOYEE", "FIELD_LEAD", "OPS_MANAGER", "ADMIN", "OWNER"] },
      isActive: true,
      deletedAt: null,
    },
    select: { id: true, name: true },
  });
  if (!other) return { success: false, error: "User not found" };

  // DMs always have exactly two member rows, so a direct channel containing
  // both users IS the pair's conversation.
  const existing = await db.groupChannel.findFirst({
    where: {
      isDirect: true,
      isActive: true,
      AND: [
        { members: { some: { userId: a.user.id } } },
        { members: { some: { userId: other.id } } },
      ],
    },
  });
  if (existing) {
    return {
      success: true,
      data: { id: existing.id, name: other.name, isDefault: false, isDirect: true, unreadCount: 0 },
    };
  }

  const channel = await db.groupChannel.create({
    data: {
      name: "Direct message",
      isDefault: false,
      isActive: true,
      isDirect: true,
      createdById: a.user.id,
      members: { create: [{ userId: a.user.id }, { userId: other.id }] },
    },
  });

  return {
    success: true,
    data: { id: channel.id, name: other.name, isDefault: false, isDirect: true, unreadCount: 0 },
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
