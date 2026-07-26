import type { ClockStatus } from "@/lib/time-tracking";

/** One cleaner's clock record for one job (awer_fixes.pdf item 12). */
export interface ClockActivityEntry {
  id: string;
  jobId: string;
  jobNumber: number;
  clientName: string;
  jobType: string | null;
  /** ISO — the job's scheduled start, used for grouping by day. */
  scheduledStart: string;
  cleanerId: string | null;
  cleanerName: string;
  clockInTime: string | null;
  clockOutTime: string | null;
  status: ClockStatus;
  /** Completed shift length in minutes (elapsed); null while still clocked in. */
  minutesWorked: number | null;
  /** Break time taken on this job by this cleaner (item 26). */
  breakMinutes: number;
  /** Worked minus breaks — the figure payroll should read. Null while open. */
  activeMinutes: number | null;
  /** True when this cleaner is on a break right now. */
  isOnBreak: boolean;
  /** Minutes elapsed on an in-progress shift; null when not open. */
  openMinutes: number | null;
  /** Open far longer than a plausible shift — likely a missed clock-out. */
  isStale: boolean;
  /** True when derived from legacy job-level fields, not a JobAssignment row. */
  isLegacy: boolean;
}

export interface ClockActivityPage {
  entries: ClockActivityEntry[];
  nextCursor: string | null;
  /** Counts across the whole filtered set, not just this page. */
  totals: {
    openShifts: number;
    staleShifts: number;
  };
}
