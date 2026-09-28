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
//
// The v1 inbox service is written for v1. It must NOT call or wrap the web's
// app/admin/chat/actions.ts helpers (getAdminChatList, getAdminChat,
// sendChatMessage, markChatRead), for three reasons found in review:
//   - their gate is isAdminRole, which admits OPS_MANAGER and FIELD_LEAD;
//     the inbox is OFFICE_INBOX (OWNER, ADMIN) only;
//   - getAdminChat (~line 252) refuses any conversation whose person has an
//     office role (isAdminRole(employee.role)), which includes FIELD_LEAD,
//     and getAdminChatList lists EMPLOYEE only. The v1 inbox must list and
//     open field leads' threads, since they write to the office from the
//     phone's cleaner screens;
//   - sendChatMessage and markChatRead pick the sender's side from the
//     CALLER's role (isAdminRole ? "ADMIN" : "EMPLOYEE"), so a field lead
//     writing from the cleaner screens would post, and read, as the office.
// So the side is set by the ROUTE, server-side, never from the request or
// the caller's role: every message posted through /manager/chat is
// senderRole ADMIN and stamps readByAdminAt; every message through the
// cleaner endpoints (./messages.ts, `staff` access) is senderRole EMPLOYEE
// and stamps readByEmployeeAt, a FIELD_LEAD included. What may be shared
// with the web is the storage underneath (the conversation upsert, the
// message insert, the notifyChatEmail throttle), each taking the side as an
// argument.

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
 * their messages must land somewhere the office reads (see the note above:
 * not through getAdminChatList). Creating a missing conversation row is
 * idempotent, as on the web. `unreadTotal` is across every conversation,
 * for the Messages tab's badge.
 */
export const OfficeConversationsResponse = page(OfficeConversation).extend({
  unreadTotal: z.number().int(),
});
export type OfficeConversationsResponse = z.infer<typeof OfficeConversationsResponse>;

/**
 * GET /api/v1/manager/chat/conversations/:cleanerId — one, for a
 * conversation opened directly. Access: OFFICE_INBOX. `:cleanerId` must be
 * an EMPLOYEE or FIELD_LEAD of this company, else 404; a FIELD_LEAD's
 * thread opens like anyone's (unlike getAdminChat's).
 */
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
 * Access: OFFICE_INBOX. `:cleanerId` as for GET. Posts as senderRole ADMIN,
 * fixed by this route, with the caller as sender (neither is taken from the
 * request, nor derived from the caller's role). Trims, refuses empty or over
 * MESSAGE_BODY_MAX. Keeps sendChatMessage's side effects: delivered at once
 * when the cleaner is online; otherwise the throttled email to the cleaner
 * (notifyChatEmail, at most one per conversation per five minutes), as an
 * effect after commit and never on a replay. Rate limit: rule 7.
 */
export const SendManagerMessageResponse = OfficeMessage;

/**
 * POST /api/v1/manager/chat/conversations/:cleanerId/read — no body.
 * Idempotent by nature. Stamps readByAdminAt on the cleaner's unread
 * messages in that conversation (what markChatRead's admin branch does,
 * fixed by this route rather than chosen by the caller's role).
 *
 * Access: OFFICE_INBOX. `:cleanerId` must be an EMPLOYEE or FIELD_LEAD of
 * this company, else 404.
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
 * `{ id }` and changes nothing (the first moderator stays on record).
 *
 * Audit: the row records `deletedById` (new column: the moderator) with
 * deletedAt, and a logActivity line naming the moderator and the channel,
 * never the message's text. The original body and attachment are KEPT on
 * the row server-side, for a dispute or a complaint; no v1 response ever
 * returns them (a deleted TeamMessage goes out with its body emptied and
 * `deleted` true, to every role, the moderator included), and nothing on
 * the phone can read them back.
 */
export const ModerateTeamMessageResponse = z.object({ id: z.string() });
export type ModerateTeamMessageResponse = z.infer<typeof ModerateTeamMessageResponse>;
