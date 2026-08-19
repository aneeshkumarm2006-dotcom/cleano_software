/**
 * Stage 0 — READ-ONLY baseline probes for the fourth AWER fixes round
 * (`_ai_context/awerfixesaug18.pdf`).
 *
 * Every query here is a read. Nothing writes, and nothing may be added to this
 * file that does: the numbers it prints are the blast-radius record the TODO
 * signs off against, so it must be safe to re-run against the live database at
 * any point in the round.
 *
 *   npx tsx scripts/probe-awer-fixes-4.ts
 *
 * Covers TODO steps 0.3 (fix 1 — future jobs reading Completed), 0.4 (fix 2 —
 * assigned job missing from the cleaner list) and 0.5 (fix 5 — hourly pay type
 * not sticking). The remaining Stage 0 steps are browser work.
 */
import { PrismaClient } from "@prisma/client";
import { startOfDayTz } from "../src/lib/time";
import { quoteSettledFilter, upcomingFilter } from "../src/lib/cleaner-jobs";
import { activeJobsWhere, jobStatusWhere } from "../src/lib/metrics";
import { ON_HOLD_STATUS } from "../src/lib/job-hold";
import { billableActualHours } from "../src/lib/hourly-billing";
import { crewActiveMinutesByCleaner } from "../src/lib/work-sessions";
import {
  formatAptLabel,
  normalizeApt,
  splitAptFromLocation,
} from "../src/lib/client-address";

const db = new PrismaClient();

const n = (v: bigint | number) => Number(v);
const money = (v: number | null | undefined) => `$${(v ?? 0).toFixed(2)}`;
const when = (d: Date | null | undefined) =>
  d ? new Date(d).toISOString().replace("T", " ").slice(0, 16) : "—";

function heading(title: string) {
  console.log(`\n${"─".repeat(70)}\n${title}\n${"─".repeat(70)}`);
}

async function main() {
  const now = new Date();
  const dayStart = startOfDayTz(now);
  console.log("Stage 0 — read-only probes  (no writes)");
  console.log(`now = ${now.toISOString()}   start-of-store-day = ${dayStart.toISOString()}`);

  // ── Fix 1 · future-dated jobs already stamped COMPLETED / PAID ────────────
  // This is IMG-1: the Completed tab is `status IN (COMPLETED, PAID)` with no
  // date guard, so every row below renders a green "Completed" pill and
  // increments the Completed stat while the job has not happened yet.
  heading("FIX 1 — jobs with a FUTURE startTime already stamped COMPLETED/PAID");

  const futureClosed = await db.job.findMany({
    where: {
      deletedAt: null,
      status: { in: ["COMPLETED", "PAID"] },
      startTime: { gte: dayStart },
    },
    select: {
      id: true,
      jobNumber: true,
      clientName: true,
      status: true,
      startTime: true,
      paymentReceived: true,
      paidAt: true,
      clockInTime: true,
      clockOutTime: true,
      bookingSource: true,
      price: true,
      employeeId: true,
      cleaners: { select: { id: true, name: true } },
    },
    orderBy: { startTime: "asc" },
  });

  console.log(`rows: ${futureClosed.length}`);
  for (const j of futureClosed) {
    console.log(
      `  #${j.jobNumber} ${j.id}  ${j.status.padEnd(9)} start=${when(j.startTime)}` +
        `  paid=${j.paymentReceived}  clockOut=${when(j.clockOutTime)}` +
        `  src=${j.bookingSource ?? "—"}  ${money(j.price)}  ${j.clientName}` +
        `  crew=[${j.cleaners.map((c) => c.name).join(", ") || "—"}]`
    );
  }

  // Split by the guard Stage 1 is about to add: a future job with NO clock-out
  // is unambiguously mis-stamped; one WITH a clock-out was genuinely worked
  // (early clock-out on a same-day job) and must be left alone.
  const misStamped = futureClosed.filter((j) => !j.clockOutTime);
  console.log(
    `\n  → mis-stamped (future, no clock-out): ${misStamped.length}` +
      `   |   genuinely worked (has clock-out): ${futureClosed.length - misStamped.length}`
  );

  // How they got there, by source: the import stamps PAID regardless of date.
  const bySource = new Map<string, number>();
  for (const j of misStamped) {
    const k = j.bookingSource ?? "(none)";
    bySource.set(k, (bySource.get(k) ?? 0) + 1);
  }
  console.log(
    `  → by bookingSource: ${
      [...bySource].map(([k, v]) => `${k}=${v}`).join("  ") || "—"
    }`
  );

  // What the Completed tab / dashboard count says today vs. what it should say.
  const completedTotal = await db.job.count({
    where: { deletedAt: null, status: { in: ["COMPLETED", "PAID"] } },
  });
  console.log(
    `\n  Completed tab count today: ${completedTotal}` +
      `   → after the date guard: ${completedTotal - misStamped.length}`
  );

  // ── Fix 2 · assigned future jobs missing from the cleaner's upcoming list ──
  // `upcomingFilter` excludes COMPLETED/CANCELLED and anything with a
  // clockOutTime, so a future job mis-stamped above vanishes from the cleaner
  // exactly as in IMG-3. Enumerate the victims.
  heading("FIX 2 — assigned FUTURE jobs hidden from their cleaner's upcoming list");

  const futureAssigned = await db.job.findMany({
    where: {
      deletedAt: null,
      startTime: { gte: dayStart },
      OR: [{ employeeId: { not: null } }, { cleaners: { some: {} } }],
    },
    select: {
      id: true,
      jobNumber: true,
      clientName: true,
      status: true,
      startTime: true,
      clockOutTime: true,
      quoteStatus: true,
      employeeId: true,
      cleaners: { select: { id: true, name: true } },
    },
    orderBy: { startTime: "asc" },
  });

  // Which of them SURVIVE the cleaner's real upcoming predicate?
  //
  // Step 2.5 asks for this to be re-run after the Stage 1 + 2 changes, so the
  // exclusion test runs the ACTUAL `upcomingFilter` / `quoteSettledFilter` in
  // the database rather than a hand-copy of their rules — a hand-copy would
  // keep reporting the old behaviour after the fix and quietly pass. The
  // per-job "excluded by" lines below stay hand-written: they explain WHY a row
  // failed, and only run for rows the real clause already rejected.
  const visibleIds = new Set(
    (
      await db.job.findMany({
        where: {
          AND: [
            { id: { in: futureAssigned.map((j) => j.id) } },
            upcomingFilter(now),
            quoteSettledFilter(),
          ],
        },
        select: { id: true },
      })
    ).map((j) => j.id)
  );
  const hidden = futureAssigned.filter((j) => !visibleIds.has(j.id));

  console.log(
    `future assigned jobs: ${futureAssigned.length}   hidden from upcoming: ${hidden.length}`
  );
  for (const j of hidden) {
    const reasons = [
      j.status === "CANCELLED" && "status=CANCELLED (the one allowed exclusion)",
      j.status === "COMPLETED" &&
        "status=COMPLETED — SHOULD NOT HAPPEN on a future job after Stage 2",
      j.clockOutTime && `clockOutTime=${when(j.clockOutTime)} (worked early)`,
      j.quoteStatus &&
        j.quoteStatus !== "ACCEPTED" &&
        `quoteStatus=${j.quoteStatus} (quoteSettledFilter)`,
    ].filter(Boolean);
    console.log(
      `  #${j.jobNumber} ${j.id}  ${when(j.startTime)}  ${j.clientName}` +
        `  crew=[${j.cleaners.map((c) => c.name).join(", ") || "—"}]` +
        `\n      excluded by: ${reasons.join(" · ") || "(no hand-written reason — investigate)"}`
    );
  }

  // Step 2.2's guarantee, stated as a pass/fail line: after the hardening, the
  // ONLY thing that may hide an assigned future job is a cancellation (or a
  // genuine early clock-out / an unsettled quote, neither of which is a status
  // question). Anything else here is a regression.
  const wronglyHidden = hidden.filter(
    (j) =>
      j.status !== "CANCELLED" &&
      j.clockOutTime === null &&
      (j.quoteStatus === null || j.quoteStatus === "ACCEPTED")
  );
  console.log(
    `\n  → 2.2 guarantee — future assigned jobs hidden for any reason other than ` +
      `CANCELLED/clock-out/unsettled quote: ${wronglyHidden.length} ` +
      `${wronglyHidden.length === 0 ? "✓ PASS" : "✗ FAIL"}`
  );
  // PAID is NOT in CLEANER_CLOSED_STATUSES, so a future PAID job still reaches
  // the cleaner — worth stating so the diagnosis doesn't over-claim.
  const futurePaidVisible = futureAssigned.filter(
    (j) => j.status === "PAID" && !j.clockOutTime
  );
  console.log(
    `  (note: ${futurePaidVisible.length} future PAID assigned job(s) are still VISIBLE — ` +
      `PAID is not a CLEANER_CLOSED_STATUS)`
  );

  // ── Fix 2 · IMG-3's named pair, if it is in this database ─────────────────
  heading('FIX 2 — IMG-2/IMG-3 pair: "David Hinchey" job + cleaner "Annabel"');

  const hinchey = await db.job.findMany({
    where: { deletedAt: null, clientName: { contains: "Hinchey", mode: "insensitive" } },
    select: {
      id: true,
      jobNumber: true,
      clientName: true,
      status: true,
      startTime: true,
      clockInTime: true,
      clockOutTime: true,
      deletedAt: true,
      quoteStatus: true,
      employeeId: true,
      paymentReceived: true,
      cleaners: { select: { id: true, name: true } },
      assignments: { select: { id: true, cleanerId: true, onMyWayAt: true, payAmount: true } },
      logs: {
        select: { action: true, field: true, oldValue: true, newValue: true, description: true, createdAt: true },
        orderBy: { createdAt: "asc" },
      },
    },
    orderBy: { startTime: "desc" },
    take: 10,
  });
  if (hinchey.length === 0) console.log("  no matching job in this database");
  for (const j of hinchey) {
    console.log(
      `  #${j.jobNumber} ${j.id}  ${j.status}  start=${when(j.startTime)}  paid=${j.paymentReceived}`
    );
    console.log(
      `      clockIn=${when(j.clockInTime)} clockOut=${when(j.clockOutTime)}` +
        ` quoteStatus=${j.quoteStatus ?? "null"} employeeId=${j.employeeId ?? "null"}`
    );
    console.log(
      `      M2M cleaners: [${j.cleaners.map((c) => `${c.name}:${c.id}`).join(", ") || "EMPTY"}]`
    );
    console.log(
      `      JobAssignment rows: ${
        j.assignments
          .map((a) => `${a.cleanerId}(otw=${when(a.onMyWayAt)},pay=${a.payAmount ?? "—"})`)
          .join(", ") || "EMPTY"
      }`
    );
    console.log(`      job log (${j.logs.length} entries):`);
    for (const l of j.logs) {
      console.log(
        `        ${when(l.createdAt)} ${l.action}` +
          (l.field ? ` ${l.field}: ${l.oldValue ?? "—"} → ${l.newValue ?? "—"}` : "") +
          (l.description ? `  "${l.description}"` : "")
      );
    }
  }

  const annabel = await db.user.findMany({
    where: { name: { contains: "Annabel", mode: "insensitive" }, deletedAt: null },
    select: { id: true, name: true, role: true, isActive: true },
  });
  console.log(
    `  cleaner match: ${
      annabel.map((u) => `${u.name} ${u.id} ${u.role} active=${u.isActive}`).join(" | ") || "none"
    }`
  );

  // ── Fix 5 · hourly cleaner pay: does payType stick, and is it clock-based? ─
  heading("FIX 5 — HOURLY pay-type jobs: does the row carry payType/hourlyRate?");

  const [payTypeCounts] = await Promise.all([
    db.job.groupBy({
      by: ["payType"],
      where: { deletedAt: null },
      _count: { _all: true },
    }),
  ]);
  console.log(
    `  payType distribution: ${payTypeCounts
      .map((r) => `${r.payType ?? "null"}=${n(r._count._all)}`)
      .join("  ")}`
  );

  const hourlyPay = await db.job.findMany({
    where: { deletedAt: null, payType: "HOURLY" },
    select: {
      id: true,
      jobNumber: true,
      status: true,
      startTime: true,
      endTime: true,
      hourlyRate: true,
      employeePay: true,
      employeePayIsManual: true,
      clockInTime: true,
      clockOutTime: true,
      workSessions: { select: { id: true, startedAt: true, endedAt: true, cleanerId: true } },
    },
    orderBy: { startTime: "desc" },
    take: 15,
  });
  console.log(`  HOURLY-pay jobs (latest ${hourlyPay.length}):`);
  for (const j of hourlyPay) {
    const clocked = j.workSessions.filter((s) => s.endedAt).length;
    console.log(
      `    #${j.jobNumber} ${j.status.padEnd(9)} rate=${
        j.hourlyRate ?? "null"
      } pay=${money(j.employeePay)} manual=${j.employeePayIsManual}` +
        ` sessions=${j.workSessions.length} (closed ${clocked})`
    );
  }
  const hourlyMissingRate = await db.job.count({
    where: { deletedAt: null, payType: "HOURLY", hourlyRate: null },
  });
  console.log(`  HOURLY-pay jobs with NO hourlyRate: ${hourlyMissingRate}`);

  // ── Fix 4 · hourly BILLING jobs (customer side) — for Stage 4A later ──────
  heading("FIX 4 — HOURLY-billed jobs (customer side), for reference");
  const billingCounts = await db.job.groupBy({
    by: ["billingType"],
    where: { deletedAt: null },
    _count: { _all: true },
  });
  console.log(
    `  billingType distribution: ${billingCounts
      .map((r) => `${r.billingType ?? "null"}=${n(r._count._all)}`)
      .join("  ")}`
  );

  // ── Fixes 3 + 6 · what "Total jobs" counted, and what it counts now ──────
  // The Dashboard tile was `count({ deletedAt: null })` — every row in the
  // table — so a cancellation never came off it. The Analytics tile repeated
  // the same thing in memory. Both now count ACTIVE work through
  // `activeJobsWhere()`, with the two excluded kinds printed beside them.
  //
  // Printed as a before/after pair so the size of the correction is a measured
  // number rather than a claim, and so a re-run after the backfill shows the
  // on-hold column collapsing to the genuine holds.
  heading("FIXES 3 + 6 — Total jobs: every row vs. active work");

  const [everyRow, active, onHold, cancelled] = await Promise.all([
    db.job.count({ where: { deletedAt: null } }),
    db.job.count({ where: activeJobsWhere() }),
    db.job.count({ where: jobStatusWhere("onhold", now) }),
    db.job.count({ where: jobStatusWhere("cancelled", now) }),
  ]);
  console.log(`  every non-archived row (the OLD tile): ${everyRow}`);
  console.log(`  active jobs           (the NEW tile): ${active}`);
  console.log(`    …excluded: ${onHold} on hold · ${cancelled} cancelled`);
  console.log(
    `  the two excluded counts add back exactly: ${active + onHold + cancelled === everyRow ? "yes" : "NO — investigate"}`
  );

  // Where the holds come from, which is the client's own question ("what
  // triggers On Hold, and is it automatic or manual?") answered against live
  // data rather than against the code.
  const held = await db.job.findMany({
    where: { deletedAt: null, status: ON_HOLD_STATUS },
    select: {
      jobNumber: true,
      clientName: true,
      startTime: true,
      isFlexible: true,
      quoteStatus: true,
      holdReason: true,
      price: true,
      subtotalAmount: true,
      totalAmount: true,
      bookingSource: true,
    },
    orderBy: { startTime: "asc" },
  });
  const trigger = (j: (typeof held)[number]) =>
    j.quoteStatus && j.quoteStatus !== "ACCEPTED"
      ? "quote"
      : j.isFlexible
        ? "flexible"
        : !(j.price ?? 0) && !(j.subtotalAmount ?? 0) && !(j.totalAmount ?? 0)
          ? "$0 import"
          : "enum default (not a real hold)";
  const byTrigger = new Map<string, number>();
  for (const j of held) byTrigger.set(trigger(j), (byTrigger.get(trigger(j)) ?? 0) + 1);
  console.log(`\n  ${held.length} job(s) on hold, by what actually put them there:`);
  for (const [k, v] of byTrigger) console.log(`    ${String(v).padStart(4)}  ${k}`);
  const withReason = held.filter((j) => j.holdReason?.trim()).length;
  console.log(
    `  ${withReason}/${held.length} carry a stated reason` +
      (withReason < held.length
        ? "  ← run scripts/releaseLegacyJobHolds.ts to release the defaults and label the rest"
        : "")
  );
  for (const j of held.slice(0, 20)) {
    console.log(
      `    #${j.jobNumber}  ${when(j.startTime)}  ${j.clientName.padEnd(28).slice(0, 28)}` +
        `  ${money(j.price ?? j.subtotalAmount)}  ${trigger(j)}` +
        `  reason=${j.holdReason ?? "—"}`
    );
  }
  if (held.length > 20) console.log(`    …and ${held.length - 20} more`);

  // ── Stage 4 · what the hourly rule change is actually worth on this data ──
  //
  // Fix 4 reverses the billable-hours rule (union → total crew hours) and fix 5
  // makes the clock, not the schedule, settle an hourly cleaner's pay. Both are
  // rule changes, so the question the client will ask is "how much money moves?"
  // — answered here from the rows rather than from the code.
  //
  // The measurement is the SHIPPED helper (`billableActualHours`), so this
  // section reports what the app will do, not a second opinion about it. The
  // repair itself lives in scripts/recomputeHourlyJobs.ts; this stays read-only.
  heading("STAGE 4 — hourly money: how much moves under the new rules");

  const hourlyRows = await db.job.findMany({
    where: {
      deletedAt: null,
      OR: [{ billingType: "HOURLY" }, { payType: "HOURLY" }],
    },
    select: {
      jobNumber: true,
      clientName: true,
      billingType: true,
      billedHourlyRate: true,
      billedActualHours: true,
      payType: true,
      hourlyRate: true,
      employeePay: true,
      employeePayIsManual: true,
      paymentReceived: true,
      workSessions: { select: { cleanerId: true, startedAt: true, endedAt: true } },
      breaks: { select: { cleanerId: true, startedAt: true, endedAt: true } },
    },
    orderBy: { startTime: "desc" },
  });

  const billedWithClock = hourlyRows.filter(
    (j) => j.billingType === "HOURLY" && j.workSessions.length > 0
  );
  let billedMoving = 0;
  for (const j of billedWithClock) {
    const next = billableActualHours(j.workSessions, j.breaks);
    if (next > 0 && (j.billedActualHours == null || Math.abs(j.billedActualHours - next) >= 0.005)) {
      billedMoving += 1;
      console.log(
        `    #${j.jobNumber} ${j.clientName.padEnd(24).slice(0, 24)}  billed hours ` +
          `${j.billedActualHours ?? "—"} → ${Math.round(next * 100) / 100}`
      );
    }
  }
  console.log(
    `  fix 4: ${billedWithClock.length} hourly-BILLED job(s) have clock data · ` +
      `${billedMoving} would change under the crew-hours rule`
  );

  const paidWithClock = hourlyRows.filter(
    (j) => j.payType === "HOURLY" && j.hourlyRate != null && j.workSessions.length > 0
  );
  let paidMoving = 0;
  for (const j of paidWithClock) {
    if (j.employeePayIsManual) continue;
    // Σ per-cleaner active hours × the cleaner rate — the team total
    // `computeJobPayShares` will hand out, without needing the rate map.
    let owed = 0;
    for (const mins of crewActiveMinutesByCleaner(j.workSessions, j.breaks).values()) {
      owed += (mins / 60) * (j.hourlyRate ?? 0);
    }
    owed = Math.round(owed * 100) / 100;
    if (j.employeePay != null && Math.abs(j.employeePay - owed) < 0.005) continue;
    paidMoving += 1;
    console.log(
      `    #${j.jobNumber} ${j.clientName.padEnd(24).slice(0, 24)}  crew pay ` +
        `${money(j.employeePay)} → ${money(owed)}   (rate ${money(j.hourlyRate)}/h)`
    );
  }
  console.log(
    `  fix 5: ${paidWithClock.length} hourly-PAID job(s) have clock data and a rate · ` +
      `${paidMoving} would change once the clock settles the pay`
  );
  const hourlyNoRate = hourlyRows.filter(
    (j) => j.payType === "HOURLY" && j.hourlyRate == null
  ).length;
  console.log(
    `  fix 5: ${hourlyNoRate} hourly-PAID job(s) still carry NO rate — the reset bug's ` +
      `residue. New saves keep it; these need the rate re-entered once.`
  );

  // ══════════════════════════════════════════════════════════════════════════
  // Fix 7 — where the apartment number actually lives
  // ══════════════════════════════════════════════════════════════════════════
  //
  // The recon guessed IMG-5's unit was NOT in `aptNumber` and rode at the tail
  // of an imported `location`. This section is what corrected that: the column
  // is populated, and `formatAddressLine` simply re-appends it after the street
  // — so the trailing ", 23" in the screenshot is the RENDERING putting a
  // known unit somewhere nobody reads, not a lost value. Worth keeping around:
  // it is also the check that fix 7's split heuristic has nothing to invent.
  heading("Fix 7 — apartment numbers (IMG-5)");
  {
    const withLocation = await db.job.findMany({
      where: { deletedAt: null, location: { not: null } },
      select: { jobNumber: true, location: true, aptNumber: true },
    });
    const withApt = withLocation.filter((j) => normalizeApt(j.aptNumber));
    const placeholder = withLocation.filter(
      (j) => (j.aptNumber ?? "").trim() && !normalizeApt(j.aptNumber)
    );
    // Rows the backfill (5A.5) would touch: no usable column, but a unit
    // sitting inside the address string.
    const recoverable = withLocation.filter(
      (j) => !normalizeApt(j.aptNumber) && splitAptFromLocation(j.location).apt
    );
    console.log(`  ${withLocation.length} job(s) with an address`);
    console.log(`  ${withApt.length} carry a usable apartment number in the column`);
    console.log(
      `  ${placeholder.length} carry a PLACEHOLDER there ` +
        `(${[...new Set(placeholder.map((j) => JSON.stringify(j.aptNumber)))].join(", ") || "—"}) ` +
        `— read as blank since fix 7, so no "Apt None" line is rendered`
    );
    // The flag is spelled out in that script's own header, not here: the
    // safety rail in verify-awer-fixes-4.ts asserts this file contains no
    // commit switch at all, and it should not be weakened to let a message
    // through.
    console.log(
      `  ${recoverable.length} hide a unit inside the address string ` +
        `— i.e. what scripts/backfillJobAptNumbers.ts would fill in once committed`
    );
    for (const j of recoverable.slice(0, 20)) {
      const s = splitAptFromLocation(j.location);
      console.log(`    #${j.jobNumber}  ${JSON.stringify(j.location)} → apt ${JSON.stringify(s.apt)}`);
    }
    // Every distinct value, run through the label the hero now prints. A rule
    // that mangles real data shows up here and nowhere else.
    const labels = new Map<string, string | null>();
    for (const j of withLocation) {
      const raw = (j.aptNumber ?? "").trim();
      if (raw) labels.set(raw, formatAptLabel(raw));
    }
    console.log(`  ${labels.size} distinct apartment value(s), as the job hero will print them:`);
    for (const [raw, label] of labels) {
      console.log(`    ${JSON.stringify(raw).padEnd(30)} → ${JSON.stringify(label)}`);
    }
  }

  console.log("\nDone. No writes were made.\n");
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
