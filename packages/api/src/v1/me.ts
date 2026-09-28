import { z } from "zod";

import { Instant, openEnum } from "./common";
import { ROLES } from "./enums";

/**
 * GET /api/v1/me — who is signed in, and for which company.
 *
 * Server: every staff role (OWNER, ADMIN, OPS_MANAGER, FIELD_LEAD, EMPLOYEE).
 * The app picks its side from `role` with appSideFor (./manager-access.ts),
 * and signs out any other role, saying why.
 */
export const MeResponse = z.object({
  person: z.object({
    id: z.string(),
    name: z.string(),
    email: z.string(),
    role: openEnum(ROLES),
  }),
  company: z.object({
    id: z.string(),
    name: z.string(),
    slug: z.string(),
    /** IANA zone. Every "today" and every clock time is in this zone. */
    timezone: z.string(),
    /** ISO 4217, e.g. "CAD". */
    currency: z.string(),
  }),
  /** The app shows the change-password screen before anything else. */
  mustChangePassword: z.boolean(),
});
export type MeResponse = z.infer<typeof MeResponse>;

/**
 * POST /api/v1/me/password — choose a new password.
 *
 * The server must: verify `currentPassword` against the caller's own account;
 * enforce the same length rules as the web; clear `mustChangePassword`; and
 * end every OTHER session the caller holds (this device stays signed in).
 */
export const ChangePasswordRequest = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: z.string().min(8).max(200),
});
export const ChangePasswordResponse = z.object({ ok: z.literal(true) });

// ---- Asking the company to delete the account ------------------------------
//
// App Store guideline 5.1.1(v). A staff account is made by the employer, not
// by the person, and the company must keep some of what it holds (pay and tax
// records) by law, so the app can't delete it on the spot. It sends the
// company a request instead, and says plainly what will and won't go.

export const DELETION_REASON_MAX = 500;

/**
 * POST /api/v1/me/deletion-request — ask the company to delete the caller's
 * account. Idempotent on `clientEventId` (also the Idempotency-Key).
 * Response: when the request was made.
 *
 * Server:
 *   - any staff role (OWNER, ADMIN, OPS_MANAGER, FIELD_LEAD, EMPLOYEE);
 *   - `reason` is trimmed; empty is no reason; over DELETION_REASON_MAX is 400;
 *   - one open request per person: asking again while one is pending answers
 *     with the first request's time and raises nothing new, so a retry, a
 *     double tap, or a second phone never alerts the office twice;
 *   - records the request, then, as effects after the response: an office
 *     alert in the admin notification feed (the manager app's Alerts) and an
 *     email to the company's active OWNER and ADMIN accounts;
 *   - deletes nothing and signs nobody out: the office acts on it.
 */
export const DeletionRequestBody = z.object({
  reason: z.string().max(DELETION_REASON_MAX).optional(),
  clientEventId: z.uuid(),
});
export type DeletionRequestBody = z.infer<typeof DeletionRequestBody>;

export const DeletionRequestResponse = z.object({ requestedAt: Instant });
export type DeletionRequestResponse = z.infer<typeof DeletionRequestResponse>;

/**
 * GET /api/v1/me/deletion-request — whether the caller has a request waiting
 * for the office. `requestedAt` is null when there is none.
 *
 * Server: any staff role; the caller's own request only.
 */
export const DeletionRequestState = z.object({
  pending: z.boolean(),
  requestedAt: Instant.nullable(),
});
export type DeletionRequestState = z.infer<typeof DeletionRequestState>;
