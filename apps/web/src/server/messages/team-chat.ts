// Team chat: channels, their messages, direct messages, and the directory
// (messages.ts, "Team chat"). The web's groupChat.ts actions and the v1 routes
// both call these, so the rules can't drift.
//
// Who may do what is the web's, unchanged:
//   canParticipate    any staff role; never a CLIENT or an unknown role.
//   canAccessChannel  the DEFAULT channel is open to all staff; any other
//                     channel only to its members, except that OWNER, ADMIN
//                     and OPS_MANAGER see every channel (moderation).
// A channel the caller can't access is the same answer as one that doesn't
// exist (null here, 404 on the wire), so channel ids can't be probed.
//
// Blocking (./blocks.ts) leaves a blocked person's messages out of the
// blocker's lists and unread counts, and stops direct messages between the
// two either way round.
//
// Editing and deleting are the caller's OWN messages only, whatever their
// role. Removing someone else's is moderation (groupChat.ts
// deleteGroupMessage, and the manager API), not this.
import "server-only";

import { Prisma } from "@prisma/client";
import type { TeamChannel, TeamMessage } from "@bookmops/api/v1";

import { logActivity } from "@/lib/activity-log";
import { requireOrgId } from "@/lib/org";
import { db } from "@/lib/org-db";

import type { Actor } from "../actor";
import { teamMessagePush } from "../push/notify";
import { failure, notFound, ok, type Result } from "../result";
import { BLOCKED, blockedEitherWay, blockedIdsFor } from "./blocks";
import { decodeCursor, NEWEST_FIRST, olderThan, pageOf } from "./cursor";
import { MESSAGE_BODY_MAX, MESSAGE_EMPTY, MESSAGE_TOO_LONG } from "./office-chat";

// ── Roles ───────────────────────────────────────────────────────────────────

const STAFF_ROLES = ["OWNER", "ADMIN", "OPS_MANAGER", "FIELD_LEAD", "EMPLOYEE"] as const;
const MODERATOR_ROLES = ["OWNER", "ADMIN", "OPS_MANAGER"] as const;

export function canParticipate(role: string | null | undefined): boolean {
  return !!role && (STAFF_ROLES as readonly string[]).includes(role);
}

/** Sees every channel, and may manage channels and remove anyone's message. */
export function isModerator(role: string | null | undefined): boolean {
  return !!role && (MODERATOR_ROLES as readonly string[]).includes(role);
}

const CHANNEL_NOT_FOUND = "This conversation isn't available.";
const MESSAGE_NOT_FOUND = "This message isn't available.";

// ── Settings (AppSetting "team.chat") ─────────────────────────────────────

export interface TeamChatSettings {
  dmEnabled: boolean;
  showContactInfo: boolean;
}

export const TEAM_CHAT_KEY = "team.chat";
const DEFAULT_TEAM_CHAT: TeamChatSettings = { dmEnabled: true, showContactInfo: false };

export async function readTeamChatSettings(): Promise<TeamChatSettings> {
  try {
    const row = await db.appSetting.findFirst({ where: { key: TEAM_CHAT_KEY } });
    const raw = (row?.value ?? null) as { dmEnabled?: unknown; showContactInfo?: unknown } | null;
    return {
      dmEnabled: typeof raw?.dmEnabled === "boolean" ? raw.dmEnabled : DEFAULT_TEAM_CHAT.dmEnabled,
      showContactInfo:
        typeof raw?.showContactInfo === "boolean" ? raw.showContactInfo : DEFAULT_TEAM_CHAT.showContactInfo,
    };
  } catch {
    // Fail safe: defaults keep chat usable and contact info hidden.
    return { ...DEFAULT_TEAM_CHAT };
  }
}

/**
 * Whether this caller may use direct messages. The setting gates cleaners; the
 * office (moderators) is never locked out of it, as on the web.
 */
function dmAllowed(actor: Actor, settings: TeamChatSettings): boolean {
  return settings.dmEnabled || isModerator(actor.role);
}

// ── Channels ────────────────────────────────────────────────────────────────

const DEFAULT_CHANNEL_NAME = "All Cleaners";

/**
 * A transaction-scoped lock on a name, so two requests racing to create the
 * same row (the default channel, one pair's direct channel) take turns. The
 * name is hashed into Postgres's advisory-lock space; a collision only makes
 * two unrelated creations wait for each other.
 */
async function lockFor(tx: { $executeRaw: (q: TemplateStringsArray, ...v: unknown[]) => Promise<unknown> }, name: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${name}))`;
}

/** The company's one default channel, created on first use; race-safe. */
export async function ensureDefaultChannel() {
  const existing = await db.groupChannel.findFirst({ where: { isDefault: true }, orderBy: { createdAt: "asc" } });
  if (existing) return existing;
  const orgId = await requireOrgId();
  return db.$transaction(async (tx) => {
    await lockFor(tx, `team-default-channel:${orgId}`);
    const again = await tx.groupChannel.findFirst({ where: { isDefault: true }, orderBy: { createdAt: "asc" } });
    if (again) return again;
    return tx.groupChannel.create({ data: { name: DEFAULT_CHANNEL_NAME, isDefault: true, isActive: true } });
  });
}

type ChannelRow = {
  id: string;
  name: string;
  isDefault: boolean;
  isDirect: boolean;
  isActive: boolean;
  createdAt: Date;
};

/**
 * The channel, when the caller may access it; null otherwise (not found, not
 * a member, not staff). `active` also requires the channel be active.
 */
export async function accessibleChannel(
  actor: Actor,
  channelId: string,
  opts: { active?: boolean } = {},
): Promise<ChannelRow | null> {
  if (!canParticipate(actor.role)) return null;
  if (typeof channelId !== "string" || !channelId) return null;
  const channel = await db.groupChannel.findFirst({
    where: { id: channelId },
    select: { id: true, name: true, isDefault: true, isDirect: true, isActive: true, createdAt: true },
  });
  if (!channel) return null;
  if (opts.active && !channel.isActive) return null;
  if (channel.isDefault || isModerator(actor.role)) return channel;
  const member = await db.groupChannelMember.findFirst({
    where: { channelId: channel.id, userId: actor.userId },
    select: { id: true },
  });
  return member ? channel : null;
}

async function unreadCount(actor: Actor, channelId: string, blocked: readonly string[]): Promise<number> {
  const read = await db.groupChannelRead.findFirst({
    where: { channelId, userId: actor.userId },
    select: { lastReadAt: true },
  });
  return db.groupMessage.count({
    where: {
      channelId,
      deletedAt: null,
      // Nobody the caller blocked counts as unread either.
      senderId: { notIn: [actor.userId, ...blocked] },
      ...(read ? { createdAt: { gt: read.lastReadAt } } : {}),
    },
  });
}

/** A direct channel is titled with the other member's name (both, for a moderator who isn't in it). */
async function channelTitles(actor: Actor, channels: { id: string; name: string; isDirect: boolean }[]) {
  const direct = channels.filter((c) => c.isDirect).map((c) => c.id);
  const titles = new Map<string, string>();
  if (direct.length === 0) return titles;
  const members = await db.groupChannelMember.findMany({
    where: { channelId: { in: direct } },
    select: { channelId: true, userId: true },
    orderBy: { createdAt: "asc" },
  });
  const users = await db.user.findMany({
    where: { id: { in: [...new Set(members.map((m) => m.userId))] } },
    select: { id: true, name: true },
  });
  const nameById = new Map(users.map((u) => [u.id, u.name]));
  for (const c of channels.filter((x) => x.isDirect)) {
    const ids = members.filter((m) => m.channelId === c.id).map((m) => m.userId);
    const others = ids.filter((id) => id !== actor.userId);
    const title =
      others.length !== ids.length
        ? others.map((id) => nameById.get(id) ?? "Unknown").join(", ")
        : ids.map((id) => nameById.get(id) ?? "Unknown").join(" ↔ ");
    titles.set(c.id, title || c.name);
  }
  return titles;
}

function kindOf(c: { isDefault: boolean; isDirect: boolean }): "DEFAULT" | "GROUP" | "DIRECT" {
  return c.isDefault ? "DEFAULT" : c.isDirect ? "DIRECT" : "GROUP";
}

async function toTeamChannels(actor: Actor, channels: ChannelRow[]): Promise<TeamChannel[]> {
  const titles = await channelTitles(actor, channels);
  const blocked = await blockedIdsFor(actor.userId);
  const counts = await Promise.all(channels.map((c) => unreadCount(actor, c.id, blocked)));
  return channels.map((c, i) => ({
    id: c.id,
    name: titles.get(c.id) ?? c.name,
    kind: kindOf(c),
    unreadCount: counts[i],
  }));
}

/**
 * The channels the caller can access: the default channel first, then groups
 * by age, then direct conversations. Members-only for crew; every channel for
 * a moderator. Creates the default channel if it is missing.
 */
export async function listTeamChannels(
  actor: Actor,
): Promise<Result<{ items: TeamChannel[]; nextCursor: null; dmEnabled: boolean }>> {
  if (!canParticipate(actor.role)) return failure(403, "FORBIDDEN", "Not authorized");
  await ensureDefaultChannel();
  const channels = await db.groupChannel.findMany({
    where: {
      isActive: true,
      ...(isModerator(actor.role)
        ? {}
        : { OR: [{ isDefault: true }, { members: { some: { userId: actor.userId } } }] }),
    },
    orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
    select: { id: true, name: true, isDefault: true, isDirect: true, isActive: true, createdAt: true },
  });
  const sorted = [...channels].sort((x, y) => {
    if (x.isDefault !== y.isDefault) return x.isDefault ? -1 : 1;
    if (x.isDirect !== y.isDirect) return x.isDirect ? 1 : -1;
    return x.createdAt.getTime() - y.createdAt.getTime() || x.id.localeCompare(y.id);
  });
  const settings = await readTeamChatSettings();
  return ok({ items: await toTeamChannels(actor, sorted), nextCursor: null, dmEnabled: settings.dmEnabled });
}

export async function getTeamChannel(actor: Actor, channelId: string): Promise<Result<TeamChannel>> {
  const channel = await accessibleChannel(actor, channelId, { active: true });
  if (!channel) return notFound(CHANNEL_NOT_FOUND);
  const [one] = await toTeamChannels(actor, [channel]);
  return ok(one);
}

/** Stamp the caller's read cursor to now, and only theirs. */
export async function markTeamChannelRead(
  actor: Actor,
  channelId: string,
  now: Date,
): Promise<Result<{ channelId: string }>> {
  const channel = await accessibleChannel(actor, channelId);
  if (!channel) return notFound(CHANNEL_NOT_FOUND);
  await db.groupChannelRead.upsert({
    where: { channelId_userId: { channelId: channel.id, userId: actor.userId } },
    create: { channelId: channel.id, userId: actor.userId, lastReadAt: now },
    update: { lastReadAt: now },
  });
  return ok({ channelId: channel.id });
}

// ── Messages ────────────────────────────────────────────────────────────────

export const TEAM_MESSAGE_SELECT = {
  id: true,
  channelId: true,
  senderId: true,
  senderName: true,
  body: true,
  clientEventId: true,
  createdAt: true,
  editedAt: true,
  deletedAt: true,
} as const;

export type TeamMessageRow = {
  id: string;
  channelId: string;
  senderId: string;
  senderName: string;
  body: string;
  clientEventId: string | null;
  createdAt: Date;
  editedAt: Date | null;
  deletedAt: Date | null;
};

/**
 * The wire shape. A deleted message keeps its place with no text, for
 * everyone, the moderator and the sender included; its original body stays on
 * the row server-side and is never sent.
 */
export function toTeamMessage(m: TeamMessageRow, actor: Actor): TeamMessage {
  const fromMe = m.senderId === actor.userId;
  const deleted = !!m.deletedAt;
  return {
    id: m.id,
    channelId: m.channelId,
    clientEventId: fromMe ? m.clientEventId : null,
    fromMe,
    senderId: m.senderId,
    senderName: m.senderName,
    body: deleted ? "" : m.body,
    createdAt: m.createdAt.toISOString(),
    editedAt: m.editedAt ? m.editedAt.toISOString() : null,
    deleted,
  };
}

const PAGE_SIZE = 50;

/**
 * Newest first, deleted ones included as placeholders. Moves no read cursor.
 * Messages from anyone the caller blocked are left out after the page is
 * read, so the cursor still walks every message; `hiddenCount` is how many
 * this page left out.
 */
export async function listTeamMessages(
  actor: Actor,
  channelId: string,
  cursorRaw: string | undefined,
): Promise<Result<{ items: TeamMessage[]; nextCursor: string | null; hiddenCount: number }>> {
  const cursor = decodeCursor(cursorRaw);
  if (cursor === "invalid") return failure(400, "VALIDATION_FAILED", "That page link isn't valid. Refresh and try again.");
  const channel = await accessibleChannel(actor, channelId);
  if (!channel) return notFound(CHANNEL_NOT_FOUND);
  const rows = await db.groupMessage.findMany({
    where: { channelId: channel.id, ...olderThan(cursor) },
    orderBy: NEWEST_FIRST,
    take: PAGE_SIZE + 1,
    select: TEAM_MESSAGE_SELECT,
  });
  const page = pageOf(rows, PAGE_SIZE);
  const blocked = new Set(await blockedIdsFor(actor.userId));
  const shown = page.rows.filter((m) => !blocked.has(m.senderId));
  return ok({
    items: shown.map((m) => toTeamMessage(m, actor)),
    nextCursor: page.nextCursor,
    hiddenCount: page.rows.length - shown.length,
  });
}

function checkBody(body: string): { ok: true; text: string } | { ok: false; message: string } {
  const text = typeof body === "string" ? body.trim() : "";
  if (!text) return { ok: false, message: MESSAGE_EMPTY };
  if (text.length > MESSAGE_BODY_MAX) return { ok: false, message: MESSAGE_TOO_LONG };
  return { ok: true, text };
}

/** Post to a channel. Sender id and name come from the actor, never the request. */
export async function sendTeamMessage(
  actor: Actor,
  channelId: string,
  input: { body: string; clientEventId?: string | null; now: Date },
): Promise<Result<{ message: TeamMessage; row: TeamMessageRow }>> {
  const body = checkBody(input.body);
  if (!body.ok) return failure(400, "VALIDATION_FAILED", body.message);
  const channel = await accessibleChannel(actor, channelId, { active: true });
  if (!channel) return notFound(CHANNEL_NOT_FOUND);
  if (channel.isDirect && (await directBlocked(actor, channel.id))) return failure(403, "BLOCKED", BLOCKED);

  const findPrior = () =>
    input.clientEventId
      ? db.groupMessage.findFirst({
          where: { senderId: actor.userId, clientEventId: input.clientEventId },
          select: TEAM_MESSAGE_SELECT,
        })
      : Promise.resolve(null);

  // A retry past the idempotency record's life finds the message it made.
  const prior = await findPrior();
  if (prior) {
    if (prior.channelId !== channel.id) return failure(422, "IDEMPOTENCY_KEY_REUSED", "This message was already sent somewhere else.");
    return ok({ message: toTeamMessage(prior, actor), row: prior });
  }

  try {
    const row = await db.groupMessage.create({
      data: {
        channelId: channel.id,
        senderId: actor.userId,
        senderName: actor.name ?? "Unknown",
        body: body.text,
        clientEventId: input.clientEventId ?? null,
        createdAt: input.now,
      },
      select: TEAM_MESSAGE_SELECT,
    });
    // Only a message just written pushes; either replay above returns without.
    return ok({ message: toTeamMessage(row, actor), row }, [teamMessagePush(channel.id, actor.userId, actor.name)]);
  } catch (e) {
    if (input.clientEventId && e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      const again = await findPrior();
      if (again && again.channelId === channel.id) return ok({ message: toTeamMessage(again, actor), row: again });
    }
    throw e;
  }
}

/**
 * Whether a direct channel the caller is IN joins them to someone they
 * blocked, or who blocked them. A moderator reading a direct channel they
 * aren't in isn't one of its pair, so no block applies to them.
 */
async function directBlocked(actor: Actor, channelId: string): Promise<boolean> {
  const members = await db.groupChannelMember.findMany({ where: { channelId }, select: { userId: true } });
  if (!members.some((m) => m.userId === actor.userId)) return false;
  for (const m of members) {
    if (m.userId !== actor.userId && (await blockedEitherWay(actor.userId, m.userId))) return true;
  }
  return false;
}

/** The caller's own message in this channel, or null (404 on the wire). */
async function ownMessage(actor: Actor, channelId: string, messageId: string) {
  if (typeof messageId !== "string" || !messageId) return null;
  return db.groupMessage.findFirst({
    where: { id: messageId, channelId, senderId: actor.userId },
    select: TEAM_MESSAGE_SELECT,
  });
}

/**
 * Edit the caller's own message: sets the body and editedAt, and nothing else
 * (not the sender, the time it was sent, or anyone's read cursor). A deleted
 * message can't be edited.
 *
 * The body being replaced is written to GroupMessageEdit first, in the same
 * transaction and under a lock on the message row, so concurrent edits each
 * record exactly the text they replaced. That history is for moderators only
 * (teamMessageEditsFor) and is never returned by anything else. There is no
 * time limit on editing (the owner hasn't decided one).
 */
export async function editTeamMessage(
  actor: Actor,
  channelId: string,
  messageId: string,
  input: { body: string; now: Date },
): Promise<Result<TeamMessage>> {
  const body = checkBody(input.body);
  if (!body.ok) return failure(400, "VALIDATION_FAILED", body.message);
  const channel = await accessibleChannel(actor, channelId, { active: true });
  if (!channel) return notFound(CHANNEL_NOT_FOUND);
  const message = await ownMessage(actor, channel.id, messageId);
  if (!message) return notFound(MESSAGE_NOT_FOUND);
  if (message.deletedAt) return failure(409, "MESSAGE_DELETED", "This message was deleted, so it can't be edited.");

  const organizationId = await requireOrgId();
  // Conditional on still being the sender's and not deleted, so an edit
  // racing a delete can't bring text back onto a deleted message.
  const applied = await db.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<{ body: string }[]>`
      SELECT "body" FROM "GroupMessage"
      WHERE "id" = ${message.id}
        AND "organizationId" = ${organizationId}
        AND "channelId" = ${channel.id}
        AND "senderId" = ${actor.userId}
        AND "deletedAt" IS NULL
      FOR UPDATE`;
    const current = locked[0];
    if (!current) return false;
    await tx.groupMessageEdit.create({
      data: { messageId: message.id, previousBody: current.body, editedAt: input.now, editedById: actor.userId },
      select: { id: true },
    });
    const updated = await tx.groupMessage.updateMany({
      where: { id: message.id, channelId: channel.id, senderId: actor.userId, deletedAt: null },
      data: { body: body.text, editedAt: input.now },
    });
    return updated.count === 1;
  });
  if (!applied) {
    const now = await ownMessage(actor, channel.id, message.id);
    if (!now) return notFound(MESSAGE_NOT_FOUND);
    return failure(409, "MESSAGE_DELETED", "This message was deleted, so it can't be edited.");
  }
  const row = await ownMessage(actor, channel.id, message.id);
  if (!row) return notFound(MESSAGE_NOT_FOUND);
  return ok(toTeamMessage(row, actor));
}

export interface TeamMessageEditView {
  previousBody: string;
  editedAt: string;
  editedById: string;
}

/**
 * A message's edit history, oldest first: what each edit replaced. For the
 * office's moderators (OWNER, ADMIN, OPS_MANAGER) only; anyone else, the
 * sender included, gets the same 404 as a message that doesn't exist, so the
 * history's existence isn't revealed either. Deleted messages keep their
 * history for moderation.
 */
export async function teamMessageEditsFor(
  actor: Actor,
  channelId: string,
  messageId: string,
): Promise<Result<TeamMessageEditView[]>> {
  if (!isModerator(actor.role)) return notFound(MESSAGE_NOT_FOUND);
  const channel = await accessibleChannel(actor, channelId);
  if (!channel) return notFound(CHANNEL_NOT_FOUND);
  if (typeof messageId !== "string" || !messageId) return notFound(MESSAGE_NOT_FOUND);
  const message = await db.groupMessage.findFirst({
    where: { id: messageId, channelId: channel.id },
    select: { id: true },
  });
  if (!message) return notFound(MESSAGE_NOT_FOUND);
  const edits = await db.groupMessageEdit.findMany({
    where: { messageId: message.id },
    orderBy: [{ editedAt: "asc" }, { id: "asc" }],
    select: { previousBody: true, editedAt: true, editedById: true },
  });
  return ok(
    edits.map((e) => ({ previousBody: e.previousBody, editedAt: e.editedAt.toISOString(), editedById: e.editedById })),
  );
}

/**
 * Delete the caller's own message. Soft: sets deletedAt and deletedById, and
 * keeps the text on the row, never served again. Deleting one already deleted
 * answers the same, so a retry is harmless.
 */
export async function deleteOwnTeamMessage(
  actor: Actor,
  channelId: string,
  messageId: string,
  now: Date,
): Promise<Result<{ id: string }>> {
  const channel = await accessibleChannel(actor, channelId);
  if (!channel) return notFound(CHANNEL_NOT_FOUND);
  const message = await ownMessage(actor, channel.id, messageId);
  if (!message) return notFound(MESSAGE_NOT_FOUND);
  if (!message.deletedAt) {
    await db.groupMessage.updateMany({
      where: { id: message.id, senderId: actor.userId, deletedAt: null },
      data: { deletedAt: now, deletedById: actor.userId },
    });
  }
  return ok({ id: message.id });
}

/**
 * Remove anyone's message: moderation, for OWNER, ADMIN and OPS_MANAGER
 * (isModerator). Soft, like a sender's own delete: deletedAt and deletedById
 * (the moderator) are set, and the body and attachment stay on the row for a
 * dispute, never served again. Conditional on not yet deleted, so when two
 * moderators remove the same message the first stays on record and the
 * activity line names only them. `channelId` is the channel the message must
 * be in (the phone's path); null for the web's action, which names only the
 * message. The web's deleteGroupMessage and the manager API both call this.
 */
export async function moderateTeamMessage(
  actor: Actor,
  channelId: string | null,
  messageId: string,
  now: Date,
  via: "web" | "app",
): Promise<Result<{ id: string }>> {
  if (!isModerator(actor.role)) return failure(403, "FORBIDDEN", "Your role can't do this.");
  if (typeof messageId !== "string" || !messageId) return notFound(MESSAGE_NOT_FOUND);
  if (channelId !== null && !(await accessibleChannel(actor, channelId))) return notFound(CHANNEL_NOT_FOUND);
  const message = await db.groupMessage.findFirst({
    where: { id: messageId, ...(channelId !== null ? { channelId } : {}) },
    select: { id: true, channelId: true, senderId: true, senderName: true, deletedAt: true },
  });
  if (!message) return notFound(MESSAGE_NOT_FOUND);
  if (message.deletedAt) return ok({ id: message.id });

  const removed = await db.groupMessage.updateMany({
    where: { id: message.id, deletedAt: null },
    data: { deletedAt: now, deletedById: actor.userId },
  });
  // WHO removed it: on the row, and in the activity log. Never the text:
  // removing it from view is the point.
  if (removed.count > 0) {
    await logActivity({
      category: "ADMIN",
      action: "groupchat.message.deleted",
      status: "SUCCESS",
      actorId: actor.userId,
      actorLabel: actor.name ?? null,
      targetType: "GroupMessage",
      targetId: message.id,
      message:
        `${actor.name ?? "An admin"} removed a team chat message from ${message.senderName}` +
        (via === "app" ? " from the app." : "."),
      metadata: { channelId: message.channelId, senderId: message.senderId },
    });
  }
  return ok({ id: message.id });
}

// ── Directory and direct messages ─────────────────────────────────────────

export interface DirectoryPerson {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
}

/**
 * The other active cleaners, to start a direct message with. Empty when
 * direct messages are off (for anyone the setting gates). Contact details only
 * when the company shows them. Never the caller, clients, inactive or deleted
 * people; the scoped client keeps it to the caller's company.
 */
export async function teamDirectory(
  actor: Actor,
): Promise<Result<{ items: DirectoryPerson[]; nextCursor: null; dmEnabled: boolean; showContactInfo: boolean }>> {
  if (!canParticipate(actor.role)) return failure(403, "FORBIDDEN", "Not authorized");
  const settings = await readTeamChatSettings();
  if (!dmAllowed(actor, settings)) {
    return ok({ items: [], nextCursor: null, dmEnabled: false, showContactInfo: settings.showContactInfo });
  }
  const people = await db.user.findMany({
    where: { role: "EMPLOYEE", isActive: true, deletedAt: null, id: { not: actor.userId } },
    select: { id: true, name: true, phone: true, email: true },
    orderBy: [{ name: "asc" }, { id: "asc" }],
  });
  return ok({
    items: people.map((p) => ({
      id: p.id,
      name: p.name,
      phone: settings.showContactInfo ? (p.phone ?? null) : null,
      email: settings.showContactInfo ? p.email : null,
    })),
    nextCursor: null,
    dmEnabled: settings.dmEnabled,
    showContactInfo: settings.showContactInfo,
  });
}

export const DM_DISABLED = "Direct messages are disabled";
export const DM_SELF = "You cannot message yourself";

/**
 * Open (or create) the direct conversation between the caller and another
 * active staff member of the caller's company. One per pair: the find and the
 * create run under a lock on the pair, so a double tap, a retry, or both people
 * tapping at once all land in the same conversation.
 */
export async function openDirectChannel(actor: Actor, otherUserId: string): Promise<Result<TeamChannel>> {
  if (!canParticipate(actor.role)) return failure(403, "FORBIDDEN", "Not authorized");
  if (typeof otherUserId !== "string" || !otherUserId) return failure(400, "VALIDATION_FAILED", "User is required");
  if (otherUserId === actor.userId) return failure(400, "CANNOT_MESSAGE_SELF", DM_SELF);

  const settings = await readTeamChatSettings();
  if (!dmAllowed(actor, settings)) return failure(403, "DIRECT_MESSAGES_OFF", DM_DISABLED);

  // Scoped: someone in another company is simply not found, the same answer
  // as nobody at all.
  const other = await db.user.findFirst({
    where: { id: otherUserId, role: { in: [...STAFF_ROLES] }, isActive: true, deletedAt: null },
    select: { id: true },
  });
  if (!other) return notFound("This person isn't available.");
  if (await blockedEitherWay(actor.userId, other.id)) return failure(403, "BLOCKED", BLOCKED);

  const orgId = await requireOrgId();
  const [a, b] = [actor.userId, other.id].sort();
  const channel = await db.$transaction(async (tx) => {
    await lockFor(tx, `team-direct:${orgId}:${a}:${b}`);
    const existing = await tx.groupChannel.findFirst({
      where: {
        isDirect: true,
        isActive: true,
        AND: [{ members: { some: { userId: a } } }, { members: { some: { userId: b } } }],
      },
      orderBy: { createdAt: "asc" },
      select: { id: true, name: true, isDefault: true, isDirect: true, isActive: true, createdAt: true },
    });
    if (existing) return existing;
    return tx.groupChannel.create({
      data: {
        name: "Direct message",
        isDefault: false,
        isActive: true,
        isDirect: true,
        createdById: actor.userId,
        members: { create: [{ userId: actor.userId }, { userId: other.id }] },
      },
      select: { id: true, name: true, isDefault: true, isDirect: true, isActive: true, createdAt: true },
    });
  });
  const [one] = await toTeamChannels(actor, [channel]);
  return ok(one);
}
