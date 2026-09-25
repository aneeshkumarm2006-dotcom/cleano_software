// Clocking in and out, breaks, the checklist, and the closing kit report.
//
// Every clock action is an EVENT the phone records when the person taps —
// with or without signal — and sends when it can (API_V1.md §6). The server
// decides which time counts: the phone's, when it can prove the phone was
// offline and the gap is small; otherwise its own, with the phone's time sent
// to the office as a correction request. Nothing a cleaner taps is dropped.
import { z } from "zod";

import { Instant, openEnum } from "./common";
import { CLOCK_STATES, COUNTABLE_STATUSES, EQUIPMENT_CONDITIONS, LIQUID_LEVELS, REPORT_KINDS } from "./enums";

/** What every clock action carries. */
export const ClockEvent = z.object({
  /** Made on the phone at the tap; also sent as the Idempotency-Key. */
  clientEventId: z.uuid(),
  /** When the tap happened, by the phone's best estimate of server time. */
  occurredAt: Instant,
  /**
   * How far the phone's estimate is from its own wall clock, in ms, and
   * whether it came from a recent server sync (`synced`) or the device clock
   * alone. Lets the server judge how much to trust `occurredAt`.
   */
  clock: z.object({
    source: z.enum(["synced", "device"]),
    offsetMs: z.number().int(),
  }),
});
export type ClockEvent = z.infer<typeof ClockEvent>;

export const BreakSpan = z.object({
  startedAt: Instant,
  endedAt: Instant.nullable(),
});

/** GET /api/v1/jobs/:id/clock — where this cleaner stands on this job. */
export const ClockStateResponse = z.object({
  jobId: z.string(),
  state: openEnum(CLOCK_STATES),
  clockedInAt: Instant.nullable(),
  clockedOutAt: Instant.nullable(),
  breaks: z.array(BreakSpan),
  plannedMinutes: z.number().int().nullable(),
  /**
   * True when a time this phone sent is waiting on the office (it arrived
   * late, or couldn't be applied as sent). The app says so rather than
   * pretending the time is settled.
   */
  pendingReview: z.boolean(),
});
export type ClockStateResponse = z.infer<typeof ClockStateResponse>;

/** One kit item the cleaner reports on at clock-out. */
export const KitReportItem = z.object({
  productId: z.string(),
  name: z.string(),
  unit: z.string(),
  kind: openEnum(REPORT_KINDS),
  /** What the office has on record, to start the count from. */
  quantity: z.number().int(),
});
export type KitReportItem = z.infer<typeof KitReportItem>;

/** GET /api/v1/jobs/:id/kit-report — what to report on at clock-out. */
export const KitReportResponse = z.object({ items: z.array(KitReportItem) });
export type KitReportResponse = z.infer<typeof KitReportResponse>;

/** One reported kit item. Request enums are closed. */
export const KitReportEntry = z.object({
  productId: z.string(),
  kind: z.enum(REPORT_KINDS),
  levelStatus: z.enum(LIQUID_LEVELS).nullable().optional(),
  quantity: z.number().int().min(0).max(1000).nullable().optional(),
  status: z.enum(COUNTABLE_STATUSES).nullable().optional(),
  condition: z.enum(EQUIPMENT_CONDITIONS).nullable().optional(),
  note: z.string().max(300).nullable().optional(),
});
export type KitReportEntry = z.infer<typeof KitReportEntry>;

/** POST /api/v1/jobs/:id/clock-out */
export const ClockOutRequest = ClockEvent.extend({
  report: z.object({ items: z.array(KitReportEntry) }),
});
export type ClockOutRequest = z.infer<typeof ClockOutRequest>;

export const ClockOutResponse = z.object({
  clock: ClockStateResponse,
  /** Every cleaner on the job has clocked out, so the job is done. */
  jobCompleted: z.boolean(),
  /** Something in the kit fell below its threshold; the office is told. */
  restockNeeded: z.boolean(),
});
export type ClockOutResponse = z.infer<typeof ClockOutResponse>;

export const ChecklistItem = z.object({
  id: z.string(),
  label: z.string(),
  /** A room or area, for grouping: "Kitchen". */
  section: z.string().nullable(),
  done: z.boolean(),
});
export type ChecklistItem = z.infer<typeof ChecklistItem>;

/** GET /api/v1/jobs/:id/checklist */
export const ChecklistResponse = z.object({ items: z.array(ChecklistItem) });
export type ChecklistResponse = z.infer<typeof ChecklistResponse>;

/** PUT /api/v1/jobs/:id/checklist/:itemId */
export const ChecklistItemUpdate = z.object({ done: z.boolean(), clientEventId: z.uuid() });
