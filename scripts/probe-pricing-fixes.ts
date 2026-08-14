/**
 * Stage 0 — READ-ONLY probes for the pricing-logic fixes round
 * (`../_ai_context/TODO.md`, third list, items 0.2 / 0.3 / 0.4).
 *
 * Four questions the plan depends on, all answered against live data:
 *
 *   1. (0.2) The Settings page: run the EXACT 13 queries `/admin/settings`
 *      runs, individually, timed, and measure the JSON payload each one
 *      contributes to the RSC response. Static analysis already exonerated the
 *      queries themselves; what it could not measure is LATENCY and SIZE, which
 *      are the two remaining runtime-only suspects for "the page returns an
 *      error" on Vercel (`maxDuration = 60`).
 *   2. (0.2) The guard matrix: which roles actually hold the pages today, and
 *      how many live users each verdict applies to. `requireOwnerAdmin()` on a
 *      page `/cleaners/settings` re-exports means every EMPLOYEE is bounced.
 *   3. (0.3) Clock-out: size the `db.$transaction(ops)` array against real
 *      cleaner kits (Prisma's default interactive timeout is 5s and this pooler
 *      measures seconds per query), and count the cleaners carrying
 *      `OTHER`-category products — the shape in the PDF's page-6 screenshot.
 *   4. (0.4) Money snapshot: the three screenshot jobs (grout $128/$186,
 *      booking 6919 $177, "Dan Mast" $100/$171) with every figure the fixes
 *      will move, so before/after deltas are demonstrable to the client.
 *
 * Every query is a read. Nothing here writes, and nothing that writes may be
 * added — verify-pricing-fixes.ts holds this file to that mechanically.
 *
 *   npx tsx scripts/probe-pricing-fixes.ts
 */
import { PrismaClient } from "@prisma/client";
import { computeJobMoney } from "../src/lib/job-money";
import { computeJobPayout } from "../src/lib/pay-tiers";
import { DEFAULT_TAX_RATES } from "../src/lib/tax";
// The REAL rate resolver, not a hand-built STANDARD/1.0 stand-in: a snapshot
// the client will be shown has to use the rates payroll would actually use.
import { getCleanerRateInputs } from "../src/lib/cleaner-rates";

const db = new PrismaClient();

const pad = (label: string, width = 46) => label.padEnd(width, ".");
const money = (n: number | null | undefined) =>
  `$${(Number(n) || 0).toFixed(2)}`;

/** Bytes this result contributes to the serialized RSC payload. */
const bytes = (v: unknown) => Buffer.byteLength(JSON.stringify(v ?? null), "utf8");
const kb = (n: number) => `${(n / 1024).toFixed(1)} KB`;

async function timed<T>(
  label: string,
  fn: () => Promise<T>
): Promise<{ label: string; ms: number; size: number; rows: number; error?: string }> {
  const t0 = Date.now();
  try {
    const out = await fn();
    const ms = Date.now() - t0;
    const size = bytes(out);
    const rows = Array.isArray(out) ? out.length : 1;
    console.log(
      `  ${pad(label)} ${String(ms).padStart(6)} ms  ${String(rows).padStart(5)} rows  ${kb(size).padStart(10)}`
    );
    return { label, ms, size, rows };
  } catch (e) {
    const ms = Date.now() - t0;
    const error = e instanceof Error ? e.message : String(e);
    console.log(`  ${pad(label)} ${String(ms).padStart(6)} ms  FAILED — ${error}`);
    return { label, ms, size: 0, rows: 0, error };
  }
}

// ── 1 + 2 · the Settings page ───────────────────────────────────────────────

async function probeSettingsPage() {
  console.log("\n═══ 0.2 · /admin/settings — the 13 queries, timed and sized ═══\n");

  const results = [
    await timed("appSetting.findMany", () => db.appSetting.findMany()),
    await timed("product.findMany", () =>
      db.product.findMany({ orderBy: { name: "asc" } })
    ),
    await timed("kitTemplate.findMany +items +product", () =>
      db.kitTemplate.findMany({
        include: { items: { include: { product: true } } },
        orderBy: { name: "asc" },
      })
    ),
    await timed("supplier.findMany +prices +product", () =>
      db.supplier.findMany({
        include: { prices: { include: { product: true } } },
        orderBy: { name: "asc" },
      })
    ),
    await timed("inventoryLocation.findMany +stock", () =>
      db.inventoryLocation.findMany({
        include: { stock: true },
        orderBy: { name: "asc" },
      })
    ),
    await timed("checklistTemplate.findMany +items", () =>
      db.checklistTemplate.findMany({
        include: { items: { orderBy: { sortOrder: "asc" } } },
        orderBy: { name: "asc" },
      })
    ),
    await timed("trainingModule.findMany +quizzes +progress", () =>
      db.trainingModule.findMany({
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
        include: {
          quizzes: { orderBy: { sortOrder: "asc" } },
          progress: { include: { employee: { select: { id: true, name: true } } } },
        },
      })
    ),
    await timed("document.findMany +signatures", () =>
      db.document.findMany({
        orderBy: { createdAt: "desc" },
        include: {
          signatures: {
            include: { employee: { select: { id: true, name: true } } },
            orderBy: { createdAt: "asc" },
          },
        },
      })
    ),
    await timed("user.findMany (non-CLIENT)", () =>
      db.user.findMany({
        where: { role: { not: "CLIENT" }, deletedAt: null },
        orderBy: { name: "asc" },
        select: { id: true, name: true, role: true },
      })
    ),
    await timed("serviceArea.findMany", () =>
      db.serviceArea.findMany({ orderBy: { prefix: "asc" } })
    ),
    // THE unbounded one (plan item 1.5). No take, no date floor.
    await timed("transaction.findMany +job  ← UNBOUNDED", () =>
      db.transaction.findMany({
        orderBy: { date: "desc" },
        include: { job: { select: { id: true, clientName: true } } },
      })
    ),
    await timed("budget.findMany", () =>
      db.budget.findMany({
        orderBy: [{ period: "desc" }, { category: { sortOrder: "asc" } }],
      })
    ),
    await timed("budgetCategory.findMany +_count", () =>
      db.budgetCategory.findMany({
        orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
        include: { _count: { select: { budgets: true, transactions: true } } },
      })
    ),
  ];

  // Then the two the page runs AFTER the Promise.all, sequentially.
  console.log("");
  const after = [
    await timed("notificationSetting.count (seed gate)", () =>
      db.notificationSetting.count()
    ),
    await timed("notificationSetting.findMany", () =>
      db.notificationSetting.findMany({
        orderBy: [{ recipient: "asc" }, { sortOrder: "asc" }],
      })
    ),
  ];

  const all = [...results, ...after];
  const failed = all.filter((r) => r.error);
  const totalMs = all.reduce((s, r) => s + r.ms, 0);
  const slowest = all.reduce((a, b) => (b.ms > a.ms ? b : a));
  const totalSize = all.reduce((s, r) => s + r.size, 0);
  const biggest = all.reduce((a, b) => (b.size > a.size ? b : a));

  console.log(`\n  queries that threw ................. ${failed.length}`);
  if (failed.length) {
    for (const f of failed) console.log(`     • ${f.label}: ${f.error}`);
  }
  console.log(`  sum of individual latencies ....... ${totalMs} ms`);
  console.log(`  slowest single query .............. ${slowest.ms} ms (${slowest.label})`);
  console.log(`  serialized payload (all sections) .. ${kb(totalSize)}`);
  console.log(`  biggest single section ............ ${kb(biggest.size)} (${biggest.label})`);
  console.log(
    `  NOTE: Promise.all runs the first 13 concurrently, so wall-clock ≈ the\n` +
      `        slowest, not the sum. The sum is what a cold serverless instance\n` +
      `        pays if the pooler serialises them.`
  );
}

async function probeGuardMatrix() {
  console.log("\n═══ 0.2 · guard matrix — who can actually open Settings today ═══\n");

  const byRole = await db.user.groupBy({
    by: ["role"],
    where: { deletedAt: null },
    _count: { _all: true },
  });

  // Mirrors src/lib/page-guards.ts as it stands right now.
  const OWNER_ADMIN = ["OWNER", "ADMIN"];
  const CLIENT = ["CLIENT"];
  for (const r of byRole.sort((a, b) => a.role.localeCompare(b.role))) {
    const passesToday = OWNER_ADMIN.includes(r.role);
    const shouldPass = !CLIENT.includes(r.role); // requireStaff, per D6
    const verdict = passesToday
      ? "opens the page"
      : shouldPass
      ? "REDIRECTED — regression"
      : "redirected (correct)";
    console.log(
      `  ${pad(`${r.role} (${r._count._all} live users)`, 40)} ${verdict}`
    );
  }
  const locked = byRole
    .filter((r) => !OWNER_ADMIN.includes(r.role) && !CLIENT.includes(r.role))
    .reduce((s, r) => s + r._count._all, 0);
  console.log(
    `\n  staff currently locked out of their OWN settings ... ${locked}` +
      `\n  (they reach /cleaners/settings, which re-exports the admin page whose\n` +
      `   first line is requireOwnerAdmin() → homeForRole() bounce, no error text.)`
  );
}

// ── 3 · clock-out ───────────────────────────────────────────────────────────

async function probeClockOut() {
  console.log("\n═══ 0.3 · clock-out — transaction size and the OTHER-category shape ═══\n");

  const kits = await db.employeeProduct.groupBy({
    by: ["employeeId"],
    _count: { _all: true },
  });
  const sizes = kits.map((k) => k._count._all).sort((a, b) => b - a);
  const maxKit = sizes[0] ?? 0;
  const medianKit = sizes.length ? sizes[Math.floor(sizes.length / 2)] : 0;

  // Every product line in `deductions` pushes FOUR statements:
  // jobProductUsage upsert + employeeProduct.update + inventoryChange.create
  // + jobLog.create. Then the fixed tail: session close, job update, break
  // close, CLOCKED_OUT log (4), plus supplies Transaction and the low-stock
  // Alert when they apply (2).
  const OPS_PER_PRODUCT = 4;
  const FIXED_OPS = 4;
  const CONDITIONAL_OPS = 2;

  // AFTER Stage 5.6. Per product it is now TWO statements — the usage upsert and
  // the stock update — because the two append-only audit writes (inventoryChange
  // and the PRODUCT_USED job logs) became one `createMany` each covering every
  // product at once, with the CLOCKED_OUT entry riding along in the same call.
  // Fixed tail: those 2 createMany calls + session close + job update + break
  // close. Conditional: the supplies Transaction and the low-stock Alert.
  const OPS_PER_PRODUCT_AFTER = 2;
  const FIXED_OPS_AFTER = 5;

  const worstBefore = maxKit * OPS_PER_PRODUCT + FIXED_OPS + CONDITIONAL_OPS;
  const worstAfter = maxKit * OPS_PER_PRODUCT_AFTER + FIXED_OPS_AFTER + CONDITIONAL_OPS;
  const medianBefore = medianKit * OPS_PER_PRODUCT + FIXED_OPS;
  const medianAfter = medianKit * OPS_PER_PRODUCT_AFTER + FIXED_OPS_AFTER;

  console.log(`  cleaners holding a kit ............ ${kits.length}`);
  console.log(`  products in the largest kit ....... ${maxKit}`);
  console.log(`  products in the median kit ........ ${medianKit}`);
  console.log(
    `  → worst-case ops in db.$transaction  ${worstBefore} → ${worstAfter}` +
      `  (${maxKit}×${OPS_PER_PRODUCT_AFTER} + ${FIXED_OPS_AFTER} + ${CONDITIONAL_OPS})`
  );
  console.log(
    `  → median-case ops ................... ${medianBefore} → ${medianAfter}`
  );

  const otherProducts = await db.product.findMany({
    where: { category: "OTHER" },
    select: { id: true, name: true },
  });
  const otherAssigned = otherProducts.length
    ? await db.employeeProduct.count({
        where: { productId: { in: otherProducts.map((p) => p.id) } },
      })
    : 0;
  console.log(`\n  products in category OTHER ........ ${otherProducts.length}`);
  console.log(`  OTHER items sitting in cleaner kits  ${otherAssigned}`);
  console.log(
    `  (OTHER is the remaining-quantity input path — usage.remaining — which is\n` +
      `   the page-6 screenshot. Unchanged quantity → used = 0 → no deduction and\n` +
      `   no ops, so an all-blank submit should be the CHEAPEST clock-out there is.)`
  );

  // How many sessions were left open — the stranded half-clocked-out state the
  // plan predicts when a post-transaction step throws.
  const openSessions = await db.jobWorkSession.count({ where: { endedAt: null } });
  const staleOpen = await db.jobWorkSession.count({
    where: {
      endedAt: null,
      startedAt: { lt: new Date(Date.now() - 24 * 3600_000) },
    },
  });
  console.log(`\n  open work sessions (endedAt null) .. ${openSessions}`);
  console.log(`  …of those, open >24h ............... ${staleOpen}`);

  // Jobs whose session rows all closed but whose status never flipped — the
  // signature of a post-transaction failure (syncClockMirrors or the status
  // update threw after the session close committed).
  const closedButNotCompleted = await db.job.count({
    where: {
      deletedAt: null,
      status: { notIn: ["COMPLETED", "PAID", "CANCELLED"] },
      workSessions: { some: { endedAt: { not: null } } },
      NOT: { workSessions: { some: { endedAt: null } } },
    },
  });
  console.log(
    `  jobs fully clocked out but NOT completed  ${closedButNotCompleted}` +
      `\n  (candidate stranded states: the transaction committed, a post-transaction\n` +
      `   step did not. The cleaner saw "Failed to clock out".)`
  );

  // Failed clock-outs, grouped by the code Stage 5.3 records in `field`. Before
  // that stage there was no such row anywhere, so this block prints nothing at
  // all until the enum migration is deployed and a failure actually happens —
  // which is the point: it is the first direct measurement of the failure rate
  // this project has ever been able to take.
  //
  // Guarded, because until `20260814020000_job_log_clock_out_failed` is deployed
  // the VALUE does not exist in the database's enum type and Postgres rejects the
  // query outright — this probe must keep running against a pre-migration
  // database, which is exactly the state it is meant to measure.
  const failures = await db.jobLog
    .groupBy({
      by: ["field"],
      where: { action: "CLOCK_OUT_FAILED" },
      _count: { _all: true },
      _max: { createdAt: true },
    })
    .catch(() => null);
  if (!failures) {
    console.log(
      `\n  logged clock-out failures ......... n/a` +
        `\n  (the CLOCK_OUT_FAILED enum value is not in this database yet — the\n` +
        `   20260814020000 migration is still pending. Re-run after deploy.)`
    );
  } else {
  console.log(`\n  logged clock-out failures ......... ${failures.reduce((n, f) => n + f._count._all, 0)}`);
  if (failures.length === 0) {
    console.log(
      `  (none — expected until the 20260814020000 migration is deployed and a\n` +
        `   clock-out actually fails. A run of DB_TIMEOUT rows points at the pooler;\n` +
        `   INVALID_USAGE / PRODUCT_NOT_IN_KIT rows each name the exact product.)`
    );
  }
  for (const f of failures.sort((a, b) => b._count._all - a._count._all)) {
    console.log(
      `    ${(f.field ?? "(no code)").padEnd(20)} ${String(f._count._all).padStart(4)}` +
        `   last ${f._max.createdAt?.toISOString() ?? "—"}`
    );
  }
  }

  const budgetCat = await db.budgetCategory.findUnique({
    where: { slug: "supplies" },
    select: { id: true, archivedAt: true },
  });
  console.log(
    `\n  budget category "supplies" ......... ${
      budgetCat ? `present${budgetCat.archivedAt ? " (ARCHIVED)" : ""}` : "MISSING — self-heal write runs mid-flow"
    }`
  );
}

// ── 4 · money snapshot ──────────────────────────────────────────────────────

// PERCENTAGES (5 / 9.975), which is how `tax.config` stores them and what
// computeJobTaxes expects — passing fractions here would silently compute ~0 tax.
const RATES = DEFAULT_TAX_RATES;

async function probeMoneySnapshot() {
  console.log("\n═══ 0.4 · money snapshot — every figure the fixes will move ═══\n");

  // The three jobs the PDF screenshots. Matched by the shapes the PDF shows
  // rather than by id, since ids aren't in the document.
  //
  // "Booking 6919" is the BookingKoala booking number printed in the PDF's
  // tooltip; this database carries no `externalBookingId` at all (see the
  // provenance block below), so it is matched by its unmistakable money shape
  // instead: $177 price, $88.55 stored team pay, $17.70 tip, $20 parking, two
  // cleaners. That is job #1809 here.
  const candidates = await db.job.findMany({
    where: {
      deletedAt: null,
      OR: [
        { externalBookingId: "6919" },
        { jobNumber: 6919 },
        { AND: [{ price: 177 }, { employeePay: { gte: 88, lte: 89 } }] },
        { clientName: { contains: "Dan Mast", mode: "insensitive" } },
        { addOns: { some: { name: { contains: "grout", mode: "insensitive" } } } },
      ],
    },
    select: {
      id: true,
      jobNumber: true,
      clientName: true,
      bookingSource: true,
      externalBookingId: true,
      price: true,
      discountAmount: true,
      subtotalAmount: true,
      gstAmount: true,
      qstAmount: true,
      totalAmount: true,
      refundedAmount: true,
      employeePay: true,
      payType: true,
      totalTip: true,
      parking: true,
      isCashJob: true,
      taxExempt: true,
      depositPaid: true,
      status: true,
      paymentReceived: true,
      addOns: { select: { name: true, price: true, quantity: true } },
      cleaners: { select: { id: true, name: true } },
      employeeId: true,
      assignments: { select: { cleanerId: true, payAmount: true } },
    },
    orderBy: { jobNumber: "asc" },
    take: 25,
  });

  if (candidates.length === 0) {
    console.log("  none of the three screenshot jobs are in this database.");
    return;
  }

  for (const j of candidates) {
    const m = computeJobMoney(j, RATES);
    const addOnDesc =
      j.addOns.map((a) => `${a.name}×${a.quantity ?? 1} @ ${money(a.price)}`).join(", ") ||
      "none";

    // TODAY's pay basis: the bare column. This is the number Stage 4a moves.
    const teamIds = Array.from(
      new Set([j.employeeId, ...j.cleaners.map((c) => c.id)].filter(Boolean))
    ) as string[];
    const rateMap = await getCleanerRateInputs(teamIds);
    const rateInputs = teamIds.map(
      (id) =>
        rateMap.get(id) ?? {
          id,
          tier: "STANDARD" as const,
          avgRating: null,
          ratingCount: 0,
          multiplier: 1,
        }
    );
    const payToday = computeJobPayout(j.price, rateInputs);
    const payAfter = computeJobPayout(m.subtotalAmount, rateInputs);

    // TODAY's revenue (metrics-shared.jobRevenue) vs the active subtotal basis.
    const revToday = Math.max(
      0,
      (j.price ?? 0) - (j.discountAmount ?? 0) - (j.refundedAmount ?? 0)
    );
    const revAfter = Math.max(
      0,
      m.subtotalAmount - (j.discountAmount ?? 0) - (j.refundedAmount ?? 0)
    );

    console.log(
      `\n  ── #${j.jobNumber} ${j.clientName} — ${j.bookingSource ?? "admin"}${
        j.externalBookingId ? ` (ext ${j.externalBookingId})` : ""
      } · ${j.status}`
    );
    console.log(`     add-ons ...................... ${addOnDesc}`);
    console.log(`     basis (job-money) ............ ${m.basis}`);
    console.log(
      `     price card TODAY (job.price) . ${money(j.price)}   →  ACTIVE subtotal ${money(m.subtotalAmount)}`
    );
    console.log(
      `     stored subtotal/total ........ ${money(j.subtotalAmount)} / ${money(j.totalAmount)}`
    );
    console.log(
      `     charge label TODAY ........... ${money((j.price ?? 0) - (j.discountAmount ?? 0))}   →  actually billed ${money(
        j.totalAmount != null && j.totalAmount > 0
          ? j.totalAmount
          : Math.max(0, (j.price ?? 0) - (j.discountAmount ?? 0))
      )}${j.depositPaid ? " (less deposit)" : ""}`
    );
    console.log(
      `     jobRevenue TODAY ............. ${money(revToday)}   →  active basis ${money(revAfter)}`
    );
    console.log(
      `     cleaners ..................... ${teamIds.length}${
        j.cleaners.length ? ` (${j.cleaners.map((c) => c.name).join(", ")})` : ""
      }   payType ${j.payType}`
    );
    console.log(
      `     employeePay stored ........... ${money(j.employeePay)}   tip ${money(j.totalTip)}   parking ${money(j.parking)}`
    );
    console.log(
      `     auto pay TODAY (off price) ... ${money(payToday.pool)}   →  off active subtotal ${money(payAfter.pool)}`
    );
    if (j.assignments.some((a) => a.payAmount != null)) {
      console.log(
        `     per-cleaner overrides ........ ${j.assignments
          .filter((a) => a.payAmount != null)
          .map((a) => money(a.payAmount))
          .join(", ")}`
      );
    }
  }

  // Provenance. Stage 2.1's `pricingMode` backfill and Stage 4c.1's
  // `employeePayIsManual` backfill both key off `bookingSource` /
  // `externalBookingId`, so how many rows actually carry them decides whether
  // those migrations move anything at all.
  console.log("\n  ── provenance (what the Stage 2 / 4c backfills key off) ──");
  const total = await db.job.count();
  const sources = await db.job.groupBy({
    by: ["bookingSource"],
    _count: { _all: true },
  });
  console.log(`     jobs ................................. ${total}`);
  for (const s of sources) {
    console.log(
      `     bookingSource = ${pad(String(s.bookingSource ?? "NULL"), 22)} ${s._count._all}`
    );
  }
  console.log(
    `     externalBookingId not null ........... ${await db.job.count({
      where: { externalBookingId: { not: null } },
    })}`
  );
  console.log(
    `     subtotalAmount > 0 ................... ${await db.job.count({
      where: { subtotalAmount: { gt: 0 } },
    })}`
  );
  console.log(
    `     tip or parking > 0 ................... ${await db.job.count({
      where: { deletedAt: null, OR: [{ totalTip: { gt: 0 } }, { parking: { gt: 0 } }] },
    })}`
  );

  // Population-level sizing: how much money moves when add-ons enter the basis.
  // NULL-safe on purpose: `NOT: { bookingSource: { in: [...] } }` drops every
  // NULL row in SQL three-valued logic, which in this database is EVERY row.
  console.log("\n  ── population impact (jobs whose add-ons are ADDITIVE) ──");
  const additive = await db.job.findMany({
    where: {
      deletedAt: null,
      addOns: { some: {} },
      OR: [
        { bookingSource: null },
        { bookingSource: { notIn: ["web", "web (referral)", "bookingkoala_import"] } },
      ],
    },
    select: {
      price: true,
      discountAmount: true,
      subtotalAmount: true,
      gstAmount: true,
      qstAmount: true,
      totalAmount: true,
      bookingSource: true,
      isCashJob: true,
      taxExempt: true,
      addOns: { select: { name: true, price: true, quantity: true } },
    },
  });
  let deltaSum = 0;
  let moved = 0;
  for (const j of additive) {
    const m = computeJobMoney(j, RATES);
    const d = m.subtotalAmount - (j.price ?? 0);
    if (Math.abs(d) >= 0.01) {
      moved += 1;
      deltaSum += d;
    }
  }
  console.log(`     admin/legacy jobs carrying add-ons ... ${additive.length}`);
  console.log(`     …whose active subtotal ≠ job.price ... ${moved}`);
  console.log(
    `     total value currently invisible ...... ${money(deltaSum)}` +
      `\n     (this is what the price card, revenue and the pay basis all miss today)`
  );
}

async function main() {
  console.log("Cleano — Stage 0 baseline probe (read-only)");
  console.log(`run at ${new Date().toISOString()}`);
  await probeSettingsPage();
  await probeGuardMatrix();
  await probeClockOut();
  await probeMoneySnapshot();
  console.log("\ndone.\n");
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
