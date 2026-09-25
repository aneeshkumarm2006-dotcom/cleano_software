/**
 * Round 4, fixes 4 + 5 — re-settle hourly jobs under the new rules.
 *
 *   npx tsx --conditions=react-server scripts/recomputeHourlyJobs.ts           # dry-run (default)
 *   npx tsx --conditions=react-server scripts/recomputeHourlyJobs.ts --commit  # apply
 *
 * ⚠️ THE `--conditions=react-server` FLAG IS NOT OPTIONAL. This script drives the
 * same two server helpers the app uses, and those carry `import "server-only"`,
 * whose default export throws under plain node. `npm run verify` passes the flag
 * for the same reason (see scripts/run-verify.ts). Run without it and you get a
 * pointed message rather than a stack trace.
 *
 * ## Why a script at all
 *
 * Both fixes change a RULE, not just code, so rows already in the database were
 * settled under the old one:
 *
 *   fix 4  `billedActualHours` was the UNION of the crew's time. It is now the
 *          SUM. A two-person hourly job measured 3h and is really 6 crew hours,
 *          so the customer was billed half. (`awerfixesaug18.pdf` p4.)
 *   fix 5  an HOURLY job's `employeePay` was computed ONCE at save time from the
 *          SCHEDULED window and never revisited, so the crew was paid for hours
 *          nobody worked — in either direction.
 *
 * Code alone heals neither: the billing snapshot only re-runs when someone
 * touches the clock again, and the pay snapshot only runs at clock-out.
 *
 * ## What it changes
 *
 * SECTION A (fix 4) — jobs with `billingType = HOURLY`, not archived, with at
 * least one work session. Each goes through `snapshotBilledActualHours`, which
 * re-measures from the sessions and re-prices. Its own guards apply and are the
 * point of routing through it rather than writing here:
 *   • a job whose customer has already PAID has its hours recorded and its money
 *     left alone — re-pricing a settled job would open a balance nobody agreed
 *     to. The dry run lists those separately so the difference is reviewable.
 *   • a FINAL_PRICE override still wins; the derived price is not written over it.
 *
 * SECTION B (fix 5) — jobs with `payType = HOURLY`, not archived, with at least
 * one work session and an `hourlyRate`. Each goes through
 * `snapshotHourlyEmployeePay`, which pays each cleaner their own clocked hours ×
 * the rate and stores the team total. Its guards:
 *   • `employeePayIsManual` is never touched — a stated figure is an order (D2);
 *   • a job inside a pay period that is pending approval, approved or paid is
 *     skipped, because those Payout rows are frozen and moving the job under
 *     them would make an approved payroll stop matching its jobs.
 *
 * A job can appear in both sections — the two hourly numbers are independent
 * (decision D6), and a job billed hourly may pay percentage and vice versa.
 *
 * ## Reversibility
 *
 * Section B writes a `JobLog` per change carrying the old and new figures, so
 * the exact set of rows can be read back out. Section A's hours are a
 * MEASUREMENT — re-running the script (or any clock edit) recomputes them from
 * the sessions, which are untouched, so it is idempotent rather than reversible:
 * nothing is lost that the sessions cannot re-derive. The dry run below is the
 * record of what the money was before.
 */
import { PrismaClient } from "@prisma/client";
import { billableActualHours, hourlyServiceAmount } from "../src/lib/hourly-billing";
import { computeJobPayShares, type JobPayInput } from "../src/lib/cleaner-earnings";
import { refuseOnMultiTenant } from "./_scope";

const db = new PrismaClient();
const commit = process.argv.includes("--commit");

const money = (v: number | null | undefined) => `$${(v ?? 0).toFixed(2)}`;
const hrs = (v: number | null | undefined) =>
  v == null ? "—" : `${String(Math.round(v * 100) / 100)}h`;
const delta = (before: number | null, after: number) =>
  before != null && Math.abs(before - after) < 0.005 ? "" : "  ← CHANGES";

function heading(title: string) {
  console.log(`\n${"─".repeat(74)}\n${title}\n${"─".repeat(74)}`);
}

/**
 * The two write helpers, loaded late so a missing `--conditions=react-server`
 * produces an instruction instead of `server-only`'s stack trace.
 */
async function loadWriters() {
  // Written when there was one company; its queries do not name one.
  await refuseOnMultiTenant(db, "recomputeHourlyJobs.ts");

  try {
    const [billing, pay, rates] = await Promise.all([
      import("../src/lib/hourly-billing.server"),
      import("../src/lib/hourly-pay.server"),
      import("../src/lib/cleaner-rates"),
    ]);
    return {
      snapshotBilledActualHours: billing.snapshotBilledActualHours,
      snapshotHourlyEmployeePay: pay.snapshotHourlyEmployeePay,
      getCleanerRateInputs: rates.getCleanerRateInputs,
    };
  } catch (e) {
    console.error(
      "\nThis script needs Node's `react-server` condition, because the helpers " +
        "it drives are server-only modules.\n\nRun it as:\n" +
        "  npx tsx --conditions=react-server scripts/recomputeHourlyJobs.ts\n"
    );
    throw e;
  }
}

async function main() {
  const writers = await loadWriters();
  console.log(
    `recomputeHourlyJobs — ${commit ? "COMMIT" : "DRY RUN"}  (now = ${new Date().toISOString()})`
  );

  // ── Section A · fix 4 — customer billing, total crew hours ────────────────
  heading("A · Customer billing (fix 4) — billedActualHours = TOTAL CREW HOURS");

  const billed = await db.job.findMany({
    where: {
      deletedAt: null,
      billingType: "HOURLY",
      workSessions: { some: {} },
    },
    select: {
      id: true,
      jobNumber: true,
      clientName: true,
      status: true,
      pricingMode: true,
      price: true,
      totalAmount: true,
      paymentReceived: true,
      stripePaymentIntentId: true,
      billingType: true,
      billedHourlyRate: true,
      billedEstimatedHours: true,
      billedActualHours: true,
      workSessions: { select: { cleanerId: true, startedAt: true, endedAt: true } },
      breaks: { select: { cleanerId: true, startedAt: true, endedAt: true } },
    },
    orderBy: { startTime: "asc" },
  });

  const billedMoves: typeof billed = [];
  const billedSettled: typeof billed = [];
  for (const j of billed) {
    const nextHours = billableActualHours(j.workSessions, j.breaks);
    if (nextHours <= 0) continue;
    const changes =
      j.billedActualHours == null ||
      Math.abs(j.billedActualHours - nextHours) >= 0.005;
    if (!changes) continue;
    const settled = j.paymentReceived || j.stripePaymentIntentId != null;
    (settled ? billedSettled : billedMoves).push(j);

    const before = hourlyServiceAmount(j);
    const after = hourlyServiceAmount({ ...j, billedActualHours: nextHours });
    const crew = new Set(j.workSessions.map((s) => s.cleanerId)).size;
    console.log(
      `  #${j.jobNumber}  ${j.clientName}` +
        `\n      hours ${hrs(j.billedActualHours)} → ${hrs(nextHours)}   (${crew} cleaner${crew === 1 ? "" : "s"} clocked)` +
        `\n      service total ${money(before)} → ${money(after)}` +
        (j.pricingMode === "FINAL_PRICE"
          ? "   [FINAL_PRICE override — the total is NOT re-derived]"
          : "") +
        (settled
          ? "\n      ⚠ already paid — hours are recorded, money is left alone"
          : "") +
        `\n      id=${j.id}`
    );
  }
  console.log(
    `\n  ${billed.length} hourly-billed job(s) with sessions · ` +
      `${billedMoves.length} to re-price · ${billedSettled.length} settled (hours only) · ` +
      `${billed.length - billedMoves.length - billedSettled.length} already correct`
  );

  // ── Section B · fix 5 — cleaner pay, from the clock ───────────────────────
  heading("B · Cleaner pay (fix 5) — employeePay = each cleaner's clocked hours × rate");

  const paid = await db.job.findMany({
    where: {
      deletedAt: null,
      payType: "HOURLY",
      hourlyRate: { not: null },
      workSessions: { some: {} },
    },
    select: {
      id: true,
      jobNumber: true,
      clientName: true,
      status: true,
      jobDate: true,
      startTime: true,
      endTime: true,
      clockInTime: true,
      clockOutTime: true,
      employeeId: true,
      employeePay: true,
      employeePayIsManual: true,
      payType: true,
      hourlyRate: true,
      price: true,
      totalTip: true,
      parking: true,
      bookingSource: true,
      pricingMode: true,
      subtotalAmount: true,
      discountAmount: true,
      billingType: true,
      billedHourlyRate: true,
      billedEstimatedHours: true,
      billedActualHours: true,
      addOns: { select: { name: true, price: true, quantity: true } },
      cleaners: { select: { id: true, name: true } },
      assignments: { select: { cleanerId: true, payAmount: true } },
      workSessions: { select: { cleanerId: true, startedAt: true, endedAt: true } },
      breaks: { select: { cleanerId: true, startedAt: true, endedAt: true } },
    },
    orderBy: { startTime: "asc" },
  });

  const rates = await writers.getCleanerRateInputs(
    paid.flatMap((j) => [j.employeeId, ...j.cleaners.map((c) => c.id)])
  );
  const nameById = new Map(paid.flatMap((j) => j.cleaners.map((c) => [c.id, c.name])));

  const payMoves: typeof paid = [];
  const payManual: typeof paid = [];
  for (const j of paid) {
    if (j.employeePayIsManual) {
      payManual.push(j);
      continue;
    }
    const shares = computeJobPayShares(j as unknown as JobPayInput, rates);
    if (shares.size === 0) continue;
    let next = 0;
    for (const s of shares.values()) next += s.base;
    next = Math.round(next * 100) / 100;
    if (j.employeePay != null && Math.abs(j.employeePay - next) < 0.005) continue;
    payMoves.push(j);

    console.log(
      `  #${j.jobNumber}  ${j.clientName}` +
        `\n      team pay ${money(j.employeePay)} → ${money(next)}   ` +
        `(rate ${money(j.hourlyRate)}/h)${delta(j.employeePay, next)}`
    );
    for (const [id, s] of shares) {
      console.log(
        `        ${(nameById.get(id) ?? id).padEnd(24)} ${money(s.base).padStart(9)}   ${s.basisLabel}`
      );
    }
    console.log(`      id=${j.id}`);
  }
  console.log(
    `\n  ${paid.length} hourly-paid job(s) with sessions and a rate · ` +
      `${payMoves.length} to recompute · ${payManual.length} manual (left alone) · ` +
      `${paid.length - payMoves.length - payManual.length} already correct`
  );

  if (!commit) {
    console.log(
      "\nDry run — nothing written. Re-run with --commit to apply.\n" +
        "Section B also refuses any job whose date sits in a pay period that is " +
        "pending approval, approved or paid; those are reported as skipped when it runs."
    );
    return;
  }

  // ── Apply ─────────────────────────────────────────────────────────────────
  heading("Committing");
  let repriced = 0;
  let hoursOnly = 0;
  for (const j of [...billedMoves, ...billedSettled]) {
    const r = await writers.snapshotBilledActualHours(j.id);
    if (r.reason === "SETTLED") hoursOnly++;
    else if (r.changed) repriced++;
  }
  console.log(
    `  fix 4: ${repriced} job(s) re-priced, ${hoursOnly} settled job(s) had hours recorded only.`
  );

  let repaid = 0;
  const lockedOut: string[] = [];
  for (const j of payMoves) {
    const r = await writers.snapshotHourlyEmployeePay(j.id);
    if (r.changed) repaid++;
    else if (r.reason === "PAYROLL_LOCKED") {
      lockedOut.push(`#${j.jobNumber} (${r.payPeriodStatus?.toLowerCase()})`);
    }
  }
  console.log(`  fix 5: ${repaid} job(s) repaid from the clock, each with a JobLog entry.`);
  if (lockedOut.length) {
    console.log(
      `  fix 5: ${lockedOut.length} skipped — payroll already closed on their date: ${lockedOut.join(", ")}.` +
        `\n         Adjust those on the pay period itself if the new figure should apply.`
    );
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
