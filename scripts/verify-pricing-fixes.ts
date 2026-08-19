/**
 * Verification for the pricing-logic fixes round
 * (`../_ai_context/cleano_new_fixes.pdf` → `../_ai_context/TODO.md`, third list).
 *
 *   npx tsx scripts/verify-pricing-fixes.ts
 *
 * ## What makes this file different from the other verify-*.ts scripts
 *
 * The others assert a finished state. This one is written BEFORE the fixes, so
 * most of its money probes are supposed to FAIL on the day it lands — they
 * encode the PDF's own worked examples as acceptance tests, and each stage
 * flips a batch of them green. Two kinds of assertion, therefore:
 *
 *   check(...)              REQUIRED. A failure is a regression and exits 1.
 *   pending(stage, ...)     EXPECTED to fail until that stage ships. A failure
 *                           prints as PENDING and does NOT fail the run; a PASS
 *                           prints as READY and asks you to promote it to
 *                           check(). By Stage 7.2 there should be no pending
 *                           entries left.
 *
 * That asymmetry is the point: it means the script can be run on every commit
 * from Stage 0 onward and only ever goes red for a real regression, while still
 * telling you exactly how much of the PDF is done.
 *
 * ## Three kinds of check
 *
 *   BEHAVIOUR — pure money logic imported and exercised against fixtures built
 *               from the PDF's screenshots. No database.
 *   SOURCE    — fixes that live in a guard, a Prisma `where` or a JSX branch
 *               can't be exercised without a browser, so they're asserted
 *               against the source. A regression there is a deleted line,
 *               which is exactly what this catches.
 *   MATRIX    — the role → page-access table, computed from the real routing
 *               helpers rather than restated by hand.
 *
 * Live-data baselines (the three screenshot jobs, the settings query battery,
 * the clock-out transaction size) live in `scripts/probe-pricing-fixes.ts`,
 * which is read-only and needs a database. This file needs neither.
 */
import fs from "node:fs";
import {
  activeSubtotal,
  computeJobMoney,
  jobPayBasis,
  resolvePassThroughBilling,
  resolvePricingMode,
  sumAddOns,
  type ActiveValueJob,
  type JobMoneyJob,
} from "../src/lib/job-money";
import {
  computeJobPayout,
  individualRate,
  type CleanerRateInput,
} from "../src/lib/pay-tiers";
import {
  computeJobPayShares,
  type JobPayInput,
} from "../src/lib/cleaner-earnings";
import { resolveAmountDue } from "../src/lib/job-billing";
import {
  CLOCK_OUT_RESUME_WINDOW_MS,
  classifyClockOutError,
  clockOutErrorClass,
  describeReportForLog,
  validateClosingReport,
  type ClockOutKit,
  type ClosingReport,
  type ClosingReportValidation,
  type KitItem,
} from "../src/lib/clock-out";
import { jobRevenue, jobScheduledValue } from "../src/lib/metrics-shared";
import { DEFAULT_TAX_RATES } from "../src/lib/tax";
import {
  homeForRole,
  isAdminRole,
  isApplicantRole,
  isCleanerRole,
  isClientRole,
} from "../src/lib/role-routing";

let pass = 0,
  fail = 0,
  pendingFail = 0,
  pendingReady = 0;

const eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

function check(name: string, actual: unknown, expected: unknown) {
  const okv = eq(actual, expected);
  console.log(`${okv ? "PASS" : "FAIL"}  ${name}`);
  if (!okv) {
    console.log(
      `        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`
    );
  }
  if (okv) pass++;
  else fail++;
}

/**
 * An acceptance test for a stage that has not shipped. Failing is the expected
 * state and never breaks the build; passing means the stage landed and the call
 * should be promoted to `check()` so it starts guarding against regression.
 */
function pending(stage: string, name: string, actual: unknown, expected: unknown) {
  const okv = eq(actual, expected);
  if (okv) {
    console.log(`READY   [${stage}] ${name}  ← now passes, promote to check()`);
    pendingReady++;
  } else {
    console.log(`PEND    [${stage}] ${name}`);
    console.log(
      `        wants ${JSON.stringify(expected)}, today ${JSON.stringify(actual)}`
    );
    pendingFail++;
  }
}

const ok = (n: string, c: boolean) => check(n, c, true);
const okPending = (stage: string, n: string, c: boolean) =>
  pending(stage, n, c, true);

/**
 * A file that does not exist yet reads as empty rather than throwing: several
 * assertions below name files a later stage creates (the settings error
 * boundary, for one), and a missing file has to render as a FAIL line, not as
 * a crash that hides every check after it.
 */
const read = (p: string) => (fs.existsSync(p) ? fs.readFileSync(p, "utf8") : "");
const has = (name: string, path: string, needle: string) =>
  ok(name, read(path).includes(needle));
const lacks = (name: string, path: string, needle: string) =>
  ok(name, fs.existsSync(path) && !read(path).includes(needle));
/**
 * A file with its comment lines stripped.
 *
 * Needed by every "X is gone" assertion whose replacement explains what it
 * replaced — `clockOut.ts` says in prose that it no longer writes
 * `jobProductUsage`, and a bare `lacks` would read that sentence as the thing
 * itself. Same helper, same reasoning, as verify-awer-fixes-3.ts's `codeOf`.
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
const lacksInCode = (name: string, path: string, needle: string) =>
  ok(name, fs.existsSync(path) && !codeOf(path).includes(needle));

const RATES = DEFAULT_TAX_RATES;
const round2 = (n: number) => Math.round(n * 100) / 100;

/** A STANDARD cleaner with no earned multiplier — the 40% baseline. */
const cleaner = (id: string, over: Partial<CleanerRateInput> = {}): CleanerRateInput => ({
  id,
  tier: "STANDARD",
  avgRating: null,
  ratingCount: 0,
  multiplier: 1,
  ...over,
});

const rateMap = (...cs: CleanerRateInput[]) =>
  new Map(cs.map((c) => [c.id, c]));

// ───────────────────────────────────────────────────────────────────────────
console.log("\n── Fixtures · the three jobs the PDF screenshots ──");
// Live values confirmed against the database by scripts/probe-pricing-fixes.ts
// on 2026-08-14: #1826 (grout), #2031 (Dan Mast), #1809 (the $177/"booking
// 6919" job). Anything here that stops matching those rows is a fixture bug,
// not a code bug — re-run the probe.

/** PDF page 2 · job #1826: $128 base + 2 × $29 grout. Admin job → ADDITIVE. */
const groutJob: JobMoneyJob = {
  bookingSource: null,
  price: 128,
  discountAmount: 0,
  subtotalAmount: 186,
  gstAmount: 9.3,
  qstAmount: 18.55,
  totalAmount: 213.85,
  addOns: [{ name: "Grout Cleaning (Per Room)", price: 29, quantity: 2 }],
};

/** PDF page 5 · job #2031: $100 base + $29 + 2 × $21 = $171. */
const danMastJob: JobMoneyJob = {
  bookingSource: null,
  price: 100,
  discountAmount: 0,
  subtotalAmount: 171,
  gstAmount: 8.55,
  qstAmount: 17.06,
  totalAmount: 196.61,
  addOns: [
    { name: "Interior Kitchen Cabinets (Empty)", price: 29, quantity: 1 },
    { name: "Interior Bathroom Cabinets (Empty)", price: 21, quantity: 2 },
  ],
};

check("grout job's add-ons sum to $58", sumAddOns(groutJob.addOns), 58);
check("Dan Mast's add-ons sum to $71", sumAddOns(danMastJob.addOns), 71);
check(
  "computeJobMoney already knows the grout job is worth $186",
  computeJobMoney(groutJob, RATES).subtotalAmount,
  186
);
check(
  "computeJobMoney already knows Dan Mast is worth $171",
  computeJobMoney(danMastJob, RATES).subtotalAmount,
  171
);

// ───────────────────────────────────────────────────────────────────────────
console.log("\n── Stage 3 · ONE active price on every surface (PDF fix 3) ──");

// The disease in one line: the breakdown reads computeJobMoney, the price card
// reads the bare column, and they disagree by exactly the add-ons.
const groutMoney = computeJobMoney(groutJob, RATES);
check("the gap the client is looking at", round2(groutMoney.subtotalAmount - (groutJob.price ?? 0)), 58);

/**
 * Widen a fixture to the shape the reporting helpers take.
 *
 * `ActiveValueJob` requires every money column to be PRESENT (see job-money.ts)
 * precisely so a real caller cannot forget one in its `select`. The fixtures
 * above are written as sparse `JobMoneyJob`s for readability, so this fills the
 * gaps with the same nulls Prisma would return.
 */
const activeValue = (j: JobMoneyJob): ActiveValueJob => ({
  price: j.price ?? null,
  discountAmount: j.discountAmount ?? null,
  subtotalAmount: j.subtotalAmount ?? null,
  bookingSource: j.bookingSource ?? null,
  pricingMode: j.pricingMode ?? null,
  addOns: j.addOns ?? [],
});

// ── 3.1 · the price card ────────────────────────────────────────────────────
check(
  "3.1 · price card reads the ACTIVE subtotal, not job.price",
  groutMoney.subtotalAmount,
  186
);
check(
  "3.1 · …and `activeSubtotal` is the same number without needing tax rates",
  activeSubtotal(groutJob),
  groutMoney.subtotalAmount
);
check(
  "3.1 · the base line survives beside it, so the card can show both",
  [groutMoney.basePrice, groutMoney.addOnTotal],
  [128, 58]
);

// ── 3.2 · the charge label ──────────────────────────────────────────────────
// The button said $128 (price − discount) while chargeJob billed $213.85 (the
// stored taxed total). Both directions of that lie are asserted.
const groutAmountDue = resolveAmountDue({
  price: groutJob.price ?? 0,
  discountAmount: groutJob.discountAmount ?? 0,
  totalAmount: groutJob.totalAmount ?? 0,
  depositPaid: false,
});
check("3.2 · charge label = what Stripe will actually take", groutAmountDue, 213.85);
check(
  "3.2 · …which the OLD label understated by the tax it never showed",
  round2(groutAmountDue - round2((groutJob.price ?? 0) - (groutJob.discountAmount ?? 0))),
  85.85
);
check(
  "3.2 · a paid deposit comes off the quoted figure, once",
  resolveAmountDue({
    price: groutJob.price ?? 0,
    discountAmount: 0,
    totalAmount: groutJob.totalAmount ?? 0,
    depositPaid: true,
  }),
  193.85
);

// ── 3.3 · net profit ────────────────────────────────────────────────────────
// The page-3 shape: a $177 job with $20 of customer-funded parking on it.
// Parking must not reduce company profit (D3), and the revenue term is the
// active subtotal.
{
  const pay = 88.55, productCost = 4.2, parking = 20;
  // What the card printed before: job.price − pay − parking − productCost.
  const before = round2((danMastJob.price ?? 0) - pay - parking - productCost);
  const after = round2(activeSubtotal(danMastJob) - pay - productCost);
  check("3.3 · net profit reads the active subtotal and ignores parking", after, 78.25);
  check(
    "3.3 · …which is the old figure plus the add-ons plus the parking it wrongly ate",
    round2(after - before),
    round2(71 + parking)
  );
}

// ── 3.4 · revenue ───────────────────────────────────────────────────────────
check(
  "3.4 · jobRevenue counts the add-ons",
  jobRevenue({ ...activeValue(groutJob), refundedAmount: 0 }),
  186
);
check(
  "3.4 · jobRevenue counts Dan Mast's $71 of cabinets",
  jobRevenue({ ...activeValue(danMastJob), refundedAmount: 0 }),
  171
);
check(
  "3.4 · refunds still come off",
  jobRevenue({ ...activeValue(groutJob), refundedAmount: 30 }),
  156
);
// The trap in the plan's own wording. `activeSubtotal` is ALREADY discount-net,
// so the literal `subtotalAmount − discount − refunds` would take the discount
// off twice — the same shape as the referral-credit defect in job-billing.ts.
{
  const discounted: JobMoneyJob = { ...groutJob, discountAmount: 20, subtotalAmount: 166 };
  check(
    "3.4 · a discount is applied ONCE, not once by the helper and again by the caller",
    jobRevenue({ ...activeValue(discounted), refundedAmount: 0 }),
    166
  );
}
check(
  "3.4 · booked value moved to the same basis, so payday can't change a job's worth",
  jobScheduledValue(activeValue(groutJob)),
  jobRevenue({ ...activeValue(groutJob), refundedAmount: 0 })
);

// ── 3.8 · card = breakdown = revenue, for all three money shapes ────────────
// The acceptance criterion in one loop: whatever the basis, the number the
// price card prints, the number the breakdown totals to and the number revenue
// counts are the SAME number.
{
  const shapes: Array<{ label: string; job: JobMoneyJob; want: number }> = [
    { label: "ADDITIVE (admin job with add-ons)", job: groutJob, want: 186 },
    {
      label: "INCLUSIVE (stored override total)",
      job: {
        bookingSource: "bookingkoala_import",
        pricingMode: "FINAL_PRICE",
        price: 186,
        discountAmount: 0,
        subtotalAmount: 186,
        gstAmount: 9.3,
        qstAmount: 18.55,
        totalAmount: 213.85,
        addOns: [{ name: "Grout Cleaning (Per Room)", price: 0, quantity: 2 }],
      },
      want: 186,
    },
    {
      label: "LEGACY_PRICE (override mode, nothing stored)",
      job: {
        bookingSource: "web",
        pricingMode: "FINAL_PRICE",
        price: 186,
        discountAmount: 0,
        subtotalAmount: 0,
        totalAmount: 0,
        addOns: [{ name: "Grout Cleaning (Per Room)", price: 29, quantity: 2 }],
      },
      want: 186,
    },
  ];
  for (const s of shapes) {
    const m = computeJobMoney(s.job, RATES);
    check(`3.8 · ${s.label} · price card`, m.subtotalAmount, s.want);
    check(`3.8 · ${s.label} · revenue basis`, jobRevenue({ ...activeValue(s.job), refundedAmount: 0 }), s.want);
    check(`3.8 · ${s.label} · booked value`, jobScheduledValue(activeValue(s.job)), s.want);
    check(
      `3.8 · ${s.label} · card = breakdown`,
      activeSubtotal(s.job),
      m.subtotalAmount
    );
  }
}

// Source-level: the offenders named in the plan, each its own line so a partial
// fix reads as a partial fix.
ok(
  "3.1 · JobDetailView price card no longer prints job.price",
  // The literal render at JobDetailView.tsx:1601 — the $128 in the screenshot.
  !/astat-value">\{job\.price !== null \? `\$\$\{job\.price\.toFixed\(2\)\}`/.test(
    read("src/app/admin/jobs/[id]/JobDetailView.tsx")
  )
);
has(
  "3.1 · …it prints the active subtotal instead",
  "src/app/admin/jobs/[id]/JobDetailView.tsx",
  "`$${money.subtotalAmount.toFixed(2)}`"
);
ok(
  "3.3 · net profit no longer subtracts parking from company money",
  !/const netProfit = \(job\.price \|\| 0\) - computedEmployeePay - \(job\.parking \|\| 0\)/.test(
    read("src/app/admin/jobs/[id]/JobDetailView.tsx")
  )
);
has(
  "3.3 · …and its revenue term is the active subtotal",
  "src/app/admin/jobs/[id]/JobDetailView.tsx",
  "const netProfit = money.subtotalAmount - computedEmployeePay - totalProductCost"
);
ok(
  "3.4 · jobRevenue's signature takes the add-on rows",
  /export function jobRevenue\([\s\S]{0,400}ActiveValueJob/.test(
    read("src/lib/metrics-shared.ts")
  )
);
lacks(
  "3.2 · the view no longer computes its own charge amount",
  "src/app/admin/jobs/[id]/JobDetailView.tsx",
  "const grossRevenue = (job.price || 0) - (job.discountAmount || 0)"
);
has(
  "3.2 · the amount comes from resolveAmountDue, server-side",
  "src/app/admin/jobs/[id]/page.tsx",
  "const amountDue = resolveAmountDue(job)"
);
has(
  "3.2 · …and the gift-card credit chargeJob applies first is quoted with it",
  "src/app/admin/jobs/[id]/page.tsx",
  "giftCardBalance"
);
has(
  "3.2 · the calendar drawer's \"due\" figure is the same one",
  "src/components/calendar/CalendarJobActions.tsx",
  "money(summary.amountDue)"
);

// 3.5 — every list/summary surface reads the shared helper rather than a column.
for (const [label, file] of [
  ["jobs list rows", "src/app/admin/jobs/JobsView.tsx"],
  ["jobs list profit %", "src/app/admin/jobs/page.tsx"],
  ["calendar month/range feed", "src/app/admin/actions/getJobsForDay.ts"],
  ["calendar prefetch feed", "src/app/admin/actions/getJobsForCalendar.ts"],
  ["dashboard job lists", "src/app/admin/dashboard/page.tsx"],
  ["analytics", "src/app/admin/analytics/page.tsx"],
  ["client history", "src/app/admin/clients/[id]/page.tsx"],
] as const) {
  has(`3.5 · ${label} price via activeSubtotal`, file, "activeSubtotal(");
}
has(
  "3.5 · the calendar select carries the add-on rows it now needs",
  "src/app/admin/actions/_calendarSelect.ts",
  "addOns: { select: { name: true, price: true, quantity: true } }"
);

// 3.6 — invoice/receipt already routed through computeJobMoney (AWER round 3);
// assert it rather than trust it, and add the export that did NOT.
for (const [label, file] of [
  ["invoice generator", "src/app/admin/actions/generateInvoiceFromJob.ts"],
  ["receipt PDF", "src/lib/receipt-pdf.ts"],
] as const) {
  has(`3.6 · ${label} still routes through computeJobMoney`, file, "computeJobMoney(");
}
has(
  "3.6 · the jobs export prices the ACTIVE value",
  "src/app/admin/actions/exportJobs.ts",
  "Price: activeSubtotal(j)"
);
has(
  "3.6 · …and keeps the base line beside it so the two reconcile",
  "src/app/admin/actions/exportJobs.ts",
  '"Base Price": j.price ?? ""'
);

// 3.7 — the labour-% denominator is the same basis as revenue.
has(
  "3.7 · labour metric's revenue denominator is the active subtotal",
  "src/app/admin/actions/getLabourCostMetric.ts",
  "const gross = activeSubtotal(j)"
);
lacks(
  "3.7 · …not the stored-subtotal-or-price fallback chain it used",
  "src/app/admin/actions/getLabourCostMetric.ts",
  "j.subtotalAmount && j.subtotalAmount > 0 ? j.subtotalAmount : j.price"
);

// The enforcement mechanism itself: the money columns are REQUIRED on the
// reporting shape, so a `select` that drops one fails to compile instead of
// silently reverting to the bare price. If this line goes, the guarantee goes.
has(
  "3.4 · RevenueJobShape extends ActiveValueJob (a missing column is a build error)",
  "src/lib/metrics-shared.ts",
  "export interface RevenueJobShape extends ActiveValueJob"
);
has(
  "3.4 · one shared select fragment for every revenue caller",
  "src/lib/metrics.ts",
  "export const ACTIVE_VALUE_SELECT"
);

// ───────────────────────────────────────────────────────────────────────────
console.log("\n── Stage 2 · explicit pricing modes (PDF fix 2) ──");

// An imported/override job whose stored total ALREADY contains the grout:
// selecting grout for scope must itemise, never add.
const overrideJob: JobMoneyJob = {
  bookingSource: "bookingkoala_import",
  price: 186,
  discountAmount: 0,
  subtotalAmount: 186,
  gstAmount: 9.3,
  qstAmount: 18.55,
  totalAmount: 213.85,
  addOns: [{ name: "Grout Cleaning (Per Room)", price: 0, quantity: 2 }],
};
check(
  "an INCLUSIVE $186 job with grout for scope stays $186",
  computeJobMoney(overrideJob, RATES).subtotalAmount,
  186
);
check(
  "…and labels the add-ons as included rather than adding them",
  computeJobMoney(overrideJob, RATES).addOnsIncludedInSubtotal,
  true
);
// The same job priced ADDITIVELY is the mode bug: $186 + $58 = $244.
check(
  "the same rows read ADDITIVELY would double-charge the grout",
  computeJobMoney(
    { ...overrideJob, bookingSource: null, addOns: groutJob.addOns },
    RATES
  ).subtotalAmount,
  244
);

ok(
  "2.1 · Job.pricingMode exists in the schema",
  /pricingMode\s+JobPricingMode\?/.test(read("prisma/schema.prisma"))
);
ok(
  "2.1 · …as a two-value enum",
  /enum JobPricingMode \{\s*ITEMIZED\s*FINAL_PRICE\s*\}/.test(
    read("prisma/schema.prisma")
  )
);
{
  // The backfill has to be the addOnMoneyBasis truth table, or it re-prices
  // live jobs. Both halves asserted, plus the `web %` arm that catches
  // 'web (referral)' — dropping it would leave referral bookings itemized.
  const mig = read(
    "prisma/migrations/20260814000000_job_pricing_mode/migration.sql"
  );
  ok("2.1 · the migration creates the enum type", mig.includes('CREATE TYPE "JobPricingMode"'));
  ok("2.1 · …adds the column nullable (no DEFAULT, no NOT NULL)", /ADD COLUMN "pricingMode" "JobPricingMode";/.test(mig));
  ok("2.1 · …backfills the inclusive sources to FINAL_PRICE", /SET "pricingMode" = 'FINAL_PRICE'/.test(mig));
  ok("2.1 · …including 'web (referral)' via the LIKE arm", mig.includes("LIKE 'web %'"));
  ok("2.1 · …and everything else to ITEMIZED", /SET "pricingMode" = 'ITEMIZED'\s*\nWHERE "pricingMode" IS NULL;/.test(mig));
}

ok(
  "2.2 · job-money exports resolvePricingMode",
  read("src/lib/job-money.ts").includes("export function resolvePricingMode")
);
// The fallback is what makes the column safe to roll out: a row with no mode
// must price exactly as it did before, off `bookingSource`.
check("2.2 · an unstamped admin job falls back to ITEMIZED", resolvePricingMode({ bookingSource: null }), "ITEMIZED");
check("2.2 · an unstamped web booking falls back to FINAL_PRICE", resolvePricingMode({ bookingSource: "web" }), "FINAL_PRICE");
check("2.2 · …'web (referral)' too", resolvePricingMode({ bookingSource: "web (referral)" }), "FINAL_PRICE");
check("2.2 · …and a BookingKoala import", resolvePricingMode({ bookingSource: "bookingkoala_import" }), "FINAL_PRICE");
check(
  "2.2 · a stamped mode BEATS the provenance it contradicts",
  resolvePricingMode({ pricingMode: "ITEMIZED", bookingSource: "bookingkoala_import" }),
  "ITEMIZED"
);
check(
  "2.2 · …in the other direction as well",
  resolvePricingMode({ pricingMode: "FINAL_PRICE", bookingSource: null }),
  "FINAL_PRICE"
);
check(
  "2.2 · garbage in the column is not trusted — it falls back",
  resolvePricingMode({ pricingMode: "NONSENSE", bookingSource: "web" }),
  "FINAL_PRICE"
);
check(
  "2.2 · computeJobMoney reports the mode it ran under",
  computeJobMoney(overrideJob, RATES).pricingMode,
  "FINAL_PRICE"
);
check(
  "2.2 · …and whether it was chosen or merely inferred",
  [
    computeJobMoney(overrideJob, RATES).pricingModeIsExplicit,
    computeJobMoney({ ...overrideJob, pricingMode: "FINAL_PRICE" }, RATES)
      .pricingModeIsExplicit,
  ],
  [false, true]
);

// ── 2.7 acceptance · the PDF's own cases ───────────────────────────────────

// (a) An imported $186 job that ALREADY includes the grout: selecting grout for
//     scope keeps every money surface at $186.
const stampedOverride: JobMoneyJob = { ...overrideJob, pricingMode: "FINAL_PRICE" };
check(
  "2.7a · a FINAL_PRICE $186 job with grout selected for scope stays $186",
  computeJobMoney(stampedOverride, RATES).subtotalAmount,
  186
);
check(
  "2.7a · …and its taxed total is untouched too",
  computeJobMoney(stampedOverride, RATES).totalAmount,
  213.85
);
// The grout priced for real, not the BK $0 rows — proves the MODE is doing the
// work, not the happy accident that imported rows carry no price.
const overridePricedRows: JobMoneyJob = {
  ...stampedOverride,
  addOns: groutJob.addOns,
};
check(
  "2.7a · …even when those add-on rows carry real unit prices",
  computeJobMoney(overridePricedRows, RATES).subtotalAmount,
  186
);
check(
  "2.7a · …with the rows labelled as included rather than added",
  computeJobMoney(overridePricedRows, RATES).addOnsIncludedInSubtotal,
  true
);

// (b) The same job after "Recalculate From Items" — base + items math, and the
//     figure the button offers is the figure it produces.
const recalculated: JobMoneyJob = { ...overridePricedRows, pricingMode: "ITEMIZED" };
check(
  "2.7b · Recalculate From Items switches it to base + items ($186 + $58)",
  computeJobMoney(recalculated, RATES).subtotalAmount,
  244
);
check(
  "2.7b · …and the button's advertised figure is exactly what it lands on",
  computeJobMoney(overridePricedRows, RATES).itemizedSubtotal,
  computeJobMoney(recalculated, RATES).subtotalAmount
);
check(
  "2.7b · …and it stops calling the add-ons included",
  computeJobMoney(recalculated, RATES).addOnsIncludedInSubtotal,
  false
);

// (c) An admin itemized job: add-ons still add (no regression on AWER item 10).
check(
  "2.7c · an explicitly ITEMIZED admin job still adds its add-ons",
  computeJobMoney({ ...groutJob, pricingMode: "ITEMIZED" }, RATES).subtotalAmount,
  186
);
check(
  "2.7c · …identically to the same job with no mode stamped at all",
  computeJobMoney({ ...groutJob, pricingMode: "ITEMIZED" }, RATES).subtotalAmount,
  computeJobMoney(groutJob, RATES).subtotalAmount
);

// (d) Editing a FINAL_PRICE job's price does not flip its mode. This is the
//     `priceUnchanged` bug in one line: the mode must not be a function of
//     whether the price field still matches what was stored.
// Built from the REAL-priced grout rows, so the two readings actually differ:
// with $0 import rows the mode makes no arithmetic difference and the assertion
// below would pass for the wrong reason.
const repriced: JobMoneyJob = {
  ...overridePricedRows,
  price: 210,
  subtotalAmount: 210,
  gstAmount: 0,
  qstAmount: 0,
  totalAmount: 0,
};
check(
  "2.7d · retyping a FINAL_PRICE job's price keeps it FINAL_PRICE",
  computeJobMoney(repriced, RATES).pricingMode,
  "FINAL_PRICE"
);
check(
  "2.7d · …and the new override total is what it charges, add-ons still inside",
  computeJobMoney(repriced, RATES).subtotalAmount,
  210
);
// The same edit under the OLD rule: provenance was discarded the moment the
// price moved, so the add-ons started adding. Asserted so the regression has a
// name if it ever comes back.
check(
  "2.7d · …whereas the old provenance-only rule would have added them ($268)",
  computeJobMoney({ ...repriced, pricingMode: null, bookingSource: null }, RATES)
    .subtotalAmount,
  268
);

// Source-level: the mode has to be stored and posted, or none of the above
// survives a save.
// The DECLARATION, not the word: saveJob's comment still names the retired
// `priceUnchanged` mechanism on purpose, and deleting that explanation would be
// a loss. What must not come back is the variable that fed the mode.
ok(
  "2.3 · saveJob no longer infers the mode from a priceUnchanged variable",
  !/const priceUnchanged\b/.test(read("src/app/admin/actions/saveJob.ts"))
);
has("2.3 · saveJob persists the mode", "src/app/admin/actions/saveJob.ts", "pricingMode,");
has(
  "2.3 · …and accepts the Recalculate From Items action",
  "src/app/admin/actions/saveJob.ts",
  'formData.get("recalculateFromItems")'
);
ok(
  "2.3 · …and logs a mode change to the job log",
  /existingPricingMode !== pricingMode[\s\S]{0,600}db\.jobLog/.test(
    read("src/app/admin/actions/saveJob.ts")
  )
);
lacks(
  "2.3 · the full-page form drops its own priceUnchanged copy too",
  "src/app/admin/jobs/new/page.tsx",
  "moneyPriceUnchanged"
);
has(
  "2.4 · the BookingKoala importer stamps FINAL_PRICE",
  "src/app/admin/actions/runBookingKoalaImport.ts",
  'pricingMode: "FINAL_PRICE"'
);
has(
  "2.4 · …so does the standalone import script",
  "scripts/importBookingKoala.ts",
  'pricingMode: "FINAL_PRICE"'
);
{
  // BOTH web job writes — the primary booking and every recurring child. A
  // child left unstamped would price its add-ons on top of a subtotal that
  // already contains them, on every visit of the series.
  const booking = read("src/app/(book)/actions/submitBooking.ts");
  check(
    "2.4 · submitBooking stamps FINAL_PRICE on both job creates",
    (booking.match(/pricingMode: "FINAL_PRICE"/g) ?? []).length,
    2
  );
}
has(
  "2.5 · the job modal offers the mode as a visible choice",
  "src/app/admin/jobs/JobModal.tsx",
  'aria-label="Pricing mode"'
);
has(
  "2.5 · …labels the price field as the service total in override mode",
  "src/app/admin/jobs/JobModal.tsx",
  "Service total (override)"
);
has(
  "2.5 · …shows BOTH totals, labelled",
  "src/app/admin/jobs/JobModal.tsx",
  "Calculated from items"
);
has(
  "2.5 · …offers Recalculate from items",
  "src/app/admin/jobs/JobModal.tsx",
  "Recalculate from items"
);
has(
  "2.5 · …posts the mode on every save",
  "src/app/admin/jobs/JobModal.tsx",
  'formData.append("pricingMode", pricingMode)'
);
has(
  "2.5 · …and keeps the add-on pickers, marked as included",
  "src/app/admin/jobs/JobModal.tsx",
  "ADDON_INCLUDED_LABEL"
);
has(
  "2.5 · the full-page job form carries the same control",
  "src/app/admin/jobs/new/PricingModeField.tsx",
  'name="pricingMode"'
);
has(
  "2.6 · job detail shows the active mode as a pill",
  "src/app/admin/jobs/[id]/JobDetailView.tsx",
  "function PricingModePill"
);
ok(
  "2.6 · …a DIFFERENT pill from the client-level fixed price",
  read("src/app/admin/jobs/[id]/JobDetailView.tsx").includes("function FixedPricePill")
);
has(
  "2.6 · …and the breakdown names both totals when they differ",
  "src/app/admin/jobs/[id]/JobDetailView.tsx",
  "Calculated itemized total"
);
{
  // The view could not have been right before: it never received
  // `bookingSource`, so computeJobMoney read every job — imports included — as
  // ADDITIVE. Assert both fields are actually handed to it.
  const detailPage = read("src/app/admin/jobs/[id]/page.tsx");
  ok(
    "2.6 · the job detail page passes the mode AND its fallback to the view",
    /bookingSource: job\.bookingSource,\s*\n\s*pricingMode: job\.pricingMode,/.test(
      detailPage
    )
  );
}

// ───────────────────────────────────────────────────────────────────────────
console.log("\n── Stage 4a · the cleaner pay basis includes add-ons (PDF fix 5) ──");

/**
 * NOTE ON THE REWRITE (Stage 4, 2026-08-14).
 *
 * Six of this stage's original `pending()` entries could never have flipped
 * green, whatever shipped, because both sides of the comparison were computed
 * from the SAME local expression — and three of them contradicted a REQUIRED
 * `check()` on that identical expression one line above, so passing one would
 * have failed the other. (Stage 3 spotted the first instance and left a note:
 * "the 4b.3 pending entry compares two local helper functions, not the app, so
 * it can never flip green no matter what ships.")
 *
 * They are rewritten below to exercise the app — `computeJobPayShares`,
 * `jobPayBasis`, `resolvePassThroughBilling` — instead of restating arithmetic,
 * and the "today" checks they contradicted are re-pointed at the raw helpers
 * they were really about. Same PDF numbers, same intent, now falsifiable.
 */

const tanya = cleaner("tanya");
check(
  "a STANDARD cleaner with no earned ratings is on 40%",
  individualRate(tanya),
  0.4
);
check(
  "computeJobPayout still pays a flat 40% of whatever basis it is handed",
  computeJobPayout(danMastJob.price, [tanya]).pool,
  40
);

// 4a.1 — THE basis. `activeSubtotal` answers "what is this job worth?" for
// revenue; `jobPayBasis` answers it for pay, and they differ only on discounts.
check("4a.1 · jobPayBasis reads Dan Mast's active value: $171", jobPayBasis(danMastJob), 171);
check("4a.1 · …and the grout job's: $186", jobPayBasis(groutJob), 186);
check(
  "4a.1 · a FINAL_PRICE job's basis is its stored override total",
  jobPayBasis({
    pricingMode: "FINAL_PRICE",
    price: 128,
    subtotalAmount: 186,
    addOns: [{ name: "Grout", price: 29, quantity: 2 }],
  }),
  186
);

/** Dan Mast as the PAY layer sees him: one STANDARD cleaner, $100 + $71. */
const danMastPayJob: JobPayInput = {
  id: "2031",
  employeeId: "tanya",
  cleaners: [{ id: "tanya" }],
  price: danMastJob.price ?? null,
  subtotalAmount: danMastJob.subtotalAmount ?? null,
  discountAmount: danMastJob.discountAmount ?? null,
  bookingSource: null,
  pricingMode: null,
  addOns: danMastJob.addOns ?? [],
  employeePay: null,
  payType: "PERCENTAGE",
  hourlyRate: null,
  totalTip: null,
  jobDate: null,
  startTime: null,
  endTime: null,
  clockInTime: null,
  clockOutTime: null,
};

// 4a.3/4a.5 — the acceptance line from the plan, run through the real function.
check(
  "4a.3 · the pay basis is the ACTIVE subtotal: $171 × 40% = $68.40",
  computeJobPayShares(danMastPayJob, rateMap(tanya)).get("tanya")?.base,
  68.4
);
check(
  "4a.3 · …not $40.00, which is what 40% of the bare base price pays",
  computeJobPayout(danMastPayJob.price, [tanya]).pool,
  40
);
check(
  "4a.3 · a job with NO add-ons is completely unmoved",
  computeJobPayShares(
    { ...danMastPayJob, addOns: [], subtotalAmount: 100 },
    rateMap(tanya)
  ).get("tanya")?.base,
  40
);

has(
  "4a.1 · the helper lives beside the other money definitions",
  "src/lib/job-money.ts",
  "export function jobPayBasis"
);
has(
  "4a.3 · …and the pay calculation is what calls it",
  "src/lib/cleaner-earnings.ts",
  "const payBasis = jobPayBasis(job)"
);
ok(
  "4a.2 · JOB_PAY_SELECT carries the add-on rows",
  /JOB_PAY_SELECT[\s\S]{0,900}addOns/.test(read("src/lib/cleaner-earnings.ts"))
);
ok(
  "4a.2 · …and the four columns the basis is computed from",
  ["bookingSource: true", "pricingMode: true", "subtotalAmount: true", "discountAmount: true"].every(
    (needle) => new RegExp(`JOB_PAY_SELECT[\\s\\S]{0,900}${needle}`).test(
      read("src/lib/cleaner-earnings.ts")
    )
  )
);
has(
  "4a.4 · saveJob's stored estimate is taken off the same basis",
  "src/app/admin/actions/saveJob.ts",
  "computeJobPayout(payBasis, rateList)"
);

// D5 — the discount reduces REVENUE but never the pay basis. Both halves are
// asserted, because the whole point of D5 is that the two figures differ.
const discounted: JobMoneyJob = { ...danMastJob, discountAmount: 20 };
check("D5 · a $20 discount takes revenue to $151", activeSubtotal(discounted), 151);
check("D5 · …and leaves the cleaner's basis at $171", jobPayBasis(discounted), 171);
check(
  "D5 · so the cleaner is still paid $68.40, not $60.40",
  computeJobPayShares(
    { ...danMastPayJob, discountAmount: 20 },
    rateMap(tanya)
  ).get("tanya")?.base,
  68.4
);

// ───────────────────────────────────────────────────────────────────────────
console.log("\n── Stage 4b/4c · tips, parking and the manual team total (PDF fix 4) ──");

// PDF page 4 · the BookingKoala tooltip, and job #1809 in this database:
// $177 job, $88.55 stored team pay, 2 cleaners, $17.70 tip, $20 parking.
// The PDF rounds the stored figure to $88.50; both are asserted so neither the
// document's number nor the database's can drift unnoticed.
const viktoriia = cleaner("viktoriia");
const ahmed = cleaner("ahmed");
const rates2 = rateMap(viktoriia, ahmed);

const job1809: JobPayInput = {
  id: "1809",
  employeeId: "ahmed",
  cleaners: [{ id: "viktoriia" }, { id: "ahmed" }],
  price: 177,
  employeePay: 88.55,
  payType: "PERCENTAGE",
  hourlyRate: null,
  totalTip: 17.7,
  parking: 20,
  jobDate: null,
  startTime: null,
  endTime: null,
  clockInTime: null,
  clockOutTime: null,
  assignments: [
    { cleanerId: "viktoriia", payAmount: null },
    { cleanerId: "ahmed", payAmount: null },
  ],
};

// ── D1 REGRESSION GUARD — required, today and forever. ─────────────────────
// With no AUTHORITATIVE team pay, the per-cleaner full-rate model must survive:
// the pooled halving was retired by the client (awer_fixes.pdf item 3) and
// reinstating it silently reverses a decided item. Note the fixture carries a
// stored $88.55 but no manual flag, which is exactly the "stale snapshot" case.
const shares1809 = computeJobPayShares(job1809, rates2);
check(
  "D1 · an UNFLAGGED stored $88.55 is still a snapshot — each cleaner earns 40%",
  [shares1809.get("viktoriia")?.base, shares1809.get("ahmed")?.base],
  [70.8, 70.8]
);
check(
  "D1 · …so that job books $141.60 of labour, 80% of the price, as decided",
  round2((shares1809.get("viktoriia")?.base ?? 0) + (shares1809.get("ahmed")?.base ?? 0)),
  141.6
);
lacks(
  "D1 · the retired pool fraction is still unused by any pay path",
  "src/lib/cleaner-earnings.ts",
  "SPLIT_POOL_FRACTION"
);
has(
  "D1 · …and is still documented as retired",
  "src/lib/pay-tiers.ts",
  "@deprecated"
);

// ── 4b.1 · tips AND parking are per-cleaner pass-throughs ──────────────────
check(
  "4b.1 · tips split evenly and are never multiplied",
  [shares1809.get("viktoriia")?.tip, shares1809.get("ahmed")?.tip],
  [8.85, 8.85]
);
check(
  "4b.1 · parking splits the same way — $20 over two cleaners",
  [shares1809.get("viktoriia")?.parking, shares1809.get("ahmed")?.parking],
  [10, 10]
);
check(
  "4b.1 · total = base + tip + parking",
  shares1809.get("ahmed")?.total,
  round2(70.8 + 8.85 + 10)
);

// ── 4c.3 · D2: the flag turns employeePay into an authoritative TEAM TOTAL ──
const manual1809: JobPayInput = { ...job1809, employeePayIsManual: true };
const sharesManual = computeJobPayShares(manual1809, rates2);
/**
 * Sorted, deliberately: an odd team total leaves one cent over, and WHICH
 * cleaner absorbs it falls out of `jobParticipantIds` ordering (lead first,
 * then the assigned list) — a detail no requirement pins down and no admin can
 * see. What must hold is that the pair is {$44.28, $44.27} and that it sums to
 * the agreed total exactly, which is asserted immediately below.
 */
const sortedBase = (m: Map<string, { base: number }>) =>
  [...m.values()].map((s) => s.base).sort((a, b) => a - b);
const sortedTotal = (m: Map<string, { total: number }>) =>
  [...m.values()].map((s) => s.total).sort((a, b) => a - b);

check(
  "4c.3 · manual team total $88.55 splits to $44.28 / $44.27",
  sortedBase(sharesManual),
  [44.27, 44.28]
);
check(
  "4c.3 · …and the crew is paid the agreed total to the cent, not a penny over",
  round2((sharesManual.get("viktoriia")?.base ?? 0) + (sharesManual.get("ahmed")?.base ?? 0)),
  88.55
);
check(
  "4c.6 · booking 6919: $44.28 + $8.85 + $10.00 = $63.13 / $63.12",
  sortedTotal(sharesManual),
  [63.12, 63.13]
);

// The PDF's own rounded line, asserted separately so the document's number and
// the database's can each be traced.
const sharesPdf = computeJobPayShares(
  { ...manual1809, employeePay: 88.5 },
  rates2
);
check(
  "4b.6 · PDF's own line: $44.25 + $8.85 + $10.00 = $63.10 per cleaner",
  [sharesPdf.get("viktoriia")?.total, sharesPdf.get("ahmed")?.total],
  [63.1, 63.1]
);

// Clearing the flag returns to the tier math (4c.6's second half).
check(
  "4c.6 · clearing the override returns to the per-cleaner full rate",
  computeJobPayShares({ ...manual1809, employeePayIsManual: false }, rates2).get(
    "ahmed"
  )?.base,
  70.8
);
// A per-cleaner override still comes off the top of a manual team total — the
// FLAT-path remainder logic D2 says to reuse verbatim.
check(
  "4c.3 · a per-cleaner override comes off the top, the rest splits the remainder",
  (() => {
    const s = computeJobPayShares(
      {
        ...manual1809,
        employeePay: 100,
        assignments: [
          { cleanerId: "viktoriia", payAmount: 70 },
          { cleanerId: "ahmed", payAmount: null },
        ],
      },
      rates2
    );
    return [s.get("viktoriia")?.base, s.get("ahmed")?.base];
  })(),
  [70, 30]
);

has(
  "4c.1 · Job.employeePayIsManual exists in the schema",
  "prisma/schema.prisma",
  "employeePayIsManual"
);
ok(
  "4c.1 · …with a migration that defaults it FALSE, changing no existing payout",
  /ADD COLUMN "employeePayIsManual" BOOLEAN NOT NULL DEFAULT false/.test(
    read("prisma/migrations/20260814010000_job_employee_pay_is_manual/migration.sql")
  )
);
has(
  "4c.2 · the BookingKoala importer stamps it on every CSV team payment",
  "src/app/admin/actions/runBookingKoalaImport.ts",
  "employeePayIsManual: r.job.employeePay != null"
);
has(
  "4c.2 · …and so does the standalone importer",
  "scripts/importBookingKoala.ts",
  "employeePayIsManual: !!teamPayout"
);
has(
  "4c.2 · the job form offers the clear control the PDF asks for",
  "src/app/admin/jobs/JobModal.tsx",
  "Clear — use automatic calculation"
);
has(
  "4c.2 · …and posts the answer explicitly rather than letting the server guess",
  "src/app/admin/jobs/JobModal.tsx",
  '"employeePayIsManual",'
);
ok(
  "4c.2 · saveJob reads that tri-state and preserves the stored flag when absent",
  /submittedPayIsManual === "on"[\s\S]{0,400}existingPayIsManual/.test(
    read("src/app/admin/actions/saveJob.ts")
  )
);
lacks(
  "4c.4 · the dismissive stored-value row is gone",
  "src/app/admin/jobs/[id]/JobDetailView.tsx",
  "not used"
);
// AWER round 4, fix 5 widened this label from manual-or-not to the ACTUAL basis
// (hourly-from-the-clock, hourly-estimate, flat, percentage, manual), because
// manual-or-not could not tell an hourly job apart from a tier-rate one and
// printed "automatic (tier rates)" on both. The ternary this used to pin moved
// into the shared vocabulary; the guarantee is unchanged and is asserted one
// level down — the page still labels where the number came from, and the two
// round-2 strings are still the wording for those two cases.
has(
  "4c.4 · …replaced by a labelled pay source",
  "src/app/admin/jobs/[id]/JobDetailView.tsx",
  "PAY_BASIS_SHORT_LABEL[payBasisKinds[0]]"
);
has(
  "4c.4 · …whose manual wording survives round 4",
  "src/lib/pay-basis.ts",
  'MANUAL_TEAM: "Manual amount"'
);
has(
  "4c.4 · …and whose automatic wording does too",
  "src/lib/pay-basis.ts",
  'PERCENTAGE: "Automatic (tier rates)"'
);
has(
  "4b.2 · the Financials rows name the pass-through instead of a company expense",
  "src/app/admin/jobs/[id]/JobDetailView.tsx",
  "Passed to cleaners — customer-funded, not company money"
);
lacks(
  "4b.2 · …and the old Transportation expense row is gone",
  "src/app/admin/jobs/[id]/JobDetailView.tsx",
  '<span className="finrow-label">Transportation</span>'
);
has(
  "4c.5 · the cleaner's own modal itemises the parking share too",
  "src/app/cleaners/my-jobs/PayBreakdownModal.tsx",
  "Your parking share"
);
has(
  "4b.4 · payroll pays the three-component total",
  "src/lib/pay-period.server.ts",
  "entry.base += share.total"
);

// ───────────────────────────────────────────────────────────────────────────
console.log("\n── Stage 4b.3 · tips and parking are not company money ──");

// These three formulas live inside JSX/server pages that cannot be imported
// here, so they are asserted against the source — the same technique Stage 3
// used for its seven surfaces. Each was `… − parking` (and analytics also
// `+ tips`) before this stage; a regression is a re-added term.
lacks(
  "4b.3 · the jobs list stops charging the company for parking",
  "src/app/admin/jobs/page.tsx",
  "(job.parking || 0) + productCost"
);
has(
  "4b.3 · …and its cost term is now labour + products only",
  "src/app/admin/jobs/page.tsx",
  "const costs = (job.employeePay || 0) + productCost;"
);
has(
  "4b.3 · analytics net profit drops both the tip income and the parking cost",
  "src/app/admin/analytics/page.tsx",
  "const netProfit = totalRevenue - totalEmployeePay - totalProductCost;"
);
lacks(
  "4b.3 · …with no `+ totalTips` left in any profit term",
  "src/app/admin/analytics/page.tsx",
  "totalTips -"
);
lacks(
  "4b.3 · …and no parking in the monthly or PROFIT_MARGIN cost reducers",
  "src/app/admin/analytics/page.tsx",
  "(j.parking || 0) +"
);
has(
  "4b.3 · the job page's net profit is revenue − labour − products",
  "src/app/admin/jobs/[id]/JobDetailView.tsx",
  "const netProfit = money.subtotalAmount - computedEmployeePay - totalProductCost;"
);

// ───────────────────────────────────────────────────────────────────────────
console.log("\n── D3 · tips + parking are customer-funded pass-throughs ──");

// The rule, exercised through the function saveJob actually calls. A $200 job
// taxes to $229.95; a $20 tip and $10 parking make the card charge $259.95 —
// but only if they were entered BEFORE the card was taken.
const TAXED_200 = 229.95;
const beforeCharge = resolvePassThroughBilling({
  taxedTotal: TAXED_200,
  passThrough: 30,
  settled: false,
  storedTotal: null,
});
check("4b.5 · a tip + parking entered before charging fold into the total", beforeCharge.totalAmount, 259.95);
check("4b.5 · …all of it collected on the card", [beforeCharge.collected, beforeCharge.uncollected], [30, 0]);
check(
  "4b.5 · …so resolveAmountDue bills the customer for them",
  resolveAmountDue({
    price: 200,
    discountAmount: 0,
    totalAmount: beforeCharge.totalAmount,
    depositPaid: false,
  }),
  259.95
);

// Entered AFTER payment: the amount due must NOT move (no silent recharge), and
// the shortfall must be reported so an admin can collect it in cash.
const afterPayment = resolvePassThroughBilling({
  taxedTotal: TAXED_200,
  passThrough: 30,
  settled: true,
  storedTotal: TAXED_200,
});
check("D3 · a tip added after payment never re-charges the card", afterPayment.totalAmount, 229.95);
check(
  "D3 · …it is flagged as owed to the crew but uncollected",
  [afterPayment.collected, afterPayment.uncollected],
  [0, 30]
);
check(
  "D3 · re-saving a job whose tip WAS collected does not drop it back off",
  resolvePassThroughBilling({
    taxedTotal: TAXED_200,
    passThrough: 30,
    settled: true,
    storedTotal: 259.95,
  }),
  { totalAmount: 259.95, collected: 30, uncollected: 0 }
);
has(
  "4b.5 · saveJob writes the folded total, not the bare taxed one",
  "src/app/admin/actions/saveJob.ts",
  "totalAmount: passThroughBilling.totalAmount"
);
has(
  "4b.5 · …and so does the full-page job form",
  "src/app/admin/jobs/new/page.tsx",
  "totalAmount: passThroughBilling.totalAmount"
);
has(
  "4b.5 · the job page flags a pass-through the card never took",
  "src/app/admin/jobs/[id]/JobDetailView.tsx",
  "not collected on card"
);

// ───────────────────────────────────────────────────────────────────────────
console.log("\n── Stage 1 · Settings page access (PDF fix 1, decision D6) ──");

// MATRIX, computed from the real routing helpers. `/cleaners/settings`
// re-exports the admin page, so whatever guards that page decides who reaches
// their own profile, password, availability and notification preferences.
const ROLES = ["OWNER", "ADMIN", "OPS_MANAGER", "FIELD_LEAD", "EMPLOYEE", "CLIENT"] as const;
const settingsPage = read("src/app/admin/settings/page.tsx");
const guardedByOwnerAdmin = /await requireOwnerAdmin\(\)/.test(settingsPage);
const guardedByStaff = /await requireStaff\(\)/.test(settingsPage);

const reaches = (role: string) => {
  if (guardedByStaff) return !isClientRole(role);
  if (guardedByOwnerAdmin) return role === "OWNER" || role === "ADMIN";
  return true; // no guard at all
};
// D6: one shared page, guarded with requireStaff — every role but CLIENT.
check(
  "role → can open Settings",
  ROLES.map((r) => `${r}:${reaches(r) ? "yes" : "no"}`),
  [
    "OWNER:yes",
    "ADMIN:yes",
    "OPS_MANAGER:yes",
    "FIELD_LEAD:yes",
    "EMPLOYEE:yes",
    "CLIENT:no",
  ]
);
check("a bounced CLIENT lands on the customer home", homeForRole("CLIENT"), "/");
check(
  "…and an EMPLOYEE who IS bounced lands in a loop back to my-jobs",
  homeForRole("EMPLOYEE"),
  "/cleaners/my-jobs"
);

has(
  "the shared settings page guards with requireStaff",
  "src/app/admin/settings/page.tsx",
  "requireStaff()"
);
has(
  "/cleaners/settings still re-exports the shared page",
  "src/app/cleaners/settings/page.tsx",
  'export { default } from "@/app/admin/settings/page"'
);
has(
  "admin-only data is still fetched behind isAdmin",
  "src/app/admin/settings/page.tsx",
  "isAdmin"
);
has(
  "admin-only tabs are still flagged in the client",
  "src/app/admin/settings/SettingsClient.tsx",
  "adminOnly: true"
);

// 1.3 — one failing section must not take the page down with it.
has(
  "the settings route has an error boundary",
  "src/app/admin/settings/error.tsx",
  '"use client"'
);
has(
  "…with a retry affordance",
  "src/app/admin/settings/error.tsx",
  "reset"
);
has(
  "…on the cleaner route too (boundaries are per segment)",
  "src/app/cleaners/settings/error.tsx",
  'export { default } from "@/app/admin/settings/error"'
);
has(
  "settings queries degrade per-section instead of throwing the page",
  "src/app/admin/settings/page.tsx",
  "settledSection"
);
ok(
  "…including the notification catalog, which used to run bare",
  /settledSection\(\s*"notificationSettings"/.test(settingsPage)
);
has(
  "…and the page tells the client which section failed",
  "src/app/admin/settings/SettingsClient.tsx",
  "failedSections"
);
lacks(
  "no settings query is left in a bare Promise.all that can throw the page",
  "src/app/admin/settings/page.tsx",
  "await Promise.all([\n        db."
);

// 1.5 — the unbounded transaction read.
ok(
  "the Budgets transaction read is bounded",
  /db\.transaction\.findMany\(\{[\s\S]{0,400}?take:/.test(settingsPage)
);
ok(
  "…and windowed to recent rows",
  /db\.transaction\.findMany\(\{[\s\S]{0,400}?date: \{ gte:/.test(settingsPage)
);

// 1.4 — every save path surfaces its error rather than swallowing it.
{
  const tabsDir = "src/app/admin/settings/tabs";
  const callers = fs
    .readdirSync(tabsDir)
    .filter((f) => f.endsWith(".tsx"))
    .filter((f) => read(`${tabsDir}/${f}`).includes("updateAppSetting("));
  const swallowed = callers.filter((f) => {
    const src = read(`${tabsDir}/${f}`);
    // A caller is safe when it reads `.success` off the result — the shape
    // updateAppSetting returns on a validation failure. Matching `.error` too
    // would let `console.error` alone count as handling.
    return !/\.success\b/.test(src);
  });
  check("every updateAppSetting caller inspects the result", swallowed, []);
  ok("…and there is more than one such caller to inspect", callers.length > 10);
}
has(
  "updateAppSetting still returns the failure instead of throwing",
  "src/app/admin/actions/updateAppSetting.ts",
  "return { success: false, error"
);
lacks(
  "…and no longer reports every failure as one opaque string",
  "src/app/admin/actions/updateAppSetting.ts",
  '"Failed to update setting"'
);
has(
  "…naming the setting that failed, since that is all the admin sees",
  "src/app/admin/actions/updateAppSetting.ts",
  "saveFailureMessage"
);

// ───────────────────────────────────────────────────────────────────────────
console.log("\n── Stage 5 · clock-out reliability (PDF fix 6) ──");

const CLOCK_OUT_ACTION = "src/app/admin/actions/clockOut.ts";
const CLOCK_OUT_LIB = "src/lib/clock-out.ts";
const CLOCK_SCREEN = "src/app/cleaners/my-jobs/[jobId]/clock/ClockPageClient.tsx";
const CLOCK_BUTTON = "src/app/cleaners/my-jobs/ClockOutButton.tsx";

// A kit line as the validator sees it. `quantity` is what the cleaner is
// recorded as HOLDING; `itemType` decides which vocabulary the line reports in.
const kitItem = (
  productId: string,
  quantity: number,
  over: Partial<KitItem> = {}
): KitItem => ({
  productId,
  name: productId.toUpperCase(),
  unit: "ml",
  quantity,
  itemType: "COUNTABLE_CONSUMABLE",
  ...over,
});
const kitOf = (...items: KitItem[]): ClockOutKit =>
  new Map(items.map((i) => [i.productId, i]));

/** Validated entries as a stable, comparable shape. */
const entriesOf = (v: ClosingReportValidation) =>
  v.ok
    ? v.entries
        .map((e) => ({
          productId: e.productId,
          kind: e.kind,
          quantity: e.quantity,
          level: e.levelStatus,
          status: e.status,
          condition: e.condition,
        }))
        .sort((a, b) => a.productId.localeCompare(b.productId))
    : null;
const failureOf = (v: ClosingReportValidation) =>
  v.ok ? null : { code: v.failure.code, field: v.failure.field?.productId ?? null };

const report = (...items: ClosingReport["items"]): ClosingReport => ({ items });

// ── 5.2 · the payload the page-6 screenshot submits ───────────────────────
// The reported failure was an all-blank submit on a kit full of items nobody
// had touched. Since Stage 3 that IS the design — "No changes" submits an empty
// list — so these assert the cheapest clock-out there is stays the cheapest, and
// that an untouched kit can never block a cleaner going home.
{
  const kit = kitOf(
    kitItem("spray", 500, { itemType: "LIQUID" }),
    kitItem("rags", 12, { itemType: "REUSABLE_EQUIPMENT", unit: "ea" }),
    kitItem("gloves", 4, { unit: "ea" })
  );

  check(
    "5.2a the No-changes fast path validates and writes nothing",
    entriesOf(validateClosingReport(report(), kit)),
    []
  );
  check(
    "…as does a payload with no items list at all",
    entriesOf(validateClosingReport({}, kit)),
    []
  );
  check(
    "…and a null payload, rather than throwing on `.items`",
    entriesOf(validateClosingReport(null, kit)),
    []
  );

  // Each vocabulary lands on its own kind, and NOTHING is deducted: a level and
  // a condition both leave `quantity` exactly where the kit had it. That is the
  // property the whole stage exists for.
  check(
    "5.2b a level report moves no quantity",
    entriesOf(
      validateClosingReport(
        report({ productId: "spray", kind: "LEVEL", levelStatus: "EMPTY" }),
        kit
      )
    ),
    [
      {
        productId: "spray",
        kind: "LEVEL",
        quantity: 500,
        level: "EMPTY",
        status: null,
        condition: null,
      },
    ]
  );
  check(
    "…a condition report moves no quantity either",
    entriesOf(
      validateClosingReport(
        report({ productId: "rags", kind: "CONDITION", condition: "DAMAGED" }),
        kit
      )
    ),
    [
      {
        productId: "rags",
        kind: "CONDITION",
        quantity: 12,
        level: null,
        status: null,
        condition: "DAMAGED",
      },
    ]
  );
  check(
    "…and a count SETS what is left rather than subtracting from it",
    entriesOf(
      validateClosingReport(
        report({ productId: "gloves", kind: "COUNT", quantity: 1, status: "LOW" }),
        kit
      )
    ),
    [
      {
        productId: "gloves",
        kind: "COUNT",
        quantity: 1,
        level: null,
        status: "LOW",
        condition: null,
      },
    ]
  );
  // A status with no number is a legitimate report ("I can't find them").
  check(
    "…a status with no count keeps the count the kit already had",
    entriesOf(
      validateClosingReport(
        report({ productId: "gloves", kind: "COUNT", status: "MISSING" }),
        kit
      )
    ),
    [
      {
        productId: "gloves",
        kind: "COUNT",
        quantity: 4,
        level: null,
        status: "MISSING",
        condition: null,
      },
    ]
  );

  // "Identify the exact field or inventory item" — each of these names one.
  check(
    "5.2c a negative count is rejected AND names the product",
    failureOf(
      validateClosingReport(
        report({ productId: "gloves", kind: "COUNT", quantity: -5 }),
        kit
      )
    ),
    { code: "INVALID_USAGE", field: "gloves" }
  );
  check(
    "…so is a fractional one",
    failureOf(
      validateClosingReport(
        report({ productId: "gloves", kind: "COUNT", quantity: 1.5 }),
        kit
      )
    ),
    { code: "INVALID_USAGE", field: "gloves" }
  );
  check(
    "…and a blank COUNT row with nothing else on it",
    failureOf(
      validateClosingReport(report({ productId: "gloves", kind: "COUNT" }), kit)
    ),
    { code: "INVALID_USAGE", field: "gloves" }
  );
  check(
    "…a report on a product that has left the kit is its own code",
    failureOf(
      validateClosingReport(
        report({ productId: "gone", kind: "COUNT", quantity: 2 }),
        kit
      )
    ),
    { code: "PRODUCT_NOT_IN_KIT", field: "gone" }
  );

  // THE type rule. A liquid has a level, a tool has a condition, and a client
  // sending the wrong one is refused rather than writing "Damaged" onto a bottle
  // of Windex — a status an admin cannot act on, in a column that does not mean
  // that for this product.
  check(
    "5.2d a condition reported against a liquid is refused",
    failureOf(
      validateClosingReport(
        report({ productId: "spray", kind: "CONDITION", condition: "DAMAGED" }),
        kit
      )
    ),
    { code: "INVALID_USAGE", field: "spray" }
  );
  check(
    "…and a level reported against a tool",
    failureOf(
      validateClosingReport(
        report({ productId: "rags", kind: "LEVEL", levelStatus: "HALF" }),
        kit
      )
    ),
    { code: "INVALID_USAGE", field: "rags" }
  );
  check(
    "…as is a level the enum doesn't have",
    failureOf(
      validateClosingReport(
        report({
          productId: "spray",
          kind: "LEVEL",
          levelStatus: "MOSTLY" as never,
        }),
        kit
      )
    ),
    { code: "INVALID_USAGE", field: "spray" }
  );

  // A re-rendered row must not be able to fail a clock-out with a duplicate.
  check(
    "5.2e the same product twice is a correction, not a conflict",
    entriesOf(
      validateClosingReport(
        report(
          { productId: "spray", kind: "LEVEL", levelStatus: "FULL" },
          { productId: "spray", kind: "LEVEL", levelStatus: "LOW" }
        ),
        kit
      )
    ),
    [
      {
        productId: "spray",
        kind: "LEVEL",
        quantity: 500,
        level: "LOW",
        status: null,
        condition: null,
      },
    ]
  );

  // A malformed payload used to reach `for (const s of usage.sprays)` and throw
  // a TypeError, which the catch-all printed as "Failed to clock out".
  check(
    "5.2f a payload that is not a list is a named failure, not a TypeError",
    failureOf(
      validateClosingReport(
        { items: "everything" as unknown as ClosingReport["items"] },
        kit
      )
    ),
    { code: "INVALID_USAGE", field: null }
  );
  ok(
    "…and its message tells the cleaner what to do, not what threw",
    /reopen the clock-out form/i.test(
      (
        validateClosingReport(
          { items: 3 as unknown as ClosingReport["items"] },
          kit
        ) as { failure: { error: string } }
      ).failure.error
    )
  );
}

// ── 5.2 · error classification, and what the cleaner is told ───────────────
{
  const prismaError = (code: string, message = "") =>
    Object.assign(new Error(message), { name: "PrismaClientKnownRequestError", code });

  check(
    "5.2f a pooler/transaction timeout reads as a timeout and offers Retry",
    (() => {
      const c = classifyClockOutError(prismaError("P2024"));
      return { code: c.code, retryable: c.retryable };
    })(),
    { code: "DB_TIMEOUT", retryable: true }
  );
  check(
    "…an unreachable database reads as a connection problem",
    (() => {
      const c = classifyClockOutError(prismaError("P1001"));
      return { code: c.code, retryable: c.retryable };
    })(),
    { code: "DB_UNAVAILABLE", retryable: true }
  );
  check(
    "…a bare TypeError still gets a code and a retryable answer",
    (() => {
      const c = classifyClockOutError(new TypeError("x is not iterable"));
      return { code: c.code, retryable: c.retryable };
    })(),
    { code: "DB_ERROR", retryable: true }
  );
  check(
    "…and Prisma's interactive-transaction message is read as a timeout",
    classifyClockOutError(new Error("Transaction already closed")).code,
    "DB_TIMEOUT"
  );
  ok(
    "no classified message is the old blanket string",
    ["P2024", "P1001", "P2010"].every(
      (c) => classifyClockOutError(prismaError(c)).error !== "Failed to clock out"
    )
  );

  // The log records the CLASS, never the message: Prisma puts the failing query
  // — and therefore row data — in `message`.
  check(
    "5.3a the logged error class carries the Prisma code",
    clockOutErrorClass(prismaError("P2024", "Timed out fetching a connection")),
    "PrismaClientKnownRequestError(P2024)"
  );
  ok(
    "…and never the error message",
    !clockOutErrorClass(prismaError("P2024", "SELECT secret FROM Job")).includes(
      "secret"
    )
  );
}

// ── 5.3 · the failure log an admin actually reads ──────────────────────────
{
  const kit = kitOf(
    kitItem("spray", 500, { name: "All-Purpose Spray", itemType: "LIQUID" })
  );

  ok(
    "5.3b the log summary names products and what was reported",
    /All-Purpose Spray → EMPTY/.test(
      describeReportForLog(
        report({ productId: "spray", kind: "LEVEL", levelStatus: "EMPTY" }),
        kit
      )
    )
  );
  ok(
    "…and says so plainly when nothing was reported",
    /no inventory changes reported/.test(describeReportForLog(report(), kit))
  );
  ok(
    "…and records the rejection code when the payload was the problem",
    /PRODUCT_NOT_IN_KIT/.test(
      describeReportForLog(
        report({ productId: "gone", kind: "COUNT", quantity: 1 }),
        kit
      )
    )
  );
  // A log row is read by an admin, so nothing the cleaner typed reaches it —
  // only our own product names and our own enum values.
  ok(
    "…and never echoes the cleaner's free text",
    !describeReportForLog(
      report({
        productId: "spray",
        kind: "LEVEL",
        levelStatus: "LOW",
        note: "<script>alert(1)</script>",
      }),
      kit
    ).includes("script")
  );
}

// ── Source assertions — the parts that need a session or a database ────────
ok(
  "5.2 clock-out names the failing product instead of one blanket string",
  /field:\s*\{/.test(read(CLOCK_OUT_ACTION))
);
lacks(
  "…and the blanket string itself is gone from the action",
  CLOCK_OUT_ACTION,
  '"Failed to clock out"'
);
has(
  "5.3 failed clock-outs are written to the job log",
  CLOCK_OUT_ACTION,
  "CLOCK_OUT_FAILED"
);
has(
  "…with the log write itself best-effort, so it can never be the failure",
  CLOCK_OUT_ACTION,
  "console.error(\"clock-out failure log\""
);
has(
  "…and the enum value exists in the schema",
  "prisma/schema.prisma",
  "CLOCK_OUT_FAILED"
);
has(
  "…with a migration that adds it",
  "prisma/migrations/20260814020000_job_log_clock_out_failed/migration.sql",
  "ALTER TYPE \"JobLogAction\" ADD VALUE 'CLOCK_OUT_FAILED'"
);
ok(
  "…and it is NOT in the customer-facing booking timeline allowlist",
  !/"CLOCK_OUT_FAILED"/.test(
    read("src/app/(customer)/(secured)/bookings/[id]/page.tsx")
  )
);
has(
  "…while the admin Activity timeline gives it its own icon",
  "src/app/admin/jobs/[id]/JobDetailView.tsx",
  "case 'CLOCK_OUT_FAILED'"
);

// Stage 3 removed the supplies transaction outright (decision D2) — it was
// priced from the estimated usage, so there is no longer a budget category to
// resolve at all. Asserting its ABSENCE is strictly stronger than the old
// "resolve it before the ops array" ordering check it replaces.
lacksInCode(
  "5.4/3.3 no supplies budget category is resolved during clock-out any more",
  CLOCK_OUT_ACTION,
  "requireBudgetCategoryId"
);
lacksInCode(
  "…and no per-job supplies Transaction is created",
  CLOCK_OUT_ACTION,
  "db.transaction.create("
);
has(
  "5.4 a retry after a post-transaction failure resumes instead of refusing",
  CLOCK_OUT_ACTION,
  "findRecentlyClosedSession"
);
has(
  "…exported from the session store with an explicit window",
  "src/lib/work-sessions.server.ts",
  "export async function findRecentlyClosedSession"
);
ok(
  "…and the window is minutes, not hours (a second shift must not resume)",
  CLOCK_OUT_RESUME_WINDOW_MS > 60_000 && CLOCK_OUT_RESUME_WINDOW_MS <= 30 * 60_000
);
ok(
  "5.4 the resume path cannot double-deduct: there is exactly ONE transaction",
  (read(CLOCK_OUT_ACTION).match(/db\.\$transaction\(/g) ?? []).length === 1
);
has(
  "…and a committed-but-unfinished clock-out is reported as saved, not failed",
  CLOCK_OUT_ACTION,
  "SYNC_INCOMPLETE"
);
has(
  "…keyed on the closed session rather than on matching inventory",
  CLOCK_OUT_ACTION,
  "resumed: true"
);
has(
  "…and a stale tab resubmitting real usage is told so, not answered “done”",
  CLOCK_OUT_ACTION,
  "ALREADY_CLOCKED_OUT"
);

has(
  "5.6 per-product audit rows are one batched write, not one each",
  CLOCK_OUT_ACTION,
  "db.inventoryChange.createMany"
);
has(
  "…and so are the per-product job logs",
  CLOCK_OUT_ACTION,
  "db.jobLog.createMany"
);
// Stage 3: the estimated-usage row is not written at all any more. The table
// stays readable (decision D4); nothing adds to it.
lacksInCode(
  "3.3 clock-out no longer writes JobProductUsage",
  CLOCK_OUT_ACTION,
  "jobProductUsage"
);
lacksInCode(
  "…and never converts sprays to millilitres",
  CLOCK_OUT_ACTION,
  "ML_PER_SPRAY"
);

// 5.5 — both modals, because the checklist gate shipped on one of them first
// and the same divergence would be just as easy to reintroduce here.
for (const [label, path] of [
  ["clock screen", CLOCK_SCREEN],
  ["job-page button", CLOCK_BUTTON],
] as const) {
  has(`5.5 the ${label} offers Retry on a retryable failure`, path, "onRetry");
  has(
    `…and resubmits the SAME payload rather than re-reading the inputs`,
    path,
    "?? buildUsage()"
  );
  ok(
    `…and guards re-entry inside the handler, not only on the button`,
    /if \((co)?[Ll]oading\) return;/.test(read(path))
  );
  lacks(
    `…and no longer falls back to the blanket string`,
    path,
    '"Failed to clock out"'
  );
  // `parseFloat(x ?? "0")` reads a MISSING key as "zero remaining", i.e. the
  // cleaner used their entire stock of that product. Found while wiring 5.5.
  ok(
    `…and a missing remaining value is untouched, not the whole stock`,
    !/parseFloat\([^)]*\?\? "0"\)/.test(read(path))
  );
  // Stage 3: ONE report component, imported by both screens. The estimated
  // survey shipped twice, and that is how the two drifted apart.
  has(
    `…and the ${label} renders the shared closing report`,
    path,
    "<ClosingInventoryReport"
  );
  lacksInCode(
    `…rather than its own copy of the usage pickers`,
    path,
    "SPRAY_OPTIONS"
  );
}
has(
  "5.5 the failure notice is one shared component across both modals",
  "src/app/cleaners/my-jobs/ClockOutError.tsx",
  "export function ClockOutErrorNotice"
);
ok(
  "…and a saved-but-unfinished clock-out is not painted as an error",
  /SYNC_INCOMPLETE/.test(read("src/app/cleaners/my-jobs/ClockOutError.tsx"))
);

// The pure rules have to stay pure or the checks above stop being runnable
// without a database — which is the whole reason they live in their own module.
{
  const lib = codeOf(CLOCK_OUT_LIB);
  const imports = [...lib.matchAll(/from "([^"]+)"/g)].map((m) => m[1]);
  // It may import the two PURE vocabulary modules it validates against — and
  // nothing else. Asserted transitively: each of those must itself import
  // nothing, so no `db`, `auth` or `@prisma/client` can arrive one hop away and
  // make these checks un-runnable without a database.
  const PURE = ["./inventory-status", "./item-type"];
  check(
    "the clock-out rules module imports only pure local vocabularies",
    imports.filter((i) => !PURE.includes(i)),
    []
  );
  for (const dep of imports) {
    const depSrc = codeOf(`src/lib/${dep.replace("./", "")}.ts`);
    check(
      `…and ${dep} imports nothing at all`,
      [...depSrc.matchAll(/from "([^"]+)"/g)].map((m) => m[1]),
      []
    );
  }
}

// ───────────────────────────────────────────────────────────────────────────
console.log("\n── Stage 6 · Applicant portal access model (PDF item 7, decision D4) ──");

// BEHAVIOUR — the real routing helpers, not restated by hand.
check("APPLICANT is not an admin role", isAdminRole("APPLICANT"), false);
check("APPLICANT is not the cleaner role", isCleanerRole("APPLICANT"), false);
check("APPLICANT is not the client role", isClientRole("APPLICANT"), false);
check("APPLICANT is recognised by isApplicantRole", isApplicantRole("APPLICANT"), true);
check("homeForRole sends an applicant to the portal", homeForRole("APPLICANT"), "/applicant");

// MATRIX — access across all seven roles for the three restricted areas,
// computed from the real routing helpers (same convention as Stage 1's
// Settings matrix). The PDF names exactly these: /cleaners/*, /admin/*
// (which covers payroll and training, both admin routes), and — via
// requireStaff, checked below — chat/documents too.
const ALL_ROLES = [
  "OWNER",
  "ADMIN",
  "OPS_MANAGER",
  "FIELD_LEAD",
  "EMPLOYEE",
  "CLIENT",
  "APPLICANT",
] as const;
check(
  "role → reaches /cleaners/* (isCleanerRole)",
  ALL_ROLES.map((r) => `${r}:${isCleanerRole(r) ? "yes" : "no"}`),
  ["OWNER:no", "ADMIN:no", "OPS_MANAGER:no", "FIELD_LEAD:no", "EMPLOYEE:yes", "CLIENT:no", "APPLICANT:no"]
);
check(
  "role → reaches /admin/* (isAdminRole) — covers payroll and training",
  ALL_ROLES.map((r) => `${r}:${isAdminRole(r) ? "yes" : "no"}`),
  ["OWNER:yes", "ADMIN:yes", "OPS_MANAGER:yes", "FIELD_LEAD:yes", "EMPLOYEE:no", "CLIENT:no", "APPLICANT:no"]
);
check(
  "role → reaches /applicant (isApplicantRole)",
  ALL_ROLES.map((r) => `${r}:${isApplicantRole(r) ? "yes" : "no"}`),
  ["OWNER:no", "ADMIN:no", "OPS_MANAGER:no", "FIELD_LEAD:no", "EMPLOYEE:no", "CLIENT:no", "APPLICANT:yes"]
);

// SOURCE — requireStaff gates /calendar, /training, /documents, /chat. It
// can't be called directly here (redirect() throws outside a request, same
// reasoning Stage 1 used for the settings guard), so this asserts the guard
// text itself — a regression there is a deleted line.
has(
  "requireStaff excludes APPLICANT (not just CLIENT) from /calendar, /training, /documents, /chat",
  "src/lib/page-guards.ts",
  "isClientRole(role) || isApplicantRole(role)"
);
has(
  "a dedicated requireApplicant guard exists for /applicant/*",
  "src/lib/page-guards.ts",
  "export async function requireApplicant()"
);
has(
  "the /applicant layout guards on isApplicantRole, same shape as /cleaners and /admin",
  "src/app/applicant/layout.tsx",
  "isApplicantRole(userWithRole.role)"
);
lacks(
  "…and never imports the cleaner sidebar",
  "src/app/applicant/layout.tsx",
  "CleanerSidebar"
);

// Rejected/archived → isActive=false, login blocked with a friendly message
// (D4), reusing the same AccountDeactivated notice /cleaners already shows.
has(
  "a deactivated applicant sees a friendly notice, not a bare redirect or error",
  "src/app/applicant/layout.tsx",
  "AccountDeactivated"
);
has(
  "rejecting or archiving an application deactivates its still-APPLICANT portal account",
  "src/app/admin/actions/updateApplicationStatus.ts",
  'role: "APPLICANT"'
);
has(
  "…and the bulk status action does the same for every selected row",
  "src/app/admin/actions/bulkSetApplicationStatus.ts",
  'role: "APPLICANT"'
);

// The invite flow: account minted on admin action, never at public submit.
lacks(
  "the public careers submission still creates no login of any kind",
  "src/app/(book)/careers/actions/submitJobApplication.ts",
  "db.user.create"
);
has(
  "JobApplication links to at most one portal account, and it starts unset",
  "prisma/schema.prisma",
  "one portal account per application"
);
has(
  "the invite token follows the ClientCardSetupToken / JobRatingToken shape",
  "prisma/schema.prisma",
  "model ApplicantInviteToken"
);
has(
  "\"Invite to portal\" mints an APPLICANT-role account, not EMPLOYEE",
  "src/app/admin/actions/inviteApplicantToPortal.ts",
  'role: "APPLICANT"'
);

// "Hire" becomes "Convert" — flips an existing portal account instead of
// always minting a second login; applications with no invite are untouched.
has(
  "hireApplicant converts an existing portal account instead of always minting a new login",
  "src/app/admin/actions/hireApplicant.ts",
  "converted: true"
);
has(
  "…and never re-downgrades a portal account that already left APPLICANT",
  "src/app/admin/actions/hireApplicant.ts",
  "Only an APPLICANT gets converted"
);

// Applicant portal MVP: status timeline, documents, checklist, messages.
has(
  "the portal renders the application status timeline",
  "src/app/applicant/ApplicantPortalClient.tsx",
  "Application status"
);
has(
  "document upload reuses the EmployeeFile plumbing under its own kind",
  "src/lib/employee-files.ts",
  "APPLICANT_DOCUMENT_KIND"
);
has(
  "the onboarding checklist is derived from real state, not a fabricated list",
  "src/app/applicant/ApplicantPortalClient.tsx",
  "documents.length > 0"
);
has(
  "respond-to-requests is a distinct channel from the private admin notes field",
  "prisma/schema.prisma",
  "model ApplicantMessage"
);

// ───────────────────────────────────────────────────────────────────────────
console.log("\n── Stage 7 · rollout, backfills and the post-deploy watch ──");

// 7.1 — the four migrations this round adds, in the order `migrate deploy` runs
// them. Filenames are timestamps, so "in order" is a property of the names
// themselves and can be asserted rather than eyeballed. A migration whose
// directory is missing is a deploy that will fail at the worst moment.
{
  const MIGRATIONS = [
    "20260814000000_job_pricing_mode",
    "20260814010000_job_employee_pay_is_manual",
    "20260814020000_job_log_clock_out_failed",
    "20260814030000_applicant_access_model",
  ];
  for (const name of MIGRATIONS) {
    ok(
      `7.1 · migration ${name} is on disk`,
      fs.existsSync(`prisma/migrations/${name}/migration.sql`)
    );
  }
  check(
    "7.1 · the four migrations sort into the order the plan lists them",
    [...MIGRATIONS].sort(),
    MIGRATIONS
  );

  // Each backfill's DDL, asserted so a hand edit that drops the stamp shows up
  // here rather than as a column full of NULLs on prod.
  has(
    "7.1 · pricingMode migration stamps FINAL_PRICE on the inclusive sources",
    "prisma/migrations/20260814000000_job_pricing_mode/migration.sql",
    `SET "pricingMode" = 'FINAL_PRICE'`
  );
  has(
    "7.1 · …and leaves no job unstamped",
    "prisma/migrations/20260814000000_job_pricing_mode/migration.sql",
    `SET "pricingMode" = 'ITEMIZED'`
  );
  has(
    "7.1 · employeePayIsManual defaults FALSE so no payout moves on deploy",
    "prisma/migrations/20260814010000_job_employee_pay_is_manual/migration.sql",
    "BOOLEAN NOT NULL DEFAULT false"
  );
  has(
    "7.1 · CLOCK_OUT_FAILED is added to JobLogAction",
    "prisma/migrations/20260814020000_job_log_clock_out_failed/migration.sql",
    `ALTER TYPE "JobLogAction" ADD VALUE 'CLOCK_OUT_FAILED'`
  );
  has(
    "7.1 · APPLICANT is added to Roles",
    "prisma/migrations/20260814030000_applicant_access_model/migration.sql",
    `ALTER TYPE "Roles" ADD VALUE 'APPLICANT'`
  );

  // Prisma's engine discards Postgres notices, so each hand-authored migration
  // carries its post-deploy count query in the header instead of a RAISE
  // NOTICE. Losing that comment loses the only record of what to check.
  for (const name of MIGRATIONS.filter((m) => !m.endsWith("clock_out_failed"))) {
    has(
      `7.1 · ${name.slice(15)} carries its post-deploy sanity query`,
      `prisma/migrations/${name}/migration.sql`,
      "Post-deploy sanity check (Stage 7.1)"
    );
  }
  // Not a bare `includes`: each header EXPLAINS why it doesn't use RAISE NOTICE,
  // so the phrase is supposed to appear — in a comment. What must not exist is
  // an executable one, whose counts Prisma's engine would silently discard.
  ok(
    "7.1 · no migration tries to log counts through an executable RAISE NOTICE",
    MIGRATIONS.every((name) =>
      read(`prisma/migrations/${name}/migration.sql`)
        .split("\n")
        .every((line) => !/RAISE\s+NOTICE/i.test(line) || line.trim().startsWith("--"))
    )
  );

  // The schema has to declare what the migrations create, or `migrate deploy`
  // succeeds and the generated client still can't read the column.
  has("7.1 · schema declares Job.pricingMode", "prisma/schema.prisma", "pricingMode");
  has(
    "7.1 · schema declares Job.employeePayIsManual",
    "prisma/schema.prisma",
    "employeePayIsManual"
  );
  has(
    "7.1 · schema declares JobLogAction.CLOCK_OUT_FAILED",
    "prisma/schema.prisma",
    "CLOCK_OUT_FAILED"
  );
  has("7.1 · schema declares Roles.APPLICANT", "prisma/schema.prisma", "APPLICANT");
}

// 7.5 — "alert on any CLOCK_OUT_FAILED row". The JobLog row is where an admin
// looks once they know to look; the alert is what tells them to.
has(
  "7.5 · a failed clock-out raises an admin alert, not just a log row",
  "src/app/admin/actions/clockOut.ts",
  "notifyAdmins("
);
has(
  "7.5 · …carrying the job it happened on, so the card is actionable",
  "src/app/admin/actions/clockOut.ts",
  "Clock-out failed — job #"
);
// The property that makes "alert on ANY CLOCK_OUT_FAILED row" true rather than
// "on most of them": the alert sits INSIDE the one logger every failure path
// already calls, so it cannot be forgotten at a new call site. Asserted as
// "exactly one notifyAdmins in the file, and more than one caller of the
// logger" — a copy pasted to a single failure branch would break the first
// half, and inlining the log at one site would break the second.
{
  const src = read("src/app/admin/actions/clockOut.ts");
  const alerts = src.split("notifyAdmins(").length - 1;
  const callers = src.split("await logClockOutFailure({").length - 1;
  check("7.5 · the alert is raised in exactly one place", alerts, 1);
  ok("7.5 · …the shared logger, which every failure path calls", callers >= 6);
}

// 7.1 + 7.5 — the script that answers both on the day of the deploy.
ok(
  "7.1/7.5 · the post-deploy check script exists",
  fs.existsSync("scripts/post-deploy-check.ts")
);
has(
  "7.1 · …reports which of the four migrations landed",
  "scripts/post-deploy-check.ts",
  "20260814030000_applicant_access_model"
);
has(
  "7.5 · …and reads CLOCK_OUT_FAILED grouped by error code",
  "scripts/post-deploy-check.ts",
  "CLOCK_OUT_FAILED"
);

// 7.3 / 7.4 — the client-facing half of the stage. These are documents, so the
// only thing a script can honestly assert is that they exist and name the
// decisions they are supposed to carry; the numbers in them are checked by the
// probe, not here.
ok(
  "7.3 · the numbers-will-move memo exists",
  fs.existsSync("NUMBERS_THAT_MOVE.md")
);
for (const d of ["D1", "D2", "D3", "D4", "D5", "D6"]) {
  has(`7.4 · ${d} is recorded in CLIENT_DECISIONS.md`, "CLIENT_DECISIONS.md", d);
}

// ───────────────────────────────────────────────────────────────────────────
console.log("\n── Housekeeping ──");

// The baseline probe is the evidence behind every number in this file, and the
// post-deploy check runs against prod on deploy day. Both must stay read-only.
{
  const writeCalls = [
    ".create(",
    ".createMany(",
    ".update(",
    ".updateMany(",
    ".upsert(",
    ".delete(",
    ".deleteMany(",
    "$executeRaw",
  ];
  for (const [name, path] of [
    ["the Stage 0 probe performs no writes", "scripts/probe-pricing-fixes.ts"],
    ["the Stage 7 post-deploy check performs no writes", "scripts/post-deploy-check.ts"],
  ] as const) {
    const src = read(path);
    check(name, writeCalls.filter((w) => src.includes(w)), []);
  }
}

console.log(
  `\n${pass} passed, ${fail} failed` +
    `\n${pendingFail} pending (expected until their stage ships)` +
    (pendingReady ? `, ${pendingReady} READY to promote to check()` : "")
);
process.exit(fail === 0 ? 0 : 1);
