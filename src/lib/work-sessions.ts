// Work sessions (awerfixes.pdf item 6, round 3 — "clock back into a job").
//
// PURE — no DB imports — so the clock screen, the admin job view, payroll and
// the verify script all compute "how long did this cleaner work" identically.
// The store side is in the clock actions; the model is JobWorkSession.
//
// THE ONE THING TO UNDERSTAND HERE: breaks are allocated to sessions by
// INTERVAL INTERSECTION, not subtracted wholesale.
//
// JobBreak rows are keyed (jobId, cleanerId) with no session reference, so a
// cleaner with two sessions and one break has a break that belongs to exactly
// one of them. Subtracting the job-wide break total from every session would
// double-count it; subtracting it once from the total would still put it in the
// wrong row on screen. Intersecting each break with each session interval gives
// the correct per-session figure AND the correct total, from one rule.

export interface WorkSession {
  startedAt: Date | string;
  endedAt?: Date | string | null;
}

export interface WorkSessionOf extends WorkSession {
  cleanerId: string;
}

export interface BreakInterval {
  startedAt: Date | string;
  endedAt?: Date | string | null;
}

function toDate(v: Date | string | null | undefined): Date | null {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

const MIN = 60_000;

/**
 * Minutes in one session. A RUNNING session counts up to `now`, so the live
 * figure doesn't jump when the cleaner finally clocks out.
 */
export function sessionMinutes(
  session: WorkSession,
  now: Date = new Date()
): number {
  const start = toDate(session.startedAt);
  if (!start) return 0;
  const end = toDate(session.endedAt ?? null) ?? now;
  return Math.max(0, (end.getTime() - start.getTime()) / MIN);
}

/**
 * Minutes of `breaks` that fall INSIDE this session's window. A break outside
 * it belongs to a different session and must not be deducted here.
 */
export function breakMinutesWithin(
  session: WorkSession,
  breaks: BreakInterval[] | null | undefined,
  now: Date = new Date()
): number {
  const sStart = toDate(session.startedAt);
  if (!sStart) return 0;
  const sEnd = toDate(session.endedAt ?? null) ?? now;

  let minutes = 0;
  for (const b of breaks ?? []) {
    const bStart = toDate(b.startedAt);
    if (!bStart) continue;
    // A running break is counted up to now, matching summariseBreaks.
    const bEnd = toDate(b.endedAt ?? null) ?? now;
    const start = bStart > sStart ? bStart : sStart;
    const end = bEnd < sEnd ? bEnd : sEnd;
    if (end > start) minutes += (end.getTime() - start.getTime()) / MIN;
  }
  return minutes;
}

/** Worked minus breaks for one session, floored at zero. */
export function activeSessionMinutes(
  session: WorkSession,
  breaks: BreakInterval[] | null | undefined,
  now: Date = new Date()
): number {
  return Math.max(
    0,
    sessionMinutes(session, now) - breakMinutesWithin(session, breaks, now)
  );
}

export interface SessionSummary {
  count: number;
  /** Sum of every session's elapsed minutes (breaks NOT deducted). */
  totalMinutes: number;
  /** Sum of active minutes: elapsed minus the breaks inside each session. */
  activeMinutes: number;
  /** True while any session has no endedAt. */
  isOpen: boolean;
  /** Earliest start across all sessions, or null. */
  firstStartedAt: Date | null;
  /** Latest end; null when any session is still open. */
  lastEndedAt: Date | null;
}

export function summariseSessions(
  sessions: WorkSession[] | null | undefined,
  breaks: BreakInterval[] | null | undefined = [],
  now: Date = new Date()
): SessionSummary {
  const rows = sessions ?? [];
  let totalMinutes = 0;
  let active = 0;
  let isOpen = false;
  let firstStartedAt: Date | null = null;
  let lastEndedAt: Date | null = null;

  for (const s of rows) {
    const start = toDate(s.startedAt);
    if (!start) continue;
    const end = toDate(s.endedAt ?? null);

    totalMinutes += sessionMinutes(s, now);
    active += activeSessionMinutes(s, breaks, now);

    if (!firstStartedAt || start < firstStartedAt) firstStartedAt = start;
    if (!end) {
      isOpen = true;
    } else if (!lastEndedAt || end > lastEndedAt) {
      lastEndedAt = end;
    }
  }

  return {
    count: rows.length,
    totalMinutes: Math.round(totalMinutes),
    activeMinutes: Math.round(active),
    isOpen,
    firstStartedAt,
    // A job with any session still running has no finish time yet — reporting
    // the previous session's end as "clocked out" is how a resumed job would
    // look finished while somebody is still on site.
    lastEndedAt: isOpen ? null : lastEndedAt,
  };
}

// ── TOTAL CREW HOURS (AWER round 4, fixes 4 + 5) ─────────────────────────────
//
// One measurement, two consumers, and that is the point of putting it here:
//
//   fix 4  the CUSTOMER is billed `rate × total crew hours`
//          (src/lib/hourly-billing.ts → billableCrewMinutes)
//   fix 5  the CLEANER is paid `their own clocked hours × their rate`
//          (src/lib/cleaner-earnings.ts → computeJobPayShares)
//
// The team's pay is the sum of the per-cleaner figures, and the customer's bill
// is the sum of the same per-cleaner figures. So both sides read the SAME map,
// and "the customer was billed 6h while the crew was paid for 3h" stops being
// expressible.
//
// BREAK ALLOCATION. A break belongs to the cleaner who took it: their lunch
// comes off their hours and nobody else's. A break row with no `cleanerId` is
// the pre-item-26 shape and applies to everyone, and the legacy job-level clock
// pair — which stands for the whole crew, not one person — has every break
// deducted from it, matching `jobWorkedHours` on the pay side.

/** A work session that knows whose it is. Null `cleanerId` = the legacy pair. */
export interface CrewSession extends WorkSession {
  cleanerId?: string | null;
}

/** A break that knows whose it is. Null `cleanerId` = "everybody's". */
export interface CrewBreak extends BreakInterval {
  cleanerId?: string | null;
}

/** The key a null/absent `cleanerId` groups under — the legacy job-level pair. */
const LEGACY_KEY = "";

/**
 * ACTIVE minutes per cleaner: their sessions summed, their own breaks removed.
 *
 * Keyed by `cleanerId`; the legacy job-level pair (no cleanerId) lands under
 * `""` and is counted ONCE, because there is no per-cleaner data behind it to
 * expand — a single pair is one record of work, not one per crew member.
 */
export function crewActiveMinutesByCleaner(
  sessions: readonly CrewSession[] | null | undefined,
  breaks: readonly CrewBreak[] | null | undefined = [],
  now: Date = new Date()
): Map<string, number> {
  const byCleaner = new Map<string, WorkSession[]>();
  for (const s of sessions ?? []) {
    const key = s.cleanerId ?? LEGACY_KEY;
    const list = byCleaner.get(key);
    if (list) list.push(s);
    else byCleaner.set(key, [s]);
  }

  const allBreaks = [...(breaks ?? [])];
  const out = new Map<string, number>();
  for (const [key, mine] of byCleaner) {
    // The legacy pair stands for the whole crew, so every break comes off it —
    // the same rule `jobWorkedHours` applies when it deducts the job's whole
    // break total from the job's single clock span.
    const applicable =
      key === LEGACY_KEY
        ? allBreaks
        : allBreaks.filter((b) => b.cleanerId == null || b.cleanerId === key);
    out.set(key, summariseSessions(mine, applicable, now).activeMinutes);
  }
  return out;
}

/**
 * TOTAL CREW MINUTES — every cleaner's active time, added up.
 *
 * Two cleaners on site together for three hours is SIX crew hours. That is the
 * round-4 rule and it reverses Stage 8's union ("three hours"); see the long
 * note in src/lib/hourly-billing.ts for why the PDF wins.
 */
export function crewActiveMinutes(
  sessions: readonly CrewSession[] | null | undefined,
  breaks: readonly CrewBreak[] | null | undefined = [],
  now: Date = new Date()
): number {
  let total = 0;
  for (const minutes of crewActiveMinutesByCleaner(sessions, breaks, now).values()) {
    total += minutes;
  }
  return total;
}

/**
 * The legacy fallback: turn a pre-JobWorkSession clock pair into the one
 * session it represents. Jobs that predate this table — and any job whose
 * backfill has not been committed — read correctly through this.
 *
 * A clock-in with no clock-out becomes one OPEN session, which is exactly what
 * it was.
 */
export function sessionsFromLegacyPair(
  clockInTime: Date | string | null | undefined,
  clockOutTime: Date | string | null | undefined
): WorkSession[] {
  const start = toDate(clockInTime);
  if (!start) return [];
  return [{ startedAt: start, endedAt: toDate(clockOutTime) }];
}

/**
 * Sessions for one cleaner, falling back to the legacy pair when they have
 * none. THE single entry point for "what did this cleaner work on this job" —
 * every reader should go through here so old and new rows behave alike.
 */
export function sessionsForCleaner(
  cleanerId: string,
  sessions: WorkSessionOf[] | null | undefined,
  legacy: {
    clockInTime?: Date | string | null;
    clockOutTime?: Date | string | null;
  } = {}
): WorkSession[] {
  const mine = (sessions ?? []).filter((s) => s.cleanerId === cleanerId);
  if (mine.length > 0) return mine;
  return sessionsFromLegacyPair(legacy.clockInTime, legacy.clockOutTime);
}

/** True when this cleaner is on the clock right now on this job. */
export function hasOpenSession(sessions: WorkSession[] | null | undefined): boolean {
  return (sessions ?? []).some((s) => !toDate(s.endedAt ?? null));
}

/** Newest first — how the session log reads on screen. */
export function sortSessionsDesc<T extends WorkSession>(sessions: T[]): T[] {
  return [...sessions].sort((a, b) => {
    const at = toDate(a.startedAt)?.getTime() ?? 0;
    const bt = toDate(b.startedAt)?.getTime() ?? 0;
    return bt - at;
  });
}

/**
 * Statuses a job can never be resumed from. COMPLETED is deliberately NOT here
 * — reopening a finished job is the entire point of "clock back in". PAID means
 * the money has moved and CANCELLED means the work is off.
 */
export const RESUME_BLOCKED_STATUSES = ["PAID", "CANCELLED"] as const;

export function canResume(status: string): boolean {
  return !(RESUME_BLOCKED_STATUSES as readonly string[]).includes(status);
}
