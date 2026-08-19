// Verification for AwerNewFixes.pdf items 1–5.
//
// Two kinds of check:
//   • BEHAVIOUR — pure logic imported and exercised directly (clock-time
//     validation, assignment status).
//   • SOURCE    — the fixes that live in a Prisma `where` clause or a form
//     contract can't be exercised without a database, so they're asserted
//     against the source instead. A regression there is a deleted line, which
//     is exactly what these catch.
import fs from "node:fs";
import {
  MAX_SHIFT_HOURS,
  assignmentStatusForClock,
  parseInstant,
  validateClockEdit,
} from "../src/lib/clock-edit";

let pass = 0,
  fail = 0;

function check(name: string, actual: unknown, expected: unknown) {
  const okv = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${okv ? "PASS" : "FAIL"}  ${name}`);
  if (!okv) {
    console.log(`        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
  okv ? pass++ : fail++;
}
const ok = (n: string, c: boolean) => check(n, c, true);

const read = (p: string) => fs.readFileSync(p, "utf8");
/** Assert a file contains a snippet. */
const has = (name: string, path: string, needle: string) =>
  ok(name, read(path).includes(needle));
const lacks = (name: string, path: string, needle: string) =>
  ok(name, !read(path).includes(needle));

console.log("\n── Item 1 · archived jobs stay out of active reporting ──");

// Every query that used to include archived rows now filters them.
has(
  "labour-cost report excludes archived",
  "src/app/admin/actions/getLabourCostMetric.ts",
  "deletedAt: null"
);
has(
  "job export defaults to active-only",
  "src/app/admin/actions/exportJobs.ts",
  "where.deletedAt = filters.includeArchived ? { not: null } : null;"
);
has(
  "employee detail stats exclude archived",
  "src/app/admin/employees/[id]/page.tsx",
  "where: { deletedAt: null },"
);
for (const [label, path] of [
  ["bulk-charge queue", "src/app/admin/bulk-charge/page.tsx"],
  ["requests queue", "src/app/admin/requests/page.tsx"],
  // Was getPendingRequestCount.ts. That action was folded into the consolidated
  // sidebar counts (awerfixes.pdf item 11, round 3); the archived-jobs filter it
  // guarded moved with the query, so this check follows it rather than lapsing.
  ["requests badge count", "src/app/admin/actions/getAdminAttentionCounts.ts"],
  ["wash payout review", "src/app/admin/wash-payouts/page.tsx"],
  ["web bookings list", "src/app/admin/web-bookings/page.tsx"],
  ["finances job picker", "src/app/admin/finances/page.tsx"],
  ["booking availability", "src/app/(book)/actions/getDayAvailability.ts"],
  ["booking slot blocking", "src/app/(book)/actions/getUnavailableSlots.ts"],
  ["customer booking history", "src/app/(customer)/(secured)/bookings/page.tsx"],
  ["monthly client statement", "src/app/api/cron/monthly/route.ts"],
] as const) {
  has(`${label} excludes archived`, path, "deletedAt: null");
}
// The weekly cron has three separate job reads; all three must filter.
check(
  "all three weekly-cron job reads filter archived",
  (read("src/app/api/cron/weekly/route.ts").match(/deletedAt: null/g) ?? []).length,
  3
);
// Archived data is still reachable — but only on purpose.
has(
  "archive is still exportable when explicitly selected",
  "src/app/admin/actions/exportJobs.ts",
  "includeArchived?: boolean;"
);
has(
  "the export follows the Active/Archived view",
  "src/app/admin/jobs/JobsPageClient.tsx",
  "includeArchived: archived,"
);

// ── Completeness guard: no NEW unfiltered job read can slip in ──────────────
//
// Asserting file-by-file only proves the files I remembered. This walks every
// `db.job.findMany/count/aggregate/groupBy` in the tree and requires an archive
// filter near it, with an explicit allowlist for the ones that legitimately
// don't have a literal `deletedAt` on site.
{
  const ALLOWED = new Map<string, string>([
    // `where` comes from a shared helper in @/lib/cleaner-jobs, which filters.
    ["src/app/cleaners/my-jobs/page.tsx", "cleanerAssignedWhere()"],
    ["src/app/cleaners/available-jobs/page.tsx", "claimableJobsWhere()"],
    ["src/app/admin/calendar/page.tsx", "calendarJobsWhere()"],
    ["src/app/admin/dashboard/CleanerDashboard.tsx", "upcoming/doneJobsWhere()"],
    // `where` object is built earlier in the same function (filter included).
    ["src/app/admin/actions/getJobsForCalendar.ts", "where built above"],
    ["src/app/admin/actions/getJobsForDay.ts", "where built above"],
    ["src/app/admin/actions/exportJobs.ts", "where built above"],
    ["src/app/admin/actions/getLabourCostMetric.ts", "where built above"],
    ["src/app/admin/jobs/page.tsx", "listWhere — this IS the archive toggle"],
    // Both reads delegate to revenueWhere()/scheduledValueWhere(), defined a few
    // lines above each of them in this same file, and both carry
    // `deletedAt: null`. They were only ever passing because the 17-line window
    // happened to reach the NEXT helper's literal; the pricing-fixes stage moved
    // the lines and exposed the accident.
    ["src/lib/metrics.ts", "revenueWhere()/scheduledValueWhere()"],
    // Targeted by explicit id, so the archive state isn't a filter question.
    ["src/lib/cleaner-pay-display.ts", "by-id lookup"],
    // Maintenance / audit paths that intentionally span the archive.
    ["src/app/admin/actions/migrateClients.ts", "data migration"],
    ["src/app/admin/actions/deleteClient.ts", "client teardown"],
    ["src/app/admin/logs/page.tsx", "audit log, spans archive"],
  ]);

  const walk = (dir: string): string[] =>
    fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      const full = `${dir}/${e.name}`;
      if (e.isDirectory()) return walk(full);
      return /\.tsx?$/.test(e.name) ? [full] : [];
    });

  // The named scope helpers in @/lib/cleaner-jobs. Each one returns a
  // JobWhereInput that already carries `deletedAt: null`, so a read composing
  // one is filtered even though no literal appears on site. Spelled as a rule
  // rather than by adding another file to ALLOWED, for the reason given at the
  // id-pinned rule below: allowlisting a whole FILE also silences the next,
  // unrelated read someone adds to it. Asserted just below, so a helper that
  // ever loses its filter fails here instead of quietly widening every caller.
  const SCOPE_HELPERS = [
    "cleanerAssignedWhere",
    "claimableJobsWhere",
    "calendarJobsWhere",
    "fieldLeadScopedJobsWhere",
    // The per-tab builders. They were absent while their only callers happened
    // to be allowlisted by FILE (my-jobs, CleanerDashboard); round 4's fix 2
    // pointed the admin employee profile at `upcomingJobsWhere` too, and this
    // guard is the right place to answer "does that read filter the archive?"
    // — by proving the helper does, not by silencing another file.
    "upcomingJobsWhere",
    "doneJobsWhere",
    "pastJobsWhere",
    "cancelledJobsWhere",
  ];
  const helperSrc = read("src/lib/cleaner-jobs.ts");
  // Follows delegation, because several of these are one-liners over a shared
  // builder (calendarJobsWhere → cleanerAssignedWhere → cleanerScopedWhere) and
  // only the innermost one holds the literal. Any `…Where…(` CALL in the body
  // is chased, not just a `return` of one: `cleanerScopedWhere` reaches the
  // filter through `const base = cleanerAssignedWhere(id)` and then spreads it.
  // Bounded to this file — a name it can't find a `function` for is not a
  // helper and resolves to false.
  const filtersArchive = (helper: string, seen = new Set<string>()): boolean => {
    if (seen.has(helper)) return false; // cycle guard
    seen.add(helper);
    const at = helperSrc.indexOf(`function ${helper}(`);
    if (at === -1) return false;
    const body = helperSrc.slice(at, at + 900);
    if (body.includes("deletedAt: null")) return true;
    return [...body.matchAll(/\b(\w*Where\w*)\s*\(/g)]
      .some((m) => m[1] !== helper && filtersArchive(m[1], seen));
  };
  for (const helper of SCOPE_HELPERS) {
    ok(`scope helper ${helper}() filters the archive itself`, filtersArchive(helper));
  }

  const offenders: string[] = [];
  for (const file of walk("src")) {
    const lines = read(file).split("\n");
    lines.forEach((line, i) => {
      if (!/db\.job\.(findMany|count|aggregate|groupBy)/.test(line)) return;
      const window = lines.slice(i, i + 17).join("\n");
      if (window.includes("deletedAt")) return;
      // Composed from a scope helper that filters — see SCOPE_HELPERS above.
      if (SCOPE_HELPERS.some((h) => window.includes(`${h}(`))) return;
      // A read pinned to explicit ids is not an archive-FILTER question — the
      // caller already named the rows it wants, and some of these exist
      // precisely to ask "is this id still live?". The allowlist above carries
      // the same category by file (cleaner-pay-display); expressing it as a
      // rule makes the guard more precise rather than silencing whole files
      // that also contain reads which SHOULD be filtered.
      if (/where:\s*\{\s*id:\s*\{\s*in:/.test(window)) return;
      if (ALLOWED.has(file)) return;
      offenders.push(`${file}:${i + 1}`);
    });
  }
  check("no job read outside the allowlist is missing an archive filter",
    offenders, []);
}


console.log("\n── Item 2 · jobs no longer unassign cleaners ──");

// (a) The cron sweep must never detach a cleaner again.
const cron = read("src/app/api/cron/notifications/route.ts");
// The anchor moved: awerfixes.pdf round 3 item 4 split this region in two —
// "Sweep lapsed LAST-MINUTE broadcast invites" (hard expiry, still correct) and
// the direct-assignment nudge below it. The old anchor string no longer existed,
// so indexOf returned -1 and slice(-1) handed the next two checks a single
// character, which they "passed" against. Assert the anchor before slicing:
// a check that cannot fail is worse than one that does.
const SWEEP_ANCHOR = "── Sweep lapsed LAST-MINUTE broadcast invites";
const sweepAt = cron.indexOf(SWEEP_ANCHOR);
ok("the invite-sweep block is still findable", sweepAt >= 0);
const sweep = cron.slice(Math.max(0, sweepAt));
ok(
  "expired invite sweep no longer disconnects the cleaner",
  !sweep.includes("cleaners: { disconnect")
);
ok(
  "expired invite sweep no longer deletes the assignment row",
  !sweep.slice(0, sweep.indexOf("Scheduled gift card")).includes("jobAssignment.deleteMany")
);
ok(
  "an unanswered invite alerts an admin instead",
  sweep.includes("Assignment unconfirmed")
);

// (b) saveJob only rewrites the team when the form actually carried it.
const saveJob = read("src/app/admin/actions/saveJob.ts");
has(
  "saveJob gates the team on an explicit marker",
  "src/app/admin/actions/saveJob.ts",
  'const teamSubmitted = formData.has("cleanersSubmitted");'
);
ok(
  "saveJob no longer clears the team on an empty submission",
  !saveJob.includes("{ set: [] }")
);
ok(
  "the team write is inside the teamSubmitted branch",
  saveJob.includes("if (teamSubmitted) {") &&
    saveJob.includes("updateData.cleaners = { set: cleanerIds.map((id) => ({ id })) };")
);
ok(
  "employeeId (the lead) is dropped from the generic field set",
  saveJob.includes("delete jobDataNoLead.employeeId;")
);
ok(
  "assignment sync is skipped when the team wasn't submitted",
  // Line endings normalised: the working tree is checked out CRLF, so a literal
  // "\n" needle could never match and this check was failing for a reason that
  // had nothing to do with the code it guards. Intent is unchanged — the
  // assignmentSync call must sit directly inside `if (teamSubmitted) {`.
  saveJob
    .replace(/\r\n/g, "\n")
    .includes("if (teamSubmitted) {\n        const assignmentSync")
);
ok(
  "a series edit doesn't propagate an empty team",
  saveJob.includes("teamSubmitted ? cleanerIds : undefined")
);
// The job modal is the form that owns the picker, so it posts the marker.
has(
  "the job modal posts the team marker",
  "src/app/admin/jobs/JobModal.tsx",
  'formData.append("cleanersSubmitted", "1");'
);
// A failed assignment change is still reported, never swallowed.
has(
  "assignment-sync failure is surfaced as an error",
  "src/app/admin/actions/saveJob.ts",
  "return { error: assignmentSync.error };"
);
// A late answer on a direct invite is still accepted (the cleaner stayed on).
has(
  "a direct invite stays answerable after expiry",
  "src/app/admin/actions/respondToJobInvite.ts",
  'invite.decision === "EXPIRED" && !invite.isLastMinute'
);

// Defects caught reviewing my own work (see AWER_NEW_FIXES.md § Review pass).
has(
  "a late answer is refused once the cleaner is off the job",
  "src/app/admin/actions/respondToJobInvite.ts",
  "You're no longer assigned to this job"
);
has(
  "the cleaner's invite panel only shows jobs they're still on",
  "src/app/cleaners/my-jobs/page.tsx",
  "job: { cleaners: { some: { id: session.user.id } } },"
);

console.log("\n── Item 3 · cleaners don't choose the payment type ──");

const modal = read("src/app/cleaners/my-pay/WithdrawModal.tsx");
ok("withdraw modal has no payment-method picker", !modal.includes("PAYMENT_METHODS"));
ok("withdraw modal has no paymentMethod state", !modal.includes("setPaymentMethod"));
ok("the cleaner still submits an amount", modal.includes("amount: netAmt"));
has(
  "the request stores no method — admin sets it",
  "src/app/admin/actions/requestWithdrawal.ts",
  "paymentMethod: null,"
);
has(
  "the admin processor accepts a payment method",
  "src/app/admin/actions/processWithdrawal.ts",
  "paymentMethod?: PaymentType | null;"
);
// All four states the spec names are shown to the cleaner.
const history = read("src/app/cleaners/my-pay/PaymentHistory.tsx");
for (const label of ["Requested", "Approved", "Rejected", "Paid"]) {
  ok(`cleaner sees the "${label}" state`, history.includes(`"${label}"`));
}
// And the admin has somewhere to actually review them.
ok(
  "admin withdrawal review panel exists",
  fs.existsSync("src/app/admin/payouts/WithdrawalsPanel.tsx")
);
has(
  "the panel is mounted on the payouts page",
  "src/app/admin/payouts/PayoutsPageClient.tsx",
  "<WithdrawalsPanel withdrawals={withdrawals} />"
);

console.log("\n── Item 4 · admin can edit clock-in / clock-out ──");

const t = (iso: string) => parseInstant(iso);

check("a valid shift is accepted",
  validateClockEdit({ clockIn: t("2026-07-28T13:00:00Z"), clockOut: t("2026-07-28T16:30:00Z") }),
  null);
check("clearing both times is allowed (undo a mistaken clock-in)",
  validateClockEdit({ clockIn: null, clockOut: null }), null);
check("an open shift (in, no out) is allowed",
  validateClockEdit({ clockIn: t("2026-07-28T13:00:00Z"), clockOut: null }), null);
check("a clock-out with no clock-in is rejected",
  validateClockEdit({ clockIn: null, clockOut: t("2026-07-28T16:00:00Z") }),
  "Set a clock-in time before recording a clock-out.");
check("clock-out before clock-in is rejected",
  validateClockEdit({ clockIn: t("2026-07-28T16:00:00Z"), clockOut: t("2026-07-28T13:00:00Z") }),
  "Clock-out must be after clock-in.");
check("a zero-length shift is rejected",
  validateClockEdit({ clockIn: t("2026-07-28T13:00:00Z"), clockOut: t("2026-07-28T13:00:00Z") }),
  "Clock-out must be after clock-in.");
ok("an implausible multi-day shift is rejected (typo'd date)",
  (validateClockEdit({
    clockIn: t("2026-07-28T13:00:00Z"),
    clockOut: t("2026-07-31T13:00:00Z"),
  }) ?? "").includes(`${MAX_SHIFT_HOURS}-hour shift`));
check("garbage input is rejected",
  validateClockEdit({ clockIn: parseInstant("not-a-date"), clockOut: null }),
  "Enter a valid date and time.");
check("exactly MAX_SHIFT_HOURS is still allowed",
  validateClockEdit({
    clockIn: t("2026-07-28T00:00:00Z"),
    clockOut: t("2026-07-29T00:00:00Z"),
  }), null);

// Status must follow the timestamps, or the Team card contradicts them.
check("no times → ASSIGNED", assignmentStatusForClock(null, null), "ASSIGNED");
check("in only → CLOCKED_IN",
  assignmentStatusForClock(new Date("2026-07-28T13:00:00Z"), null), "CLOCKED_IN");
check("in + out → CLOCKED_OUT",
  assignmentStatusForClock(new Date("2026-07-28T13:00:00Z"), new Date("2026-07-28T16:00:00Z")),
  "CLOCKED_OUT");

const clockAction = read("src/app/admin/actions/updateClockTimes.ts");
ok("the edit is admin-only", clockAction.includes("if (!isAdminRole(role))"));
ok("per-cleaner edits write the JobAssignment row",
  clockAction.includes("db.jobAssignment.upsert"));
ok("job-level edits write the legacy Job fields",
  clockAction.includes("db.job.update"));
ok("the audit note records the original AND the new value",
  clockAction.includes("oldValue: `in=${fmt(previousIn)} out=${fmt(previousOut)}`") &&
    clockAction.includes("newValue: `in=${fmt(clockIn)} out=${fmt(clockOut)}`"));
ok("the audit note records who edited it",
  clockAction.includes("userId: session.user.id"));
ok("a locked pay period warns instead of silently rewriting payroll",
  clockAction.includes("The recorded payout was not changed"));
ok("clock times can't be recorded for an unassigned cleaner (would make them payable)",
  clockAction.includes("isn't assigned to this job"));
ok("editing is reachable from the job page",
  read("src/app/admin/jobs/[id]/JobDetailView.tsx").includes("<ClockTimeEditor"));
ok("editing is reachable from time tracking",
  read("src/app/admin/time-tracking/TimeTrackingClient.tsx").includes("<ClockTimeEditor"));

console.log("\n── Item 5 · admin can exclude a star rating ──");

// The exclusion is a soft flag, so the record survives for review.
const schema = read("prisma/schema.prisma");
ok("EmployeeRating carries the exclusion columns",
  schema.includes("excludedAt     DateTime?") &&
    schema.includes("excludedById   String?") &&
    schema.includes("excludedReason String?"));
ok("a migration ships the columns",
  fs.existsSync("prisma/migrations/20260728000000_rating_exclusion/migration.sql"));

// EVERY average / count / tier read must skip excluded ratings, or the score
// the cleaner is paid on disagrees with the one shown.
for (const [label, path] of [
  ["pay tier (cleaner-rates)", "src/lib/cleaner-rates.ts"],
  ["pay multiplier recalc", "src/app/admin/actions/recalculateMultiplier.ts"],
  ["employee average", "src/app/admin/actions/setEmployeeRating.ts"],
  ["performance data", "src/app/admin/actions/getPerformanceData.ts"],
  ["employee detail count", "src/app/admin/employees/[id]/page.tsx"],
  ["cleaner dashboard", "src/app/admin/dashboard/CleanerDashboard.tsx"],
  ["analytics", "src/app/admin/analytics/page.tsx"],
  ["weekly cron digest", "src/app/api/cron/weekly/route.ts"],
  ["low-rating alerts", "src/app/api/cron/notifications/route.ts"],
  ["customer-facing cleaner rating", "src/app/(customer)/(secured)/bookings/[id]/page.tsx"],
  ["public reviews", "src/app/(public)/reviews/page.tsx"],
  ["overall score quoted in review emails", "src/app/(public)/rate/actions/submitRating.ts"],
  ["client detail ratings", "src/app/admin/clients/[id]/page.tsx"],
] as const) {
  has(`${label} skips excluded ratings`, path, "excludedAt: null");
}

const excl = read("src/app/admin/actions/setRatingExcluded.ts");
ok("excluding is admin-only", excl.includes("if (!isAdminRole(role))"));
ok("the rating row is never deleted", !excl.includes("employeeRating.delete"));
ok("excluding recalculates the pay tier",
  excl.includes("recalculateMultiplier({ employeeId: rating.employeeId })"));
ok("the reason + who pulled it are stored",
  excl.includes("excludedById: session.user.id") && excl.includes("excludedReason:"));
ok("restoring clears the whole exclusion record",
  excl.includes("{ excludedAt: null, excludedById: null, excludedReason: null }"));
ok("the removal is written to the job log", excl.includes("db.jobLog"));
ok("the job shows whether a rating is active or excluded",
  read("src/app/admin/jobs/[id]/JobDetailView.tsx").includes("'Excluded' : 'Active'"));

console.log("\n── Follow-up · archive means archive ──");

// The single-job delete used to HARD delete, bypassing the archive/permanent
// two-step that permanentlyDeleteJobs documents. That is how 1533 job rows
// left the database with no archive to recover them.
// Comments are stripped first — this file's own docstring names the call it
// replaced, and matching that would be a false pass/fail either way.
const del = read("src/app/admin/actions/deleteJob.ts")
  .split("\n")
  .filter((l) => !l.trim().startsWith("*") && !l.trim().startsWith("//") && !l.trim().startsWith("/*"))
  .join("\n");
ok("single-job delete no longer destroys the row", !del.includes("db.job.delete("));
ok("it archives instead", del.includes("data: { deletedAt: new Date() }"));
ok("archiving is logged", del.includes("newValue: \"archived\""));
ok("re-archiving an archived job is refused",
  del.includes("This job is already archived"));
// Permanent removal still exists, deliberately, behind the archived-only gate.
has("permanent delete still requires the job to be archived first",
  "src/app/admin/actions/permanentlyDeleteJobs.ts",
  "deletedAt: { not: null }");
// The confirmation must not promise something the action doesn't do.
ok("the job page confirm describes archiving, not destruction",
  !read("src/app/admin/jobs/[id]/JobDetailView.tsx").includes(
    "All job data will be permanently removed"));
ok("the job modal confirm describes archiving, not destruction",
  !read("src/app/admin/jobs/JobModal.tsx").includes(
    "permanently removed"));

// Schema drift the deployed database carried but the schema never declared.
ok("the field-lead index is declared, not dropped",
  read("prisma/schema.prisma").includes("@@index([fieldLeadId])"));
ok("a migration reproduces both drifted objects on a fresh database",
  fs.existsSync("prisma/migrations/20260728010000_align_schema_drift/migration.sql"));


// Destructive paths must name their actor. Nothing did before, which is why the
// July 2026 loss of 1533 jobs cannot be attributed to anyone.
ok("permanent delete writes an audit record",
  read("src/app/admin/actions/permanentlyDeleteJobs.ts").includes('action: "job.permanent_delete"'));
ok("the audit record survives the row (ActivityLog, not JobLog)",
  read("src/app/admin/actions/permanentlyDeleteJobs.ts").includes("jobNumbers: eligible.map"));
ok("archiving a job writes an audit record",
  read("src/app/admin/actions/deleteJob.ts").includes('action: "job.archive"'));
ok("bulk archive writes an audit record",
  read("src/lib/bulk/actions.ts").includes("bulk_archive"));


console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
