// Announcements: the office's noticeboard, as a cleaner reads it.
//
// Replaces, for the phone, the cleaner side of the web's
// `admin/announcements/announcements.ts` (listAnnouncements,
// markAnnouncementsRead, reactToAnnouncement). Publishing, editing, pinning
// and the read register are office-only and are not in v1: the manager side
// of the app reads announcements here like everyone else, and publishes them
// from the web console.
import { z } from "zod";

import { Instant, openEnum, page } from "./common";

/**
 * The reactions a cleaner can leave, one per person per announcement. The
 * web's allow-list is emoji (👍 🎉 ❤️); the wire uses names so a request can
 * be a closed enum and the server maps them: THUMBS_UP 👍, PARTY 🎉, HEART ❤️.
 */
export const REACTION_KINDS = ["THUMBS_UP", "PARTY", "HEART"] as const;
export type ReactionKind = (typeof REACTION_KINDS)[number];

export const ReactionCount = z.object({
  kind: openEnum(REACTION_KINDS),
  count: z.number().int(),
});

/** What the reactions on one announcement add up to, from the caller's side. */
export const ReactionState = z.object({
  /** Only kinds with at least one reaction. */
  reactions: z.array(ReactionCount),
  myReaction: openEnum(REACTION_KINDS).nullable(),
});
export type ReactionState = z.infer<typeof ReactionState>;

export const Announcement = ReactionState.extend({
  id: z.string(),
  title: z.string(),
  /** Plain text. Never HTML; the app renders it as text. */
  body: z.string(),
  /** Pinned by the office: shown first, and given weight. */
  pinned: z.boolean(),
  authorName: z.string(),
  createdAt: Instant,
  /** When the wording last changed, or null if it reads as published. */
  editedAt: Instant.nullable(),
  /** Has the caller opened it. Drives the "New" marker. */
  readByMe: z.boolean(),
  /**
   * The caller read it before its last edit. Not shown as unread (the web
   * doesn't re-flag a typo fix), but the app re-stamps the read once the new
   * text has been on screen, so the office's register recovers.
   */
  myReadStale: z.boolean(),
});
export type Announcement = z.infer<typeof Announcement>;

/**
 * GET /api/v1/announcements?cursor= — pinned first, then newest.
 *
 * Server: every staff role, the office roles included (canParticipate: never
 * a CLIENT or APPLICANT). Carries only the
 * caller's own read and reaction state; NEVER the admin `audience` (who read
 * it, who reacted, who hasn't), nor read counts: a cleaner does not get a
 * register of their colleagues. Reading the list marks nothing read.
 */
export const AnnouncementsResponse = page(Announcement).extend({
  /** Announcements the caller has never opened, across every page. */
  unreadCount: z.number().int(),
});
export type AnnouncementsResponse = z.infer<typeof AnnouncementsResponse>;

/**
 * POST /api/v1/announcements/read — the announcements that have been on the
 * caller's screen. Idempotent by nature.
 *
 * Server: staff only; writes only the CALLER's read rows. Keeps the web's
 * rules: an existing read is not moved (first seen is what the office wants
 * to know), except one that predates the last edit, which is re-stamped.
 * Unknown ids, and ids of another company's announcements, are ignored, not an
 * error; at most 200 per call.
 */
/** How many ids one mark-read call takes. */
export const MARK_READ_MAX = 200;

export const MarkAnnouncementsReadRequest = z.object({
  ids: z.array(z.string().min(1).max(64)).min(1).max(MARK_READ_MAX),
});
export type MarkAnnouncementsReadRequest = z.infer<typeof MarkAnnouncementsReadRequest>;

export const MarkAnnouncementsReadResponse = z.object({
  marked: z.number().int(),
  unreadCount: z.number().int(),
});
export type MarkAnnouncementsReadResponse = z.infer<typeof MarkAnnouncementsReadResponse>;

/**
 * POST /api/v1/announcements/:id/reactions — SET the caller's reaction.
 * Response: the fresh ReactionState.
 *
 * Unlike the web action, which toggles, this says what the reaction should
 * BE (`kind`, or null to remove it). A toggle replayed after a dropped
 * connection would undo itself; a set can be replayed safely. It also carries
 * a `clientEventId` as the Idempotency-Key.
 *
 * Server: staff only; the announcement must exist (else 404). One reaction
 * per person (the unique pair); writes only the caller's row.
 */
export const SetReactionRequest = z.object({
  kind: z.enum(REACTION_KINDS).nullable(),
  clientEventId: z.uuid(),
});
export type SetReactionRequest = z.infer<typeof SetReactionRequest>;
export const SetReactionResponse = ReactionState;
