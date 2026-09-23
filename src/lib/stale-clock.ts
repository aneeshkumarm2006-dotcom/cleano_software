/**
 * A clock somebody forgot to stop.
 *
 * Nothing in this app has ever closed a work session. `endedAt` is written by
 * an explicit clock-out and by nothing else, so a cleaner who finishes a job
 * and walks away leaves a session running for good. Eighteen of them were open
 * in production when this was written, the oldest for thirty-four days.
 *
 * That is not merely untidy, because `sessionMinutes` measures an open session
 * to NOW:
 *
 *     const end = toDate(session.endedAt ?? null) ?? now;
 *
 * which is right for a cleaner who is genuinely on site and wrong for every
 * other case. A session open since last month reports eight hundred hours, and
 * those hours reach payroll.
 *
 * WHY THIS ONLY REPORTS. Closing one of these means choosing when the cleaner
 * actually stopped, and that is a fact about a day nobody here witnessed. The
 * job's own end time is a good guess and only a guess. So this module decides
 * what looks wrong and what the likely answer is; a person confirms it. There
 * is deliberately no sweep that writes `endedAt`.
 *
 * Pure. The queries live in stale-clock.server.ts.
 */

/**
 * How long a session may run before we call it forgotten.
 *
 * Sixteen hours, not eight. A double shift, a job that runs past midnight, and
 * a cleaner who takes a long unpaid gap between two houses are all real and all
 * legitimate; flagging those would train an admin to ignore the list, which is
 * the only failure mode that matters for a queue like this. Nothing honest runs
 * sixteen hours.
 */
export const STALE_SESSION_HOURS = 16;

/** Past this, it is not a long shift, it is a data problem. */
export const ABANDONED_SESSION_HOURS = 48;

const HOUR = 60 * 60 * 1000;

export type StaleSeverity = "forgotten" | "abandoned";

export interface OpenSessionInput {
  startedAt: Date | string;
  endedAt?: Date | string | null;
  /** The job's scheduled finish, when it has one. */
  jobEndTime?: Date | string | null;
  /** The job's scheduled start. */
  jobStartTime?: Date | string | null;
}

function toDate(v: Date | string | null | undefined): Date | null {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Hours this session has been running. */
export function openHours(
  session: OpenSessionInput,
  now: Date = new Date(),
): number {
  const start = toDate(session.startedAt);
  if (!start) return 0;
  return Math.max(0, (now.getTime() - start.getTime()) / HOUR);
}

/**
 * Is this session one somebody forgot to stop?
 *
 * A closed session is never stale, however long it ran: that one was answered.
 */
export function isStale(
  session: OpenSessionInput,
  now: Date = new Date(),
): boolean {
  if (toDate(session.endedAt ?? null)) return false;
  return openHours(session, now) >= STALE_SESSION_HOURS;
}

export function severityOf(
  session: OpenSessionInput,
  now: Date = new Date(),
): StaleSeverity {
  return openHours(session, now) >= ABANDONED_SESSION_HOURS
    ? "abandoned"
    : "forgotten";
}

/**
 * The best guess at when the cleaner actually stopped, for prefilling the form
 * an admin confirms.
 *
 * Order matters. The job's scheduled finish is the strongest signal we have and
 * it is what an admin would reach for anyway. Failing that, the job's start
 * plus a normal shift. Failing both, the session's own start plus a normal
 * shift — never `now`, which would bake in the very inflation this exists to
 * catch.
 *
 * Returns null when the guess would be before the clock-in, because a negative
 * shift is worse than no suggestion: it would be silently clamped to zero and
 * the admin would never see that we had no idea.
 */
export const ASSUMED_SHIFT_HOURS = 3;

export function suggestedEnd(
  session: OpenSessionInput,
  now: Date = new Date(),
): Date | null {
  const start = toDate(session.startedAt);
  if (!start) return null;

  const candidates = [
    toDate(session.jobEndTime ?? null),
    (() => {
      const js = toDate(session.jobStartTime ?? null);
      return js ? new Date(js.getTime() + ASSUMED_SHIFT_HOURS * HOUR) : null;
    })(),
    new Date(start.getTime() + ASSUMED_SHIFT_HOURS * HOUR),
  ];

  for (const c of candidates) {
    if (!c) continue;
    if (c.getTime() <= start.getTime()) continue;
    // A guess in the future is not a guess about the past.
    if (c.getTime() > now.getTime()) continue;
    return c;
  }
  return null;
}

/** "3 days" / "16 hours" — for a list an admin scans, not a precise readout. */
export function describeOpenFor(
  session: OpenSessionInput,
  now: Date = new Date(),
): string {
  const h = openHours(session, now);
  if (h < 48) {
    const rounded = Math.round(h);
    return `${rounded} hour${rounded === 1 ? "" : "s"}`;
  }
  const days = Math.floor(h / 24);
  return `${days} days`;
}

/**
 * What this costs if nobody acts.
 *
 * Stated in hours rather than money on purpose: the rate depends on the
 * cleaner and the job, and a wrong dollar figure in a warning is worse than an
 * honest count of hours.
 */
export function overstatedHours(
  session: OpenSessionInput,
  now: Date = new Date(),
): number {
  const guess = suggestedEnd(session, now);
  const start = toDate(session.startedAt);
  if (!guess || !start) return openHours(session, now);
  const real = (guess.getTime() - start.getTime()) / HOUR;
  return Math.max(0, openHours(session, now) - real);
}
