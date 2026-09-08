// How the Jobs list is ordered, as pure functions.
//
// Kept out of the view for the same reason metrics-shared exists: an ordering
// rule that only exists inside a component cannot be tested, and this one has
// an edge (the yesterday boundary) that is easy to get wrong by a day.

/** Only the fields ordering needs. Prisma rows and DTOs both satisfy it. */
export interface JobOrderShape {
  jobDate: Date | string | null;
  startTime: Date | string;
}

/** The instant a job is scheduled for. jobDate is nullable, so fall back. */
export function jobInstant(job: JobOrderShape): number {
  const raw = job.jobDate ?? job.startTime;
  const t = raw ? new Date(raw).getTime() : NaN;
  // An undated job sorts as oldest rather than floating to the top.
  return Number.isNaN(t) ? -Infinity : t;
}

/** Start of yesterday, local time: the front edge of "still my problem". */
export function startOfYesterday(now: number): number {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - 1);
  return d.getTime();
}

/**
 * Operational order: what an admin actually needs when they open Jobs.
 *
 * Yesterday onward, soonest first — yesterday's jobs to close out, today's to
 * run, then what is coming. Everything older follows, most recent first, so
 * history is one scroll away rather than sitting on top of today.
 *
 * The previous default was service date descending, which opened the page on
 * the single furthest-future booking: the one row nobody needs this morning.
 */
export function compareOperational(
  a: JobOrderShape,
  b: JobOrderShape,
  cutoff: number,
): number {
  const at = jobInstant(a);
  const bt = jobInstant(b);
  const aCurrent = at >= cutoff;
  const bCurrent = bt >= cutoff;
  if (aCurrent !== bCurrent) return aCurrent ? -1 : 1;
  return aCurrent ? at - bt : bt - at;
}
