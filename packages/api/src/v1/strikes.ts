// Strikes: the cleaner's own reliability record. Read-only from the phone;
// strikes are applied by the server's job rules or by an admin, and excused
// by an admin.
import { z } from "zod";

import { Instant, openEnum } from "./common";

export const STRIKE_STATUSES = ["ACTIVE", "EXPIRED", "EXCUSED", "REMOVED"] as const;
export const STRIKE_LEVELS = ["OK", "WARNING", "REVIEW"] as const;

export const StrikeItem = z.object({
  id: z.string(),
  /** The rule, in words: "No-show", "45+ minutes late without approved notice". */
  title: z.string(),
  /**
   * What happened, as recorded on the strike. May repeat the title with a
   * detail after it ("No-show — job #1432").
   */
  reason: z.string(),
  /**
   * EXPIRED also covers a strike still marked active whose date has passed,
   * so the app never shows a rolled-off strike as active.
   */
  status: openEnum(STRIKE_STATUSES),
  givenAt: Instant,
  /** When it rolls off (or rolled off). */
  expiresAt: Instant,
  /** The job it was for, when there was one: its number and id, nothing about the client. */
  job: z.object({ id: z.string(), number: z.number().int() }).nullable(),
});
export type StrikeItem = z.infer<typeof StrikeItem>;

/**
 * GET /api/v1/strikes — the caller's standing and strike history, newest
 * first (up to 100, as the web shows).
 *
 * Server: staff only; strikes WHERE cleanerId = session user. Never sends the
 * admin's private note, who applied or excused it, or anything about the
 * job's client. `activeCount` counts ACTIVE strikes not yet expired, and
 * `level` is the web's `strikeLevel(activeCount)`.
 */
export const StrikesResponse = z.object({
  activeCount: z.number().int(),
  /** Active strikes at which an admin reviews the account: 3 today. */
  threshold: z.number().int(),
  /** How long a strike stays active: 30 days today. */
  windowDays: z.number().int(),
  level: openEnum(STRIKE_LEVELS),
  items: z.array(StrikeItem),
});
export type StrikesResponse = z.infer<typeof StrikesResponse>;
