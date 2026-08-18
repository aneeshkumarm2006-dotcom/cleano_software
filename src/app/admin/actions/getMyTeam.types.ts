// Payload for the Field Lead's My Team page (cleano_inventory_operations_fixes
// PDF #7, p.6).
//
// ─── WHAT IS DELIBERATELY NOT IN HERE ──────────────────────────────────────
//
// Written in the spirit of `getAvailableJobPreview.types.ts`: the list below is
// the specification, not a summary of today's implementation. A Field Lead is a
// scheduling role, not an office role — they coordinate a crew, they do not see
// the books.
//
//   • `price` / `subtotalAmount` / `discountAmount` / add-on prices — the CLIENT
//     price of a job. This is the single most important omission: widening the
//     job scope from "my jobs" to "my group's jobs" without a projection would
//     hand a Field Lead the billing value of every job their crew works.
//   • `employeePay`, `hourlyRate`, `payType`, `totalTip`, `parking` — payroll.
//     A lead must not be able to read what their crew (or they) are paid per
//     job, which is also why `FieldLeadGroupMember` carries `cleanerTier` but no
//     `payMultiplier`: the tier is a seniority label used for dispatch, the
//     percentages attached to it live in `src/lib/pay-tiers.ts` and stay there.
//   • `paymentReceived`, `invoiceSent`, `paymentType`, `isCashJob` — client
//     payment state. Chasing an invoice is not a Field Lead's job.
//   • Group revenue / the weekly group bonus — a MONEY figure, even though it is
//     computed from this exact group. It stays on the admin-only employee detail
//     page (`getFieldLeadWeeklyBonus`).
//   • `notes` (raw) — free text an admin may have pasted billing into, and the
//     column legacy BookingKoala imports wrote "Final amount CAD: …" to. Only
//     ever emitted through `sanitizeCleanerNotes()`; see `src/lib/cleaner-notes.ts`.
//   • `clientAddress.accessNotes` — door and gate codes. A lead is not
//     necessarily assigned to their group's jobs, and codes are released per
//     assignment, not per hierarchy.
//   • `client.email` / `client.phone` / full street address — the lead gets the
//     area (trailing locality) and the client's FIRST name, which is what a
//     "who is where today" view needs. Full contact details are a client-record
//     read.
//
// Adding any of the above to these types is a privacy regression, not a feature.
// `scripts/verify-stage7-field-lead.ts` asserts their absence mechanically.

/**
 * How far ahead the group schedule runs. 14 days per PDF #7 — long enough to
 * plan the fortnight a lead is actually asked about, short enough that the page
 * is one query and not a paginated table.
 *
 * It lives in the TYPES file, not next to the action that uses it: a
 * `"use server"` module may only export async functions, so a plain `const`
 * exported from `getMyTeam.ts` fails the build ("The module has no exports at
 * all"). This file is the natural shared home — the action reads it for the
 * query bound and the day loop, and the payload carries it as `horizonDays` so
 * the UI's copy can never quote a different number.
 */
export const SCHEDULE_HORIZON_DAYS = 14;

export interface TeamMemberDTO {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  /** App role (FIELD_LEAD / EMPLOYEE / …) — drives nothing but a label. */
  role: string;
  /** Seniority tier used for dispatch decisions. Not a pay figure. */
  cleanerTier: string;
  isActive: boolean;
  /** The lead's own row. Always the first member. */
  isLead: boolean;
  /** Count of this member's jobs inside the schedule horizon. */
  upcomingJobCount: number;
}

export interface TeamJobDTO {
  id: string;
  jobNumber: number;
  /** Business-timezone civil day key, "YYYY-MM-DD". */
  dateKey: string;
  /** Business-timezone wall clock, "9:30 AM". Null when the job has no start. */
  startLabel: string | null;
  /** Business-timezone wall clock for the end, when the job has one. */
  endLabel: string | null;
  /**
   * The client's FIRST name only ("Sarah"), or "Client" when the record has no
   * usable name. Enough to recognise the booking on the phone; not a contact
   * record.
   */
  clientFirstName: string;
  /** Trailing locality of the address ("…, Verdun" → "Verdun"). Never the street. */
  area: string | null;
  /** Resolved through the admin's own service names, never the raw column. */
  serviceType: string | null;
  status: string;
  /** Who is on it, by name — the point of the view. */
  cleanerNames: string[];
  /** True when this job is the viewing lead's own work rather than a member's. */
  isMine: boolean;
  /** Billing text already stripped by sanitizeCleanerNotes. Null when nothing survives. */
  notes: string | null;
}

export interface TeamDayDTO {
  /** "YYYY-MM-DD" in the business timezone. */
  dateKey: string;
  /** "Mon, Aug 17". */
  label: string;
  isToday: boolean;
  jobs: TeamJobDTO[];
}

/** One weekday rule, as the availability grid renders it. */
export interface TeamAvailabilitySlotDTO {
  /** MONDAY…SUNDAY */
  day: string;
  startTime: string;
  endTime: string;
  isAvailable: boolean;
}

export interface TeamAvailabilityRowDTO {
  employeeId: string;
  employeeName: string;
  slots: TeamAvailabilitySlotDTO[];
  /** Upcoming one-off blocked dates ("YYYY-MM-DD"), soonest first. */
  timeOff: Array<{ date: string; reason: string | null }>;
}

export interface MyTeamDTO {
  leadId: string;
  leadName: string;
  /** How many days ahead the schedule covers (see SCHEDULE_HORIZON_DAYS). */
  horizonDays: number;
  members: TeamMemberDTO[];
  /** One entry per civil day in the horizon, including days with no jobs. */
  days: TeamDayDTO[];
  availability: TeamAvailabilityRowDTO[];
  /**
   * True when an OWNER/ADMIN is inspecting a lead's view rather than a lead
   * viewing their own. Renders a banner so nobody mistakes it for their own data.
   */
  viewingAsAdmin: boolean;
}

export type MyTeamResult =
  | { success: true; team: MyTeamDTO }
  | { success: false; error: string };
