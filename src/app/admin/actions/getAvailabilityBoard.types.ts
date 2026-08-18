// Payload for /admin/availability — the all-cleaner availability view
// (cleano_inventory_operations_fixes PDF #12, p.8 / Stage 12).
//
// Separate from the action for the reason `getMyTeam.types.ts` records: a
// `"use server"` module may only export async functions, so every constant and
// every interface the page needs has to live beside it rather than inside it.
//
// ─── SCOPE ─────────────────────────────────────────────────────────────────
// This is an OWNER/ADMIN surface (the nav entry carries `adminOnly`, the page
// calls `requireOwnerAdmin`, and the action authorizes independently). A Field
// Lead's group-scoped equivalent already exists at /admin/my-team, which is why
// no lead-scoped branch was added here — widening this action to FIELD_LEAD
// would hand one lead the roster of every other group.
//
// No money, ever. Availability is a scheduling fact; nothing on this page needs
// `payMultiplier`, an hourly rate or a job price, and none of them are selected.

import type { AvailabilityResult } from "@/lib/availability";
import type { AvailabilityViewQuery } from "@/lib/availability-view";

/**
 * Roster ceiling. A cleaning business with more than 300 active cleaners has
 * outgrown a single-page grid, and this stops a runaway query from rendering a
 * table nobody can read. The UI says out loud when it bites — see `truncated`.
 */
export const AVAILABILITY_BOARD_MAX_ROWS = 300;

/** One weekday rule. Mirrors `EmployeeAvailability`'s renderable columns. */
export interface AvailabilityBoardSlotDTO {
  /** MONDAY…SUNDAY */
  day: string;
  startTime: string;
  endTime: string;
  isAvailable: boolean;
}

/** The selected day's answer for one cleaner. */
export interface AvailabilityBoardDayDTO {
  result: AvailabilityResult;
  /** Short human explanation. Null when AVAILABLE or NO_DATA. */
  reason: string | null;
  /** True when the answer came from a one-off blocked date. */
  blockedDate: boolean;
  /** The cleaner's open hours that day. Empty unless AVAILABLE. */
  windows: Array<{ startTime: string; endTime: string }>;
  /**
   * True when the result was evaluated against the admin's chosen time window
   * rather than against the whole day — so the UI can say which question it
   * answered instead of leaving "Not working" ambiguous.
   */
  windowed: boolean;
}

export interface AvailabilityBoardRowDTO {
  employeeId: string;
  employeeName: string;
  /** Weekly rules — what the week grid renders. */
  slots: AvailabilityBoardSlotDTO[];
  /** Blocked dates INSIDE THE VISIBLE WEEK, so the dated grid can strike them. */
  timeOff: Array<{ date: string; reason: string | null }>;
  /** The group this cleaner is in, or null when they report to no Field Lead. */
  fieldLeadName: string | null;
  /** Approved service categories. EMPTY MEANS EVERY CATEGORY (decision 8). */
  allowedServiceCategories: string[];
  /** Seniority label used for dispatch. Not a pay figure. */
  cleanerTier: string;
  /** False = login switched off ("Deactivate" on the Employees page). */
  isActive: boolean;
  /**
   * True = soft-deleted ("Archive" on the Employees page, restorable from
   * Employees → Archived). A DIFFERENT state from `!isActive`, and the reason
   * both are spelled out: an archived cleaner is only ever on this board with
   * the off-roster toggle on, and must never read as bookable.
   */
  isArchived: boolean;
  day: AvailabilityBoardDayDTO;
}

/** One dated column of the week grid. */
export interface AvailabilityBoardWeekDayDTO {
  dateKey: string;
  /** MONDAY…SUNDAY */
  day: string;
  /** "Mon 17" */
  label: string;
  isToday: boolean;
  isSelected: boolean;
}

export interface AvailabilityBoardDTO {
  /** The validated filters, echoed back so the controls render from one source. */
  query: AvailabilityViewQuery;
  /** The resolved selected date — always a real key, today when none was given. */
  dateKey: string;
  /** "Tuesday, Aug 18, 2026" */
  dateLabel: string;
  isToday: boolean;
  /** Mon…Sun of the week containing `dateKey`. */
  week: AvailabilityBoardWeekDayDTO[];
  /** "Aug 17 – Aug 23" */
  weekLabel: string;
  /** Date keys the prev/next controls navigate to. */
  prevWeekDate: string;
  nextWeekDate: string;
  prevDayDate: string;
  nextDayDate: string;
  todayDate: string;
  rows: AvailabilityBoardRowDTO[];
  /** Field Leads with a group, for the group filter. */
  fieldLeads: Array<{ id: string; name: string }>;
  /** Cleaners matching the ROSTER filters, before the status filter narrowed. */
  matchedCleaners: number;
  /** Active cleaners in the business, with no filter at all. */
  totalCleaners: number;
  /**
   * Cleaners the off-roster toggle can reveal — deactivated OR archived — with
   * no other filter applied. Reported whether the toggle is on or off so the
   * footer can distinguish "none to show" from "the toggle does nothing", which
   * is the whole reason it read as broken.
   */
  offRosterCleaners: number;
  /** Of `matchedCleaners`, how many resolved to each bucket on the day. */
  dayCounts: {
    available: number;
    unavailable: number;
    /** Neither available nor unavailable — nobody entered any hours. */
    unknown: number;
  };
  /** True when `AVAILABILITY_BOARD_MAX_ROWS` cut the roster off. */
  truncated: boolean;
}

export type AvailabilityBoardResult =
  | { success: true; board: AvailabilityBoardDTO }
  | { success: false; error: string };
