// Verification for fix list item 26 — cleaner break / pause while clocked in.
import fs from "node:fs";
import {
  activeHours,
  activeMinutes,
  formatWorkedDuration,
  summariseBreaks,
} from "../src/lib/time-tracking";
import { jobWorkedHours, type JobPayInput } from "../src/lib/cleaner-earnings";

let pass = 0, fail = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const okv = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${okv ? "PASS" : "FAIL"}  ${name}`);
  if (!okv) console.log(`        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  okv ? pass++ : fail++;
}
const ok = (n: string, c: boolean) => check(n, c, true);

const T = (h: number, m = 0) =>
  new Date(Date.UTC(2026, 6, 20, h, m)).toISOString();

// ── Break totals ───────────────────────────────────────────────────────────
check("a single 30-minute break",
  summariseBreaks([{ startedAt: T(12), endedAt: T(12, 30) }]).minutes, 30);
// Rows, not a column pair — a long job can have several breaks.
check("multiple breaks add up",
  summariseBreaks([
    { startedAt: T(11), endedAt: T(11, 15) },
    { startedAt: T(13), endedAt: T(13, 30) },
  ]).minutes, 45);
check("no breaks is zero, not null", summariseBreaks([]).minutes, 0);
check("undefined breaks are safe", summariseBreaks(undefined).minutes, 0);

// A running break counts up to `now`, so live "active time" doesn't jump when
// the cleaner finally ends it.
const running = summariseBreaks([{ startedAt: T(12), endedAt: null }], new Date(T(12, 20)));
check("a running break counts elapsed time", running.minutes, 20);
ok("a running break is flagged", running.isOnBreak);
check("running break exposes its own elapsed", running.openBreakMinutes, 20);
ok("a finished break is not flagged as running",
  !summariseBreaks([{ startedAt: T(12), endedAt: T(12, 30) }]).isOnBreak);

// ── Active vs elapsed — the core requirement ───────────────────────────────
check("active = worked − breaks", activeMinutes(480, 45), 435);
check("breaks longer than the shift floor at zero", activeMinutes(30, 90), 0);
// An open shift has no final worked figure, and inventing one would put a guess
// into payroll.
check("an open shift has no active total", activeMinutes(null, 30), null);
check("activeHours converts for hourly pay", activeHours(480, 60), 7);
check("activeHours of an open shift is 0", activeHours(null, 30), 0);

// ── Payroll must not pay for break time ────────────────────────────────────
const base: JobPayInput = {
  id: "j", employeeId: null, cleaners: [{ id: "asia" }], price: null,
  employeePay: null, payType: "HOURLY", hourlyRate: 30, payRateMultiplier: 1,
  totalTip: null, jobDate: null, startTime: null, endTime: null,
  clockInTime: new Date(T(9)), clockOutTime: new Date(T(17)), assignments: [],
};
check("8h shift with no breaks bills 8h", jobWorkedHours(base), 8);
check("8h shift with a 1h break bills 7h",
  jobWorkedHours({ ...base, breaks: [{ startedAt: T(12), endedAt: T(13) }] }), 7);
check("two breaks are both deducted",
  jobWorkedHours({
    ...base,
    breaks: [
      { startedAt: T(11), endedAt: T(11, 30) },
      { startedAt: T(14), endedAt: T(14, 30) },
    ],
  }), 7);
ok("break time genuinely reduces paid hours",
  jobWorkedHours({ ...base, breaks: [{ startedAt: T(12), endedAt: T(13) }] }) <
    jobWorkedHours(base));
check("a break longer than the shift can't make hours negative",
  jobWorkedHours({
    ...base,
    clockOutTime: new Date(T(10)),
    breaks: [{ startedAt: T(9), endedAt: T(15) }],
  }), 0);

check("formats a break duration", formatWorkedDuration(90), "1h 30m");

// ── Source sweep ───────────────────────────────────────────────────────────
const read = (p: string) => fs.readFileSync(p, "utf8");

const schema = read("prisma/schema.prisma");
ok("JobBreak is modelled as rows (multiple breaks per shift)",
  schema.includes("model JobBreak") && schema.includes("endedAt   DateTime?"));
const migration = read("prisma/migrations/20260726020000_job_breaks/migration.sql");
ok("migration creates the table", migration.includes('CREATE TABLE "JobBreak"'));
ok("migration cascades from the job", migration.includes("ON DELETE CASCADE"));

const action = read("src/app/admin/actions/jobBreak.ts");
ok("break requires being clocked in", action.includes("to start a break"));
ok("double-tap can't open two overlapping breaks",
  action.includes("You're already on a break"));
ok("ending without a break is rejected", action.includes("You're not on a break"));
ok("actions are scoped to the session user", action.includes("session.user.id"));
ok("legacy job-level clock is honoured", action.includes("employeeId: cleanerId"));

const clockOut = read("src/app/admin/actions/clockOut.ts");
ok("clock-out closes any running break",
  clockOut.includes("jobBreak.updateMany") && clockOut.includes("endedAt: null"));

const earnings = read("src/lib/cleaner-earnings.ts");
ok("payroll select loads breaks", earnings.includes("breaks: { select:"));
ok("worked hours subtract break time", earnings.includes("elapsedHours - breakHours"));

const ui = read("src/app/cleaners/my-jobs/[jobId]/clock/ClockPageClient.tsx");
ok("break button only shows once clocked in", ui.includes("isLive ? ("));
ok("start and end break are both offered",
  ui.includes("Start break") && ui.includes("End break"));
ok("break state survives a reload", ui.includes("initialOnBreak"));

const admin = read("src/app/admin/time-tracking/TimeTrackingClient.tsx");
ok("admin time view shows break time", admin.includes("break"));
ok("admin headline figure is ACTIVE time", admin.includes("e.activeMinutes !== null"));
ok("on-break is visible to admin", admin.includes("On break"));

const detail = read("src/app/admin/jobs/[id]/JobDetailView.tsx");
ok("job modal shows active time and breaks",
  detail.includes("summariseBreaks") && detail.includes("active"));

console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail === 0 ? 0 : 1);
