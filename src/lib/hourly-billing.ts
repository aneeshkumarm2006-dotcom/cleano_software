// Customer-side HOURLY BILLING (PDF #8, Stage 8).
//
// ## The one distinction this whole module exists to protect
//
// There are now two hourly numbers on a Job and they are NOT the same money:
//
//   Job.hourlyRate        what the CLEANER is paid per hour  (payType HOURLY)
//   Job.billedHourlyRate  what the CUSTOMER is charged per hour (billingType HOURLY)
//
// Before this stage only the first existed, and "hourly job" in the admin UI
// meant "hourly cleaner pay" — there was no customer-side hourly price at all,
// which is what PDF #8 reports. The columns are deliberately named apart, the
// modal keeps them in two separate sections (decision D6), and nothing in this
// file ever reads `hourlyRate`.
//
// PURE — no DB, no framework, no `@prisma/client` import. Three client
// components render through `computeJobMoney`, which imports this file, so a
// server-only import here would break the build at the far end of the app.
// The enum values below mirror `enum JobBillingType` in schema.prisma; the
// verify script asserts the two lists match.

/** `Job.billingType`. Spelled as a union, not imported — see the header. */
export type JobBillingType = "FLAT" | "HOURLY";

export const JOB_BILLING_TYPES: readonly JobBillingType[] = [
  "FLAT",
  "HOURLY",
] as const;

export function isBillingType(v: unknown): v is JobBillingType {
  return v === "FLAT" || v === "HOURLY";
}

/**
 * Labels and hints. Worded for decision D6: the admin must never be able to
 * confuse the customer rate with the cleaner's rate, so both strings say
 * "customer" out loud and neither says "pay".
 */
export const BILLING_TYPE_LABEL: Record<JobBillingType, string> = {
  FLAT: "Flat price",
  HOURLY: "Hourly",
};

export const BILLING_TYPE_HINT: Record<JobBillingType, string> = {
  FLAT: "One agreed price for the job, however long it takes.",
  HOURLY: "The customer is billed an hourly rate × the job's billable hours.",
};

/**
 * Rounding for the actual-hours snapshot (decision D7): nearest quarter hour,
 * admin-editable afterwards. A 2h47m job bills 2.75h.
 */
export const BILLED_HOURS_INCREMENT = 0.25;

/** Longest single job this will ever bill, as a sanity clamp on form input. */
export const MAX_BILLED_HOURS = 999;

export function roundBilledHours(hours: number): number {
  const n = Number(hours);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return (
    Math.round(Math.min(n, MAX_BILLED_HOURS) / BILLED_HOURS_INCREMENT) *
    BILLED_HOURS_INCREMENT
  );
}

/** The four columns any hourly calculation reads. All optional — see `isHourlyBilled`. */
export interface HourlyBillingFields {
  billingType?: JobBillingType | string | null;
  billedHourlyRate?: number | null;
  billedEstimatedHours?: number | null;
  /** Snapshotted at final clock-out from the work sessions; admin-editable. */
  billedActualHours?: number | null;
}

/**
 * Is this job billed by the hour?
 *
 * An absent/garbage `billingType` reads as FLAT, which is every row written
 * before this stage and every caller that hasn't been threaded — so a `select`
 * that forgets the column degrades to today's behaviour rather than to a
 * different price. (Both save paths ALSO keep `Job.price` equal to the derived
 * hourly amount, so such a caller still prints the right number; see
 * `hourlyServiceAmount` below.)
 */
export function isHourlyBilled(job: HourlyBillingFields | null | undefined): boolean {
  return job?.billingType === "HOURLY";
}

/**
 * The hours this job actually bills: what was worked, else what was estimated.
 *
 * `billedActualHours` wins the moment it exists — that is the whole point of
 * snapshotting it at clock-out — and `?? billedEstimatedHours` is what an
 * unstarted job quotes. Returns null when neither is a usable positive number,
 * which is the "hourly job with nothing entered yet" case.
 */
export function billedHours(
  job: HourlyBillingFields | null | undefined
): number | null {
  const actual = Number(job?.billedActualHours);
  if (Number.isFinite(actual) && actual > 0) return actual;
  const estimated = Number(job?.billedEstimatedHours);
  if (Number.isFinite(estimated) && estimated > 0) return estimated;
  return null;
}

/** Which of the two figures `billedHours` returned — for labelling, never for arithmetic. */
export function billedHoursSource(
  job: HourlyBillingFields | null | undefined
): "ACTUAL" | "ESTIMATED" | "NONE" {
  const actual = Number(job?.billedActualHours);
  if (Number.isFinite(actual) && actual > 0) return "ACTUAL";
  const estimated = Number(job?.billedEstimatedHours);
  if (Number.isFinite(estimated) && estimated > 0) return "ESTIMATED";
  return "NONE";
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * THE hourly service line: `billedHourlyRate × billedHours`.
 *
 * Returns null — not 0 — when the job is not hourly, or is hourly but has no
 * rate or no hours yet. Null means "this job has no hourly-derived price, use
 * `Job.price`"; zero would mean "this job is worth nothing", and the two must
 * not be confused by the caller in `computeJobMoney`.
 */
export function hourlyServiceAmount(
  job: HourlyBillingFields | null | undefined
): number | null {
  if (!isHourlyBilled(job)) return null;
  const rate = Number(job?.billedHourlyRate);
  if (!Number.isFinite(rate) || rate <= 0) return null;
  const hours = billedHours(job);
  if (hours === null) return null;
  return round2(rate * hours);
}

/** "4h × $60.00/hr = $240.00" — one string, so no two surfaces word it differently. */
export function hourlyLineLabel(
  job: HourlyBillingFields | null | undefined
): string | null {
  const amount = hourlyServiceAmount(job);
  if (amount === null) return null;
  const hours = billedHours(job) ?? 0;
  const rate = Number(job?.billedHourlyRate) || 0;
  return `${formatHours(hours)} × $${rate.toFixed(2)}/hr = $${amount.toFixed(2)}`;
}

/** "4h" / "2.75h" — trailing zeros trimmed, so 4.00 never prints as "4.00h". */
export function formatHours(hours: number): string {
  const n = Number(hours);
  if (!Number.isFinite(n)) return "0h";
  return `${String(Math.round(n * 100) / 100)}h`;
}

// ── Actual hours, measured from the work sessions ────────────────────────────
//
// THE RULE (documented here because it is the one judgement call in Stage 8):
// billable hours are ELAPSED, not man-hours. Two cleaners on site together for
// three hours is THREE billable hours, not six.
//
// Why: `billedEstimatedHours` is typed by an admin looking at the scheduled
// window, so the actual figure has to be measured in the same unit or the total
// would jump the moment a second cleaner is assigned — an invisible doubling of
// a real customer's bill. Sending more crew shortens the job; it does not
// double the rate. (A per-cleaner-hour model is what `postConstructionBasePrice`
// uses — `hours × rate × cleaners` — and Stage 11 can reach it from here by
// multiplying the rate, never by redefining these hours.)
//
// Concretely: per cleaner, take each work session and cut their own breaks out
// of it; then UNION every remaining piece across the crew. A break one cleaner
// takes while a teammate keeps working does not stop the clock, because the job
// was still being worked.

export interface BilledInterval {
  startedAt: Date | string;
  endedAt?: Date | string | null;
}

export interface BilledSession extends BilledInterval {
  cleanerId?: string | null;
}

export interface BilledBreak extends BilledInterval {
  cleanerId?: string | null;
}

interface Span {
  start: number;
  end: number;
}

function toMs(v: Date | string | null | undefined): number | null {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  const t = d.getTime();
  return Number.isNaN(t) ? null : t;
}

/** `base` with every span in `cuts` removed. Cuts may overlap and be unsorted. */
function subtractSpans(base: Span, cuts: Span[]): Span[] {
  let pieces: Span[] = [base];
  for (const cut of cuts) {
    if (cut.end <= cut.start) continue;
    const next: Span[] = [];
    for (const p of pieces) {
      if (cut.end <= p.start || cut.start >= p.end) {
        next.push(p);
        continue;
      }
      if (cut.start > p.start) next.push({ start: p.start, end: cut.start });
      if (cut.end < p.end) next.push({ start: cut.end, end: p.end });
    }
    pieces = next;
    if (pieces.length === 0) break;
  }
  return pieces;
}

/** Overlapping/adjacent spans collapsed into the fewest spans that cover the same time. */
function mergeSpans(spans: Span[]): Span[] {
  const sorted = spans
    .filter((s) => s.end > s.start)
    .sort((a, b) => a.start - b.start);
  const out: Span[] = [];
  for (const s of sorted) {
    const last = out[out.length - 1];
    if (last && s.start <= last.end) {
      if (s.end > last.end) last.end = s.end;
    } else {
      out.push({ ...s });
    }
  }
  return out;
}

/**
 * Minutes this job was being worked by AT LEAST ONE cleaner, breaks removed.
 *
 * An open session (no `endedAt`) counts up to `now`, matching
 * `summariseSessions` — so a live figure doesn't jump when the last cleaner
 * finally clocks out.
 */
export function billableElapsedMinutes(
  sessions: readonly BilledSession[] | null | undefined,
  breaks: readonly BilledBreak[] | null | undefined = [],
  now: Date = new Date()
): number {
  const nowMs = now.getTime();
  const breakSpansByCleaner = new Map<string, Span[]>();
  for (const b of breaks ?? []) {
    const start = toMs(b.startedAt);
    if (start === null) continue;
    const end = toMs(b.endedAt ?? null) ?? nowMs;
    if (end <= start) continue;
    const key = b.cleanerId ?? "";
    const list = breakSpansByCleaner.get(key) ?? [];
    list.push({ start, end });
    breakSpansByCleaner.set(key, list);
  }

  const active: Span[] = [];
  for (const s of sessions ?? []) {
    const start = toMs(s.startedAt);
    if (start === null) continue;
    const end = toMs(s.endedAt ?? null) ?? nowMs;
    if (end <= start) continue;
    // A break row with no cleanerId belongs to whoever was working — the
    // pre-per-cleaner shape — so it cuts every session.
    const cuts = [
      ...(breakSpansByCleaner.get(s.cleanerId ?? "") ?? []),
      ...(s.cleanerId ? breakSpansByCleaner.get("") ?? [] : []),
    ];
    active.push(...subtractSpans({ start, end }, cuts));
  }

  return mergeSpans(active).reduce(
    (sum, s) => sum + (s.end - s.start) / 60_000,
    0
  );
}

/**
 * The figure written into `billedActualHours`: elapsed worked time, rounded to
 * the nearest quarter hour (D7). Returns 0 when nothing was worked, which the
 * caller treats as "nothing to snapshot" rather than "the job billed nothing".
 */
export function billableActualHours(
  sessions: readonly BilledSession[] | null | undefined,
  breaks: readonly BilledBreak[] | null | undefined = [],
  now: Date = new Date()
): number {
  return roundBilledHours(billableElapsedMinutes(sessions, breaks, now) / 60);
}
