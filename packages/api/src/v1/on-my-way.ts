// "On my way": the cleaner tells the office, and the client, that they're
// heading to today's job. The web's version is markOnMyWay in
// apps/web/src/app/cleaners/my-jobs/[jobId]/onMyWay.ts.
//
// The phone sends its position at most once, with the tap, and only if the
// person agreed. There is no tracking in v1: the web's 30-second location
// updates (updateOnMyWayLocation) need background location on a phone, which
// is a separate decision with its own review.
import { z } from "zod";

import { Instant } from "./common";

/**
 * GET /api/v1/jobs/:id/on-my-way
 *
 * The server must check the caller is assigned to the job (404 otherwise).
 */
export const OnMyWayState = z.object({
  /** When THIS cleaner said they were on their way; null if they haven't. */
  sentAt: Instant.nullable(),
  /**
   * Whether the company keeps a location with "On my way" (the web's
   * `tracking.gpsEnabled`). When false the app never asks for location.
   */
  askForLocation: z.boolean(),
});
export type OnMyWayState = z.infer<typeof OnMyWayState>;

/**
 * POST /api/v1/jobs/:id/on-my-way
 *
 * Idempotent on `clientEventId` (also the Idempotency-Key), and once per
 * cleaner per job regardless: a second tap returns the first `sentAt` with
 * `alreadySent`, and never texts the client twice.
 *
 * The server must:
 *   - check the caller is assigned to the job (404);
 *   - check the job is TODAY in the company's timezone (409 `NOT_TODAY`) and
 *     is not cancelled or finished (409 `JOB_CLOSED`);
 *   - check the caller hasn't clocked in on it (409 `ALREADY_STARTED`);
 *   - store `coords` only when the company has location on (the web's
 *     `tracking.gpsEnabled`), and otherwise drop them unread;
 *   - tell the office, and text the client when the booking allows it
 *     (`notifyClient`, the company's SMS setting, a phone on file), exactly as
 *     the web does — and say which it did in the response.
 */
export const OnMyWayRequest = z.object({
  coords: z
    .object({
      lat: z.number().min(-90).max(90),
      lng: z.number().min(-180).max(180),
      /** The phone's own accuracy estimate, in metres. */
      accuracyM: z.number().min(0).max(100_000),
    })
    .optional(),
  clientEventId: z.uuid(),
});
export type OnMyWayRequest = z.infer<typeof OnMyWayRequest>;

export const OnMyWayResponse = z.object({
  sentAt: Instant,
  /** Someone had already said so for this cleaner; nobody was told twice. */
  alreadySent: z.boolean(),
  /** The office was notified. */
  officeTold: z.boolean(),
  /** The client was sent a text. False when the booking or company says not to. */
  clientTold: z.boolean(),
  /** A position was kept with it. */
  locationSaved: z.boolean(),
});
export type OnMyWayResponse = z.infer<typeof OnMyWayResponse>;
