import { z } from "zod";

import { openEnum } from "./common";
import { ROLES } from "./enums";

/** GET /api/v1/me — who is signed in, and for which company. */
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
