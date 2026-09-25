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
