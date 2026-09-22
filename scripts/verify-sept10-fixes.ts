// Verification for BOOKMOPSsept10.pdf, items 1-15.
//
// Run through `npm run verify`, which passes --conditions=react-server. Run
// directly it needs that flag too, because job-reschedule.ts is server-only:
//   npx tsx --conditions=react-server scripts/verify-sept10-fixes.ts
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
import {
  planWorkTrailReset,
  type WorkTrailJob,
} from "../src/lib/job-reschedule";
import fs from "node:fs";
import { ratedCleanerIds } from "../src/lib/rating-crew";
import { resolveRecurringDiscountPercent } from "../src/lib/booking-pricing";
import { storeDateKey, storeTimeKey } from "../src/lib/timezone";
import { tzToday } from "../src/lib/tz-calendar";

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

// ════════════════════════════════════════════════════════════════════════════
// Item 1: a rescheduled job must arrive as a fresh job
// ════════════════════════════════════════════════════════════════════════════
//
// Most of this was already built. What was missing is the checklist: a job
// moved to next Tuesday arrived with its ticks intact, telling the cleaner
// nine of twelve rooms were already done.
//
// `planWorkTrailReset` is the whole decision, and it is pure, so every rule
// below is checked without a database: what counts as a trail, which cleaners
// must not be dragged back onto the job, and how many minutes are being thrown
// away.

const RESCHEDULE_NOW = new Date("2026-09-22T15:00:00.000Z");

function trailJob(over: Partial<WorkTrailJob> = {}): WorkTrailJob {
  return {
    status: "SCHEDULED",
    clockInTime: null,
    clockOutTime: null,
    onMyWayAt: null,
    workSessions: [],
    breaks: [],
    assignments: [],
    checklists: [],
    ...over,
  };
}

const item = (id: string, status: string) => ({ id, status });

// ── The gap this fixes ──────────────────────────────────────────────────────

const tickedChecklist = trailJob({
  checklists: [
    {
      items: [
        item("a", "COMPLETED"),
        item("b", "COMPLETED"),
        item("c", "SKIPPED"),
        item("d", "PENDING"),
      ],
    },
  ],
});
check(
  "ticked checklist items are reset",
  planWorkTrailReset(tickedChecklist, RESCHEDULE_NOW)?.tickedItemIds,
  ["a", "b", "c"]
);
check(
  "a skipped item counts as a tick",
  planWorkTrailReset(
    trailJob({ checklists: [{ items: [item("only", "SKIPPED")] }] }),
    RESCHEDULE_NOW
  )?.tickedItemIds,
  ["only"]
);
check(
  "a checklist nobody touched is not a trail",
  planWorkTrailReset(
    trailJob({ checklists: [{ items: [item("a", "PENDING")] }] }),
    RESCHEDULE_NOW
  ),
  null
);
check(
  "a two-person job resets both checklists",
  planWorkTrailReset(
    trailJob({
      checklists: [
        { items: [item("anna-1", "COMPLETED")] },
        { items: [item("bea-1", "COMPLETED")] },
      ],
    }),
    RESCHEDULE_NOW
  )?.tickedItemIds,
  ["anna-1", "bea-1"]
);

// ── The rules that were already there stay there ────────────────────────────

check(
  "a completed job is left entirely alone",
  planWorkTrailReset(
    trailJob({ status: "COMPLETED", clockInTime: new Date(), checklists: [{ items: [item("a", "COMPLETED")] }] }),
    RESCHEDULE_NOW
  ),
  null
);
check(
  "a paid job is left entirely alone",
  planWorkTrailReset(trailJob({ status: "PAID", clockInTime: new Date() }), RESCHEDULE_NOW),
  null
);
check(
  "an untouched job needs no reset",
  planWorkTrailReset(trailJob(), RESCHEDULE_NOW),
  null
);
check(
  "an in-progress job is a trail even with nothing else on it",
  planWorkTrailReset(trailJob({ status: "IN_PROGRESS" }), RESCHEDULE_NOW) !== null,
  true
);

// ── A cleaner who left must not be dragged back ─────────────────────────────

const mixedCrew = trailJob({
  assignments: [
    { id: "live", status: "CLOCKED_IN", onMyWayAt: null, clockInTime: new Date(), clockOutTime: null },
    { id: "gone", status: "CANCELLED", onMyWayAt: null, clockInTime: new Date(), clockOutTime: null },
    { id: "untouched", status: "ASSIGNED", onMyWayAt: null, clockInTime: null, clockOutTime: null },
  ],
});
check(
  "only the live, started assignment is reset",
  planWorkTrailReset(mixedCrew, RESCHEDULE_NOW)?.assignmentIds,
  ["live"]
);

// ── The minutes the log row reports ─────────────────────────────────────────

const sessions = trailJob({
  workSessions: [
    {
      startedAt: new Date(RESCHEDULE_NOW.getTime() - 90 * 60_000),
      endedAt: new Date(RESCHEDULE_NOW.getTime() - 60 * 60_000),
    },
    // Still open: measured up to the moment of the reschedule, not to "now".
    { startedAt: new Date(RESCHEDULE_NOW.getTime() - 45 * 60_000), endedAt: null },
  ],
});
check("finished and open sessions are both counted", planWorkTrailReset(sessions, RESCHEDULE_NOW)?.minutes, 75);
check("session count is reported", planWorkTrailReset(sessions, RESCHEDULE_NOW)?.sessions, 2);

// ── Wiring, which no pure test can see ──────────────────────────────────────
//
// The planner being right is worth nothing if a path that moves a date forgets
// to call it. That already happened once: /admin/jobs/new is a second copy of
// the job save, and it shipped without the call. These are source assertions
// because the regression is a deleted line.

const read = (f: string) => fs.readFileSync(f, "utf8");

for (const path of [
  "src/app/admin/actions/saveJob.ts",
  "src/app/admin/actions/updateJobDates.ts",
  "src/app/admin/jobs/new/page.tsx",
]) {
  check(`${path} clears the trail on a move`, read(path).includes("clearWorkTrailForReschedule"), true);
}

const helper = read("src/lib/job-reschedule.ts");
check("the reset runs inside a transaction", helper.includes("db.$transaction(async (tx)"), true);
check("checklist items are reset on tx, not db", helper.includes("tx.jobChecklistItem.updateMany"), true);
check("photos are never deleted here", helper.includes("jobPhoto.delete"), false);
check("product usage is never deleted here", helper.includes("jobProductUsage.delete"), false);

// Duplicating a job must not copy the clock. It cannot today, because the
// duplicate is a new row that only takes form defaults, but the guard is that
// nobody starts prefilling clock fields from the source job.
const newJobPage = read("src/app/admin/jobs/new/page.tsx");
check(
  "the duplicate prefill never reads a clock field",
  /prefill[^\n]*clock/i.test(newJobPage),
  false
);

// ════════════════════════════════════════════════════════════════════════════
// Item 4: the notification system
// ════════════════════════════════════════════════════════════════════════════
//
// All of this writes to the database, so it is asserted against the source.
// Each check below is a line that was missing, and a regression is that line
// being deleted again.

const claim = read("src/app/cleaners/available-jobs/claimJob.ts");
check(
  "claiming a job from the board tells the office",
  /sendAdminUnassignedEvent\(\{\s*event: "grabbed"/.test(claim),
  true
);
check("the notice can name the job", claim.includes("jobNumber: true"), true);

const clockOut = read("src/app/admin/actions/clockOut.ts");
check(
  "a failed clock-out reaches the feed, not only the alerts page",
  clockOut.includes('key: "admin.clock.clock_out_failed"'),
  true
);
check(
  "...and it is an ERROR, because a cleaner is stuck on site",
  /clock_out_failed[\s\S]{0,240}severity: "ERROR"/.test(clockOut),
  true
);

const clockIn = read("src/app/admin/actions/clockIn.ts");
check(
  "a thrown clock-in is reported",
  clockIn.includes('key: "admin.clock.clock_in_failed"'),
  true
);
check(
  "...but a refusal is not: 'too early' is the rule working",
  /Too early to clock in[\s\S]{0,400}recordAdminNotification/.test(clockIn),
  false
);

const feed = read("src/lib/admin-notifications.ts");
check(
  "a lost notification is logged where an admin can see it",
  feed.includes('action: "notification.record_failed"'),
  true
);
check(
  "the badge asks a question instead of doing arithmetic",
  feed.includes("reads: { none: { userId } }"),
  true
);
check(
  "the old total-minus-read subtraction is gone",
  /Math\.max\(0, total - read\)/.test(feed),
  false
);
check(
  "there is a way to clear what the page never listed",
  feed.includes("export async function markAllAdminNotificationsRead"),
  true
);
check(
  "opening the feed clears all of it, not just the visible 50",
  read("src/app/admin/notifications/NotificationsClient.tsx").includes(
    "markAllNotificationsRead()"
  ),
  true
);

// ════════════════════════════════════════════════════════════════════════════
// Item 6: the business clock, not the viewer's and not UTC's
// ════════════════════════════════════════════════════════════════════════════
//
// The reported bug: an admin in Calgary at 1:15 PM writes 1:15 PM onto a
// Montreal job, where it is already 3:15 PM. The job form's date picker was a
// private second copy of the shared one, and only the shared one had been
// moved onto the business clock.
//
// These first checks pass on any machine in any zone, because the helpers read
// through an explicit IANA zone rather than the process clock. That is the
// property being protected.

const lateEvening = new Date("2026-09-11T02:30:00.000Z"); // 10:30 PM Sep 10, EDT
check("an instant after midnight UTC is still yesterday here", storeDateKey(lateEvening), "2026-09-10");
check("...and its wall-clock time is the business's", storeTimeKey(lateEvening), "22:30");

const winterEvening = new Date("2026-01-15T02:30:00.000Z"); // 9:30 PM Jan 14, EST
check("the same holds on standard time", storeDateKey(winterEvening), "2026-01-14");
check("...at the hour standard time actually gives", storeTimeKey(winterEvening), "21:30");

const civil = tzToday(lateEvening);
check(
  "tzToday hands the views the business's calendar day",
  [civil.getFullYear(), civil.getMonth() + 1, civil.getDate()],
  [2026, 9, 10]
);

// ── The job form, which is where the report came from ───────────────────────

const jobModal = read("src/app/admin/jobs/JobModal.tsx");
check("the job form's Today is the business's today", jobModal.includes("const today = tzToday();"), true);
check("the job form's Now is the business's now", jobModal.includes("handleTimeSelect(storeTimeKey(new Date()))"), true);
check(
  "the old device-clock Now is gone",
  jobModal.includes("new Date().toTimeString()"),
  false
);
check(
  "an empty picker opens on the business's month",
  jobModal.includes("value ? new Date(`${value}T00:00:00`) : tzToday()"),
  true
);

// The shared picker was already correct; this is what stops the two copies
// drifting apart again.
check(
  "the shared date picker still reads the business clock",
  read("src/components/ui/DatePicker.tsx").includes("const today = tzToday();"),
  true
);

// ── Four smaller defaults in the same class ─────────────────────────────────

for (const [path, needle] of [
  ["src/app/admin/reports/ReportsView.tsx", "storeDateKey(new Date())"],
  ["src/app/admin/finances/tabs/BookkeepingTab.tsx", "storeDateKey(new Date())"],
  ["src/app/admin/promo-codes/PromoCodesClient.tsx", "storeDateKey(new Date())"],
  ["src/app/admin/logs/LogsClient.tsx", "tzToday()"],
] as const) {
  check(`${path.split("/").pop()} dates from the business clock`, read(path).includes(needle), true);
}

// ════════════════════════════════════════════════════════════════════════════
// Items 13 and 12: reading a notification, and tracing a badge
// ════════════════════════════════════════════════════════════════════════════

const feedUi = read("src/app/admin/notifications/NotificationsClient.tsx");
check(
  "opening the page no longer marks everything read",
  /useEffect\([\s\S]{0,400}markAllNotificationsRead/.test(feedUi),
  false
);
check("there is a mark-all control", feedUi.includes("Mark all as read"), true);
check("there is a per-row mark-read control", feedUi.includes("Mark as read"), true);
check("opening one marks that one", feedUi.includes("if (!n.read) markOne(n.id);"), true);
check("unread and read look different", feedUi.includes('n.read ? "opacity-60" : ""'), true);
check("an unread-only view exists", feedUi.includes('useState<Tab>("unread")'), true);
check(
  "each row says why it is there",
  feedUi.includes("function reasonOf(key: string)"),
  true
);

const sidebar = read("src/app/admin/Sidebar.tsx");
check(
  "the Jobs pill leads to the rows it counted",
  sidebar.includes('badgeHref: "/admin/jobs?attention=chat"'),
  true
);
check(
  "the pill is a span, never an anchor inside an anchor",
  sidebar.includes("<Link href={item.badgeHref"),
  false
);
check(
  "...and it still announces itself as a link",
  /badgeHref \? \([\s\S]{0,400}role="link"/.test(sidebar),
  true
);
check(
  "the pill is reachable by keyboard",
  /badgeHref[\s\S]{0,900}onKeyDown/.test(sidebar),
  true
);
check(
  "the jobs list honours that filter",
  read("src/app/admin/jobs/page.tsx").includes('attention === "chat"'),
  true
);

// ════════════════════════════════════════════════════════════════════════════
// Item 15: the client's phone, before and after a cleaner accepts
// ════════════════════════════════════════════════════════════════════════════
//
// Audited rather than rewritten: the rule the PDF asks for is already the rule
// the code enforces. These checks are what stop that quietly changing, because
// the failure would be silent and would leak a customer's mobile number.

const previewTypes = read(
  "src/app/cleaners/available-jobs/getAvailableJobPreview.types.ts"
);
const previewImpl = read("src/app/cleaners/available-jobs/getAvailableJobPreview.ts");
check(
  "the pre-claim preview never selects a client phone",
  /client:\s*\{[^}]*phone/.test(previewImpl),
  false
);
check(
  "...and says so where the next person will read it",
  previewTypes.includes("client.phone"),
  true
);

const jobPage = read("src/app/cleaners/my-jobs/[jobId]/page.tsx");
check(
  "an unassigned cleaner is turned away from the job page",
  jobPage.includes('if (!isEmployee && !isCleaner) redirect("/cleaners/my-jobs")'),
  true
);
check(
  "the phone is still behind the admin's own setting",
  /showCustomerPhone && job\.client\?\.phone/.test(jobPage),
  true
);

const onMyWay = read("src/app/cleaners/my-jobs/[jobId]/onMyWay.ts");
check(
  "on-my-way checks assignment before it uses the number",
  onMyWay.indexOf("You are not assigned to this job") <
    onMyWay.indexOf("const phone = job.notifyClient"),
  true
);
check(
  "...and never hands the number back to the caller",
  /return \{ success: true[^}]*phone/.test(onMyWay),
  false
);

// ════════════════════════════════════════════════════════════════════════════
// Item 10: telling the office a cleaner dropped a shift
// ════════════════════════════════════════════════════════════════════════════
//
// Audited, not rewritten. Every bullet the PDF lists is already built, so what
// was missing is the thing that keeps it built.

const cancelShift = read("src/app/admin/actions/cancelShift.ts");
check(
  "one email goes on every drop",
  cancelShift.includes("sendAdminShiftDropped({ ...details, urgent: false })"),
  true
);
check(
  "a second, urgent one goes inside the late window",
  cancelShift.includes("sendAdminShiftDropped({ ...details, urgent: true })"),
  true
);
check("the late window is 24 hours", cancelShift.includes("LATE_CANCEL_HOURS = 24"), true);
check(
  "the job goes back on the board",
  cancelShift.includes("cleaners: { disconnect: { id: employeeId } }"),
  true
);

const emailLib = read("src/lib/email.ts");
check(
  "the drop also lands in the notification feed",
  /sendAdminShiftDropped[\s\S]{0,400}recordAdminNotification/.test(emailLib),
  true
);
check(
  "a send that fails is recorded as FAILED",
  emailLib.includes('status: "FAILED", error: error.message'),
  true
);
check(
  "a send that works is recorded as SENT",
  emailLib.includes('status: "SENT", sentAt: new Date()'),
  true
);

// ════════════════════════════════════════════════════════════════════════════
// Item 11: a customer's stars reach every cleaner who worked the job
// ════════════════════════════════════════════════════════════════════════════
//
// The rule, confirmed by the client on 2026-09-22: the same rating applies to
// every assigned cleaner, with no per-cleaner adjustment.
//
// The defect was that the two rating paths disagreed. The public link rated
// the whole crew; the customer portal rated the LEAD and stopped, so on a
// three-person job two cleaners' work vanished — and where `employeeId` still
// held the acting admin, a customer's stars were filed against an
// administrator and fed their pay tier.

const crew = [{ id: "anna" }, { id: "bea" }];

check(
  "every assigned cleaner is rated",
  ratedCleanerIds({ cleaners: crew, employeeId: "anna" }),
  ["anna", "bea"]
);
check(
  "a token naming one cleaner rates only that one",
  ratedCleanerIds({ tokenCleanerId: "bea", cleaners: crew, employeeId: "anna" }),
  ["bea"]
);
check(
  "a lead missing from the crew relation is still rated",
  ratedCleanerIds({ cleaners: [{ id: "anna" }], employeeId: "lead" }),
  ["anna", "lead"]
);
check(
  "an admin stamped on employeeId is never rated",
  ratedCleanerIds({ cleaners: crew, employeeId: "boss", leadIsAdmin: true }),
  ["anna", "bea"]
);
check(
  "nobody is rated twice",
  ratedCleanerIds({ cleaners: [{ id: "anna" }, { id: "anna" }], employeeId: "anna" }),
  ["anna"]
);
check(
  "a job with nobody on it rates nobody",
  ratedCleanerIds({ cleaners: [], employeeId: null }),
  []
);

for (const path of [
  "src/app/(customer)/actions/ratingActions.ts",
  "src/app/(public)/rate/actions/submitRating.ts",
]) {
  check(`${path.split("/").pop()} uses the shared rule`, read(path).includes("ratedCleanerIds({"), true);
}
check(
  "the portal no longer stops at the lead",
  read("src/app/(customer)/actions/ratingActions.ts").includes(
    "? [tokenRow.job.employeeId]"
  ),
  false
);

// ════════════════════════════════════════════════════════════════════════════
// Item 9: the jobs behind a payout
// ════════════════════════════════════════════════════════════════════════════
//
// The rows have to add up to the total printed above them. That holds by
// construction, not by luck: the breakdown and the payroll generator share one
// date window and one money function. These checks are what keep that true.

const breakdown = read("src/app/admin/actions/getPayoutJobBreakdown.ts");
check("payroll is owner/admin only", breakdown.includes("await requireOwnerAdmin()"), true);
check(
  "the employee is read from the payout, never from the caller",
  breakdown.includes("payout.employeeId"),
  true
);
check(
  "it uses the generator's own date window",
  breakdown.includes("payPeriodJobsWhere("),
  true
);
check(
  "...and the generator still uses it too",
  read("src/lib/pay-period.server.ts").includes("where: payPeriodJobsWhere("),
  true
);
check(
  "the money comes from the same function payroll used",
  breakdown.includes("computeJobPayShares(job, rates)"),
  true
);
check(
  "each line says which rule paid it",
  breakdown.includes("basisLabel: share.basisLabel"),
  true
);

const panel = read("src/app/admin/payouts/PayoutJobsPanel.tsx");
check("the panel links straight to the job", panel.includes("href={`/admin/jobs/${r.jobId}`}"), true);
check("tips and parking are shown apart from the work", panel.includes("money(r.parking)"), true);
check(
  "it loads only when expanded",
  /if \(!next \|\| rows \|\| loading\) return;/.test(panel),
  true
);

// ════════════════════════════════════════════════════════════════════════════
// Item 14: coming back to the list you were on
// ════════════════════════════════════════════════════════════════════════════
//
// The lists already keep page, search and filters in the query string. The
// back links simply refused to use it, pointing at the bare list URL instead.

const back = read("src/components/common/BackToList.tsx");
check("it returns through history, so scroll comes back too", back.includes("router.back()"), true);
check(
  "it stays a real link for a cold entry",
  back.includes("<a\n      href={href}") || back.includes("href={href}"),
  true
);
check(
  "a new-tab click is left to the browser",
  back.includes("e.metaKey || e.ctrlKey || e.shiftKey"),
  true
);

for (const path of [
  "src/app/admin/employees/[id]/EmployeeDetailView.tsx",
  "src/app/admin/clients/[id]/ClientDetailView.tsx",
  "src/app/admin/inventory/[id]/ProductDetailView.tsx",
  "src/app/admin/jobs/[id]/JobDetailView.tsx",
]) {
  check(`${path.split("/").slice(-1)[0]} uses it`, read(path).includes("<BackToList"), true);
}
check(
  "the calendar's explicit returnTo still wins on a job",
  read("src/app/admin/jobs/[id]/JobDetailView.tsx").includes("{returnToUrl ? ("),
  true
);

// ════════════════════════════════════════════════════════════════════════════
// Item 7: the admin's "areas to clean" photos
// ════════════════════════════════════════════════════════════════════════════
//
// No migration: `JobPhotoKind.BEFORE` already exists, `uploadJobPhoto` already
// admits an admin and already takes a kind. What was missing was any way for
// an admin to reach it.

const upload = read("src/app/admin/actions/uploadJobPhoto.ts");
check(
  "only an admin or someone on the job may upload",
  upload.includes("if (!isAdmin && !isEmployee && !isCleaner)"),
  true
);

const scope = read("src/app/admin/jobs/[id]/ScopePhotoUpload.tsx");
check("scope photos are stored as BEFORE", scope.includes('fd.set("kind", "BEFORE")'), true);
check(
  "uploads are sequential, not fired at once",
  scope.includes("for (const file of files)"),
  true
);
check(
  "the job page offers it",
  read("src/app/admin/jobs/[id]/JobDetailView.tsx").includes("<ScopePhotoUpload jobId={job.id} />"),
  true
);
check(
  "the cleaner's gallery can show them apart from the rest",
  read("src/app/cleaners/my-jobs/[jobId]/PhotoGallery.tsx").includes(
    "photos.filter((p) => p.kind === filter)"
  ),
  true
);

// ════════════════════════════════════════════════════════════════════════════
// Item 8: not every recurring job should be discounted
// ════════════════════════════════════════════════════════════════════════════
//
// The client's example: a weekly commercial contract already has the discount
// in its agreed rate, so the configured table applies it a second time.

check("AUTO keeps the configured discount", resolveRecurringDiscountPercent("AUTO", null, 12), 12);
check("a missing mode means AUTO", resolveRecurringDiscountPercent(null, null, 12), 12);
check("an unknown mode means AUTO", resolveRecurringDiscountPercent("WAT", null, 12), 12);
check("NONE means no discount at all", resolveRecurringDiscountPercent("NONE", null, 12), 0);
check("CUSTOM replaces the table", resolveRecurringDiscountPercent("CUSTOM", 7.5, 12), 7.5);
check("CUSTOM with nothing typed is 0, not the table", resolveRecurringDiscountPercent("CUSTOM", null, 12), 0);
check("a discount cannot exceed 100%", resolveRecurringDiscountPercent("CUSTOM", 140, 12), 100);
check("a negative discount is not a surcharge", resolveRecurringDiscountPercent("CUSTOM", -5, 12), 0);

const save = read("src/app/admin/actions/saveJob.ts");
check(
  "the generator asks the resolver, not the table directly",
  save.includes("resolveRecurringDiscountPercent("),
  true
);
check("the decision is stored on the job", save.includes("recurringDiscountMode,"), true);
check(
  "an override is only stored in CUSTOM mode",
  save.includes('recurringDiscountMode === "CUSTOM" ? recurringDiscountCustomPct : null'),
  true
);
check(
  "the whole series is discounted on the same terms",
  read("src/lib/job-series.ts").includes('"recurringDiscountMode",'),
  true
);
check(
  "the form offers the three choices",
  read("src/app/admin/jobs/JobModal.tsx").includes('{ v: "NONE", label: "No discount" }'),
  true
);

// ── Item 13, the archive half ───────────────────────────────────────────────

const feedLib = read("src/lib/admin-notifications.ts");
check("archiving is per person", feedLib.includes("notificationId_userId: { notificationId, userId }"), true);
check("it is reversible", feedLib.includes("export async function restoreAdminNotification"), true);
check(
  "nothing is deleted, so history survives",
  feedLib.includes("jobPhoto.delete") || feedLib.includes("notification.delete"),
  false
);
check(
  "an archived row is not counted as unread",
  feedLib.includes("where: { reads: { none: { userId } } }"),
  true
);
check(
  "the archived view can still fetch them",
  feedLib.includes("includeDismissed = false"),
  true
);
check(
  "the feed offers Archive and Put back",
  read("src/app/admin/notifications/NotificationsClient.tsx").includes('{archivedView ? "Put back" : "Archive"}'),
  true
);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
