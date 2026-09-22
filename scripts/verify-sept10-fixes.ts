// Verification for BOOKMOPSsept10.pdf, items 2, 3 and 5.
//
// The fix lives in a Prisma `where` clause, which normally means it cannot be
// exercised without a database. So this script carries a tiny evaluator for the
// handful of Prisma operators those fragments actually use, and runs real job
// rows through the real filters. That tests the logic, not the source text, and
// needs no connection.
//
// The scenario the client reported: a job scheduled 11:55 PM, a cleaner trying
// to clock in at 12:30 AM. It must still be Upcoming, and it must NOT also be
// Past — a job in both lists reads as a duplicate, which is how an earlier
// round of this same filter went wrong.
import {
  doneFilter,
  pastFilter,
  stillWithinServiceWindow,
  upcomingFilter,
  SERVICE_WINDOW_GRACE_HOURS,
} from "../src/lib/cleaner-jobs";
import {
  computeJobPayShares,
  jobParticipantIds,
  liveAssignments,
  type JobPayInput,
} from "../src/lib/cleaner-earnings";
import type { CleanerRateInput } from "../src/lib/pay-tiers";

let pass = 0,
  fail = 0;

function check(name: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
  if (!ok) {
    console.log(`        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    fail++;
  } else pass++;
}

// ── A very small subset of Prisma's `where` semantics ───────────────────────
// Only the operators these fragments use. Anything else throws rather than
// quietly passing, so the evaluator cannot drift out from under the filters.

type Row = Record<string, unknown>;
type Cond = Record<string, unknown>;

const ts = (v: unknown): number => (v as Date).getTime();

function matchField(value: unknown, cond: unknown): boolean {
  if (cond === null) return value === null || value === undefined;
  if (cond instanceof Date) return value instanceof Date && ts(value) === ts(cond);
  if (typeof cond !== "object") return value === cond;

  for (const [op, operand] of Object.entries(cond as Cond)) {
    switch (op) {
      case "gte":
        if (!(value instanceof Date) || ts(value) < ts(operand)) return false;
        break;
      case "gt":
        if (!(value instanceof Date) || ts(value) <= ts(operand)) return false;
        break;
      case "lt":
        if (!(value instanceof Date) || ts(value) >= ts(operand)) return false;
        break;
      case "lte":
        if (!(value instanceof Date) || ts(value) > ts(operand)) return false;
        break;
      case "not":
        if (operand === null) {
          if (value === null || value === undefined) return false;
        } else if (value === operand) return false;
        break;
      case "in":
        if (!(operand as unknown[]).includes(value)) return false;
        break;
      case "notIn":
        if ((operand as unknown[]).includes(value)) return false;
        break;
      default:
        throw new Error(`verify-sept10: unsupported operator "${op}"`);
    }
  }
  return true;
}

function matches(row: Row, where: Cond): boolean {
  for (const [key, cond] of Object.entries(where)) {
    if (key === "OR") {
      if (!(cond as Cond[]).some((c) => matches(row, c))) return false;
    } else if (key === "AND") {
      if (!(cond as Cond[]).every((c) => matches(row, c))) return false;
    } else if (key === "NOT") {
      if (matches(row, cond as Cond)) return false;
    } else if (!matchField(row[key], cond)) {
      return false;
    }
  }
  return true;
}

// ── The rows ────────────────────────────────────────────────────────────────
// Times are given in the store timezone by construction: each row is built
// relative to a fixed "now" so the test says nothing about which zone the
// machine running it happens to sit in.

const round2cents = (n: number) => Math.round(n * 100) / 100;

const H = 3_600_000;
const M = 60_000;

/** 12:30 AM, the night of the reported bug. */
const now = new Date("2026-09-11T04:30:00.000Z"); // 00:30 in Montreal (UTC-4)

/** The job: 11:55 PM the previous evening, 45 minutes long, never started. */
const lateNightJob = {
  startTime: new Date(now.getTime() - 35 * M),
  endTime: new Date(now.getTime() + 10 * M),
  clockOutTime: null,
  status: "CREATED",
};

const lateNightNoEnd = { ...lateNightJob, endTime: null };
const lateNightInProgress = { ...lateNightJob, status: "IN_PROGRESS" };
const lateNightFinished = { ...lateNightJob, clockOutTime: new Date(now.getTime() - 5 * M), status: "COMPLETED" };
const lateNightCancelled = { ...lateNightJob, status: "CANCELLED" };

/** The same job, looked at long after its window closed. */
const nextMorning = new Date(now.getTime() + (SERVICE_WINDOW_GRACE_HOURS + 2) * H);

/** Regression rows: today's work must behave exactly as it did before. */
const laterToday = {
  startTime: new Date(now.getTime() + 9 * H),
  endTime: new Date(now.getTime() + 12 * H),
  clockOutTime: null,
  status: "CREATED",
};
const finishedToday = {
  startTime: new Date(now.getTime() + 1 * H),
  endTime: new Date(now.getTime() + 3 * H),
  clockOutTime: new Date(now.getTime() + 3 * H),
  status: "COMPLETED",
};

// ── The reported bug ────────────────────────────────────────────────────────

check("11:55 PM job is still Upcoming at 12:30 AM", matches(lateNightJob, upcomingFilter(now)), true);
check("11:55 PM job is NOT also Past at 12:30 AM", matches(lateNightJob, pastFilter(now)), false);
check("11:55 PM job is not Done at 12:30 AM", matches(lateNightJob, doneFilter(now)), false);
check("...and the same holds when it has no endTime", matches(lateNightNoEnd, upcomingFilter(now)), true);
check("...and when the cleaner has already clocked in", matches(lateNightInProgress, upcomingFilter(now)), true);

// ── The window does close ───────────────────────────────────────────────────

check("once the window closes it leaves Upcoming", matches(lateNightJob, upcomingFilter(nextMorning)), false);
check("once the window closes it becomes Past", matches(lateNightJob, pastFilter(nextMorning)), true);

// ── Closed work never reopens ───────────────────────────────────────────────

check("a finished overnight job is not Upcoming", matches(lateNightFinished, upcomingFilter(now)), false);
check("a finished overnight job is Past", matches(lateNightFinished, pastFilter(now)), true);
check("a cancelled overnight job is not Upcoming", matches(lateNightCancelled, upcomingFilter(now)), false);

// ── Today's work is untouched ───────────────────────────────────────────────

check("a job later today is Upcoming", matches(laterToday, upcomingFilter(now)), true);
check("a job later today is not Past", matches(laterToday, pastFilter(now)), false);
check("a job finished today is not Upcoming", matches(finishedToday, upcomingFilter(now)), false);
check("a job finished today is Done", matches(finishedToday, doneFilter(now)), true);

// ── Upcoming and Past never overlap ─────────────────────────────────────────
// The property that matters more than any single row: whatever the job, it can
// never be in both lists. That is what made the earlier round of this filter a
// visible bug rather than a silent one.

const everyRow = [
  lateNightJob, lateNightNoEnd, lateNightInProgress, lateNightFinished,
  lateNightCancelled, laterToday, finishedToday,
];
const both = everyRow.filter(
  (r) => matches(r, upcomingFilter(now)) && matches(r, pastFilter(now))
);
check("no job is ever in both Upcoming and Past", both.length, 0);

const bothLater = everyRow.filter(
  (r) => matches(r, upcomingFilter(nextMorning)) && matches(r, pastFilter(nextMorning))
);
check("...still true once every window has closed", bothLater.length, 0);

// ── The helper is anchored to yesterday ─────────────────────────────────────
check(
  "the grace window never captures today's work",
  matches(laterToday, stillWithinServiceWindow(now)),
  false
);

// ════════════════════════════════════════════════════════════════════════════
// Items 3 and 5: the removed cleaner who stayed on the payroll
// ════════════════════════════════════════════════════════════════════════════
//
// One cause, two complaints. When a cleaner drops or is taken off a job,
// `cancelShift` disconnects them from `Job.cleaners` and marks their
// JobAssignment row CANCELLED; `syncJobAssignments` keeps that row on purpose,
// as history. The pay math read every row it found, so the ghost stayed a
// payable head: their pay line survived in Financials (item 5), and a manual
// TEAM TOTAL was divided by a crew that included them, so $180 typed for one
// cleaner paid $90 (item 3).

const rate = (id: string, role?: string): CleanerRateInput => ({
  id,
  tier: "STANDARD",
  avgRating: null,
  ratingCount: 0,
  multiplier: 1,
  role: role ?? "EMPLOYEE",
});

const rates = new Map<string, CleanerRateInput>([
  ["anna", rate("anna")],
  ["nancy", rate("nancy")],
  ["bea", rate("bea")],
  ["boss", rate("boss", "ADMIN")],
]);

function payJob(over: Partial<JobPayInput>): JobPayInput {
  return {
    id: "job",
    employeeId: null,
    cleaners: [],
    price: 400,
    employeePay: null,
    employeePayIsManual: false,
    payType: "FLAT",
    hourlyRate: null,
    totalTip: 0,
    parking: 0,
    jobDate: new Date("2026-09-10T14:00:00.000Z"),
    startTime: new Date("2026-09-10T14:00:00.000Z"),
    endTime: new Date("2026-09-10T17:00:00.000Z"),
    clockInTime: null,
    clockOutTime: null,
    ...over,
  } as JobPayInput;
}

const baseOf = (job: JobPayInput, id: string) =>
  computeJobPayShares(job, rates).get(id)?.base ?? 0;

// ── The reported number ─────────────────────────────────────────────────────

/** $180 typed for ONE cleaner. Nancy dropped the shift, so her row is history. */
const soloWithGhost = payJob({
  employeePay: 180,
  employeePayIsManual: true,
  cleaners: [{ id: "anna" }],
  assignments: [
    { cleanerId: "anna", payAmount: null, status: "ASSIGNED" },
    { cleanerId: "nancy", payAmount: null, status: "CANCELLED" },
  ],
});

check("$180 for one cleaner pays that cleaner $180", baseOf(soloWithGhost, "anna"), 180);
check("the dropped cleaner is paid nothing", baseOf(soloWithGhost, "nancy"), 0);
check("the dropped cleaner has no pay line at all", computeJobPayShares(soloWithGhost, rates).has("nancy"), false);
check("the dropped cleaner is not a participant", jobParticipantIds(soloWithGhost, rates), ["anna"]);

// ── The crew really is a crew ───────────────────────────────────────────────

const realCrew = payJob({
  employeePay: 180,
  employeePayIsManual: true,
  cleaners: [{ id: "anna" }, { id: "bea" }],
  assignments: [
    { cleanerId: "anna", payAmount: null, status: "ASSIGNED" },
    { cleanerId: "bea", payAmount: null, status: "ASSIGNED" },
  ],
});

check("a genuine two-person job still splits: anna", baseOf(realCrew, "anna"), 90);
check("a genuine two-person job still splits: bea", baseOf(realCrew, "bea"), 90);

/** The client's own three-cleaner screenshot: $160 split cent-exact. */
const threeCrew = payJob({
  employeePay: 160,
  employeePayIsManual: true,
  cleaners: [{ id: "anna" }, { id: "bea" }, { id: "nancy" }],
});
const threeShares = computeJobPayShares(threeCrew, rates);
const threeTotal = round2cents(
  ["anna", "bea", "nancy"].reduce((s, id) => s + (threeShares.get(id)?.base ?? 0), 0)
);
check("a three-cleaner total still splits to the cent", threeTotal, 160);

// ── A ghost's stored override must not come off the top ─────────────────────
//
// Worse than the head count: an override is paid BEFORE the remainder is
// split, so a dropped cleaner's stored amount would have been taken out of the
// crew's money and handed to nobody.

const ghostWithOverride = payJob({
  employeePay: 180,
  employeePayIsManual: true,
  cleaners: [{ id: "anna" }],
  assignments: [
    { cleanerId: "anna", payAmount: null, status: "ASSIGNED" },
    { cleanerId: "nancy", payAmount: 60, status: "CANCELLED" },
  ],
});

check("a dropped cleaner's override is ignored", baseOf(ghostWithOverride, "anna"), 180);
check("liveAssignments drops the cancelled row", liveAssignments(ghostWithOverride).length, 1);

// ── Guards that were already there stay there ───────────────────────────────

const adminStamped = payJob({
  employeePay: 180,
  employeePayIsManual: true,
  employeeId: "boss",
  cleaners: [{ id: "anna" }],
});
check("an admin stamped on employeeId is still not paid", baseOf(adminStamped, "anna"), 180);

const legacyRows = payJob({
  employeePay: 180,
  employeePayIsManual: true,
  cleaners: [{ id: "anna" }],
  // Pre-dates the status field being read: no status at all.
  assignments: [
    { cleanerId: "anna", payAmount: null },
    { cleanerId: "bea", payAmount: null },
  ],
});
check("a row with no status still counts as live", baseOf(legacyRows, "anna"), 90);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
