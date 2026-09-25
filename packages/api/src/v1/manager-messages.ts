// Messages for the office: every cleaner's conversation with the office,
// answered as the office, and moderating team chat.
//
// Replaces, for the phone, the admin side of the web's app/admin/chat/
// actions.ts (getAdminChatList, getAdminChat, sendChatMessage as ADMIN,
// markChatRead as ADMIN) and deleteGroupMessage in
// app/cleaners/group-chat/groupChat.ts. Access follows ./manager-access.ts,
// and every rule at the bottom of that file applies.
//
// Team channels themselves use the cleaner endpoints in ./messages.ts, whose
// access now includes the office roles: canAccessChannel as the web has it,
// so OWNER, ADMIN and OPS_MANAGER see every channel and a FIELD_LEAD only
// the default channel and the ones they are a member of. Announcements are
// read through ./announcements.ts by every staff role; PUBLISHING one stays
// on the web console.
import { z } from "zod";

import { Instant, page } from "./common";
import { OfficeMessage } from "./messages";

// ---- The office inbox ---------------------------------------------------------------

export const OfficeConversation = z.object({
  cleaner: z.object({ id: z.string(), name: z.string() }),
  /** A cleaner active in the last minute (the web's presence rule). */
  online: z.boolean(),
  /** The newest message, trimmed to 140 characters, or null if none yet. */
  last: z
    .object({
      body: z.string(),
      at: Instant,
      /** Sent by the office (anyone in it), not the cleaner. */
      fromOffice: z.boolean(),
    })
    .nullable(),
  /** The cleaner's messages the office hasn't read. */
  unreadCount: z.number().int(),
});
export type OfficeConversation = z.infer<typeof OfficeConversation>;

/**
 * GET /api/v1/manager/chat/conversations?cursor= — every cleaner's
 * conversation: unread first, then most recent, then by name
 * (getAdminChatList's order).
 *
 * Access: OFFICE_INBOX (OWNER, ADMIN). The web lists role EMPLOYEE only;
 * this also lists FIELD_LEAD, because field leads now write to the office
 * from the phone's cleaner screens (GET/POST /chat, `staff` access), and
 * their messages must land somewhere the office reads. Creating a missing
 * conversation row is idempotent, as on the web. `unreadTotal` is across
 * every conversation, for the Messages tab's badge.
 */
export const OfficeConversationsResponse = page(OfficeConversation).extend({
  unreadTotal: z.number().int(),
});
export type OfficeConversationsResponse = z.infer<typeof OfficeConversationsResponse>;

/** GET /api/v1/manager/chat/conversations/:cleanerId — one, for a conversation opened directly. */
export const OfficeConversationResponse = OfficeConversation;

/**
 * GET /api/v1/manager/chat/conversations/:cleanerId/messages?cursor= —
 * newest first, keyset-paged, as ./messages.ts.
 *
 * The messages are OfficeMessage, read from the OFFICE's side:
 *   - `fromMe` is true for a message the office sent (senderRole ADMIN,
 *     whoever in the office sent it), so the office's own sit on the right;
 *   - `clientEventId` is set on messages the CALLER sent from a phone;
 *   - `receipt` on the office's messages says whether the cleaner has read
 *     them (readByEmployeeAt), as the web's admin view shows.
 * Access: OFFICE_INBOX. `:cleanerId` must be an EMPLOYEE or FIELD_LEAD of
 * this company, else 404. Reading marks nothing read.
 */
export const ManagerMessagesResponse = page(OfficeMessage);
export type ManagerMessagesResponse = z.infer<typeof ManagerMessagesResponse>;

/**
 * POST /api/v1/manager/chat/conversations/:cleanerId/messages — body:
 * SendMessageRequest (./messages.ts). Idempotent on `clientEventId`.
 * Response: the saved OfficeMessage, from the office's side.
 *
 * Access: OFFICE_INBOX. Posts as senderRole ADMIN with the caller as sender
 * (never taken from the request). Trims, refuses empty or over
 * MESSAGE_BODY_MAX. Keeps sendChatMessage's side effects: delivered at once
 * when the cleaner is online; otherwise the throttled email to the cleaner
 * (notifyChatEmail, at most one per conversation per five minutes), as an
 * effect after commit and never on a replay. Rate limit: rule 7.
 */
export const SendManagerMessageResponse = OfficeMessage;

/**
 * POST /api/v1/manager/chat/conversations/:cleanerId/read — no body.
 * Idempotent by nature. Stamps readByAdminAt on the cleaner's unread
 * messages in that conversation (markChatRead's admin branch).
 */
export const ManagerMarkReadResponse = z.object({ unreadTotal: z.number().int() });
export type ManagerMarkReadResponse = z.infer<typeof ManagerMarkReadResponse>;

// ---- Moderating team chat -------------------------------------------------------------

/**
 * DELETE /api/v1/manager/team/channels/:channelId/messages/:messageId —
 * remove anyone's message. No body. Response: `{ id }`.
 *
 * Access: TEAM_MODERATE (OWNER, ADMIN, OPS_MANAGER; groupChat.ts
 * deleteGroupMessage). The channel and the message must be in this company
 * and the message in that channel, else 404. The delete is soft (deletedAt,
 * as the web's moderation), so everyone sees "Message deleted" in its place
 * (TeamMessage `deleted`). Deleting one already deleted answers the same
 * `{ id }`. Audit: deletedById (new column) and a logActivity line naming
 * the moderator and the channel, never the message's text.
 */
export const ModerateTeamMessageResponse = z.object({ id: z.string() });
export type ModerateTeamMessageResponse = z.infer<typeof ModerateTeamMessageResponse>;
