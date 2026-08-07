/**
 * Fix 1 (TODO 1.h) — READ-ONLY old-vs-new payout comparison, for owner sign-off.
 *
 * Stage 1 changes how every payout is computed:
 *
 *   OLD  PERCENTAGE                  standardRateForRating(all-time avg) x price,
 *                                    THEN x Job.payRateMultiplier
 *   OLD  override / FLAT / HOURLY    ALSO x Job.payRateMultiplier
 *   NEW  PERCENTAGE                  (tier base x the cleaner's rating multiplier) x price
 *   NEW  override / FLAT / HOURLY    paid through untouched
 *
 * This replays the last completed pay period under BOTH models and prints a
 * per-job delta table plus per-cleaner totals, so the owner can sign the
 * difference off BEFORE payroll runs on the new math.
 *
 * Every query here is a read. Nothing writes, and nothing may be added that
 * does — scripts/verify-awer-fixes-3.ts asserts it mechanically.
 *
 *   npx tsx scripts/probe-pay-multiplier-delta.ts
 */
import { PrismaClient } from "@prisma/client";
import {
  JOB_PAY_SELECT,
  PAYABLE_JOB_STATUSES,
  computeJobPayShares,
  jobParticipantIds,
  type JobPayInput,
} from "../src/lib/cleaner-earnings";
import {
  FIELD_LEAD_RATE,
  STANDARD_FLOOR_RATE,
  STANDARD_RATINGS_REQUIRED,
  TRAINEE_RATE,
  // Deprecated ON PURPOSE. This is the one legitimate importer left: the
  // comparison needs the retired ladder to reproduce the OLD number. Every
  // other import of it would be a bug, which is why 1.c kept the export.
  standardRateForRating,
  type CleanerRateInput,
  type CleanerTier,
} from "../src/lib/pay-tiers";
import {
  DEFAULT_RATING_MULTIPLIERS,
  effectiveMultiplier,
  type RatingMultiplierMap,
} from "../src/lib/pay-multiplier";
import {
  formatPayPeriodRange,
  previousPayPeriodRange,
} from "../src/lib/pay-period";

const db = new PrismaClient();

const r2 = (n: number) => Math.round(n * 100) / 100;
const usd = (n: number) => `${n < 0 ? "-" : ""}$${Math.abs(n).toFixed(2)}`;
const signed = (n: number) => `${n >= 0 ? "+" : "-"}$${Math.abs(n).toFixed(2)}`;
/** The dot-leader shape probe-awer-fixes-3.ts prints by hand. */
const dot = (label: string, value: string | number, width = 44) =>
  console.log(`  ${label} ${".".repeat(Math.max(3, width - label.length))} ${value}`);

/** The pre-Stage-1 rate: the hardcoded 40-45% ladder, no settings map. */
function oldRate(c: CleanerRateInput): number {
  if (c.tier === "TRAINEE") return TRAINEE_RATE;
  if (c.tier === "FIELD_LEAD") return FIELD_LEAD_RATE;
  if (c.ratingCount < STANDARD_RATINGS_REQUIRED || c.avgRating == null) {
    return STANDARD_FLOOR_RATE;
  }
  return standardRateForRating(c.avgRating);
}

/**
 * computeJobPayShares EXACTLY as it stood before Stage 1, frozen here so the
 * comparison survives the code change. Mirrors the pre-fix revision including
 * the bug 1.d removes: the per-job factor was applied to manual overrides and
 * FLAT/HOURLY amounts too.
 */
function oldJobPayShares(
  job: JobPayInput & { payRateMultiplier: number | null },
  rates: Map<string, CleanerRateInput>
): Map<string, number> {
  const ids = jobParticipantIds(job, rates);
  const out = new Map<string, number>();
  if (ids.length === 0) return out;

  const factor = job.payRateMultiplier ?? 1;
  const tipShare = (job.totalTip || 0) / ids.length;
  const payType = job.payType ?? "PERCENTAGE";
  const price = job.price ?? 0;
  const teamTotal = job.employeePay || 0;

  const overrideById = new Map<string, number>();
  for (const a of job.assignments ?? []) {
    if (a.payAmount != null && ids.includes(a.cleanerId)) {
      overrideById.set(a.cleanerId, a.payAmount);
    }
  }
  const overridden = ids.filter((id) => overrideById.has(id));
  const remaining = ids.length - overridden.length;
  const overriddenSum = overridden.reduce(
    (s, id) => s + (overrideById.get(id) ?? 0),
    0
  );
  const perPerson =
    remaining > 0 ? Math.max(0, teamTotal - overriddenSum) / remaining : 0;

  for (const id of ids) {
    const override = overrideById.get(id);
    let base: number;
    if (override != null) base = override;
    else if (payType === "FLAT" || payType === "HOURLY") base = perPerson;
    else if (price > 0) {
      const c = rates.get(id) ?? {
        id,
        tier: "STANDARD" as CleanerTier,
        avgRating: null,
        ratingCount: 0,
        multiplier: 1,
      };
      base = r2(price * oldRate(c));
    } else base = teamTotal / ids.length;
    out.set(id, r2(r2(base * factor) + r2(tipShare)));
  }
  return out;
}

async function main() {
  console.log("Fix 1 · old-vs-new payout comparison  (read-only)\n");

  // ── Which period ──────────────────────────────────────────────────────────
  const lastPeriod = await db.payPeriod.findFirst({
    where: { status: { not: "CANCELLED" }, endDate: { lt: new Date() } },
    orderBy: { endDate: "desc" },
    select: { id: true, startDate: true, endDate: true, status: true },
  });
  const range = lastPeriod
    ? { start: lastPeriod.startDate, end: lastPeriod.endDate }
    : previousPayPeriodRange(new Date());

  console.log("── Period under comparison ──");
  dot("window", formatPayPeriodRange(range));
  dot(
    "PayPeriod row",
    lastPeriod
      ? `${lastPeriod.id} (${lastPeriod.status})`
      : "none — using last calendar week"
  );

  // ── Jobs, selected exactly the way payroll selects them ───────────────────
  // (generatePayPeriodForWeek in src/lib/pay-period.server.ts) plus the
  // deprecated column, which 1.f removed from JOB_PAY_SELECT.
  const jobs = await db.job.findMany({
    where: {
      deletedAt: null,
      status: { in: [...PAYABLE_JOB_STATUSES] },
      OR: [
        { jobDate: { gte: range.start, lte: range.end } },
        {
          AND: [
            { jobDate: null },
            { startTime: { gte: range.start, lte: range.end } },
          ],
        },
      ],
    },
    select: {
      ...JOB_PAY_SELECT,
      jobNumber: true,
      clientName: true,
      payRateMultiplier: true,
    },
  });

  // ── Rate inputs, built locally ────────────────────────────────────────────
  // Deliberately NOT via getCleanerRateInputs: that routes through the `@/db`
  // singleton, a SECOND Prisma client this script's $disconnect never closes,
  // which leaves an open handle and hangs the process. Everything imported
  // above is pure logic that issues no query.
  const ids = Array.from(
    new Set(
      jobs
        .flatMap((j) => [j.employeeId, ...j.cleaners.map((c) => c.id)])
        .filter((v): v is string => !!v)
    )
  );
  const [users, grouped, setting] = await Promise.all([
    db.user.findMany({
      where: { id: { in: ids } },
      select: { id: true, name: true, cleanerTier: true, role: true },
    }),
    db.employeeRating.groupBy({
      by: ["employeeId"],
      where: { employeeId: { in: ids }, excludedAt: null },
      _avg: { rating: true },
      _count: { rating: true },
    }),
    // Key mirrors RATING_MULTIPLIER_SETTING_KEY in pay-multiplier-config.ts,
    // inlined for the same reason — that module imports the db singleton.
    db.appSetting.findUnique({ where: { key: "multipliers.ratings" } }),
  ]);

  const rawMap =
    setting && setting.value && typeof setting.value === "object"
      ? (setting.value as RatingMultiplierMap)
      : null;
  const map: RatingMultiplierMap = rawMap
    ? { ...DEFAULT_RATING_MULTIPLIERS, ...rawMap }
    : DEFAULT_RATING_MULTIPLIERS;

  const stats = new Map(
    grouped.map((g) => [
      g.employeeId,
      { avg: g._avg.rating, count: g._count.rating },
    ])
  );
  const nameById = new Map(users.map((u) => [u.id, u.name]));
  const rates = new Map<string, CleanerRateInput>();
  for (const u of users) {
    const s = stats.get(u.id);
    const avg = s?.avg ?? null;
    const count = s?.count ?? 0;
    rates.set(u.id, {
      id: u.id,
      tier: (u.cleanerTier as CleanerTier) ?? "STANDARD",
      avgRating: avg,
      ratingCount: count,
      multiplier: effectiveMultiplier(avg, count, map, STANDARD_RATINGS_REQUIRED),
      role: u.role ?? null,
    });
  }

  console.log("\n── Inputs ──");
  dot("jobs in the period", jobs.length);
  dot("distinct participants", ids.length);
  dot(
    "settings map source",
    setting ? "AppSetting `multipliers.ratings`" : "code defaults"
  );
  dot(
    "cleaners past the 5-rating gate",
    [...rates.values()].filter((c) => c.multiplier !== 1).length
  );

  // The live row may hold values written by the old blank-input bug. Harmless
  // while the map was display-only; not harmless now that it drives pay.
  if (rawMap) {
    const suspect = Object.entries(rawMap).filter(
      ([, v]) => typeof v !== "number" || !Number.isFinite(v) || v < 0.5 || v > 2
    );
    dot("stored map entries out of the 0.50-2.00 range", suspect.length);
    for (const [step, v] of suspect) {
      console.log(`      ${step}★ = ${JSON.stringify(v)}  ← sanitised to the default on read`);
    }
  }

  // ── Replay ────────────────────────────────────────────────────────────────
  const rows: Array<{
    jobNumber: string;
    client: string;
    payType: string;
    cleaner: string;
    old: number;
    nw: number;
    note: string;
  }> = [];
  const byCleaner = new Map<string, { old: number; nw: number }>();
  let jobsMoved = 0;
  let strayFactorJobs = 0;

  for (const j of jobs) {
    const input = j as unknown as JobPayInput & {
      payRateMultiplier: number | null;
    };
    const oldShares = oldJobPayShares(input, rates);
    const newShares = computeJobPayShares(input, rates);
    if (oldShares.size === 0 && newShares.size === 0) continue;

    const payType = (j.payType as string) ?? "PERCENTAGE";
    const factor = j.payRateMultiplier ?? 1;
    const manual = (j.assignments ?? []).some((a) => a.payAmount != null);
    // The bug 1.d fixes, made visible: a non-1.0 factor silently scaling a
    // manual/FLAT/HOURLY amount nobody intended to scale.
    if (factor !== 1 && (manual || payType !== "PERCENTAGE")) strayFactorJobs++;

    let jobMoved = false;
    const everyone = new Set([...oldShares.keys(), ...newShares.keys()]);
    for (const pid of everyone) {
      const o = oldShares.get(pid) ?? 0;
      const n = newShares.get(pid)?.total ?? 0;
      const acc = byCleaner.get(pid) ?? { old: 0, nw: 0 };
      acc.old += o;
      acc.nw += n;
      byCleaner.set(pid, acc);
      if (Math.abs(n - o) >= 0.01) {
        jobMoved = true;
        rows.push({
          jobNumber: String(j.jobNumber ?? j.id.slice(0, 8)),
          client: (j.clientName ?? "—").slice(0, 18),
          payType,
          cleaner: (nameById.get(pid) ?? pid.slice(0, 8)).slice(0, 18),
          old: o,
          nw: n,
          note: manual
            ? "manual override"
            : payType !== "PERCENTAGE"
              ? payType.toLowerCase()
              : factor !== 1
                ? `job factor was ${factor}`
                : `mult ${rates.get(pid)?.multiplier ?? 1}`,
        });
      }
    }
    if (jobMoved) jobsMoved++;
  }

  // ── Per-job deltas ────────────────────────────────────────────────────────
  console.log(`\n── Per-cleaner-per-job deltas (${rows.length} rows that move) ──`);
  if (rows.length === 0) {
    console.log("  (nothing moves — every payout in this period is identical)");
  } else {
    console.log(
      `  ${"job#".padEnd(8)}${"client".padEnd(20)}${"cleaner".padEnd(20)}` +
        `${"type".padEnd(12)}${"old".padStart(10)}${"new".padStart(10)}` +
        `${"delta".padStart(11)}   why`
    );
    for (const row of rows.sort((a, b) => b.nw - b.old - (a.nw - a.old))) {
      console.log(
        `  ${row.jobNumber.padEnd(8)}${row.client.padEnd(20)}${row.cleaner.padEnd(20)}` +
          `${row.payType.toLowerCase().padEnd(12)}${usd(row.old).padStart(10)}` +
          `${usd(row.nw).padStart(10)}${signed(row.nw - row.old).padStart(11)}   ${row.note}`
      );
    }
  }

  // ── Per-cleaner period totals ─────────────────────────────────────────────
  console.log("\n── Per-cleaner period totals ──");
  console.log(
    `  ${"cleaner".padEnd(24)}${"old".padStart(11)}${"new".padStart(11)}` +
      `${"delta".padStart(12)}${"%".padStart(9)}`
  );
  let totalOld = 0;
  let totalNew = 0;
  let cleanersMoved = 0;
  const sorted = [...byCleaner.entries()].sort(
    (a, b) => b[1].nw - b[1].old - (a[1].nw - a[1].old)
  );
  for (const [pid, v] of sorted) {
    totalOld += v.old;
    totalNew += v.nw;
    const d = v.nw - v.old;
    if (Math.abs(d) >= 0.01) cleanersMoved++;
    const pct = v.old > 0 ? `${((d / v.old) * 100).toFixed(1)}%` : "—";
    console.log(
      `  ${(nameById.get(pid) ?? pid.slice(0, 8)).slice(0, 23).padEnd(24)}` +
        `${usd(r2(v.old)).padStart(11)}${usd(r2(v.nw)).padStart(11)}` +
        `${signed(r2(d)).padStart(12)}${pct.padStart(9)}`
    );
  }

  // ── Sign-off summary ──────────────────────────────────────────────────────
  console.log("\n── Sign-off summary ──");
  dot("jobs replayed", jobs.length);
  dot("jobs whose payout moves", jobsMoved);
  dot("cleaners whose period total moves", cleanersMoved);
  dot("period labour cost OLD", usd(r2(totalOld)));
  dot("period labour cost NEW", usd(r2(totalNew)));
  dot(
    "net change",
    signed(r2(totalNew - totalOld)) +
      (totalOld > 0
        ? `  (${(((totalNew - totalOld) / totalOld) * 100).toFixed(1)}%)`
        : "")
  );
  dot("jobs where a stray job factor was scaling", "");
  dot("  a manual/FLAT/HOURLY amount (the 1.d bug)", strayFactorJobs);
  dot("rows that go DOWN (needs a second look)", rows.filter((r) => r.nw < r.old).length);

  // ── Forward look: what happens once cleaners cross the gate ───────────────
  // A "$0.00 net change" headline is only true TODAY. The multiplier is gated
  // behind STANDARD_RATINGS_REQUIRED ratings, so if nobody has reached it yet
  // the new model is dormant, not free. This projects each participant's
  // period pay at the multiplier they would earn on their CURRENT average once
  // the gate opens, which is the number the owner is actually signing off.
  console.log("\n── Forward look: pay once each cleaner reaches the gate ──");
  console.log(
    `  ${"cleaner".padEnd(24)}${"ratings".padStart(8)}${"avg".padStart(7)}` +
      `${"mult".padStart(8)}${"today".padStart(11)}${"at gate".padStart(11)}` +
      `${"delta".padStart(12)}`
  );
  let gatedOld = 0;
  let gatedNew = 0;
  for (const [pid, v] of sorted) {
    const c = rates.get(pid);
    if (!c) continue;
    // The multiplier this cleaner's CURRENT average would buy, gate ignored.
    const wouldBe =
      c.avgRating != null
        ? effectiveMultiplier(c.avgRating, STANDARD_RATINGS_REQUIRED, map)
        : 1;
    // Their percentage pay scales linearly with the rate, so the projection is
    // today's pay x (wouldBe / whatever they get now). Manual/FLAT/HOURLY pay
    // does not scale, so this is an UPPER bound for anyone with those jobs.
    const projected = v.nw * (wouldBe / (c.multiplier || 1));
    gatedOld += v.nw;
    gatedNew += projected;
    console.log(
      `  ${(nameById.get(pid) ?? pid.slice(0, 8)).slice(0, 23).padEnd(24)}` +
        `${String(c.ratingCount).padStart(8)}` +
        `${(c.avgRating != null ? c.avgRating.toFixed(2) : "—").padStart(7)}` +
        `${wouldBe.toFixed(2).padStart(8)}${usd(r2(v.nw)).padStart(11)}` +
        `${usd(r2(projected)).padStart(11)}${signed(r2(projected - v.nw)).padStart(12)}`
    );
  }
  dot("gate", `${STANDARD_RATINGS_REQUIRED} non-excluded ratings`);
  dot("participants already past it", [...rates.values()].filter((c) => c.ratingCount >= STANDARD_RATINGS_REQUIRED).length);
  dot("period labour cost if ALL were past it", usd(r2(gatedNew)));
  dot(
    "eventual net change (upper bound)",
    signed(r2(gatedNew - gatedOld)) +
      (gatedOld > 0
        ? `  (${(((gatedNew - gatedOld) / gatedOld) * 100).toFixed(1)}%)`
        : "")
  );

  // ── Reconcile against what was actually paid ──────────────────────────────
  if (lastPeriod) {
    const payouts = await db.payout.findMany({
      where: { payPeriodId: lastPeriod.id },
      select: { employeeId: true, baseAmount: true, finalAmount: true },
    });
    console.log("\n── Reconciliation vs the stored Payout rows ──");
    console.log("  NOTE: baseAmount also carries the Field Lead weekly bonus, which");
    console.log("        this replay does not compute — expect Field Leads to differ.");
    console.log(
      `  ${"cleaner".padEnd(24)}${"as paid".padStart(11)}${"replay OLD".padStart(12)}` +
        `${"replay NEW".padStart(12)}`
    );
    for (const p of payouts) {
      const v = byCleaner.get(p.employeeId) ?? { old: 0, nw: 0 };
      console.log(
        `  ${(nameById.get(p.employeeId) ?? p.employeeId.slice(0, 8)).slice(0, 23).padEnd(24)}` +
          `${usd(p.baseAmount).padStart(11)}${usd(r2(v.old)).padStart(12)}` +
          `${usd(r2(v.nw)).padStart(12)}`
      );
    }
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
