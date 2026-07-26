// Verification for fix list item 12 — admin view for employee clock-ins.
import fs from "node:fs";
import {
  resolveClockEntry,
  formatWorkedDuration,
  openShiftMinutes,
  isStaleOpenShift,
  CLOCK_STATUS_LABEL,
  STALE_SHIFT_HOURS,
} from "../src/lib/time-tracking";

let pass = 0, fail = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const okv = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${okv ? "PASS" : "FAIL"}  ${name}`);
  if (!okv) console.log(`        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  okv ? pass++ : fail++;
}
const ok = (n: string, c: boolean) => check(n, c, true);

const IN = "2026-07-20T13:00:00Z";
const OUT = "2026-07-20T16:30:00Z";

// ── Per-cleaner assignment rows ────────────────────────────────────────────
const done = resolveClockEntry({
  assignment: { status: "CLOCKED_OUT", clockInTime: IN, clockOutTime: OUT },
});
check("completed shift reports minutes worked", done.minutesWorked, 210);
check("3h30m formats as '3h 30m'", formatWorkedDuration(done.minutesWorked), "3h 30m");
check("completed shift status", done.status, "CLOCKED_OUT");
ok("completed shift is not open", !done.isOpen);

const open = resolveClockEntry({
  assignment: { status: "CLOCKED_IN", clockInTime: IN, clockOutTime: null },
});
ok("open shift is flagged open", open.isOpen);
check("open shift has NO worked total (must not reach payroll)", open.minutesWorked, null);
check("open shift status", open.status, "CLOCKED_IN");

const onWay = resolveClockEntry({
  assignment: { status: "ON_THE_WAY", onMyWayAt: IN },
});
check("on-the-way status", onWay.status, "ON_THE_WAY");
const idle = resolveClockEntry({ assignment: { status: "ASSIGNED" } });
check("assigned but not started", idle.status, "NOT_STARTED");
const cancelled = resolveClockEntry({
  assignment: { status: "CANCELLED", clockInTime: IN, clockOutTime: OUT },
});
check("cancelled wins over timestamps", cancelled.status, "CANCELLED");

// ── Legacy jobs (no JobAssignment row) must still report ───────────────────
const legacy = resolveClockEntry({ jobClockIn: IN, jobClockOut: OUT });
check("legacy job-level clock still reports worked time", legacy.minutesWorked, 210);
check("legacy job status is derived from timestamps", legacy.status, "CLOCKED_OUT");
const legacyOpen = resolveClockEntry({ jobClockIn: IN });
ok("legacy open shift detected", legacyOpen.isOpen);

// The assignment row must take precedence over the job-level fallback.
const both = resolveClockEntry({
  assignment: { status: "CLOCKED_OUT", clockInTime: IN, clockOutTime: OUT },
  jobClockIn: "2020-01-01T00:00:00Z",
  jobClockOut: "2020-01-01T23:00:00Z",
});
check("per-cleaner row wins over the job-level fallback", both.minutesWorked, 210);

// ── Missed clock-out detection ─────────────────────────────────────────────
const now = new Date("2026-07-21T13:00:00Z"); // 24h after clock-in
check("elapsed time on an open shift", openShiftMinutes(open, now), 1440);
ok("a 24h open shift is stale", isStaleOpenShift(open, now));
ok("a 2h open shift is not stale",
  !isStaleOpenShift(open, new Date("2026-07-20T15:00:00Z")));
ok("a completed shift is never stale", !isStaleOpenShift(done, now));
ok("stale threshold is a plausible shift length",
  STALE_SHIFT_HOURS >= 8 && STALE_SHIFT_HOURS <= 24);

// ── Formatting ─────────────────────────────────────────────────────────────
check("minutes under an hour", formatWorkedDuration(45), "45m");
check("exact hours drop the minutes", formatWorkedDuration(120), "2h");
check("no data renders as a dash", formatWorkedDuration(null), "—");
ok("every status has a label",
  Object.values(CLOCK_STATUS_LABEL).every((v) => typeof v === "string" && v.length > 0));

// ── Source sweep ───────────────────────────────────────────────────────────
const read = (p: string) => fs.readFileSync(p, "utf8");

ok("centralised page exists", fs.existsSync("src/app/admin/time-tracking/page.tsx"));
const page = read("src/app/admin/time-tracking/page.tsx");
ok("centralised page is admin-guarded", page.includes("requireAdmin"));

const action = read("src/app/admin/actions/getClockActivity.ts");
ok("action is admin-guarded", action.includes("requireOwnerAdmin"));
ok("action falls back to legacy job-level clocks", action.includes("jobClockIn: job.clockInTime"));
ok("action paginates by cursor", action.includes("cursor: { id: cursor }"));
ok("open/stale totals span the whole set, not one page",
  action.includes("db.jobAssignment.findMany"));

const client = read("src/app/admin/time-tracking/TimeTrackingClient.tsx");
ok("page shows cleaner, in, out, worked and status",
  client.includes("cleanerName") && client.includes("In:") &&
  client.includes("Out:") && client.includes("formatWorkedDuration") &&
  client.includes("CLOCK_STATUS_LABEL"));
ok("page can filter to still-clocked-in", client.includes('"open"'));
ok("page filters by employee", client.includes("All employees"));

const detail = read("src/app/admin/jobs/[id]/JobDetailView.tsx");
ok("job page now shows total time worked", detail.includes("formatWorkedDuration"));
ok("job page flags a missed clock-out", detail.includes("check clock-out"));

const sidebar = read("src/app/admin/Sidebar.tsx");
ok("reachable from the sidebar", sidebar.includes('/admin/time-tracking'));

console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail === 0 ? 0 : 1);
