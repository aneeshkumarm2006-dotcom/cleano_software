// Messages: the cleaner's one conversation with the office, and team chat.
//
// Replaces, for the phone, the web's `admin/chat/actions.ts` (employee side:
// getEmployeeChat, sendChatMessage, markChatRead) and
// `cleaners/group-chat/groupChat.ts` (listGroupChannels, getGroupMessages,
// sendGroupMessage, markChannelRead, listCleanerDirectory,
// getOrCreateDirectChannel).
//
// There are no websockets in v1: the app polls these endpoints while a
// conversation is on screen. Every list is newest-first with a KEYSET cursor
// (createdAt, id) pointing older, never an offset, so a page the app already
// holds stays the same page while new messages arrive and the poll refetches.
//
// Sending is idempotent. The app makes a `clientEventId` when the person taps
// Send and also sends it as the Idempotency-Key, so a retry after a dropped
// connection posts the message once (API_V1.md §6). The server stores the id
// on the message and returns it to its sender, which is how the app matches a
// message it is still showing as "sending" to the one the server saved.
//
// In team chat a person can edit and delete their own messages. Office chat
// has neither.
import { z } from "zod";

import { Instant, openEnum, page } from "./common";

// ---- Vocabularies (frozen copies; see enums.ts for why) ----------------------

/** Who sent an office-chat message. */
export const OFFICE_SENDER_ROLES = ["EMPLOYEE", "ADMIN"] as const;

/** How far an office-chat message the cleaner sent has got. */
export const MESSAGE_RECEIPTS = ["SENT", "DELIVERED", "READ"] as const;

/** What a message attachment is, for how it is shown. */
export const ATTACHMENT_KINDS = ["IMAGE", "FILE"] as const;

/** What kind of team channel this is. */
export const TEAM_CHANNEL_KINDS = ["DEFAULT", "GROUP", "DIRECT"] as const;

/**
 * The longest message body, after trimming. The web's limit
 * (sendChatMessage and sendGroupMessage both refuse past 4000), so a message
 * typed on the phone is never one the web would refuse.
 */
export const MESSAGE_BODY_MAX = 4000;

/** What every send carries. */
export const SendMessageRequest = z.object({
  /** Trimmed text. The server trims again and refuses an empty body. */
  body: z.string().trim().min(1).max(MESSAGE_BODY_MAX),
  /** Made on the phone at the tap; also sent as the Idempotency-Key. */
  clientEventId: z.uuid(),
});
export type SendMessageRequest = z.infer<typeof SendMessageRequest>;

// ---- Office chat -------------------------------------------------------------

export const MessageAttachment = z.object({
  kind: openEnum(ATTACHMENT_KINDS),
  /**
   * An https URL on the company's own asset storage. Kept a plain string so
   * one odd legacy row can't fail a whole page: the SERVER leaves out any
   * attachment whose URL isn't https on its own storage (the web has stored
   * whatever URL a client sent). The app still opens only https, and loads an
   * image inline only from a trusted storage host.
   */
  url: z.string(),
  /** The file's name as uploaded, for a file attachment's label. */
  name: z.string().nullable(),
});
export type MessageAttachment = z.infer<typeof MessageAttachment>;

/** One message in the cleaner's conversation with the office. */
export const OfficeMessage = z.object({
  id: z.string(),
  /**
   * The id the sending phone made, returned only on the caller's OWN
   * messages (null on the office's, and on messages sent from the web).
   */
  clientEventId: z.string().nullable(),
  /** True when the signed-in cleaner sent it. */
  fromMe: z.boolean(),
  senderRole: openEnum(OFFICE_SENDER_ROLES),
  /** The sender's display name ("Marie D."). */
  senderName: z.string(),
  /** May be empty when the message is only an attachment. */
  body: z.string(),
  attachment: MessageAttachment.nullable(),
  createdAt: Instant,
  /** For the cleaner's own messages: has the office got it, or read it. */
  receipt: openEnum(MESSAGE_RECEIPTS),
});
export type OfficeMessage = z.infer<typeof OfficeMessage>;

/**
 * GET /api/v1/chat — the conversation's header.
 *
 * Server: staff only (v1Route `access: "staff"`). The conversation is always
 * the CALLER's own (found or created by their user id, as getEmployeeChat
 * does); no id is taken from the request, so there is nothing to probe.
 * Reading this does NOT mark anything read — that is POST /chat/read, so a
 * background poll never tells the office a message was seen.
 */
export const OfficeChatResponse = z.object({
  /** An office user was active in the last minute (the web's presence rule). */
  officeOnline: z.boolean(),
  /** Messages from the office the cleaner hasn't read. */
  unreadCount: z.number().int(),
});
export type OfficeChatResponse = z.infer<typeof OfficeChatResponse>;

/**
 * GET /api/v1/chat/messages?cursor= — newest first.
 *
 * Server: staff only; messages of the caller's own conversation only. Returns
 * no read timestamps and nothing about any other cleaner's conversation.
 */
export const OfficeMessagesResponse = page(OfficeMessage);
export type OfficeMessagesResponse = z.infer<typeof OfficeMessagesResponse>;

/**
 * POST /api/v1/chat/messages — body: SendMessageRequest. Idempotent.
 * Response: the saved OfficeMessage.
 *
 * Server: staff only; posts to the caller's OWN conversation with
 * senderRole EMPLOYEE, a FIELD_LEAD included (never taken from the request,
 * nor from the caller's role as the web's sendChatMessage does; see
 * ./manager-messages.ts). Trims, refuses empty or
 * over MESSAGE_BODY_MAX (400). Keeps the web's side effects: delivery state
 * from the office's presence, and the email to the office when nobody is
 * online (as an effect, flushed after the response, and not re-sent on an
 * idempotent replay).
 */
export const SendOfficeMessageResponse = OfficeMessage;

/**
 * POST /api/v1/chat/read — no body. Idempotent by nature.
 *
 * Server: staff only; stamps readByEmployeeAt on the office's messages in the
 * caller's OWN conversation, and nothing else.
 */
export const MarkReadResponse = z.object({ unreadCount: z.number().int() });
export type MarkReadResponse = z.infer<typeof MarkReadResponse>;

// ---- Team chat ----------------------------------------------------------------
//
// Who may do what is the web's, unchanged (groupChat.ts):
//   canParticipate  — any staff role; never a CLIENT.
//   canAccessChannel — the DEFAULT channel is open to all staff; any other
//                      channel only to its members, except that OWNER, ADMIN
//                      and OPS_MANAGER see every channel (moderation).
// The team endpoints below admit every staff role: the `staff` list
// (EMPLOYEE, FIELD_LEAD) and the office roles (OWNER, ADMIN, OPS_MANAGER),
// who use the manager side of the app (./manager-access.ts). A FIELD_LEAD is
// a member like any cleaner. Removing someone ELSE's message is
// ./manager-messages.ts, for TEAM_MODERATE only; the edit and delete here
// stay the caller's own messages, whatever their role.
// A channel the caller can't access answers 404, exactly like one that
// doesn't exist (API_V1.md §3), so channel ids can't be probed.

export const TeamChannel = z.object({
  id: z.string(),
  /**
   * What to call it. For a DIRECT channel the server titles it with the OTHER
   * member's name, as the web does.
   */
  name: z.string(),
  kind: openEnum(TEAM_CHANNEL_KINDS),
  /** Messages from others newer than the caller's read cursor. */
  unreadCount: z.number().int(),
});
export type TeamChannel = z.infer<typeof TeamChannel>;

/**
 * GET /api/v1/team/channels — the channels the caller can access: the default
 * channel first, then groups by age, then direct conversations.
 *
 * Server: any staff role; listGroupChannels' filter for the caller's role
 * (members-only for EMPLOYEE and FIELD_LEAD, every channel for OWNER, ADMIN
 * and OPS_MANAGER). Creates the default channel if missing.
 */
export const TeamChannelsResponse = page(TeamChannel).extend({
  /** Whether the company lets cleaners start direct messages. */
  dmEnabled: z.boolean(),
});
export type TeamChannelsResponse = z.infer<typeof TeamChannelsResponse>;

/**
 * GET /api/v1/team/channels/:channelId — one channel, for a conversation
 * opened directly (from a notification, or a deep link).
 *
 * Server: canAccessChannel, else 404. Inactive channels answer 404.
 */
export const TeamChannelResponse = TeamChannel;

export const TeamMessage = z.object({
  id: z.string(),
  channelId: z.string(),
  /** The sending phone's id, on the caller's OWN messages only. */
  clientEventId: z.string().nullable(),
  fromMe: z.boolean(),
  senderId: z.string(),
  /** As stored when it was sent; no contact details. */
  senderName: z.string(),
  /** Empty when `deleted`: a deleted message's text is never sent. */
  body: z.string(),
  createdAt: Instant,
  /** When its sender last edited it; null if never. */
  editedAt: Instant.nullable(),
  /**
   * Its sender deleted it (or the office removed it). Shown to everyone as
   * "Message deleted", in its place in the conversation.
   */
  deleted: z.boolean(),
});
export type TeamMessage = z.infer<typeof TeamMessage>;

/**
 * GET /api/v1/team/channels/:channelId/messages?cursor= — newest first.
 * Soft-deleted messages are included, with `deleted: true` and an empty
 * body, so everyone sees where one was.
 *
 * Server: canAccessChannel, else 404. Does not move the read cursor.
 */
export const TeamMessagesResponse = page(TeamMessage);
export type TeamMessagesResponse = z.infer<typeof TeamMessagesResponse>;

/**
 * POST /api/v1/team/channels/:channelId/messages — body: SendMessageRequest.
 * Idempotent. Response: the saved TeamMessage.
 *
 * Server: canAccessChannel (else 404) and the channel is active. Sender id
 * and name come from the session, never the request. Trims, refuses empty or
 * over MESSAGE_BODY_MAX.
 */
export const SendTeamMessageResponse = TeamMessage;

/**
 * PATCH /api/v1/team/channels/:channelId/messages/:messageId — edit the
 * caller's own message. Body: EditTeamMessageRequest (the same rules as a
 * send). Idempotent on `clientEventId`, also sent as the Idempotency-Key: a
 * retry of the same edit returns the same message. Response: the updated
 * TeamMessage.
 *
 * Server:
 *   - canAccessChannel (else 404), and the channel is active;
 *   - the message is in this channel and the CALLER sent it: anyone else's
 *     message answers 404, the same as one that doesn't exist, so an edit
 *     can't be used to probe ids. An office admin calling v1 as staff is no
 *     exception;
 *   - trims, refuses empty or over MESSAGE_BODY_MAX (400), as a send does;
 *   - a deleted message can't be edited (409 `MESSAGE_DELETED`);
 *   - sets `body` and `editedAt` to now, and nothing else: not the sender,
 *     the time it was sent, or anyone's read cursor;
 *   - counts against the team chat send limit (API_V1.md §4).
 * Needs `editedAt DateTime?` on GroupMessage (a schema change, staging
 * first). The web's chat doesn't show "edited" yet.
 */
export const EditTeamMessageRequest = SendMessageRequest;
export type EditTeamMessageRequest = z.infer<typeof EditTeamMessageRequest>;
export const EditTeamMessageResponse = TeamMessage;

/**
 * DELETE /api/v1/team/channels/:channelId/messages/:messageId — delete the
 * caller's own message. No body. Response: `{ id }`.
 *
 * Server: canAccessChannel (else 404); the message is in this channel and
 * the CALLER sent it, else 404, as for an edit. The delete is soft: it sets
 * `deletedAt`, as the web's moderation does, and from then on the message
 * is served to everyone with `deleted: true` and no body. Deleting a message
 * that is already deleted answers the same `{ id }` again, so a retry is
 * harmless.
 */
export const DeleteTeamMessageResponse = z.object({ id: z.string() });
export type DeleteTeamMessageResponse = z.infer<typeof DeleteTeamMessageResponse>;

/**
 * POST /api/v1/team/channels/:channelId/read — no body. Idempotent by nature.
 *
 * Server: canAccessChannel, else 404. Upserts the CALLER's read cursor to
 * now, and only theirs.
 */
export const MarkChannelReadResponse = z.object({ channelId: z.string() });

export const DirectoryEntry = z.object({
  id: z.string(),
  name: z.string(),
  /** Only when the company's "show contact info" setting is on; else null. */
  phone: z.string().nullable(),
  /** Only when the company's "show contact info" setting is on; else null. */
  email: z.string().nullable(),
});
export type DirectoryEntry = z.infer<typeof DirectoryEntry>;

/**
 * GET /api/v1/team/directory — the other active cleaners, to start a direct
 * message with.
 *
 * Server: staff only. When direct messages are off the list is EMPTY (a
 * server-side gate, as on the web, not just a hidden button). Phone and email
 * are null unless the company's setting shows them. Only people in the
 * caller's company; never the caller, clients, inactive or deleted people.
 */
export const DirectoryResponse = page(DirectoryEntry).extend({
  dmEnabled: z.boolean(),
  showContactInfo: z.boolean(),
});
export type DirectoryResponse = z.infer<typeof DirectoryResponse>;

/**
 * POST /api/v1/team/direct — open (or create) the direct conversation between
 * the caller and another staff member. Response: that TeamChannel.
 *
 * Server: staff only; refuses when direct messages are off (403) and refuses
 * the caller's own id (400). The other person must be active staff IN THE
 * CALLER'S COMPANY, else 404 — the same answer for "no such person" and "not
 * in your company", so ids from elsewhere can't be probed for names.
 * Find-or-create must be race-safe (one direct channel per pair), so a double
 * tap or a retry opens the same conversation; that is what makes it safe
 * without an idempotency key.
 */
export const OpenDirectRequest = z.object({ userId: z.string().min(1).max(64) });
export type OpenDirectRequest = z.infer<typeof OpenDirectRequest>;
export const OpenDirectResponse = TeamChannel;
