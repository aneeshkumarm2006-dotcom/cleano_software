// Clock-in / clock-out reporting (awer_fixes.pdf item 12).
//
// The data already existed but had nowhere to be read: `JobAssignment` carries
// per-cleaner clockInTime/clockOutTime/status, while older jobs only have the
// job-level `clockInTime`/`clockOutTime` (the legacy single-cleaner fields).
// Reporting must handle both, or history looks empty.
//
// PURE — no DB imports — so the page, the job modal and any future export
// compute "time worked" identically.

export type ClockStatus =
  | "NOT_STARTED"
  | "ON_THE_WAY"
  | "CLOCKED_IN"
  | "CLOCKED_OUT"
  | "COMPLETED"
  | "CANCELLED";

export const CLOCK_STATUS_LABEL: Record<ClockStatus, string> = {
  NOT_STARTED: "Not started",
  ON_THE_WAY: "On the way",
  CLOCKED_IN: "Clocked in",
  CLOCKED_OUT: "Clocked out",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
};

export interface ClockSource {
  /** Per-cleaner assignment row, when one exists. */
  assignment?: {
    status?: string | null;
    onMyWayAt?: Date | string | null;
    clockInTime?: Date | string | null;
    clockOutTime?: Date | string | null;
  } | null;
  /** Job-level fallback for legacy jobs with no assignment row. */
  jobClockIn?: Date | string | null;
  jobClockOut?: Date | string | null;
  jobOnMyWayAt?: Date | string | null;
}

export interface ClockEntry {
  clockInTime: Date | null;
  clockOutTime: Date | null;
  onMyWayAt: Date | null;
  status: ClockStatus;
  /** Minutes between clock-in and clock-out; null while still on the clock. */
  minutesWorked: number | null;
  /** True when clocked in with no clock-out yet. */
  isOpen: boolean;
}

function toDate(v: Date | string | null | undefined): Date | null {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Derive one cleaner's clock record for one job.
 *
 * The assignment row wins when present; otherwise the job-level fields stand in
 * so pre-JobAssignment jobs still report. Status is derived from the timestamps
 * rather than trusted blindly, because a legacy job has no status field at all.
 */
export function resolveClockEntry(source: ClockSource): ClockEntry {
  const clockInTime =
    toDate(source.assignment?.clockInTime) ?? toDate(source.jobClockIn);
  const clockOutTime =
    toDate(source.assignment?.clockOutTime) ?? toDate(source.jobClockOut);
  const onMyWayAt =
    toDate(source.assignment?.onMyWayAt) ?? toDate(source.jobOnMyWayAt);

  const raw = source.assignment?.status ?? null;

  let status: ClockStatus;
  if (raw === "CANCELLED") {
    status = "CANCELLED";
  } else if (clockOutTime) {
    status = raw === "COMPLETED" ? "COMPLETED" : "CLOCKED_OUT";
  } else if (clockInTime) {
    status = "CLOCKED_IN";
  } else if (onMyWayAt) {
    status = "ON_THE_WAY";
  } else {
    status = "NOT_STARTED";
  }

  const minutesWorked =
    clockInTime && clockOutTime
      ? Math.max(
          0,
          Math.round((clockOutTime.getTime() - clockInTime.getTime()) / 60_000)
        )
      : null;

  return {
    clockInTime,
    clockOutTime,
    onMyWayAt,
    status,
    minutesWorked,
    isOpen: !!clockInTime && !clockOutTime,
  };
}

// ── Breaks (awer_fixes.pdf item 26) ─────────────────────────────────────────
//
// "Break time should not inflate total active work time." So there are two
// distinct numbers and they must never be confused:
//
//   WORKED  = clock-out − clock-in          (elapsed on the job)
//   ACTIVE  = worked − break time           (what the cleaner actually worked)
//
// Payroll's HOURLY model bills hours, so it uses ACTIVE — otherwise a lunch
// break is billed to the customer and paid to the cleaner.

export interface BreakEntry {
  startedAt: Date | string;
  endedAt?: Date | string | null;
}

export interface BreakSummary {
  /** Completed break minutes. */
  minutes: number;
  /** Number of breaks taken (including one currently running). */
  count: number;
  /** True when a break is running right now. */
  isOnBreak: boolean;
  /** Minutes elapsed on the running break, else null. */
  openBreakMinutes: number | null;
}

/**
 * Total break time. A RUNNING break is counted up to `now` so the live "active
 * time" figure doesn't jump when the cleaner finally ends it.
 */
export function summariseBreaks(
  breaks: BreakEntry[] | null | undefined,
  now: Date = new Date()
): BreakSummary {
  const rows = breaks ?? [];
  let minutes = 0;
  let isOnBreak = false;
  let openBreakMinutes: number | null = null;

  for (const b of rows) {
    const start = toDate(b.startedAt);
    if (!start) continue;
    const end = toDate(b.endedAt ?? null);
    if (end) {
      minutes += Math.max(0, (end.getTime() - start.getTime()) / 60_000);
    } else {
      isOnBreak = true;
      const open = Math.max(0, (now.getTime() - start.getTime()) / 60_000);
      openBreakMinutes = Math.round(open);
      minutes += open;
    }
  }

  return {
    minutes: Math.round(minutes),
    count: rows.length,
    isOnBreak,
    openBreakMinutes,
  };
}

/**
 * Active working time: elapsed minus breaks, floored at zero.
 *
 * Returns null when there is no completed worked total to subtract from — an
 * open shift has no final figure, and inventing one would put a guess into
 * payroll.
 */
export function activeMinutes(
  workedMinutes: number | null,
  breakMinutes: number
): number | null {
  if (workedMinutes === null) return null;
  return Math.max(0, workedMinutes - Math.max(0, breakMinutes));
}

/** Hours a cleaner actually worked, for hourly pay. Breaks are excluded. */
export function activeHours(
  workedMinutes: number | null,
  breakMinutes: number
): number {
  const active = activeMinutes(workedMinutes, breakMinutes);
  return active === null ? 0 : active / 60;
}

/** "3h 25m" / "45m" / "—". Shared so every surface formats duration alike. */
export function formatWorkedDuration(minutes: number | null): string {
  if (minutes === null) return "—";
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

/**
 * How long an open shift has been running, in minutes. Separate from
 * `minutesWorked` on purpose: an in-progress shift is not a worked total and
 * must never be summed into payroll figures.
 */
export function openShiftMinutes(
  entry: ClockEntry,
  now: Date = new Date()
): number | null {
  if (!entry.isOpen || !entry.clockInTime) return null;
  return Math.max(
    0,
    Math.round((now.getTime() - entry.clockInTime.getTime()) / 60_000)
  );
}

/**
 * A shift still open well past its expected end usually means the cleaner
 * forgot to clock out — worth flagging for payroll review rather than letting
 * it quietly inflate hours.
 */
export const STALE_SHIFT_HOURS = 12;

export function isStaleOpenShift(
  entry: ClockEntry,
  now: Date = new Date()
): boolean {
  const open = openShiftMinutes(entry, now);
  return open !== null && open > STALE_SHIFT_HOURS * 60;
}
