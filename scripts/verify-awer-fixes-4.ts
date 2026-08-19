/**
 * Verification for the fourth AWER fixes round
 * (`_ai_context/awerfixesaug18.pdf`, 8 items — see `_ai_context/TODO.md`).
 *
 * Each stage appends its own `section(...)` block as it lands; nothing else in
 * this file needs to change. Modelled on `verify-awer-fixes-3.ts`, including
 * its two kinds of check:
 *
 *   • BEHAVIOUR — pure logic imported and exercised directly. Preferred: it
 *     tests the thing, not its spelling.
 *   • SOURCE    — fixes that live in a JSX string or a form contract can't run
 *     without a browser, so they're asserted against the source. A regression
 *     there is a deleted line, which is exactly what these catch.
 *
 * Fix 1 leans hard on the first kind. Its acceptance criterion is that the
 * Jobs page's Completed tab and the Dashboard's completed count "agree on the
 * same jobs" — a claim about two DIFFERENT implementations (a TypeScript
 * predicate and a Prisma `where`), which a source check cannot test at all. So
 * this file carries a small evaluator for the where-clause subset those
 * buckets use, runs both implementations over the same synthetic job table,
 * and compares the row sets. See `matchesWhere` below.
 *
 * No check in this file may write to the database. Live-data questions belong
 * in `scripts/probe-awer-fixes-4.ts` (read-only), which is where the Stage 0
 * baselines came from.
 *
 *   npx tsx scripts/verify-awer-fixes-4.ts
 */
import fs from "node:fs";
import type { Prisma } from "@prisma/client";
import {
  COMPLETED_STATUSES,
  isActiveJob,
  isCompletedJob,
  isFutureJob,
  isOnHoldJob,
  isUpcomingJob,
  simpleJobStatus,
} from "../src/lib/metrics-shared";
import { activeJobsWhere, jobStatusWhere } from "../src/lib/metrics";
import {
  HOLD_LABEL,
  HOLD_REASON,
  INACTIVE_JOB_STATUSES,
  ON_HOLD_STATUS,
  holdLabel,
  holdReasonText,
  isOnHold,
} from "../src/lib/job-hold";
import { parseAndNormalize } from "../src/lib/bookingkoala/core";
import {
  cancelledJobsWhere,
  claimableJobsWhere,
  doneFilter,
  doneJobsWhere,
  openForClaimFilter,
  pastJobsWhere,
  upcomingFilter,
  upcomingJobsWhere,
} from "../src/lib/cleaner-jobs";
import {
  billableActualHours,
  billableCrewMinutes,
  hourlyServiceAmount,
} from "../src/lib/hourly-billing";
import { crewActiveMinutesByCleaner } from "../src/lib/work-sessions";
import {
  computeJobPayShares,
  hourlyTeamPayFromClock,
  type JobPayInput,
} from "../src/lib/cleaner-earnings";
import { PAY_BASIS_SHORT_LABEL, payBasisLabel } from "../src/lib/pay-basis";
import {
  formatAddressCopy,
  formatAddressLine,
  formatAddressQuery,
  formatAptLabel,
  normalizeAddressKey,
  resolveAddressParts,
  splitAptFromLocation,
} from "../src/lib/client-address";
import { postConstructionBasePrice } from "../src/lib/service-pricing";
import type { CleanerRateInput } from "../src/lib/pay-tiers";

let pass = 0,
  fail = 0;

function check(name: string, actual: unknown, expected: unknown) {
  const okv = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${okv ? "PASS" : "FAIL"}  ${name}`);
  if (!okv) {
    console.log(`        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
  if (okv) pass++;
  else fail++;
}
const ok = (n: string, c: boolean) => check(n, c, true);

/**
 * Read a source file with CRLF normalised away.
 *
 * The repo is checked out with Windows line endings, so a multi-line `has(...)`
 * needle written with plain `\n` never matches — silently, and only for the
 * multi-line ones, which is the worst kind of false negative. Normalising here
 * means a check can quote two adjacent lines of real code.
 */
const read = (p: string) => fs.readFileSync(p, "utf8").replace(/\r\n/g, "\n");
/** Assert a file contains a snippet. */
export const has = (name: string, path: string, needle: string) =>
  ok(name, read(path).includes(needle));
/** Assert a file does NOT contain a snippet (a removal stays removed). */
export const lacks = (name: string, path: string, needle: string) =>
  ok(name, !read(path).includes(needle));
/**
 * A file with its comment lines dropped, for "X no longer appears" checks where
 * the fix's own explanation legitimately NAMES the thing it removed.
 */
const codeOf = (path: string) =>
  read(path)
    .split("\n")
    .filter((l) => {
      const t = l.trim();
      return !t.startsWith("//") && !t.startsWith("*") && !t.startsWith("/*");
    })
    .join("\n");
/** Assert a snippet is absent from a file's CODE, ignoring its comments. */
export const lacksInCode = (name: string, path: string, needle: string) =>
  ok(name, !codeOf(path).includes(needle));
/**
 * `has` for PROSE. JSX wraps a sentence across lines at whatever column the
 * formatter picks, so a helper-text check written as one line never matches the
 * source it is about — the same class of silent false negative CRLF caused
 * above. Both sides get their whitespace runs collapsed.
 */
const hasText = (name: string, path: string, needle: string) =>
  ok(
    name,
    read(path).replace(/\s+/g, " ").includes(needle.replace(/\s+/g, " "))
  );

/**
 * Every stage registers its checks through `section`, keyed by the PDF fix
 * number from the TODO's execution map. The key is not decoration — the
 * completeness guard at the bottom uses it to prove no fix was ticked off
 * without a check being written for it.
 */
const covered = new Set<number>();
export function section(item: number, title: string, body: () => void) {
  covered.add(item);
  console.log(`\n── Fix ${item} · ${title} ──`);
  body();
}

// ═══════════════════════════════════════════════════════════════════════════
// Stage 0 — baseline & safety rails
// ═══════════════════════════════════════════════════════════════════════════

console.log("\n── Stage 0 · safety rails ──");

// Stage 0.2 baseline, recorded 2026-08-19, before any round-4 code landed:
// `npm run verify` 31/31 green · `npx tsc --noEmit` clean.
export const VERIFY_SCRIPTS_BASELINE = 31;

// The probe script is the only thing in this round pointed at the LIVE
// database, and the house rules say it stays read-only. Assert that
// mechanically rather than trusting it.
{
  const probePath = "scripts/probe-awer-fixes-4.ts";
  const exists = fs.existsSync(probePath);
  ok("live-data probe exists: probe-awer-fixes-4.ts", exists);
  if (exists) {
    const probe = codeOf(probePath);
    const writes = [
      ".create(",
      ".createMany(",
      ".update(",
      ".updateMany(",
      ".upsert(",
      ".delete(",
      ".deleteMany(",
      "$executeRaw",
      "$transaction",
    ].filter((w) => probe.includes(w));
    check("probe-awer-fixes-4.ts performs no writes", writes, []);
    ok(
      "probe-awer-fixes-4.ts has no --commit switch to flip",
      !probe.includes("--commit") && !probe.includes("process.argv")
    );
  }
}

// The data-repair scripts are the opposite case: they MAY write, but only
// behind an explicit flag. A script that writes on a bare run is the accident
// this round cannot afford, so the default-safe shape is asserted here.
for (const scriptPath of [
  "scripts/fixFutureCompletedJobs.ts",
  // Round 4, fix 6 — the legacy CREATED backlog. Same rails, and it needs them
  // more: it touches every held job in the business, not two rows.
  "scripts/releaseLegacyJobHolds.ts",
] as const) {
  const label = scriptPath.split("/").pop()!;
  const exists = fs.existsSync(scriptPath);
  ok(`data-repair script exists: ${label}`, exists);
  if (!exists) continue;
  const src = codeOf(scriptPath);
  ok(`${label} is dry-run unless --commit is passed`, src.includes('process.argv.includes("--commit")'));
  ok(`${label} returns before writing when not committing`, /if\s*\(!commit\)\s*\{[\s\S]*?return;/.test(src));
  ok(`${label} logs every status change as a STATUS_CHANGED job log`, src.includes('action: "STATUS_CHANGED"'));
  // Every `db.job.update` in either script, so a second write added later
  // cannot slip past a check that only ever looked at the first one.
  const updates = [...src.matchAll(/db\.job\.update\(\{[\s\S]*?data:\s*(\{[^}]*\})/g)].map((m) =>
    m[1].replace(/\s+/g, " ").trim()
  );
  if (label === "fixFutureCompletedJobs.ts") {
    ok(`${label} records the old status so the change is reversible`, src.includes("oldValue: j.status"));
    // Payment really did happen; only the completion claim is withdrawn.
    // Asserted against the update's `data:` rather than the file — the script
    // legitimately READS and PRINTS the payment columns, and a whole-file check
    // would flag that. What must not exist is a write.
    check(`${label} updates status and nothing else`, updates, ['{ status: "SCHEDULED" }']);
  } else {
    ok(`${label} records the old status so the change is reversible`, src.includes('oldValue: "CREATED"'));
    // Two writes, both narrow: the release, and the reason-only backfill on the
    // holds that STAY held. Neither may touch money, dates or the crew — a job
    // being unexplained is not a reason to re-price it.
    check(`${label} writes only status/holdReason`, updates, [
      "{ holdReason: BUCKET_REASON[bucket] }",
      '{ status: "SCHEDULED", holdReason: null }',
    ]);
    ok(
      `${label} never overwrites a reason somebody already wrote`,
      src.includes("if (j.holdReason?.trim()) continue;")
    );
    // The classification order the header argues for: a quote is unpriced BY
    // DEFINITION, so testing $0 first would relabel every quote in the business
    // as a $0 import.
    const order = ["QUOTE", "FLEXIBLE", "ZERO", "RELEASE"].map((b) =>
      src.indexOf(`return "${b}"`)
    );
    ok(`${label} classifies specific causes before the generic $0 test`, order.every((v, i) => v > 0 && (i === 0 || v > order[i - 1])));
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// A tiny Prisma-`where` evaluator
// ═══════════════════════════════════════════════════════════════════════════
//
// Covers exactly the operator subset `jobStatusWhere` uses — nothing more, so
// it cannot quietly "pass" a clause it does not understand: an unrecognised
// operator throws, which fails the run.
//
// This exists so the acceptance criterion "the Completed tab and the Dashboard
// count agree on the same jobs" can be TESTED rather than asserted. The two
// live in different languages; the only honest way to compare them is to run
// both over the same rows.

type Row = {
  id: string;
  status: string;
  startTime: Date;
  clockOutTime: Date | null;
  paymentReceived: boolean;
  deletedAt: Date | null;
  price: number | null;
  /** Round 4, fix 6 — the column `openForClaimFilter` keys on. Present on every
   *  row (defaulted to null by `job()`) because the evaluator below THROWS on a
   *  column it does not know, which is how a typo'd filter gets caught here
   *  rather than passing vacuously. */
  holdReason: string | null;
};

function matchesLeaf(value: unknown, cond: unknown): boolean {
  // Scalar equality: `status: "COMPLETED"`, `deletedAt: null`, `paid: false`.
  if (cond === null || typeof cond !== "object") {
    if (value instanceof Date && cond instanceof Date) return value.getTime() === (cond as Date).getTime();
    return value === cond;
  }
  if (cond instanceof Date) return value instanceof Date && value.getTime() === cond.getTime();
  const c = cond as Record<string, unknown>;
  return Object.entries(c).every(([op, operand]) => {
    const n = value instanceof Date ? value.getTime() : (value as number);
    const m = operand instanceof Date ? operand.getTime() : (operand as number);
    switch (op) {
      case "in":
        return (operand as unknown[]).includes(value as never);
      case "notIn":
        return !(operand as unknown[]).includes(value as never);
      case "not":
        return !matchesLeaf(value, operand);
      case "gt":
        return n > m;
      case "gte":
        return n >= m;
      case "lt":
        return n < m;
      case "lte":
        return n <= m;
      default:
        throw new Error(`where-evaluator: unsupported operator "${op}"`);
    }
  });
}

function matchesWhere(row: Row, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([key, cond]) => {
    if (key === "NOT") return !matchesWhere(row, cond as Record<string, unknown>);
    if (key === "AND") return (cond as Record<string, unknown>[]).every((w) => matchesWhere(row, w));
    if (key === "OR") return (cond as Record<string, unknown>[]).some((w) => matchesWhere(row, w));
    if (!(key in row)) throw new Error(`where-evaluator: unknown column "${key}"`);
    return matchesLeaf((row as unknown as Record<string, unknown>)[key], cond);
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// Fix 1 — future jobs must never read as Completed
// ═══════════════════════════════════════════════════════════════════════════

const NOW = new Date("2026-08-18T12:00:00.000Z"); // the PDF's "today"
const TOMORROW = new Date("2026-08-19T16:00:00.000Z"); // IMG-1's Hinchey job
const YESTERDAY = new Date("2026-08-17T16:00:00.000Z");
const LATER_TODAY = new Date("2026-08-18T22:00:00.000Z");

const job = (over: Partial<Row> & { id: string }): Row => ({
  status: "SCHEDULED",
  startTime: TOMORROW,
  clockOutTime: null,
  paymentReceived: false,
  deletedAt: null,
  price: 100,
  holdReason: null,
  ...over,
});

section(1, "isFutureJob — the guard every other predicate is built on", () => {
  ok("a job starting tomorrow is future", isFutureJob(job({ id: "a" }), NOW));
  ok("a job that already started is not future", !isFutureJob(job({ id: "b", startTime: YESTERDAY }), NOW));
  ok(
    "a future job that was CLOCKED OUT is not future — it was genuinely worked",
    !isFutureJob(job({ id: "c", startTime: LATER_TODAY, clockOutTime: NOW }), NOW)
  );
  // Fails open: a caller whose `select` omits startTime must keep the old
  // behaviour rather than have every one of its rows silently reclassified.
  ok(
    "a row with no startTime is not provably future (guard fails open)",
    !isFutureJob({ status: "PAID" }, NOW)
  );
  ok("string timestamps work too (DTOs carry ISO strings)", isFutureJob({ status: "PAID", startTime: TOMORROW.toISOString() }, NOW));
});

section(1, "isCompletedJob — the one predicate behind tab, count and stat card", () => {
  // The bug, stated as a test. IMG-1: today is Aug 18, these jobs are Aug 19.
  ok("COMPLETED + starts tomorrow ⇒ NOT completed", !isCompletedJob(job({ id: "d", status: "COMPLETED" }), NOW));
  ok("PAID + starts tomorrow ⇒ NOT completed", !isCompletedJob(job({ id: "e", status: "PAID" }), NOW));
  // ...and the behaviour that must survive the fix.
  ok("COMPLETED + already happened ⇒ completed", isCompletedJob(job({ id: "f", status: "COMPLETED", startTime: YESTERDAY }), NOW));
  ok("PAID + already happened ⇒ completed", isCompletedJob(job({ id: "g", status: "PAID", startTime: YESTERDAY }), NOW));
  ok(
    "COMPLETED later today but CLOCKED OUT ⇒ completed (an early finish is still a finish)",
    isCompletedJob(job({ id: "h", status: "COMPLETED", startTime: LATER_TODAY, clockOutTime: NOW }), NOW)
  );
  ok("SCHEDULED in the past ⇒ not completed (the enum still has to say so)", !isCompletedJob(job({ id: "i", startTime: YESTERDAY }), NOW));
  ok("CANCELLED ⇒ not completed", !isCompletedJob(job({ id: "j", status: "CANCELLED", startTime: YESTERDAY }), NOW));
  check("COMPLETED_STATUSES is exactly the two done statuses", [...COMPLETED_STATUSES], ["COMPLETED", "PAID"]);
});

section(1, "isUpcomingJob — a mis-stamped future job lands somewhere", () => {
  // The hole the old allow-list left: {CREATED, SCHEDULED, IN_PROGRESS} meant a
  // future job stamped COMPLETED/PAID matched NO tab once the completed guard
  // (correctly) refused it.
  ok("future + COMPLETED ⇒ upcoming", isUpcomingJob(job({ id: "k", status: "COMPLETED" }), NOW));
  ok("future + PAID ⇒ upcoming", isUpcomingJob(job({ id: "l", status: "PAID" }), NOW));
  ok("future + SCHEDULED ⇒ upcoming", isUpcomingJob(job({ id: "m" }), NOW));
  // Fix 6 changed this one, on purpose: on-hold work is not scheduled work
  // (PDF p5). It moves to its own bucket rather than vanishing — the partition
  // test below proves that, and it is what makes the change safe.
  ok("future + CREATED ⇒ NOT upcoming, it is on hold", !isUpcomingJob(job({ id: "n", status: "CREATED" }), NOW));
  ok("future + IN_PROGRESS ⇒ upcoming (clock-in opens 2h early)", isUpcomingJob(job({ id: "o", status: "IN_PROGRESS" }), NOW));
  ok("future + CANCELLED ⇒ NOT upcoming", !isUpcomingJob(job({ id: "p", status: "CANCELLED" }), NOW));
  ok("past ⇒ NOT upcoming", !isUpcomingJob(job({ id: "q", startTime: YESTERDAY }), NOW));
  ok(
    "future but clocked out ⇒ NOT upcoming (it is done, not coming up)",
    !isUpcomingJob(job({ id: "r", status: "COMPLETED", startTime: LATER_TODAY, clockOutTime: NOW }), NOW)
  );
});

section(1, "no job falls between the Completed, Upcoming and On-hold buckets", () => {
  // The property that actually matters to a user: whatever a row's status, it
  // is reachable. Enumerate the whole cross-product rather than trusting the
  // cases above to be representative.
  //
  // Round 4, fix 6 added the third bucket. That is the ONLY way removing
  // on-hold work from Upcoming is safe, so the partition is re-proved with it
  // in — and "exactly one", not "at least one", because a job appearing in two
  // tabs reads as a duplicate rather than as a fix (the same trap Stage 2 hit
  // with the cleaner's upcoming/done lists).
  const statuses = ["CREATED", "SCHEDULED", "IN_PROGRESS", "COMPLETED", "PAID", "CANCELLED"];
  const orphans: string[] = [];
  const multiple: string[] = [];
  for (const status of statuses) {
    for (const [label, startTime] of [["future", TOMORROW], ["past", YESTERDAY]] as const) {
      for (const clockOutTime of [null, NOW]) {
        const r = job({ id: `${status}-${label}`, status, startTime, clockOutTime });
        const buckets = [
          isCompletedJob(r, NOW) && "completed",
          isUpcomingJob(r, NOW) && "upcoming",
          isOnHoldJob(r) && "onhold",
        ].filter(Boolean);
        const key = `${status}/${label}/clockOut=${!!clockOutTime}`;
        if (buckets.length > 1) multiple.push(`${key} → ${buckets.join("+")}`);
        // Cancelled work belongs to the Cancelled tab; past non-done work is
        // the legitimate "date passed, enum not caught up" case the sweep
        // handles. Everything else must be in exactly one of the three.
        const excused = status === "CANCELLED" || label === "past";
        if (buckets.length === 0 && !excused) orphans.push(key);
      }
    }
  }
  check("no row lands in more than one bucket", multiple, []);
  check("no future non-cancelled row belongs to no bucket at all", orphans, []);
  // Spelled out rather than left implicit in the sweep above: this is the row
  // whose classification fix 6 moved, and moving it is the whole point.
  const heldFuture = job({ id: "held", status: ON_HOLD_STATUS });
  check(
    "a future on-hold job is on hold — not upcoming, not completed",
    [isOnHoldJob(heldFuture), isUpcomingJob(heldFuture, NOW), isCompletedJob(heldFuture, NOW)],
    [true, false, false]
  );
  // ...and a hold does not expire. A held job whose date slid past is STILL
  // held, which is what taking CREATED out of the nightly sweep protects.
  const heldPast = job({ id: "held-past", status: ON_HOLD_STATUS, startTime: YESTERDAY });
  ok("a hold survives its own date", isOnHoldJob(heldPast) && !isCompletedJob(heldPast, NOW));
});

section(1, "the SQL bucket and the client predicate select the SAME jobs", () => {
  // The acceptance criterion, mechanically. Two implementations in two
  // languages over one table; the row sets must be identical.
  const table: Row[] = [
    job({ id: "future-completed", status: "COMPLETED" }),               // IMG-1 row
    job({ id: "future-paid", status: "PAID", paymentReceived: true }),  // IMG-1 row
    job({ id: "future-scheduled" }),
    job({ id: "future-created", status: "CREATED" }),
    job({ id: "future-cancelled", status: "CANCELLED" }),
    job({ id: "future-inprogress", status: "IN_PROGRESS" }),
    job({ id: "today-early-finish", status: "COMPLETED", startTime: LATER_TODAY, clockOutTime: NOW }),
    job({ id: "past-completed", status: "COMPLETED", startTime: YESTERDAY }),
    job({ id: "past-paid", status: "PAID", startTime: YESTERDAY, paymentReceived: true }),
    job({ id: "past-scheduled", status: "SCHEDULED", startTime: YESTERDAY }),
    job({ id: "past-cancelled", status: "CANCELLED", startTime: YESTERDAY }),
    job({ id: "archived-past-completed", status: "COMPLETED", startTime: YESTERDAY, deletedAt: NOW }),
  ];

  const sql = (bucket: "completed" | "upcoming" | "overdue" | "onhold") =>
    table
      .filter((r) => matchesWhere(r, jobStatusWhere(bucket, NOW) as Record<string, unknown>))
      .map((r) => r.id)
      .sort();
  // The client predicates never see archived rows — the Jobs page query
  // excludes them before the list reaches the browser — so the comparison
  // applies the same precondition rather than pretending they disagree.
  const live = table.filter((r) => !r.deletedAt);
  const client = (p: (r: Row) => boolean) => live.filter(p).map((r) => r.id).sort();

  check(
    "Completed: SQL bucket === isCompletedJob",
    sql("completed"),
    client((r) => isCompletedJob(r, NOW))
  );
  check(
    "Completed contains exactly the genuinely-finished jobs",
    sql("completed"),
    ["past-completed", "past-paid", "today-early-finish"].sort()
  );
  check(
    "Upcoming: SQL bucket === isUpcomingJob",
    sql("upcoming"),
    client((r) => isUpcomingJob(r, NOW))
  );
  check(
    "Upcoming picks up the two mis-stamped IMG-1 rows",
    sql("upcoming").filter((id) => id.startsWith("future-")),
    // `future-created` is deliberately absent from round 4, fix 6 on — it is in
    // the On-hold bucket asserted two checks down, not lost.
    ["future-completed", "future-inprogress", "future-paid", "future-scheduled"]
  );
  check(
    "On hold: SQL bucket === isOnHoldJob",
    sql("onhold"),
    client((r) => isOnHoldJob(r))
  );
  check("On hold is exactly the CREATED rows", sql("onhold"), ["future-created"]);
  // Overdue = unpaid work we HAVE done. `today-early-finish` belongs: it was
  // clocked out, so the money is genuinely owed even though its scheduled
  // start is still a few hours away. `future-completed` must not — nobody owes
  // us for a job that has not happened.
  check(
    "Overdue is exactly the unpaid work that actually happened",
    sql("overdue"),
    ["past-completed", "today-early-finish"].sort()
  );
  ok("Overdue excludes a future job mis-stamped COMPLETED", !sql("overdue").includes("future-completed"));
  ok("archived rows are still excluded from every bucket", !sql("completed").includes("archived-past-completed"));
});

section(1, "simpleJobStatus — the pill, the filter and the exports", () => {
  // The branch this fix reordered: `paymentReceived || PAID ⇒ PAID` fired
  // before any date logic, so a prepaid booking printed a done status.
  check("future + paid ⇒ Scheduled", simpleJobStatus({ status: "SCHEDULED", paymentReceived: true, startTime: TOMORROW }, NOW), "SCHEDULED");
  check("future + status PAID ⇒ Scheduled", simpleJobStatus({ status: "PAID", startTime: TOMORROW }, NOW), "SCHEDULED");
  check("future + status COMPLETED ⇒ Scheduled", simpleJobStatus({ status: "COMPLETED", startTime: TOMORROW }, NOW), "SCHEDULED");
  // ...and everything that must not change.
  check("past + paid ⇒ Paid", simpleJobStatus({ status: "COMPLETED", paymentReceived: true, startTime: YESTERDAY }, NOW), "PAID");
  check("past + COMPLETED unpaid ⇒ Completed", simpleJobStatus({ status: "COMPLETED", startTime: YESTERDAY }, NOW), "COMPLETED");
  check("yesterday + still SCHEDULED ⇒ Completed (date passed, sweep not run)", simpleJobStatus({ status: "SCHEDULED", startTime: YESTERDAY }, NOW), "COMPLETED");
  check("cancelled ⇒ Cancelled", simpleJobStatus({ status: "CANCELLED", startTime: TOMORROW }, NOW), "CANCELLED");
  check(
    "IN_PROGRESS survives the date guard — clock-in opens 2h before the start",
    simpleJobStatus({ status: "IN_PROGRESS", startTime: TOMORROW }, NOW),
    "IN_PROGRESS"
  );
  check(
    "future + clocked out ⇒ Paid/Completed as usual (it happened)",
    simpleJobStatus({ status: "PAID", paymentReceived: true, startTime: LATER_TODAY, clockOutTime: NOW }, NOW),
    "PAID"
  );
  // Fails open exactly like isFutureJob, so a DTO without startTime keeps its
  // old answer instead of every row turning into "Scheduled".
  check("no startTime ⇒ old behaviour (Paid)", simpleJobStatus({ status: "PAID" }, NOW), "PAID");
});

section(1, "the BookingKoala import stops stamping PAID on future bookings", () => {
  const header = [
    "Booking id", "Booking start date time", "Service", "Industry", "Full name", "Email",
    "Service total (CAD)", "Final amount (CAD)", "Amount paid by customer (CAD)", "Payment method",
  ].join(",");
  const row = (id: string, start: string, serviceTotal: string, paid: string) =>
    [id, `"${start}"`, "Regular Cleaning", "Residential", "Test Customer", "t@example.com",
     serviceTotal, serviceTotal, paid, "CC"].join(",");

  const csv = [
    header,
    row("B1", "2026-08-25 10:00:00", "200", "200"), // prepaid, a week out
    row("B2", "2026-08-10 10:00:00", "200", "200"), // prepaid, already happened
    row("B3", "2026-08-25 10:00:00", "200", "0"),   // unpaid, future
    row("B4", "2026-08-25 10:00:00", "0", "0"),     // $0 → on hold, unchanged
  ].join("\n");

  const parsed = parseAndNormalize(csv, NOW);
  check("all four rows parsed", parsed.rows.length, 4);
  const byId = new Map(parsed.rows.map((r) => [r.job.bookingId, r.job]));

  check("prepaid FUTURE booking imports as SCHEDULED, not PAID", byId.get("B1")?.status, "SCHEDULED");
  ok("...and still records that the customer paid", byId.get("B1")?.paymentReceived === true);
  check("prepaid PAST booking still imports as PAID", byId.get("B2")?.status, "PAID");
  check("unpaid future booking is SCHEDULED", byId.get("B3")?.status, "SCHEDULED");
  check("a $0 import is still CREATED (on hold) — unchanged by this fix", byId.get("B4")?.status, "CREATED");
});

section(1, "no payment writer stamps a lifecycle status without a date guard", () => {
  // Source checks: these live inside Prisma `data:` objects, which no unit test
  // can reach without a database. A regression here is a deleted guard.
  const TOGGLE = "src/app/admin/actions/toggleJobPaymentStatus.ts";
  has("toggleJobPaymentStatus computes isFuture", TOGGLE, "const isFuture =");
  has("toggleJobPaymentStatus withholds PAID from a future job", TOGGLE, 'return isFuture ? undefined : ("PAID" as const)');

  const CHARGE = "src/app/admin/actions/chargeJob.ts";
  has("chargeJob computes isFuture", CHARGE, "const isFuture =");
  has("chargeJob gates the status write behind it", CHARGE, 'const paidStatus = isFuture ? {} : { status: "PAID" as const }');
  // The old unguarded write, in both places it lived (the atomic claim and the
  // gift-card-covers-it-entirely branch). `paidStatus` is now the only route to
  // a PAID status in this file — asserted by counting, so a third unguarded
  // write added later is caught too.
  lacksInCode("chargeJob no longer writes an unguarded PAID claim", CHARGE, 'paidAt: new Date(), status: "PAID"');
  check(
    "chargeJob names the PAID status exactly once — inside the guard",
    (codeOf(CHARGE).match(/status: "PAID" as const/g) ?? []).length,
    1
  );
  ok(
    "chargeJob still records the payment itself unconditionally",
    read(CHARGE).includes("paymentReceived: true, paidAt: new Date(), ...paidStatus")
  );

  const INVOICE = "src/lib/invoice-sync.ts";
  has("invoice-sync splits its PAID update by date", INVOICE, "const stillAhead = { startTime: { gt: now }, clockOutTime: null }");
  has("invoice-sync marks future jobs paid WITHOUT a status", INVOICE, "data: { paymentReceived: true, paidAt: now, invoiceSent: true }");

  const BK = "src/lib/bookingkoala/core.ts";
  has("the import derives paidAndPast, not bare paid", BK, "const paidAndPast = paid && start.getTime() <= now.getTime()");
  ok("the import still sets paymentReceived from the raw paid flag", read(BK).includes("paymentReceived: paid"));

  // bulkChargeJobs delegates to chargeJob, so it inherits the guard rather than
  // carrying a second copy. Assert the delegation instead of a duplicate rule.
  const BULK = "src/app/admin/actions/bulkChargeJobs.ts";
  has("bulkChargeJobs charges through chargeJob (inherits the guard)", BULK, "await chargeJob(job.id)");
  lacksInCode("bulkChargeJobs writes no status of its own", BULK, "data: {");

  // The legitimate COMPLETED writers must survive untouched — this fix removes
  // inference from payment, not the real completion paths.
  has("the past-only cron sweep still exists", "src/lib/job-sweep.ts", "startTime: { lt: dayStart }");
  has("explicit mark-complete still exists", "src/app/admin/actions/markJobComplete.ts", 'data: {');
  has("final clock-out still sets the job status", "src/app/admin/actions/clockOut.ts", "data: { status: nextStatus }");
});

section(1, "every Completed surface reads the one predicate", () => {
  const VIEW = "src/app/admin/jobs/JobsView.tsx";
  has("the Completed tab delegates to isCompletedJob", VIEW, "return isCompletedJob(job, at);");
  has("the Upcoming tab delegates to isUpcomingJob", VIEW, "return isUpcomingJob(job, at);");
  // The literal predicate this fix removed, in both places it lived.
  lacksInCode("no bare status list is left in the tab predicate", VIEW, "['COMPLETED', 'PAID'].includes(job.status)");
  lacksInCode("no bare status list is left in the stat cards", VIEW, "j.status === 'COMPLETED' || j.status === 'PAID'");
  has("the stat cards count through isCompletedJob", VIEW, "const done = isCompletedJob(j, at);");
  has("marking a future job paid no longer flips its pill", VIEW, "(isFutureJob(job) ? job.status : 'PAID')");

  // The predicate needs clockOutTime, so the whole select→map→type chain has to
  // carry it. This contract has regressed before on other columns, which is why
  // it is pinned rather than trusted.
  has("the jobs query selects clockOutTime", "src/app/admin/jobs/page.tsx", "clockOutTime: true,");
  has("...the DTO map copies it", "src/app/admin/jobs/page.tsx", "clockOutTime: job.clockOutTime?.toISOString() || null,");
  has("...JobsPageClient's type declares it", "src/app/admin/jobs/JobsPageClient.tsx", "clockOutTime: string | null;");
  has("...JobsView's type declares it", VIEW, "clockOutTime: string | null;");

  const DASH = "src/app/admin/dashboard/page.tsx";
  has("the dashboard pending-payment tile uses the overdue bucket", DASH, 'jobStatusWhere("overdue", now)');
  has("the Recently-completed list carries the date guard", DASH, "NOT: { startTime: { gt: now }, clockOutTime: null }");
  lacksInCode(
    "no unguarded completed count is left on the dashboard",
    DASH,
    'db.job.count({ where: { deletedAt: null, status: "COMPLETED", paymentReceived: false } })'
  );
});

// ═══════════════════════════════════════════════════════════════════════════
// Fix 2 — an assigned job must reach the cleaner's schedule
// ═══════════════════════════════════════════════════════════════════════════
//
// Stage 2 has the same testability problem as Stage 1 and the same answer: the
// fix lives in a Prisma `where`, so it is exercised by running that clause over
// fabricated in-memory jobs through `matchesWhere` above. The TODO's Stage 2
// "Verify" line asks for exactly this.
//
// Reproduction, from the Stage 0 probe: job #2066 (David Hinchey, Aug 19,
// 12:00 PM) carried the M2M row, the JobAssignment row AND `employeeId`, all
// naming Annabel Karim — the assignment was perfect. One clause hid it:
// `status = COMPLETED`, mis-stamped by fix 1 on a job that had not happened.

/** An hour ago — inside the store day, but already under way. */
const STARTED_TODAY = new Date(NOW.getTime() - 60 * 60 * 1000);

/** Does a job row survive a cleaner-jobs fragment? */
const survives = (where: Prisma.JobWhereInput, row: Row) =>
  matchesWhere(row, where as Record<string, unknown>);

section(2, "upcomingFilter — a future job is hidden only by CANCELLED", () => {
  const upcoming = upcomingFilter(NOW);

  // IMG-3, as a test: this is job #2066's exact shape.
  ok(
    "COMPLETED + starts tomorrow ⇒ still on the cleaner's schedule",
    survives(upcoming, job({ id: "u1", status: "COMPLETED" }))
  );
  ok(
    "PAID + starts tomorrow ⇒ still on the schedule",
    survives(upcoming, job({ id: "u2", status: "PAID" }))
  );
  ok(
    "SCHEDULED + starts tomorrow ⇒ on the schedule (unchanged)",
    survives(upcoming, job({ id: "u3" }))
  );
  ok(
    "CREATED (on hold) + starts tomorrow ⇒ on the schedule",
    survives(upcoming, job({ id: "u4", status: "CREATED" }))
  );
  ok(
    "IMG-1's 6 PM job — later TODAY, not started, COMPLETED ⇒ on the schedule",
    survives(upcoming, job({ id: "u5", status: "COMPLETED", startTime: LATER_TODAY }))
  );

  // The one exception the PDF allows, and the behaviours that must survive.
  ok(
    "CANCELLED + starts tomorrow ⇒ hidden (the only way a future job goes)",
    !survives(upcoming, job({ id: "u6", status: "CANCELLED" }))
  );
  ok(
    "a future job that was CLOCKED OUT ⇒ hidden (an early finish is a finish)",
    !survives(upcoming, job({ id: "u7", clockOutTime: NOW }))
  );
  ok(
    "COMPLETED and already under way today ⇒ hidden (today's rules unchanged)",
    !survives(upcoming, job({ id: "u8", status: "COMPLETED", startTime: STARTED_TODAY }))
  );
  ok(
    "SCHEDULED and already under way today ⇒ still upcoming until clock-out",
    survives(upcoming, job({ id: "u9", startTime: STARTED_TODAY }))
  );
  ok(
    "yesterday's job ⇒ hidden (the start-of-day floor is untouched)",
    !survives(upcoming, job({ id: "u10", startTime: YESTERDAY }))
  );
});

section(2, "doneFilter — the repaired job must not appear in BOTH lists", () => {
  const done = doneFilter(NOW);
  const upcoming = upcomingFilter(NOW);

  const misStamped = job({ id: "d1", status: "COMPLETED" }); // future, no clock-out
  ok("COMPLETED + starts tomorrow ⇒ NOT done", !survives(done, misStamped));
  ok(
    "...and it is in exactly one list, not both",
    survives(upcoming, misStamped) && !survives(done, misStamped)
  );

  ok(
    "COMPLETED and already happened ⇒ done (unchanged)",
    survives(done, job({ id: "d2", status: "COMPLETED", startTime: YESTERDAY }))
  );
  ok(
    "PAID and already happened ⇒ done (unchanged)",
    survives(done, job({ id: "d3", status: "PAID", startTime: YESTERDAY }))
  );
  ok(
    "a future job WITH a clock-out ⇒ done (worked early, genuinely finished)",
    survives(done, job({ id: "d4", status: "COMPLETED", clockOutTime: NOW }))
  );
  ok(
    "clocked out but CANCELLED ⇒ not done (unchanged)",
    !survives(done, job({ id: "d5", status: "CANCELLED", startTime: YESTERDAY, clockOutTime: NOW }))
  );
});

section(2, "the new OR arm did not clobber the assignment test", () => {
  // The hazard this pins: `cleanerAssignedWhere` spends the TOP-LEVEL `OR` key
  // on "I lead this job OR I'm on its crew", and composes the fragments through
  // `AND`. `upcomingFilter` now returns an `OR` of its own — merged rather than
  // nested, it would REPLACE the assignment test and widen every cleaner's list
  // to the whole company's schedule. That is a silent authorization failure, so
  // it is asserted rather than reasoned about.
  for (const [label, where] of [
    ["upcoming", upcomingJobsWhere("c1", NOW)],
    ["done", doneJobsWhere("c1", NOW)],
    ["cancelled", cancelledJobsWhere("c1")],
    ["past", pastJobsWhere("c1", NOW)],
  ] as const) {
    const top = where as { OR?: unknown[]; AND?: unknown[]; deletedAt?: unknown };
    check(
      `${label}: the top-level OR is still the two-arm assignment test`,
      JSON.stringify(top.OR),
      JSON.stringify([{ employeeId: "c1" }, { cleaners: { some: { id: "c1" } } }])
    );
    ok(`${label}: soft-deleted jobs stay out`, top.deletedAt === null);
    ok(`${label}: the quote guard is still first in the AND chain`, Array.isArray(top.AND) && top.AND.length === 2);
  }
});

section(2, "every assignment write records all three halves", () => {
  // M2M `cleaners` + lead `employeeId` + per-cleaner `JobAssignment`. The
  // cleaner's own list reads the first two, the admin employee profile reads
  // the lead, and JobAssignment carries per-cleaner status and pay — so a path
  // that writes only some of them is how the four surfaces drift apart.
  const CLAIM = "src/app/cleaners/available-jobs/claimJob.ts";
  has("claimJob connects the cleaner (M2M)", CLAIM, "data: { cleaners: { connect: { id: userId } } }");
  has("claimJob takes the lead slot if it is empty", CLAIM, "where: { id: jobId, employeeId: null },");
  has("claimJob writes the per-cleaner assignment row", CLAIM, "jobId_cleanerId: { jobId, cleanerId: userId }");

  const INVITE = "src/app/admin/actions/respondToJobInvite.ts";
  has(
    "a last-minute accept takes the lead slot if it is empty",
    INVITE,
    "where: { id: invite.jobId, employeeId: null },"
  );
  has("a decline re-resolves the lead", INVITE, "const declinerIsLead = invite.job.employeeId === session.user.id;");
  has("...and writes it back with the disconnect", INVITE, "employeeId: nextLead,");
  has(
    "...but only when the decliner WAS the lead (legacy leads survive)",
    INVITE,
    ": invite.job.employeeId;"
  );

  // The departure paths matter as much as the arrival ones: `employeeId` and
  // `cleaners` are ORed together by `cleanerAssignedWhere`, so clearing one and
  // leaving the other is not a departure at all.
  const SHIFT = "src/app/admin/actions/cancelShift.ts";
  has("cancelShift disconnects the crew row", SHIFT, "cleaners: { disconnect: { id: employeeId } },");
  has("...and re-resolves the lead in the same write", SHIFT, "employeeId: nextLead,");
  has("...only when the canceller held it", SHIFT, "? resolveJobLead(job.employeeId, remainingCleanerIds)");
  lacksInCode(
    "...and no longer treats lead-vs-crew as an either/or",
    SHIFT,
    "data: { employeeId: null } });"
  );
  has("...and still cancels the per-cleaner assignment row", SHIFT, 'data: { status: "CANCELLED" },');

  const ASSIGN = "src/app/admin/actions/assignCleaners.ts";
  has("assignCleaners keeps the lead on the team", ASSIGN, "employeeId: resolveJobLead(job.employeeId, input.cleanerIds),");
  has("...and syncs the assignment rows", ASSIGN, "await syncJobAssignments(input.jobId, input.cleanerIds)");

  const SAVE = "src/app/admin/actions/saveJob.ts";
  has("saveJob (edit) resolves the lead", SAVE, "updateData.employeeId = resolveJobLead(existingJob?.employeeId, cleanerIds);");
  has("saveJob (create) names the first cleaner as lead", SAVE, "employeeId: cleanerIds[0] ?? null,");
  has("saveJob (edit) syncs the assignment rows", SAVE, "await syncJobAssignments(editingJobId, cleanerIds)");
  has("saveJob (create) syncs the assignment rows", SAVE, "await syncJobAssignments(newJob.id, cleanerIds)");

  const BULK = "src/app/admin/actions/bulkAssignCleaner.ts";
  has("bulkAssignCleaner connects + fills an empty lead", BULK, "...(j.employeeId ? {} : { employeeId: cleanerId }),");
  has("...and upserts the assignment row", BULK, "jobId_cleanerId: { jobId: j.id, cleanerId }");

  // The modal's team picker is the surface IMG-2 was taken on. Without this
  // marker `saveJob` treats an empty selection as "this form doesn't manage
  // cleaners" and leaves the team alone — the contract is one submit handler,
  // so mobile and desktop cannot diverge.
  const MODAL = "src/app/admin/jobs/JobModal.tsx";
  has("JobModal posts the team marker", MODAL, 'formData.append("cleanersSubmitted", "1");');
  check(
    "JobModal has exactly one submit path, so mobile posts it too",
    (read(MODAL).match(/await onSubmit\(formData\)/g) ?? []).length,
    1
  );
});

section(2, "all four surfaces read the same assignment data", () => {
  // My Jobs, the cleaner dashboard and the cleaner calendar already composed
  // the shared builders; the admin's employee profile did not, and that was the
  // gap. It read `employee.jobs` — the `EmployeeJobs` relation, i.e. the LEAD
  // only — so a cleaner on a two-person job they did not lead had it missing
  // from their profile entirely.
  has("My Jobs composes the shared fragments", "src/app/cleaners/my-jobs/page.tsx", "andFilters.push(upcomingFilter(now));");
  has("...including the guarded done filter", "src/app/cleaners/my-jobs/page.tsx", "andFilters.push(doneFilter(now));");
  has("the cleaner dashboard uses the shared builders", "src/app/admin/dashboard/CleanerDashboard.tsx", "upcomingJobsWhere(userId, now)");
  has("the cleaner calendar uses the shared scope", "src/app/admin/calendar/page.tsx", "where: calendarJobsWhere(userId),");

  const PROFILE = "src/app/admin/employees/[id]/page.tsx";
  has("the employee profile's Upcoming panel uses the shared builder", PROFILE, "where: upcomingJobsWhere(employee.id, now),");
  // Stage 6 strengthened this one. It used to assert only that the history
  // panel shared the cleaner SCOPE (`cleanerAssignedWhere`) — which it did,
  // while still hand-rolling its own definition of "done" on top. The
  // click-through found the consequence: Annabel Karim's Aug 19 job, still
  // stamped COMPLETED, appeared under BOTH panels at once. The claim now is
  // the stronger one — the history panel uses the guarded DONE builder, so
  // `doneFilter`'s "a job that has not started and was never clocked out
  // cannot be finished" applies here as it does on the cleaner's own list.
  has("...and its history uses the guarded done builder", PROFILE, "doneJobsWhere(employee.id, now),");
  lacksInCode(
    "...not a fourth hand-written 'done' that reads a future job as recent",
    PROFILE,
    'status: "COMPLETED", startTime: { gt: thirtyDaysAgo }'
  );
  lacksInCode(
    "...and no longer asks for the IN_PROGRESS-only 'upcoming' that showed nothing",
    PROFILE,
    'j.status === "IN_PROGRESS" && new Date(j.startTime) > now'
  );
  lacksInCode(
    "...and no longer hand-rolls a fourth upcoming clause for the kit forecast",
    PROFILE,
    'status: { in: ["CREATED", "SCHEDULED", "IN_PROGRESS"] },'
  );
});

// ═══════════════════════════════════════════════════════════════════════════
// Fix 3 — cancelled work is not work the business did
// ═══════════════════════════════════════════════════════════════════════════
//
// "Total Jobs" was `db.job.count({ where: { deletedAt: null } })` — literally
// every row — so cancelling a booking left the number exactly where it was and
// it could only ever climb. Analytics repeated it in memory as `jobs.length`.
// Both now count ACTIVE work, and the two counts they exclude are printed
// beside them so nothing disappears from the record.

section(3, "activeJobsWhere / isActiveJob — one rule, two languages", () => {
  const table: Row[] = [
    job({ id: "a-scheduled" }),
    job({ id: "a-inprogress", status: "IN_PROGRESS" }),
    job({ id: "a-completed", status: "COMPLETED", startTime: YESTERDAY }),
    job({ id: "a-paid", status: "PAID", startTime: YESTERDAY, paymentReceived: true }),
    job({ id: "x-cancelled", status: "CANCELLED" }),
    job({ id: "x-onhold", status: ON_HOLD_STATUS }),
    job({ id: "x-archived", deletedAt: NOW }),
    job({ id: "x-archived-cancelled", status: "CANCELLED", deletedAt: NOW }),
  ];
  const sqlActive = table
    .filter((r) => matchesWhere(r, activeJobsWhere() as Record<string, unknown>))
    .map((r) => r.id)
    .sort();

  check("the SQL helper and the pure predicate select the same jobs", sqlActive, table.filter(isActiveJob).map((r) => r.id).sort());
  check(
    "active = everything except cancelled, on hold and archived",
    sqlActive,
    ["a-completed", "a-inprogress", "a-paid", "a-scheduled"]
  );
  ok("a cancelled job is not active", !isActiveJob({ status: "CANCELLED" }));
  ok("an on-hold job is not active", !isActiveJob({ status: ON_HOLD_STATUS }));
  ok("an archived job is not active", !isActiveJob({ status: "SCHEDULED", deletedAt: NOW }));
  ok("a completed job IS active — it is work the business did", isActiveJob({ status: "COMPLETED" }));
  check("INACTIVE_JOB_STATUSES is exactly cancelled + on hold", [...INACTIVE_JOB_STATUSES], ["CANCELLED", "CREATED"]);
});

section(3, "the Dashboard and Analytics totals both stopped counting cancellations", () => {
  const DASH = "src/app/admin/dashboard/page.tsx";
  lacksInCode(
    "the dashboard no longer counts every row in the table",
    DASH,
    "db.job.count({ where: { deletedAt: null } })"
  );
  has("...it counts through the shared helper", DASH, "getActiveJobCount(),");
  has("Today's jobs carries the same rule", DASH, "where: { ...activeJobsWhere(), jobDate: { gte: startOfToday, lt: endOfToday } }");
  // The excluded rows must stay visible — the PDF allows the exclusion only on
  // that condition ("cancelled jobs should still be visible in records or as a
  // separate stat"), so a total that quietly shed rows would fail the fix.
  has("the cancelled count is still fetched", DASH, 'jobStatusWhere("cancelled", now)');
  has("...and named in the hint under the total", DASH, "`${cancelledJobs} cancelled`");
  has("...and rendered as its own tile", DASH, 'label="Cancelled"');
  has("the on-hold count is fetched", DASH, 'jobStatusWhere("onhold", now)');
  has("...and named in the same hint", DASH, "`${onHoldJobs} on hold`");

  const AN = "src/app/admin/analytics/page.tsx";
  lacksInCode("analytics no longer totals the raw filtered list", AN, "total: jobs.length,");
  has("...it totals the active ones", AN, "total: activeJobs.length,");
  has("...through the pure twin of the SQL helper", AN, "const activeJobs = jobs.filter(isActiveJob);");
  // The denominator mattered most: with cancellations in it, a month of
  // cancelled bookings read as a month of failed completions.
  has(
    "completion rate is out of active jobs",
    AN,
    "activeJobs.length > 0\n        ? (completedJobs.length / activeJobs.length) * 100"
  );
  has("analytics keeps its own cancelled count", AN, "cancelled: cancelledJobs.length,");
  has("...and gains an on-hold one", AN, "onHold: onHoldJobs.length,");
});

// ═══════════════════════════════════════════════════════════════════════════
// Fix 6 — "On hold" becomes a real status, with a reason and a way out
// ═══════════════════════════════════════════════════════════════════════════
//
// The client's question was "what triggers On Hold, and is it automatic or
// manual?". The answer was: creating a job triggered it, because `saveJob`
// never set a status and CREATED is the Prisma default. So the noise buried the
// two holds that meant something, nothing said why, and there was no release.

section(6, "the vocabulary — one label, one set of reasons", () => {
  check("the hold status is CREATED", ON_HOLD_STATUS, "CREATED");
  check("the label is the calendar's wording, not the enum", HOLD_LABEL, "On hold");
  // A hold with no visible reason is the bug. A blank column must therefore
  // still render as something an admin can act on.
  check("a missing reason still reads as something actionable", holdReasonText(null), "Pending admin review");
  check("...and an empty string is treated the same as missing", holdReasonText("   "), "Pending admin review");
  check("a stored reason is used verbatim", holdReasonText("Waiting on keys"), "Waiting on keys");
  check("the tooltip form is the PDF's 'On hold — {reason}'", holdLabel("Waiting on keys"), "On hold — Waiting on keys");
  ok("isOnHold reads the status column", isOnHold({ status: "CREATED" }) && !isOnHold({ status: "SCHEDULED" }));
});

section(6, "simpleJobStatus — the held job finally has a status of its own", () => {
  // What it used to print, and why that was the whole complaint: a held job
  // said "Scheduled" while its date was ahead and "Completed" the morning
  // after. The one status needing action was the one never shown.
  check("on hold, date ahead ⇒ On hold", simpleJobStatus({ status: "CREATED", startTime: TOMORROW }, NOW), "ON_HOLD");
  check("on hold, date passed ⇒ still On hold, not Completed", simpleJobStatus({ status: "CREATED", startTime: YESTERDAY }, NOW), "ON_HOLD");
  check("on hold + paid ⇒ still On hold (payment shows in the payment column)", simpleJobStatus({ status: "CREATED", paymentReceived: true, startTime: YESTERDAY }, NOW), "ON_HOLD");
  // Cancelled still wins: a cancelled booking is not waiting on anybody.
  check("cancelled beats on hold", simpleJobStatus({ status: "CANCELLED", startTime: TOMORROW }, NOW), "CANCELLED");
  // ...and nothing else moved.
  check("a scheduled job is unaffected", simpleJobStatus({ status: "SCHEDULED", startTime: TOMORROW }, NOW), "SCHEDULED");
  check("a past completed job is unaffected", simpleJobStatus({ status: "COMPLETED", startTime: YESTERDAY }, NOW), "COMPLETED");
});

section(6, "no job is born on hold any more", () => {
  const SAVE = "src/app/admin/actions/saveJob.ts";
  // The root cause, in one line: the create path now names a status.
  has(
    "saveJob (create) stamps SCHEDULED when the job has a date",
    SAVE,
    'jobData.status = statusRaw ?? (hasSchedule ? "SCHEDULED" : ON_HOLD_STATUS);'
  );
  has("...and a dateless job is held WITH a reason", SAVE, "? HOLD_REASON.NO_DATE : null;");
  has("...off the actual date fields, not a guess", SAVE, "const hasSchedule = Boolean(startDate && startTime);");
  // Only on create. The edit path shares `jobData`, so a status written into it
  // higher up would be spread into every update and drag finished jobs
  // backwards — the reason this assignment lives inside the `else`.
  ok(
    "the status is written on the create path only",
    // `=` not `==`: the line below it legitimately READS `jobData.status`, and
    // a looser match would count that read as a second write and pass forever.
    (codeOf(SAVE).match(/jobData\.status = [^=]/g) ?? []).length === 1
  );
  has(
    "recurring children are scheduled, never inheriting the parent's hold",
    SAVE,
    'status: "SCHEDULED",\n            holdReason: null,'
  );
});

section(6, "every automatic hold states its trigger", () => {
  // PDF p5: "automatic holds should show what triggered them." Three producers,
  // three constants — asserted against the shared constant rather than the
  // prose, so a reworded string cannot drift between producer and backfill.
  const BK = "src/lib/bookingkoala/core.ts";
  has("the $0 import writes the import reason", BK, "HOLD_REASON.IMPORT_ZERO_TOTAL : null;");
  has("...and only on the CREATED rows", BK, 'const holdReason = status === "CREATED"');
  has("...and it travels into the job row", "src/app/admin/actions/runBookingKoalaImport.ts", "holdReason: r.job.holdReason,");

  const BOOK = "src/app/(book)/actions/submitBooking.ts";
  has("a post-construction quote says it is waiting on a price", BOOK, "? HOLD_REASON.QUOTE_PENDING");
  has("a flexible booking says it is waiting on a date", BOOK, "? HOLD_REASON.FLEXIBLE_DATE");
  has("...and each recurring occurrence carries the same reason", BOOK, "holdReason: input.isFlexible ? HOLD_REASON.FLEXIBLE_DATE : null,");

  // The hold outlives the quote, so its reason has to move on with it —
  // otherwise an accepted-but-flexible booking still points at a panel with
  // nothing left to decide.
  const QUOTE = "src/app/admin/actions/resolveJobQuote.ts";
  has("accepting a quote clears the hold", QUOTE, '{ status: "SCHEDULED" as const, holdReason: null }');
  has("...unless it is flexible, which re-words the hold", QUOTE, "{ holdReason: HOLD_REASON.FLEXIBLE_DATE }");
  has("declining a quote re-words it too", QUOTE, "{ holdReason: HOLD_REASON.QUOTE_DECLINED }");

  // Four distinct strings — a producer copying another's reason would make the
  // trigger unreadable, which is the thing being fixed.
  const reasons = Object.values(HOLD_REASON);
  check("every trigger has its own wording", new Set(reasons).size, reasons.length);
});

section(6, "the release action, and the one thing it refuses", () => {
  const REL = "src/app/admin/actions/releaseJobHold.ts";
  ok("releaseJobHold exists", fs.existsSync(REL));
  has("it moves the job to SCHEDULED and clears the reason", REL, 'data: { status: "SCHEDULED", holdReason: null }');
  has("...and logs it as a reversible STATUS_CHANGED", REL, 'action: "STATUS_CHANGED",');
  has("...carrying the reason that was cleared", REL, "was \"${previousReason}\"");
  has("it refuses a job that is not on hold", REL, "This job isn't on hold.");
  // A quote's exit is `resolveJobQuote`, which also decides the deposit.
  // Releasing one from here would schedule unpriced work AND skip that call.
  has("it refuses an unsettled quote", REL, "isAwaitingQuote(job.quoteStatus)");
  has("it is staff-gated like every other status move", REL, 'role !== "OWNER" && role !== "ADMIN" && role !== "OPS_MANAGER"');
  // Only the two columns. A hold says nothing about money or the crew.
  const updates = [...codeOf(REL).matchAll(/db\.job\.update\(\{[\s\S]*?data:\s*(\{[^}]*\})/g)].map((m) =>
    m[1].replace(/\s+/g, " ").trim()
  );
  check("it writes status and holdReason and nothing else", updates, ['{ status: "SCHEDULED", holdReason: null }']);
});

section(6, "the reason and the release reach every surface that shows a hold", () => {
  // The column has to travel with the row on three separate query paths, or a
  // surface renders "On hold" and cannot say why. This contract has regressed
  // before on other columns, which is why each leg is pinned.
  has("the jobs list selects it", "src/app/admin/jobs/page.tsx", "holdReason: true,");
  has("...and maps it into the DTO", "src/app/admin/jobs/page.tsx", "holdReason: job.holdReason,");
  has("...and JobsPageClient declares it", "src/app/admin/jobs/JobsPageClient.tsx", "holdReason?: string | null;");
  has("...and JobsView declares it", "src/app/admin/jobs/JobsView.tsx", "holdReason?: string | null;");
  has("the job detail page maps it", "src/app/admin/jobs/[id]/page.tsx", "holdReason: job.holdReason,");
  has("the calendar drawer's summary carries it", "src/app/admin/actions/getJobSummary.ts", "holdReason: job.holdReason,");

  const VIEW = "src/app/admin/jobs/JobsView.tsx";
  has("the jobs list has an On-hold tab", VIEW, "{ id: 'onhold',     label: 'On hold' },");
  has("...whose predicate is the shared one", VIEW, "return isOnHoldJob(job);");
  // The tab COUNT is derived from TABS, not hand-written per tab. The
  // hand-written object was cast `as Record<TabId, number>`, which asserted
  // completeness instead of checking it — so the new tab compiled fine and
  // rendered a blank count. Deriving it means a future tab cannot repeat that.
  has("...and its count is derived from the tab list, not hand-written", VIEW, "TABS.map(t => [t.id, effectiveJobs.filter(j => jobMatchesTab(t.id, j, now)).length])");
  has("...and a matching status-filter option", VIEW, '{ value: "ON_HOLD", label: HOLD_LABEL },');
  has("the pill carries the reason on hover", VIEW, "title={status === 'ON_HOLD' ? holdLabel(job.holdReason) : undefined}");
  has("...and inline, because hunting row by row is the complaint", VIEW, "{holdReasonText(job.holdReason)}");
  has("the row offers Release", VIEW, "aria-label=\"Release from hold\"");
  has("...and names the reason before doing it", VIEW, "Reason on file: ${holdReasonText(job.holdReason)}");
  // The dashboard's On-hold tile deep-links to that tab, and the link only
  // works because `?subTab=` is finally wired through.
  has("?subTab= actually selects a tab now", VIEW, "TABS.some(t => t.id === initialSubTab) ? (initialSubTab as TabId) : 'all'");
  has("...and JobsPageClient passes it down", "src/app/admin/jobs/JobsPageClient.tsx", "initialSubTab={initialSubTab}");
  has("the dashboard tile links to that tab", "src/app/admin/dashboard/page.tsx", 'href="/admin/jobs?subTab=onhold"');

  const DETAIL = "src/app/admin/jobs/[id]/JobDetailView.tsx";
  has("the job page banners the hold", DETAIL, "{holdReasonText(job.holdReason)}");
  has("...with a Release button", DETAIL, "'Release from hold'");
  has("...that steps aside for a quote", DETAIL, "This booking is a quote request.");

  const DRAWER = "src/components/calendar/CalendarJobActions.tsx";
  has("the calendar drawer states the reason", DRAWER, "{holdReasonText(summary.holdReason)}");
  has("...and releases from there too", DRAWER, "const res = await releaseJobHold(jobId);");
});

section(6, "one label, everywhere — the four screens now agree", () => {
  // Before this round the SAME enum rendered as "On hold" (calendar),
  // "Unconfirmed" (my-team), "Created" (clients) and "Created" (cleaner
  // calendar). Each now imports the shared constant, so the drift cannot recur
  // by someone retyping a string.
  for (const [label, path] of [
    ["the admin calendar", "src/components/calendar/status-meta.ts"],
    ["the field lead's My Team", "src/app/admin/my-team/MyTeamClient.tsx"],
    ["the client detail page", "src/app/admin/clients/[id]/ClientDetailView.tsx"],
    ["the cleaner calendar", "src/app/admin/calendar/CleanerCalendarClient.tsx"],
    ["the jobs list", "src/app/admin/jobs/JobsView.tsx"],
    ["the job detail page", "src/app/admin/jobs/[id]/JobDetailView.tsx"],
    ["the dashboard", "src/app/admin/dashboard/page.tsx"],
  ] as const) {
    has(`${label} uses the shared label`, path, "HOLD_LABEL");
  }
  lacksInCode("nobody says 'Unconfirmed' any more", "src/app/admin/my-team/MyTeamClient.tsx", '"Unconfirmed"');
  lacksInCode("...nor 'Created' on the clients page", "src/app/admin/clients/[id]/ClientDetailView.tsx", 'label: "Created"');
  lacksInCode("...nor on the cleaner calendar", "src/app/admin/calendar/CleanerCalendarClient.tsx", 'label: "Created"');
  // The calendar legend painted this colour without explaining it.
  has("the calendar legend finally lists On hold", "src/components/calendar/status-meta.ts", "STATUS_LEGEND: StatusMeta[] = [\n  STATUS_META.CREATED,");
  // Deliberately NOT changed: the customer portal says "Scheduling". A customer
  // must not read internal ops text like "Imported with $0 total".
  has(
    "the customer portal keeps its customer-safe wording",
    "src/components/customer/atoms.tsx",
    'scheduling: "Scheduling",'
  );
});

section(6, "a hold is not ended by the calendar", () => {
  // The nightly sweep used to move CREATED → COMPLETED once the date passed, so
  // an unpriced import silently reported as finished work. That is the same
  // "completion inferred from something that isn't completion" fix 1 is about,
  // one table over — and it was the only thing that ever moved a held job.
  const SWEEP = "src/lib/job-sweep.ts";
  lacksInCode("the sweep no longer touches on-hold jobs", SWEEP, '"CREATED", "SCHEDULED", "IN_PROGRESS"');
  has("...it sweeps scheduled and in-progress work only", SWEEP, 'status: { in: ["SCHEDULED", "IN_PROGRESS"]');
  has("...and the past-only guard is untouched", SWEEP, "startTime: { lt: dayStart }");
});

section(6, "step 3B.7 — cleaner schedules are NOT narrowed yet", () => {
  // The sequencing trap, asserted rather than remembered. Excluding CREATED
  // from the cleaner-facing filters before the legacy backfill has run would
  // delete every legacy admin-created job from every cleaner's schedule — i.e.
  // it would recreate fix 2, the P0 this round opened with. So the cleaner
  // filters keep admitting CREATED until `releaseLegacyJobHolds --commit` has
  // been run, and these checks fail loudly if someone does it early.
  ok(
    "a future on-hold job still reaches the cleaner's upcoming list",
    survives(upcomingFilter(NOW), job({ id: "h1", status: ON_HOLD_STATUS }))
  );
  // The admin-side buckets ARE narrowed, which is the asymmetry to be explicit
  // about: an admin needs the hold called out, a cleaner needs the job.
  ok("...while the admin's Upcoming bucket excludes it", !isUpcomingJob(job({ id: "h2", status: ON_HOLD_STATUS }), NOW));
});

section(6, "the available-jobs board — an EXPLAINED hold is not claimable", () => {
  // The follow-on this round left open, now closed WITHOUT waiting on the
  // backfill. The naive edit (delete CREATED from the status list) only becomes
  // safe after `releaseLegacyJobHolds --commit`, because most CREATED rows are
  // not holds at all — they are ordinary jobs born on the Prisma default. So
  // the board keys on the REASON, which is the thing this round added.
  //
  // Behavioural, not a grep: the filter is evaluated against rows.
  const open = openForClaimFilter();

  ok("SCHEDULED ⇒ claimable (unchanged)", survives(open, job({ id: "c1" })));
  ok(
    "on hold WITH a reason ⇒ NOT claimable — the PDF's actual requirement",
    !survives(open, job({ id: "c2", status: ON_HOLD_STATUS, holdReason: HOLD_REASON.IMPORT_ZERO_TOTAL }))
  );
  ok(
    "...and that holds for every automatic trigger, not just the $0 import",
    Object.values(HOLD_REASON).every(
      (r) => !survives(open, job({ id: `c2-${r.slice(0, 6)}`, status: ON_HOLD_STATUS, holdReason: r }))
    )
  );
  ok(
    "a MANUAL hold reason (free text) is refused too",
    !survives(open, job({ id: "c3", status: ON_HOLD_STATUS, holdReason: "Customer asked us to pause" }))
  );
  // The sequencing guarantee from step 3B.7, preserved exactly: the legacy rows
  // are the ones with no reason, and taking them off the board early would
  // recreate fix 2.
  ok(
    "a LEGACY CREATED row (no reason) is still claimable — the backfill has not run",
    survives(open, job({ id: "c4", status: ON_HOLD_STATUS, holdReason: null }))
  );
  // What the old `status: { in: [...] }` line used to do, still done.
  for (const s of ["IN_PROGRESS", "COMPLETED", "PAID", "CANCELLED"]) {
    ok(`${s} ⇒ not claimable (the old status list's job)`, !survives(open, job({ id: `c5-${s}`, status: s })));
  }

  // Composition: the guard must ride in the AND array. A second top-level `OR:`
  // key would REPLACE the employeeId test and widen the board to every job in
  // the business — the exact trap `cleanerScopedWhere` documents.
  const board = claimableJobsWhere("cleaner-1", NOW) as Record<string, unknown>;
  ok(
    "claimableJobsWhere composes it through AND, not a second OR key",
    (board.AND as unknown[]).some((w) => JSON.stringify(w) === JSON.stringify(openForClaimFilter()))
  );
  ok(
    "...and its top-level OR is still the employeeId test",
    JSON.stringify(board.OR) ===
      JSON.stringify([{ employeeId: null }, { employeeId: { not: "cleaner-1" } }])
  );
  ok("...so the bare status list is gone from the board", board.status === undefined);

  // The action takes a jobId from the client, so the board's filter is
  // decorative unless claimJob enforces the same rule — twice: once as a guard,
  // once inside the atomic WHERE so a hold placed mid-claim wins the race.
  const CLAIM = "src/app/cleaners/available-jobs/claimJob.ts";
  has("claimJob refuses an explained hold", CLAIM, "isOnHold(job) && job.holdReason !== null");
  has("...reads the column it checks", CLAIM, "holdReason: true");
  has("...and carries the same filter into the atomic WHERE", CLAIM, "AND: [quoteSettledFilter(), openForClaimFilter()]");
  lacksInCode("...with no second copy of the old status list", CLAIM, 'status: { in: ["CREATED", "SCHEDULED"] }');
});

// ═══════════════════════════════════════════════════════════════════════════
// Stage 4 — hourly money: fix 4 (customer billing) + fix 5 (cleaner pay)
// ═══════════════════════════════════════════════════════════════════════════
//
// The two are one machine. Fix 4 bills the customer for TOTAL CREW HOURS and
// fix 5 pays each cleaner their OWN clocked hours × their rate, so the bill is
// the sum of the payroll's hours by construction. Both read
// `crewActiveMinutesByCleaner`, and the invariant below is asserted rather than
// assumed.

/** 2026-08-18, the PDF's "today". Times are UTC and the arithmetic is spans. */
const H = (h: number, m = 0) => new Date(Date.UTC(2026, 7, 18, h, m));

const RATE = (id: string): CleanerRateInput => ({
  id,
  tier: "STANDARD",
  multiplier: 1,
  avgRating: null,
  ratingCount: 0,
});
const PAY_RATES = new Map([
  ["ann", RATE("ann")],
  ["bo", RATE("bo")],
]);

/**
 * The PDF's own scenario, as a fixture: two cleaners, 9→12 each, $25/h cleaner
 * rate, customer billed $50/h. Six crew hours; $75 each; $300 billed.
 */
const CREW_SESSIONS = [
  { cleanerId: "ann", startedAt: H(9), endedAt: H(12) },
  { cleanerId: "bo", startedAt: H(9), endedAt: H(12) },
];

const hourlyJob = (over: Partial<JobPayInput> = {}): JobPayInput => ({
  id: "hj",
  employeeId: "ann",
  cleaners: [{ id: "ann" }, { id: "bo" }],
  price: null,
  // The stale save-time estimate the clock is supposed to supersede.
  employeePay: 75,
  employeePayIsManual: false,
  payType: "HOURLY",
  hourlyRate: 25,
  totalTip: null,
  parking: null,
  jobDate: null,
  startTime: H(9),
  endTime: H(12),
  clockInTime: null,
  clockOutTime: null,
  addOns: [],
  assignments: [],
  breaks: [],
  workSessions: CREW_SESSIONS,
  ...over,
});

section(4, "billable hours are TOTAL CREW HOURS, reversing Stage 8's union", () => {
  check(
    "one cleaner, 9→12, is 3 hours",
    billableCrewMinutes([CREW_SESSIONS[0]]) / 60,
    3
  );
  // THE reversal. Stage 8 answered 3 here and documented why; the PDF settles it
  // the other way and this round's standing rule is that the PDF wins.
  check(
    "TWO cleaners over the same 9→12 window is SIX crew hours, not three",
    billableCrewMinutes(CREW_SESSIONS) / 60,
    6
  );
  check(
    "partly overlapping crews ADD rather than union: 9→12 + 11→15 is 7",
    billableCrewMinutes([
      { cleanerId: "ann", startedAt: H(9), endedAt: H(12) },
      { cleanerId: "bo", startedAt: H(11), endedAt: H(15) },
    ]) / 60,
    7
  );
  // Break allocation is per cleaner: a teammate's lunch is not your deduction.
  check(
    "a cleaner's own break comes off their own hours only",
    billableCrewMinutes(CREW_SESSIONS, [
      { cleanerId: "ann", startedAt: H(10), endedAt: H(10, 30) },
    ]) / 60,
    5.5
  );
  check(
    "a break row with no cleanerId is everyone's (the pre-item-26 shape)",
    billableCrewMinutes(CREW_SESSIONS, [{ startedAt: H(10), endedAt: H(10, 30) }]) / 60,
    5
  );
  // The legacy job-level pair carries no per-cleaner record, so multiplying it
  // by crew size would bill hours nobody clocked.
  check(
    "the legacy job-level clock pair counts ONCE",
    billableCrewMinutes([{ cleanerId: null, startedAt: H(9), endedAt: H(12) }]) / 60,
    3
  );
  check(
    "...and every break comes off it, since it stands for the whole crew",
    billableCrewMinutes(
      [{ cleanerId: null, startedAt: H(9), endedAt: H(12) }],
      [{ cleanerId: "ann", startedAt: H(10), endedAt: H(10, 30) }]
    ) / 60,
    2.5
  );
  check("nothing clocked is zero, not NaN", billableCrewMinutes([], []), 0);
  check(
    "the snapshot still rounds to the nearest quarter hour (D7)",
    billableActualHours([{ cleanerId: "ann", startedAt: H(9), endedAt: H(11, 47) }]),
    2.75
  );
});

section(4, "the rate is multiplied by those hours exactly ONCE", () => {
  // IMG-4's own panel: $50/hr × 30 estimated hours = $1500.00.
  check(
    "IMG-4: $50/hr × 30h = $1500",
    hourlyServiceAmount({
      billingType: "HOURLY",
      billedHourlyRate: 50,
      billedEstimatedHours: 30,
    }),
    1500
  );
  // "30 = 1 cleaner × 30h OR 2 cleaners × 15h" — the crew size is INSIDE the
  // hours, so there is no second multiplication to find. Asserted as an identity
  // rather than as a grep: the same 30 hours produce the same price however the
  // crew that worked them is arranged.
  const oneCleaner = billableCrewMinutes([
    { cleanerId: "ann", startedAt: H(0), endedAt: H(6) },
  ]);
  const twoCleaners = billableCrewMinutes([
    { cleanerId: "ann", startedAt: H(0), endedAt: H(3) },
    { cleanerId: "bo", startedAt: H(0), endedAt: H(3) },
  ]);
  check("1×6h and 2×3h are the same six crew hours", [oneCleaner, twoCleaners], [360, 360]);
  check(
    "...and therefore the same customer price",
    [
      hourlyServiceAmount({
        billingType: "HOURLY",
        billedHourlyRate: 50,
        billedActualHours: oneCleaner / 60,
      }),
      hourlyServiceAmount({
        billingType: "HOURLY",
        billedHourlyRate: 50,
        billedActualHours: twoCleaners / 60,
      }),
    ],
    [300, 300]
  );

  // Step 4A.5 — the only `× cleaners` in the codebase is the post-construction
  // QUOTE, which builds man-hours from a per-cleaner estimate and is therefore
  // ALIGNED with this rule rather than an exception to it. Pinned by behaviour:
  // it must still charge two cleaners twice one cleaner for the same hours.
  const cfgHours = 6;
  ok(
    "the post-construction quote still prices per cleaner (and is man-hours too)",
    postConstructionBasePrice(cfgHours, 2) === postConstructionBasePrice(cfgHours, 1) * 2
  );
  // ...and nothing in the billing path does the same to `billedEstimatedHours`.
  for (const [label, path] of [
    ["the pure billing module", "src/lib/hourly-billing.ts"],
    ["the money helper", "src/lib/job-money.ts"],
    ["the shared save action", "src/app/admin/actions/saveJob.ts"],
  ] as const) {
    ok(
      `${label} never multiplies billed hours by a crew count`,
      !/billedEstimatedHours[^\n]*\*[^\n]*(cleaner|crew)/i.test(codeOf(path)) &&
        !/billedActualHours[^\n]*\*[^\n]*(cleaner|crew)/i.test(codeOf(path))
    );
  }
});

section(4, "both job forms say what the field means", () => {
  // The wording IS the fix's other half: an admin typing 30 must be typing the
  // same thing the clock will measure. IMG-4's helper said the opposite.
  const WORDING = "Total job hours across all cleaners — 2 cleaners × 15h is 30.";
  hasText("the modal states the cumulative rule", "src/app/admin/jobs/JobModal.tsx", WORDING);
  hasText(
    "the full-page form states it identically",
    "src/app/admin/jobs/new/BillingTypeFields.tsx",
    WORDING
  );
  lacksInCode(
    "...and Stage 8's contradicting sentence is gone from the modal",
    "src/app/admin/jobs/JobModal.tsx",
    "Hours on site, not per cleaner"
  );
  lacksInCode(
    "...and from the full-page form",
    "src/app/admin/jobs/new/BillingTypeFields.tsx",
    "Hours on site, not hours per cleaner"
  );
  // The amber final-price note is untouched — an override still wins (IMG-4).
  has(
    "a FINAL_PRICE override still beats rate × hours",
    "src/app/admin/jobs/JobModal.tsx",
    "override total below wins over the hourly"
  );

  // The rule change reaches the CLEANER's screen too, and it had to be
  // relabelled there rather than left alone: Stage 8's billed hours were
  // elapsed, so they were how long a cleaner would be on site and "Est.
  // duration" / "Hours worked" were true. Crew hours are double that on a
  // two-person job, and a cleaner planning their day off "6h" for a 3-hour
  // shift would plan the wrong day.
  const CLEANER_VIEW = "src/app/cleaners/my-jobs/[jobId]/page.tsx";
  has("the cleaner's job view calls the figure crew hours", CLEANER_VIEW, '"Crew hours"');
  has("...and says what that means", CLEANER_VIEW, "everyone's time added up");
  has("...in the detail row too", CLEANER_VIEW, '"Crew hours worked"');
  // The needle carries the ternary so it cannot match the JSX comment that
  // explains the rename — `codeOf` strips `//` lines, not `{/* … */}` bodies.
  lacksInCode(
    "...and never labels the crew total as this cleaner's own hours",
    CLEANER_VIEW,
    '? "Hours worked"'
  );
  // Still nothing about what the customer pays (step 8.7 / PDF #8).
  lacksInCode("...and still never shows the customer's rate", CLEANER_VIEW, "billedHourlyRate");
});

section(5, "an HOURLY job pays each cleaner their own clocked hours", () => {
  const shares = computeJobPayShares(hourlyJob(), PAY_RATES);
  check("Ann clocked 3h at $25 ⇒ $75", shares.get("ann")?.base, 75);
  check("Bo clocked 3h at $25 ⇒ $75", shares.get("bo")?.base, 75);
  // NOT a slice of the stored $75 team total — that column was the save-time
  // estimate and is exactly what fix 5 says must stop being the payout.
  check(
    "the team total is the CONSEQUENCE, not the input",
    hourlyTeamPayFromClock(hourlyJob(), PAY_RATES),
    150
  );
  check("...and it says so in words", shares.get("ann")?.basisLabel, "Hourly — 3h clocked × $25.00/h");
  check("...with a short form for a pill", PAY_BASIS_SHORT_LABEL.HOURLY_CLOCK, "Hourly — clocked");

  // Unequal shifts: the whole point of paying from the clock rather than
  // splitting a total. Ann 4h, Bo 2h at $25.
  const uneven = computeJobPayShares(
    hourlyJob({
      workSessions: [
        { cleanerId: "ann", startedAt: H(9), endedAt: H(13) },
        { cleanerId: "bo", startedAt: H(9), endedAt: H(11) },
      ],
    }),
    PAY_RATES
  );
  check("Ann 4h ⇒ $100, Bo 2h ⇒ $50 — no even split anywhere", [
    uneven.get("ann")?.base,
    uneven.get("bo")?.base,
  ], [100, 50]);

  // Two sessions in a day, summed (the PDF: "all sessions summed").
  const split = computeJobPayShares(
    hourlyJob({
      cleaners: [{ id: "ann" }],
      employeeId: "ann",
      workSessions: [
        { cleanerId: "ann", startedAt: H(9), endedAt: H(11) },
        { cleanerId: "ann", startedAt: H(13), endedAt: H(14, 30) },
      ],
    }),
    PAY_RATES
  );
  check("2h + 1.5h at $25 = $87.50", split.get("ann")?.base, 87.5);

  // Breaks are ACTIVE-time deductions on the pay side too (item 26).
  const withBreak = computeJobPayShares(
    hourlyJob({ breaks: [{ cleanerId: "ann", startedAt: H(10), endedAt: H(10, 30) }] }),
    PAY_RATES
  );
  check("Ann's 30-minute break comes off Ann's pay", withBreak.get("ann")?.base, 62.5);
  check("...and not off Bo's", withBreak.get("bo")?.base, 75);
});

section(5, "the clock is the record — and an admin still outranks it", () => {
  // Manual per-cleaner override (JobAssignment.payAmount).
  const overridden = computeJobPayShares(
    hourlyJob({ assignments: [{ cleanerId: "bo", payAmount: 90 }] }),
    PAY_RATES
  );
  check("a per-cleaner override wins for that cleaner", overridden.get("bo")?.base, 90);
  check("...and is labelled as one", overridden.get("bo")?.basis, "MANUAL_CLEANER");
  check("...while their teammate is still paid from the clock", overridden.get("ann")?.base, 75);

  // D2 — a stated team total supersedes the measurement for the whole crew.
  const manual = computeJobPayShares(
    hourlyJob({ employeePay: 88.55, employeePayIsManual: true }),
    PAY_RATES
  );
  check("a manual TEAM total still wins, split to the cent", [
    manual.get("ann")?.base,
    manual.get("bo")?.base,
  ], [44.28, 44.27]);
  check("...and is labelled manual, not hourly", manual.get("ann")?.basis, "MANUAL_TEAM");

  // Nothing clocked ⇒ the save-time estimate stands, labelled as an estimate.
  const notClocked = computeJobPayShares(
    hourlyJob({ employeePay: 150, workSessions: [] }),
    PAY_RATES
  );
  check("with nothing clocked the stored estimate is split evenly", [
    notClocked.get("ann")?.base,
    notClocked.get("bo")?.base,
  ], [75, 75]);
  check("...and says it is an estimate", notClocked.get("ann")?.basis, "HOURLY_ESTIMATE");
  check(
    "...so the clock helper declines to answer",
    hourlyTeamPayFromClock(hourlyJob({ workSessions: [] }), PAY_RATES),
    null
  );
  check(
    "a job with no cleaner rate also declines — there is nothing to multiply",
    hourlyTeamPayFromClock(hourlyJob({ hourlyRate: null }), PAY_RATES),
    null
  );

  // A cleaner who never clocked in earns nothing FOR THE WORK — visibly, so an
  // admin fixes the clock or types an override rather than never noticing.
  const absent = computeJobPayShares(
    hourlyJob({
      totalTip: 20,
      workSessions: [{ cleanerId: "ann", startedAt: H(9), endedAt: H(12) }],
    }),
    PAY_RATES
  );
  check("no sessions of their own ⇒ $0 for the work", absent.get("bo")?.base, 0);
  check("...stated plainly", absent.get("bo")?.basisLabel, "Hourly — 0h clocked × $25.00/h");
  // The pass-throughs are the customer's money and are split by head count, not
  // by hours, so they are unaffected (D3).
  check("...but their even share of the tip is untouched", absent.get("bo")?.tip, 10);
});

section(5, "every other pay type is byte-identical to before", () => {
  const percentage = hourlyJob({
    payType: "PERCENTAGE",
    hourlyRate: null,
    price: 300,
    employeePay: null,
  });
  const shares = computeJobPayShares(percentage, PAY_RATES);
  ok("a PERCENTAGE crew still takes a tier cut of the job's value", (shares.get("ann")?.base ?? 0) > 0);
  check("...and is labelled percentage", shares.get("ann")?.basis, "PERCENTAGE");
  check(
    "a FLAT job still splits its agreed team total evenly",
    [...computeJobPayShares(
      hourlyJob({ payType: "FLAT", hourlyRate: null, employeePay: 120 }),
      PAY_RATES
    ).values()].map((s) => s.base),
    [60, 60]
  );
  check(
    "...labelled flat, so nothing reads as hourly that isn't",
    computeJobPayShares(
      hourlyJob({ payType: "FLAT", hourlyRate: null, employeePay: 120 }),
      PAY_RATES
    ).get("ann")?.basis,
    "FLAT"
  );
  // Every kind has wording. A missing label would render as `undefined` on
  // three screens.
  for (const kind of [
    "MANUAL_CLEANER",
    "MANUAL_TEAM",
    "HOURLY_CLOCK",
    "HOURLY_ESTIMATE",
    "FLAT",
    "PERCENTAGE",
    "LEGACY",
  ] as const) {
    ok(`${kind} has both a sentence and a short label`, !!payBasisLabel(kind) && !!PAY_BASIS_SHORT_LABEL[kind]);
  }
});

section(4, "the bill and the payroll measure the same work", () => {
  // THE invariant the two fixes exist to create, and the reason the measurement
  // lives in one module: the customer's billable hours are the SUM of the hours
  // the crew is paid for. "Billed 6h, paid for 3h" is not expressible.
  const job = hourlyJob({
    breaks: [{ cleanerId: "ann", startedAt: H(10), endedAt: H(10, 30) }],
  });
  const shares = computeJobPayShares(job, PAY_RATES);
  const paidHours = [...shares.values()].reduce((s, x) => s + x.hours, 0);
  const billedHrs = billableActualHours(job.workSessions, job.breaks);
  check("Σ paid hours === billed crew hours", Math.round(paidHours * 100) / 100, billedHrs);
  check("...and that figure is 5.5h, not 3h", billedHrs, 5.5);
  // The acceptance criterion, spelled out: 2 cleaners × 3h ⇒ 6 billed hours at
  // the CUSTOMER's rate, and 3h each at the CLEANER's — two rates, never crossed.
  const clean = hourlyJob();
  const crewHours = billableActualHours(clean.workSessions, clean.breaks);
  check("2 cleaners × 3h ⇒ 6 billed hours", crewHours, 6);
  check(
    "...customer billed $50/h × 6 = $300",
    hourlyServiceAmount({
      billingType: "HOURLY",
      billedHourlyRate: 50,
      billedActualHours: crewHours,
    }),
    300
  );
  check(
    "...and each cleaner paid 3h × $25 = $75, not a slice of $300",
    [...computeJobPayShares(clean, PAY_RATES).values()].map((s) => s.base),
    [75, 75]
  );
  // The per-cleaner map is literally shared, not two implementations that agree
  // on this fixture by luck.
  check(
    "both sides read the same per-cleaner minute map",
    [...crewActiveMinutesByCleaner(clean.workSessions, clean.breaks).values()],
    [180, 180]
  );
  has(
    "the billing module gets its measurement from the sessions module",
    "src/lib/hourly-billing.ts",
    "crewActiveMinutes"
  );
  has(
    "...and so does the pay module",
    "src/lib/cleaner-earnings.ts",
    "crewActiveMinutesByCleaner"
  );
});

section(5, "step 4B.1 — the mount site that was resetting the pay type", () => {
  // THE reset bug. The job DETAIL page hands its whole DTO to <JobModal
  // mode="edit">, and the modal OWNS the Pay type control, so it posts `payType`
  // on every save. The DTO carried the four BILLING columns and neither PAY
  // column, so the modal read `undefined`, fell back to PERCENTAGE, and the save
  // wrote that over the job — an hourly-paid job came back Percentage with its
  // rate nulled. That is "cleaner hourly pay not saving", and it is why 7 of the
  // 11 HOURLY jobs on live data carry no rate.
  //
  // Every mount site is checked TOGETHER so the next one added cannot be the
  // one nobody came back to.
  for (const [label, path, payNeedle, rateNeedle] of [
    [
      "the job detail page (the one that was broken)",
      "src/app/admin/jobs/[id]/page.tsx",
      "payType: job.payType,",
      "hourlyRate: job.hourlyRate,",
    ],
    [
      "the jobs list",
      "src/app/admin/jobs/page.tsx",
      "payType: job.payType,",
      "hourlyRate: job.hourlyRate,",
    ],
    [
      "the calendar drawer's DTO",
      "src/app/admin/actions/getJobSummary.ts",
      "payType: job.payType,",
      "hourlyRate: job.hourlyRate,",
    ],
    [
      "the calendar drawer's modal",
      "src/components/calendar/CalendarJobActions.tsx",
      "payType: summary.payType,",
      "hourlyRate: summary.hourlyRate,",
    ],
    [
      "the full-page form",
      "src/app/admin/jobs/new/page.tsx",
      "?.payType || \"PERCENTAGE\"",
      "?.hourlyRate ?? null",
    ],
  ] as const) {
    has(`${label} prefills payType`, path, payNeedle);
    has(`${label} prefills the cleaner's hourly rate`, path, rateNeedle);
  }
  // The select behind the two list-shaped ones, so the column reaches the map.
  has("the jobs list SELECTS them too", "src/app/admin/jobs/page.tsx", "payType: true,");
  has("...and so does the drawer's action", "src/app/admin/actions/getJobSummary.ts", "payType: true,");
  // The client type that carries them from server to modal.
  has("the jobs page client type declares them", "src/app/admin/jobs/JobsPageClient.tsx", "payType?: string | null;");
  has("the job detail view type declares them", "src/app/admin/jobs/[id]/JobDetailView.tsx", "payType?: string | null;");
  // The save action's tri-state, which is what makes a form WITHOUT the control
  // (the jobs-list quick edit) preserve rather than reset.
  has(
    "saveJob preserves the pay model when the form doesn't own the control",
    "src/app/admin/actions/saveJob.ts",
    'formData.has("payType")'
  );
});

section(5, "step 4B.3/4B.4 — the clock writes the pay, with guards", () => {
  const CLOCK_OUT = "src/app/admin/actions/clockOut.ts";
  const CLOCK_EDIT = "src/app/admin/actions/updateClockTimes.ts";
  const PAY_SERVER = "src/lib/hourly-pay.server.ts";

  has("the final clock-out settles the crew's pay", CLOCK_OUT, "snapshotHourlyEmployeePay(");
  ok(
    "...only on the FINAL clock-out, beside the billing snapshot",
    /isFinalClockOut\)\s*\{[\s\S]{0,900}snapshotHourlyEmployeePay/.test(read(CLOCK_OUT))
  );
  has("an admin editing a session repays from it", CLOCK_EDIT, "snapshotHourlyEmployeePay(");
  ok(
    "...and deleting a session does too — deleted work is not paid work",
    read(CLOCK_EDIT).split("snapshotHourlyEmployeePay(").length - 1 >= 2
  );
  // The round-2 rule, restated: a frozen payroll is not rewritten underneath.
  has("the snapshot refuses a locked pay period", PAY_SERVER, 'reason: "PAYROLL_LOCKED"');
  has("...off ONE status list, shared with the warning the admin sees", PAY_SERVER, "LOCKED_PAY_PERIOD_STATUSES");
  has("...which the clock editor imports rather than re-typing", CLOCK_EDIT, "LOCKED_PAY_PERIOD_STATUSES");
  // D2 and "manual admin edit still overrides".
  has("...and refuses a manual figure outright", PAY_SERVER, 'reason: "MANUAL"');
  has("...and writes nothing when nothing was clocked", PAY_SERVER, 'reason: "NO_CLOCK"');
  // The write is narrow: money only, no status, no clock, no crew.
  {
    const updates = [
      ...codeOf(PAY_SERVER).matchAll(/db\.job\.update\(\{[\s\S]*?data:\s*(\{[^}]*\})/g),
    ].map((m) => m[1].replace(/\s+/g, " ").trim());
    check("the snapshot updates employeePay and nothing else", updates, ["{ employeePay }"]);
  }
  has("...and logs the recalculation on the job", PAY_SERVER, 'field: "employeePay"');
  // The estimate has to be in the same unit as the settlement, or the figure
  // halves the moment a two-person job is worked.
  has(
    "saveJob's estimate carries the crew multiplier",
    "src/app/admin/actions/saveJob.ts",
    "hourlyRate * payHours * crewSize"
  );
});

section(5, "step 4B.6/4B.7 — every pay surface states its basis", () => {
  // One share object carries the amount AND the reason, so the three screens
  // cannot describe a rule the payout did not follow.
  has("the share carries the basis", "src/lib/cleaner-earnings.ts", "basisLabel: payBasisLabel(basis, basisDetail),");
  has("the pay modal's payload carries it", "src/app/admin/actions/getPayBreakdown.ts", "basisLabel: share.basisLabel,");
  has("the cleaner's pay modal renders it", "src/app/cleaners/my-jobs/PayBreakdownModal.tsx", "{data.basisLabel}");
  has("the job page's Financials rows render it", "src/app/admin/jobs/[id]/JobDetailView.tsx", "{r.basisLabel}");
  has("...and the job-level pill reads the basis, not just manual-or-not", "src/app/admin/jobs/[id]/JobDetailView.tsx", "PAY_BASIS_SHORT_LABEL[payBasisKinds[0]]");
  has("...fed from the server", "src/app/admin/jobs/[id]/page.tsx", "basis: share.basis,");
  // The vocabulary is its own PURE module precisely so a client component can
  // read it — `cleaner-earnings`, which decides the basis, reaches @/db.
  ok(
    "the label module is pure, so client components can import it",
    // `codeOf`, because the module's own header legitimately NAMES `@/db` while
    // explaining why it exists apart from the module that imports it.
    !codeOf("src/lib/pay-basis.ts").includes("@/db") &&
      !codeOf("src/lib/pay-basis.ts").includes('"server-only"') &&
      !/^\s*import\s/m.test(read("src/lib/pay-basis.ts"))
  );
  // A cleaner must never read a client charge or the internal split mechanics
  // off their own pay screen — the reason getPayBreakdown redacts server-side.
  // Checked against the CODE: the file's comments legitimately name the things
  // it is built to withhold.
  for (const forbidden of [
    "billedHourlyRate",
    "payBasis",
    "clientTotal",
    "basePrice",
    "individualRate",
    "poolTotal",
    "data.tier",
  ]) {
    lacksInCode(
      `the cleaner-facing pay modal never renders ${forbidden}`,
      "src/app/cleaners/my-jobs/PayBreakdownModal.tsx",
      forbidden
    );
  }
});

section(5, "every pay caller loads the clock it is now paid from", () => {
  // The subtle half of fix 5. `computeJobPayShares` settles an HOURLY job from
  // `job.workSessions`; a caller whose query omits them gets `undefined`, falls
  // back to splitting the stored team total evenly, and quietly disagrees with
  // payroll on exactly the jobs where the crew's hours differed. Prisma's
  // `include` loads scalars but never relations, which is how three callers —
  // the cleaner's own pay modal among them — were missing them.
  //
  // DISCOVERED, not listed: the next caller someone writes is checked too.
  const walk = (dir: string): string[] =>
    fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      const p = `${dir}/${e.name}`;
      if (e.isDirectory()) return walk(p);
      return /\.tsx?$/.test(e.name) ? [p] : [];
    });
  const callers = walk("src").filter((p) => {
    const src = codeOf(p);
    return (
      (src.includes("computeJobPayShares(") || src.includes("cleanerJobPay(")) &&
      // The definitions themselves, not callers of them.
      !p.endsWith("src/lib/cleaner-earnings.ts")
    );
  });
  ok("there is at least one pay caller to check", callers.length > 0);
  const blind = callers.filter((p) => {
    const src = read(p);
    // Either it reads through the shared select (which carries the sessions),
    // or it names them itself.
    return !src.includes("JOB_PAY_SELECT") && !src.includes("workSessions");
  });
  check("every computeJobPayShares caller loads workSessions", blind, []);
  const noBreaks = callers.filter((p) => {
    const src = read(p);
    return !src.includes("JOB_PAY_SELECT") && !src.includes("breaks");
  });
  // Breaks are ACTIVE-time deductions (item 26) — a caller with sessions but no
  // breaks would pay a cleaner for their own lunch.
  check("...and the breaks that come off those hours", noBreaks, []);
});

section(4, "step 4A.6 — the recompute script exists and is dry-run by default", () => {
  const path = "scripts/recomputeHourlyJobs.ts";
  const exists = fs.existsSync(path);
  ok("data script exists: recomputeHourlyJobs.ts", exists);
  if (!exists) return;
  const src = codeOf(path);
  ok("it is a dry run unless --commit is passed", src.includes('process.argv.includes("--commit")'));
  ok("...and returns before writing when it isn't", /if\s*\(!commit\)\s*\{[\s\S]*?return;/.test(src));
  // It drives the APP's own helpers rather than carrying a second copy of the
  // rules, so every guard (settled customer, FINAL_PRICE, manual pay, locked
  // payroll) applies to the repair exactly as it does to a clock-out.
  ok("it re-measures through the app's own billing snapshot", src.includes("snapshotBilledActualHours"));
  ok("...and repays through the app's own pay snapshot", src.includes("snapshotHourlyEmployeePay"));
  const writes = [".create(", ".createMany(", ".update(", ".updateMany(", ".upsert(", ".delete(", ".deleteMany(", "$executeRaw"].filter(
    (w) => src.includes(w)
  );
  check("it performs no direct writes of its own", writes, []);
});

// ═══════════════════════════════════════════════════════════════════════════
// Stage 5A — fix 7: the apartment number
// ═══════════════════════════════════════════════════════════════════════════

section(7, "step 5A.1 — the unit can be found wherever it was stored", () => {
  // IMG-5's job, exactly as the live row reads it (probe-awer-fixes-4.ts,
  // "Fix 7" section). Note what the probe found: `aptNumber` IS populated on
  // that row — the recon guessed it wasn't. So the two habits below have to
  // land on the same answer, because the same job can arrive either way.
  const IMG5 = "5550 Chemin de la Côte Saint Luc, Montreal, QC, Canada, 23";
  check(
    "the trailing unit in IMG-5's address is found",
    splitAptFromLocation(IMG5),
    { street: "5550 Chemin de la Côte Saint Luc, Montreal, QC, Canada", apt: "23" }
  );

  // The false positives that would make this rule worse than no rule. Each is
  // a real shape from a Montréal address book.
  const leaveAlone = [
    "1234 Rue Sherbrooke, Montréal, QC, H3Z 1H2", // postal code
    "123 Main St, Anytown, NY, 10012", // 5-digit US ZIP
    "45 Rue Principale, Ste Foy", // a saint, not a suite
    "45 Rue Principale, Ste-Foy",
    "100 Boulevard Saint-Laurent, Montreal, Quebec, Canada", // country
    "5550 Chemin de la Côte Saint-Luc", // a leading number is a STREET number
    "4820 Sherbrooke",
  ];
  check(
    "nothing that isn't a unit is mistaken for one",
    leaveAlone.filter((a) => splitAptFromLocation(a).apt !== null),
    []
  );
  check(
    "...and those addresses come back byte-identical",
    leaveAlone.filter((a) => splitAptFromLocation(a).street !== a),
    []
  );

  // The shapes that DO split.
  check(
    "the importer's leading form splits",
    splitAptFromLocation("Apt 12 – 4820 Sherbrooke"),
    { street: "4820 Sherbrooke", apt: "Apt 12" }
  );
  check(
    "a labelled trailing unit splits",
    splitAptFromLocation("500 Place Ville Marie, Montreal, Suite 1000"),
    { street: "500 Place Ville Marie, Montreal", apt: "Suite 1000" }
  );
  check(
    "a labelled unit splits without a comma to help",
    splitAptFromLocation("14 Main St Apt 3"),
    { street: "14 Main St", apt: "Apt 3" }
  );
  check("an empty address stays empty", splitAptFromLocation(null), {
    street: "",
    apt: null,
  });
});

section(7, "step 5A.2 — both storage habits render the same apartment", () => {
  const RAW = "5550 Chemin de la Côte Saint Luc, Montreal, QC, Canada, 23";
  // Habit A: the unit is in the column AND duplicated at the tail of the
  // string (IMG-5's actual row). Habit B: the column is empty and the string
  // is all there is. A cleaner must not be able to tell which one they got.
  check(
    "column-and-string and string-only resolve identically",
    resolveAddressParts({ address: RAW, aptNumber: "23" }),
    resolveAddressParts({ address: RAW, aptNumber: null })
  );
  check("...and that answer is the unit on its own line", resolveAddressParts({ address: RAW, aptNumber: "23" }).aptLabel, "Apt 23");
  check(
    "...with the street no longer ending in a bare number",
    resolveAddressParts({ address: RAW, aptNumber: "23" }).street,
    "5550 Chemin de la Côte Saint Luc, Montreal, QC, Canada"
  );

  // Feeding a screen's own resolved parts back in must not shift anything —
  // MapLinksClient does exactly that with the props the page hands it.
  const once = resolveAddressParts({ address: RAW, aptNumber: null });
  check(
    "resolving twice is the same as resolving once",
    resolveAddressParts({
      address: once.street,
      aptNumber: once.apt,
      city: once.city,
      postalCode: once.postalCode,
    }),
    once
  );

  // Real values off the live database (probe: 31 distinct). The two that are
  // not unit numbers are the whole reason `formatAptLabel` exists.
  check("a bare unit gets a designator", formatAptLabel("23"), "Apt 23");
  check("a lettered unit does too", formatAptLabel("8E"), "Apt 8E");
  check("an already-labelled unit is left alone", formatAptLabel("Suite 300"), "Suite 300");
  check("...including the # form", formatAptLabel("#12"), "#12");
  // Three live rows say "None". Rendered as a prominent line, "Apt None" is
  // worse than no line at all.
  check("a placeholder is not an apartment", formatAptLabel("None"), null);
  check("...nor is an empty column", formatAptLabel(""), null);
  // And three say this. It is access instruction, not a unit number; prefixing
  // it with "Apt" would read as gibberish, so it is printed as written.
  check(
    "free text is printed as written",
    formatAptLabel("Door C (locks after 6pm)"),
    "Door C (locks after 6pm)"
  );
  // The placeholder rule reaches the shared one-liner too — it has been going
  // out on invoices as "…, None, Montréal".
  check(
    "the shared address line drops placeholders as well",
    formatAddressLine({ address: "4820 Sherbrooke", aptNumber: "None", city: "Montréal" }),
    "4820 Sherbrooke, Montréal"
  );
  // ...but NOT the dedup key. Two rows are two rows.
  ok(
    "the de-duplication key is deliberately not normalised",
    normalizeAddressKey("4820 Sherbrooke", "None") !==
      normalizeAddressKey("4820 Sherbrooke", null)
  );
});

section(7, "step 5A.3 — Copy takes the apartment, the map links don't", () => {
  const parts = {
    address: "5550 Chemin de la Côte Saint Luc, Montreal, QC, Canada",
    aptNumber: "23",
    city: null,
    postalCode: null,
  };
  // The PDF is explicit that the copied address includes the unit.
  check(
    "Copy includes the apartment, labelled",
    formatAddressCopy(parts),
    "5550 Chemin de la Côte Saint Luc, Montreal, QC, Canada, Apt 23"
  );
  // ...and equally explicit that the navigation query is the address "when
  // possible" — a unit in a geocoder query is what makes it miss the building.
  check(
    "the map query leaves the apartment out",
    formatAddressQuery(parts),
    "5550 Chemin de la Côte Saint Luc, Montreal, QC, Canada"
  );
  check(
    "the map query still carries city and postal code",
    formatAddressQuery({
      address: "4820 Rue Sherbrooke",
      aptNumber: "12B",
      city: "Montréal",
      postalCode: "H3Z 1H2",
    }),
    "4820 Rue Sherbrooke, Montréal H3Z 1H2"
  );

  // The component contract itself: one raw string in was the bug.
  const MAPLINKS = "src/app/cleaners/my-jobs/[jobId]/MapLinksClient.tsx";
  lacksInCode("MapLinks no longer takes one raw address string", MAPLINKS, "{ address }: { address: string }");
  has("MapLinks takes structured props", MAPLINKS, "street,\n  apt,\n  city,\n  postalCode,");
  has("...and builds the clipboard text from them", MAPLINKS, "formatAddressCopy(parts)");
  has("...and the deep-link query separately", MAPLINKS, "formatAddressQuery(parts)");
  const PAGE = "src/app/cleaners/my-jobs/[jobId]/page.tsx";
  lacksInCode("the job page no longer passes the raw location to MapLinks", PAGE, "<MapLinks address={job.location} />");
});

section(7, "steps 5A.2 / 5A.4 — the apartment is on the screen, not at the end of a line", () => {
  const PAGE = "src/app/cleaners/my-jobs/[jobId]/page.tsx";
  has("the job page resolves the address once", PAGE, "const address = resolveAddressParts({");
  has("...and renders the apartment as its own line", PAGE, '<div className="cl-jd-apt">');
  has("...above the map buttons", PAGE, "{address.aptLabel && (");
  // The street line must not ALSO end in the unit, or the fix just prints it
  // twice. `aptNumber: null` in the address-line call is what guarantees that.
  has("...with the street line carrying no unit", PAGE, "aptNumber: null,");

  const ROW = "src/app/cleaners/my-jobs/JobRow.tsx";
  has("the job card resolves the address too", ROW, "const address = resolveAddressParts({");
  has("...and gives the apartment its own row", ROW, '<span className="cl-jobs2-apt">{address.aptLabel}</span>');
  // Its own row for a reason: `.txt` is clamped to two lines, so a unit at the
  // tail of a long address is not merely easy to miss, it is cut off.
  has("...rather than appending it to the clamped address text", ROW, "<span className=\"txt\">{address.street}</span>");

  const CSS = "src/app/globals.css";
  has("the hero apartment line is styled", CSS, ".cl-jd-apt {");
  has("...and the card's", CSS, ".cl-jobs2-apt {");
});

section(7, "step 5A.5 — the apt backfill exists and is dry-run by default", () => {
  const path = "scripts/backfillJobAptNumbers.ts";
  const exists = fs.existsSync(path);
  ok("data script exists: backfillJobAptNumbers.ts", exists);
  if (!exists) return;
  const src = codeOf(path);
  ok("it is a dry run unless --commit is passed", src.includes('process.argv.includes("--commit")'));
  ok("...and returns before writing when it isn't", /if\s*\(!commit\)\s*\{[\s\S]*?return;/.test(src));
  // It runs the app's own rule rather than carrying a second copy of it, so a
  // shape the screen refuses to split is a shape the backfill refuses to write.
  ok("it splits with the same helper the screens use", src.includes("splitAptFromLocation"));
  ok("it records the change as a job log", src.includes('action: "UPDATED"'));
  // The safety property of this script: it FILLS a blank. It never rewrites
  // `location`, so undoing it is setting one column back to null.
  const updates = [...src.matchAll(/db\.job\.update\(\{[\s\S]*?data:\s*(\{[^}]*\})/g)].map((m) =>
    m[1].replace(/\s+/g, " ").trim()
  );
  check("it writes the aptNumber column and nothing else", updates, [
    "{ aptNumber: split.apt }",
  ]);
  ok(
    "it never overwrites an apartment somebody already typed",
    src.includes("{ aptNumber: null }") && src.includes('{ aptNumber: "" }')
  );
});

// ═══════════════════════════════════════════════════════════════════════════
// Stage 5B — fix 8: the mobile job form must always reach Save
// ═══════════════════════════════════════════════════════════════════════════

section(8, "steps 5B.1 / 5B.2 — the modal fits the phone, and the footer stays put", () => {
  const MODAL = "src/app/admin/jobs/JobModal.tsx";
  const CSS = "src/app/globals.css";

  // The measurement that caused IMG-6: 95vh of card inside a 1rem-padded
  // overlay, on a viewport `vh` over-reports.
  lacksInCode("the 95vh cap is gone", MODAL, "max-h-[95vh]");
  has("the card is capped against the dynamic viewport", CSS, "max-height: var(--job-modal-max, calc(100dvh - 2rem));");
  has("...with a vh fallback for browsers without dvh", CSS, "max-height: calc(100vh - 2rem);");
  // dvh alone is not enough on iOS: a fixed overlay is laid out against the
  // LAYOUT viewport, which the keyboard does not shrink.
  has("the modal measures the visual viewport", MODAL, "window.visualViewport");
  has("...writing the height the card may take", MODAL, '"--job-modal-max"');
  has("...and the keyboard's height", MODAL, '"--job-modal-kb"');
  has("the overlay is lifted by the keyboard", CSS, "calc(1rem + var(--job-modal-kb, 0px))");

  // The structure: a flex column whose body scrolls and whose footer does not.
  has("the card is a flex column", CSS, ".job-modal-card {");
  has("the body is the part that scrolls", CSS, ".job-modal-scroll {");
  // Anchored to the rule itself rather than grepped loose: `background: #fff`
  // appears three dozen times in this stylesheet, and a check that passes on
  // any of them is a check that would survive the footer going transparent.
  has(
    "the footer is stuck to the bottom of it, over a solid background",
    CSS,
    ".job-modal-foot {\n  position: sticky;\n  bottom: 0;\n  z-index: 2;\n  background: #fff;"
  );
  has("...and clear of the home indicator", CSS, "calc(0.875rem + env(safe-area-inset-bottom))");
  has("the modal uses those classes", MODAL, '"job-modal-overlay fixed inset-0 z-[1000]');
  has("...on the card", MODAL, '"job-modal-card relative z-[1001]');
  has("...on the scroller", MODAL, '"job-modal-scroll w-full"');
  // No `w-full` alongside it: the bar spans the card via negative side margins,
  // and `width: 100%` would pin it to the PADDED width — 48px narrow and 24px
  // left of the card. Measured in a browser, so pinned here.
  has("...and on the action row", MODAL, '<div className="job-modal-foot">');

  // The scroller's bottom padding is gone from the wrapper on purpose: with it,
  // the sticky footer un-sticks that far above the bottom at full scroll.
  lacksInCode("the body no longer pads below the sticky footer", MODAL, "py-6 md:py-8");
});

section(8, "step 5B.3 — Delete is never the last thing you can reach", () => {
  const MODAL = read("src/app/admin/jobs/JobModal.tsx");
  const del = MODAL.indexOf("Delete Job");
  const foot = MODAL.indexOf("job-modal-foot");
  const save = MODAL.indexOf('{mode === "create" ? "Create Job" : "Update Job"}');
  ok("Delete Job is still offered", del > 0);
  ok("...inside the scrolling body, above the footer", del < foot);
  ok("...and the primary action is inside the footer", save > foot);
  // The confirmation moved with the button. It used to render at the top of
  // the modal: on a phone you tapped Delete, the button vanished, and the
  // question was two screens up.
  ok(
    "the confirmation renders where the button is",
    /showDeleteConfirm \? \([\s\S]{0,400}Archive this job\?/.test(MODAL)
  );
  // Both halves of the guard now live INSIDE the <form>, where the shared
  // Button component defaults to type="submit". Without these, tapping Cancel
  // on a delete confirmation would save the job.
  const confirmBlock = MODAL.slice(MODAL.indexOf("Archive this job?"));
  ok(
    "the confirmation's Cancel cannot submit the form",
    /type="button"[\s\S]{0,300}Cancel\n/.test(confirmBlock)
  );
  ok(
    "...and neither can Confirm Delete",
    /type="button"[\s\S]{0,300}onClick=\{handleDelete\}/.test(confirmBlock)
  );
  // The submit error moved into the footer for the same reason the button did:
  // an error at the end of the body would now be the one thing off-screen.
  ok(
    "the submit error travels with the submit button",
    MODAL.indexOf("{globalError && (") > foot
  );
});

section(8, "step 5B.4 — the non-modal job form", () => {
  const NEW = "src/app/admin/jobs/new/page.tsx";
  // This page never had the modal's bug — its action bar is already
  // `fixed bottom-0`. It shared the bottom EDGE: no safe-area inset, so on a
  // notched phone the bar sat under the home-indicator strip.
  has("its action bar is fixed to the viewport", NEW, 'className="fixed bottom-0 left-0 right-0 md:left-[240px] z-40"');
  has("...and clears the home indicator", NEW, 'padding: "14px 32px calc(14px + env(safe-area-inset-bottom))"');
  has("...with the form's clearance growing by the same amount", NEW, 'paddingBottom: "calc(6rem + env(safe-area-inset-bottom))"');
});

// ═══════════════════════════════════════════════════════════════════════════
// Stage 6 — what the cross-cutting click-through found
// ═══════════════════════════════════════════════════════════════════════════
//
// Three defects that no check in this file could have caught, because each one
// is two surfaces DISAGREEING and every check above tests one surface at a
// time. They were found by opening the pages side by side in the running app
// (the standing rule: the verify scripts are largely source greps — click the
// real app). The checks below are the greps that keep them fixed.

section(1, "stage 6 — Analytics counted 'completed' its own way", () => {
  const AN = "src/app/admin/analytics/page.tsx";
  // Measured in the browser on live data, before the fix:
  //   Dashboard      TOTAL JOBS 198 · 27 completed   PENDING PAYMENT 24
  //   Jobs page      Completed tab 27
  //   Analytics      TOTAL JOBS 198 · 29 completed   PENDING PAYMENTS 26
  // 29 and 26 are the PRE-GUARD numbers — the same two mis-stamped Aug 19 rows
  // (#2066 David Hinchey, #2064 Group Mercer) that IMG-1 is a screenshot of.
  // Stage 3A had rewired this page's `total`, `completionRate` and `onHold`,
  // but its `completedJobs` set was still a bare status test, and everything
  // downstream reduces over that set.
  lacksInCode(
    "analytics no longer defines 'completed' as a bare status test",
    AN,
    '(j) => j.status === "COMPLETED" || j.status === "PAID"'
  );
  has("...the stat set is the guarded predicate", AN, "const completedJobs = jobs.filter((j) => isCompletedJob(j, now));");
  has("...so is the per-employee performance table", AN, "const completedEmpJobs = empJobs.filter((j) => isCompletedJob(j, now));");
  // This last one WRITES. An unguarded predicate here minted a real "Overdue
  // payment" alert row for work nobody has done yet.
  has("...and so is the overdue-payment alert pass, which writes", AN, "isCompletedJob(j, now) &&");
  has("...imported from the one module that owns the definition", AN, "  isCompletedJob,");

  // Behaviour, not spelling: the predicate the page now calls really does
  // reject IMG-1's rows while accepting genuinely finished work. Shaped
  // exactly like the two live rows — stamped COMPLETED, dated tomorrow, never
  // clocked out.
  const imgOne = job({ id: "img1", status: "COMPLETED", startTime: TOMORROW });
  const yesterdayRow = job({ id: "y", status: "COMPLETED", startTime: YESTERDAY });
  const finishedEarly = job({ id: "e", status: "COMPLETED", startTime: LATER_TODAY, clockOutTime: NOW });
  check("IMG-1's row is not completed", isCompletedJob(imgOne, NOW), false);
  check("...yesterday's identical row is", isCompletedJob(yesterdayRow, NOW), true);
  check("...and a job finished early still counts as done", isCompletedJob(finishedEarly, NOW), true);
});

section(2, "stage 6 — the employee profile listed one job twice", () => {
  // Annabel Karim's profile showed the Aug 19 David Hinchey job under BOTH
  // "Upcoming Jobs" and "Recent Jobs (completed in last 30 days)". The source
  // side is pinned up in the fix-2 section (the profile now composes
  // `doneJobsWhere`); this is the behaviour that made it a duplicate, run
  // through the same two fragments the two panels use.
  const hinchey = job({ id: "img3", status: "COMPLETED", startTime: TOMORROW });
  const inUpcoming = matchesWhere(hinchey, upcomingFilter(NOW) as Record<string, unknown>);
  const inDone = matchesWhere(hinchey, doneFilter(NOW) as Record<string, unknown>);
  check("IMG-3's job is upcoming", inUpcoming, true);
  check("...and is NOT also done", inDone, false);
  check("...i.e. it appears in exactly one panel", [inUpcoming, inDone].filter(Boolean).length, 1);
  // The mirror case, so the guard cannot be "nothing is ever done": the same
  // job once its day has arrived and the crew has clocked out.
  const worked = job({ id: "worked", status: "COMPLETED", startTime: YESTERDAY, clockOutTime: YESTERDAY });
  check("a job actually worked yesterday is done", matchesWhere(worked, doneFilter(NOW) as Record<string, unknown>), true);
  check("...and is not also upcoming", matchesWhere(worked, upcomingFilter(NOW) as Record<string, unknown>), false);
});

section(6, "stage 6 — the drawer asked to charge a card before it said 'on hold'", () => {
  // The block's own comment said it "sits at the TOP of the admin action set,
  // above the payment line, because a held booking has not been agreed yet —
  // charging a card for it is not the next thing anyone should be doing." It
  // was written second and rendered second, so the drawer for job #2273
  // (Sembly Montreal, $195.46, on hold) read "$195.46 due · Mark paid" and
  // only then "On hold · Pending admin review · Release". Order restored, and
  // pinned by position rather than by presence — presence was never the
  // problem.
  const CJA = "src/components/calendar/CalendarJobActions.tsx";
  const src = read(CJA);
  const holdBlock = src.indexOf("{onHold && summary ? (");
  const payLine = src.indexOf("{!paid && !cancelled && summary ? (");
  ok("the drawer renders a hold notice", holdBlock > -1);
  ok("...and a payment line", payLine > -1);
  ok("...with the hold above the charge affordance", holdBlock < payLine);
  has("...naming the reason, not just the state", CJA, "{holdReasonText(summary.holdReason)}");
});

// ═══════════════════════════════════════════════════════════════════════════
// Completeness guard
// ═══════════════════════════════════════════════════════════════════════════
//
// Reads the TODO's "8 fixes at a glance" table and proves that every fix marked
// done there has at least one section here. A stage cannot be ticked off
// without its checks being written.
{
  console.log("\n── Completeness ──");
  const TODO = "_ai_context/TODO.md";
  const todoPath = fs.existsSync(TODO) ? TODO : `../${TODO}`;
  if (!fs.existsSync(todoPath)) {
    console.log("NOTE  TODO.md not found from this cwd — skipping the coverage cross-check");
  } else {
    const todo = read(todoPath);
    // A stage heading is marked done when its "Done when (acceptance)" boxes
    // are all ticked. Cheaper and more robust: a fix is claimed done when its
    // stage heading carries no unticked `- [ ]` between it and the next stage.
    const stages = [...todo.matchAll(/^## Stage (\d+[AB]?)[^\n]*$/gm)];
    const doneFixes: number[] = [];
    for (const [i, m] of stages.entries()) {
      const body = todo.slice(m.index!, stages[i + 1]?.index ?? todo.length);
      if (body.includes("- [ ]")) continue; // still open
      for (const f of body.matchAll(/Fix (\d)\b/g)) doneFixes.push(Number(f[1]));
    }
    const uncovered = [...new Set(doneFixes)].filter((n) => !covered.has(n));
    check("every fix whose stage is fully ticked has checks here", uncovered, []);
  }
  const numbers = [...covered];
  check(
    "every section() names one of this round's 8 fixes",
    numbers.filter((n) => !Number.isInteger(n) || n < 1 || n > 8),
    []
  );
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
