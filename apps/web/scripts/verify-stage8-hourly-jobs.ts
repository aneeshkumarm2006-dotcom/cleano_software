// Verification for STAGE 8 of `_ai_context/TODO.md` — hourly jobs, first-class
// in the job modal (cleano_inventory_operations_fixes.pdf #8, p.6–7).
//
// Run: npx tsx scripts/verify-stage8-hourly-jobs.ts
//
// ⚠️ SUPERSEDED IN PART BY AWER ROUND 4, FIX 4 (`awerfixesaug18.pdf` p4).
// Stage 8 billed the UNION of the crew's time ("two cleaners for three hours is
// three billable hours"). Round 4's PDF reverses that to TOTAL CREW HOURS ("2
// cleaners × 15h is 30"), and this round's standing rule is that the PDF wins.
// Section 3 below was rewritten to the new rule rather than deleted, so the
// reversal stays visible and cannot be quietly reverted; everything else in this
// file — the service line, the rounding, the money branches, the pay
// consequence, the source sweep — is unchanged and still load-bearing.
//
// Three halves, same shape as the other verify-* scripts in this repo:
//   1. The PURE rules, exercised directly — the hourly service line, the
//      0.25h rounding, the crew-hours measurement, and the money helper's
//      three branches.
//   2. The PAY consequence: a PERCENTAGE crew on an hourly job is paid off
//      rate × hours, and an HOURLY-PAY crew is not (PDF #8's last bullet).
//   3. A SOURCE SWEEP proving both save paths changed together, that the two
//      hourly rates are never crossed, and that nothing flat-rate fires on an
//      hourly job.
//
// The DB is never touched: Stage 8's migration is deferred with the rest of the
// batch, so every check has to hold on code alone.

import fs from "node:fs";
import {
  BILLED_HOURS_INCREMENT,
  billableActualHours,
  billableCrewMinutes,
  billedHours,
  billedHoursSource,
  formatHours,
  hourlyLineLabel,
  hourlyServiceAmount,
  isBillingType,
  isHourlyBilled,
  roundBilledHours,
  JOB_BILLING_TYPES,
} from "../src/lib/hourly-billing";
import { computeJobMoney, jobPayBasis } from "../src/lib/job-money";
import { computeJobPayShares } from "../src/lib/cleaner-earnings";
import { SERIES_PROPAGATED_FIELDS } from "../src/lib/job-series";

let pass = 0;
let fail = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const okv = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${okv ? "PASS" : "FAIL"}  ${name}`);
  if (!okv) {
    console.log(
      `        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`
    );
  }
  okv ? pass++ : fail++;
}
const ok = (n: string, c: boolean) => check(n, c, true);

const read = (p: string) => fs.readFileSync(p, "utf8");
const has = (name: string, path: string, needle: string) =>
  ok(name, read(path).includes(needle));
const lacks = (name: string, path: string, needle: string) =>
  ok(name, !read(path).includes(needle));

const RATES = { gstRate: 5, qstRate: 9.975 };

/* ═══════════════ 1. THE HOURLY SERVICE LINE ═══════════════════════════════ */
// PDF #8: "Job total should calculate automatically (hourly rate x hours)".

const HOURLY_4H = {
  billingType: "HOURLY" as const,
  billedHourlyRate: 60,
  billedEstimatedHours: 4,
  billedActualHours: null,
};

check("$60/hr × 4h estimated = $240", hourlyServiceAmount(HOURLY_4H), 240);
check(
  "actual hours win over the estimate the moment they exist",
  hourlyServiceAmount({ ...HOURLY_4H, billedActualHours: 5 }),
  300
);
check("...and `billedHours` agrees", billedHours({ ...HOURLY_4H, billedActualHours: 5 }), 5);
check(
  "...and says WHICH figure it used, for labelling",
  [
    billedHoursSource(HOURLY_4H),
    billedHoursSource({ ...HOURLY_4H, billedActualHours: 5 }),
    billedHoursSource({ ...HOURLY_4H, billedEstimatedHours: null }),
  ],
  ["ESTIMATED", "ACTUAL", "NONE"]
);

// NULL, not 0. "No hourly price" and "worth nothing" are different answers, and
// computeJobMoney branches on the difference.
check("a FLAT job has no hourly line", hourlyServiceAmount({ ...HOURLY_4H, billingType: "FLAT" }), null);
check("an hourly job with no rate has no hourly line", hourlyServiceAmount({ ...HOURLY_4H, billedHourlyRate: null }), null);
check(
  "an hourly job with no hours at all has no hourly line",
  hourlyServiceAmount({ ...HOURLY_4H, billedEstimatedHours: null }),
  null
);
check("a zero rate is not a rate", hourlyServiceAmount({ ...HOURLY_4H, billedHourlyRate: 0 }), null);
ok("garbage in billingType reads as flat, i.e. today's behaviour", !isHourlyBilled({ billingType: "hourly" }));
ok("...and an absent one too", !isHourlyBilled({}));
check("the enum mirrors schema.prisma", JOB_BILLING_TYPES, ["FLAT", "HOURLY"]);
ok("isBillingType rejects anything else", !isBillingType("PERCENTAGE") && isBillingType("HOURLY"));
check("the label is one string, shared", hourlyLineLabel(HOURLY_4H), "4h × $60.00/hr = $240.00");
check("hours print without trailing zeros", [formatHours(4), formatHours(2.75)], ["4h", "2.75h"]);

/* ═══════════════ 2. ROUNDING (decision D7) ════════════════════════════════ */

check("the increment is a quarter hour", BILLED_HOURS_INCREMENT, 0.25);
check("2h47m → 2.75h", roundBilledHours(167 / 60), 2.75);
check("2h52m → 2.75h (nearest, not up)", roundBilledHours(172 / 60), 2.75);
check("2h54m → 3h", roundBilledHours(174 / 60), 3);
check("an exact figure is untouched", roundBilledHours(4), 4);
check("nothing worked is zero, never negative", [roundBilledHours(0), roundBilledHours(-3)], [0, 0]);

/* ═══════════════ 3. TOTAL CREW HOURS (round 4, fix 4) ═════════════════════ */
// REVERSED FROM STAGE 8. This block used to assert the union ("two cleaners for
// three hours is THREE billable hours") on the reasoning that the estimate is
// typed from the scheduled window and both figures needed one unit.
// `awerfixesaug18.pdf` fix 4 answers that directly — "Estimated hours = 30 means
// 1 cleaner × 30h OR 2 cleaners × 15h" — so the estimate is man-hours too, the
// units still match, and the crew sum is the rule. Both job forms now say so on
// the field itself. The expectations below are the old ones with the new
// answers, kept side by side on purpose.

const T = (h: number, m = 0) => new Date(Date.UTC(2026, 7, 17, h, m)).toISOString();

check(
  "one cleaner, 9→14, is 5 hours",
  billableCrewMinutes([{ cleanerId: "a", startedAt: T(9), endedAt: T(14) }]) / 60,
  5
);
check(
  "TWO cleaners over the same 9→14 window is 10 crew hours, not 5",
  billableCrewMinutes([
    { cleanerId: "a", startedAt: T(9), endedAt: T(14) },
    { cleanerId: "b", startedAt: T(9), endedAt: T(14) },
  ]) / 60,
  10
);
check(
  "partially overlapping crews ADD: 9→12 (3h) and 11→15 (4h) is 7 crew hours",
  billableCrewMinutes([
    { cleanerId: "a", startedAt: T(9), endedAt: T(12) },
    { cleanerId: "b", startedAt: T(11), endedAt: T(15) },
  ]) / 60,
  7
);
check(
  "one cleaner's own break comes off their own time",
  billableCrewMinutes(
    [{ cleanerId: "a", startedAt: T(9), endedAt: T(14) }],
    [{ cleanerId: "a", startedAt: T(12), endedAt: T(12, 30) }]
  ) / 60,
  4.5
);
check(
  "...and comes off THEIR hours only — the teammate still working is unaffected",
  billableCrewMinutes(
    [
      { cleanerId: "a", startedAt: T(9), endedAt: T(14) },
      { cleanerId: "b", startedAt: T(9), endedAt: T(14) },
    ],
    [{ cleanerId: "a", startedAt: T(12), endedAt: T(12, 30) }]
  ) / 60,
  9.5
);
check(
  "...and when the WHOLE crew is on break, both halves come off",
  billableCrewMinutes(
    [
      { cleanerId: "a", startedAt: T(9), endedAt: T(14) },
      { cleanerId: "b", startedAt: T(9), endedAt: T(14) },
    ],
    [
      { cleanerId: "a", startedAt: T(12), endedAt: T(12, 30) },
      { cleanerId: "b", startedAt: T(12), endedAt: T(12, 30) },
    ]
  ) / 60,
  9
);
check(
  "a legacy break row with no cleanerId cuts every cleaner's time",
  billableCrewMinutes(
    [{ cleanerId: "a", startedAt: T(9), endedAt: T(14) }],
    [{ startedAt: T(12), endedAt: T(13) }]
  ) / 60,
  4
);
check(
  "a split shift adds its pieces and nothing between them",
  billableCrewMinutes([
    { cleanerId: "a", startedAt: T(9), endedAt: T(11) },
    { cleanerId: "a", startedAt: T(13), endedAt: T(15) },
  ]) / 60,
  4
);
check("no sessions is zero, not NaN", billableCrewMinutes([], []), 0);
check(
  "the legacy job-level pair has no per-cleaner data, so it counts ONCE",
  billableCrewMinutes([{ cleanerId: null, startedAt: T(9), endedAt: T(12) }]) / 60,
  3
);
check(
  "the snapshot rounds what it measured (2h47m of work → 2.75h)",
  billableActualHours([{ cleanerId: "a", startedAt: T(9), endedAt: T(11, 47) }]),
  2.75
);
check(
  "an open session counts up to `now` so the live figure never jumps",
  billableActualHours(
    [{ cleanerId: "a", startedAt: T(9), endedAt: null }],
    [],
    new Date(Date.UTC(2026, 7, 17, 12, 0))
  ),
  3
);

/* ═══════════════ 4. THE MONEY (step 8.2) ══════════════════════════════════ */

const money4h = computeJobMoney({ ...HOURLY_4H, price: null, addOns: [] }, RATES);
check("an hourly job's base price is rate × hours", money4h.basePrice, 240);
check("...and its subtotal too", money4h.subtotalAmount, 240);
check("...and it reports the hourly line for labelling", money4h.hourlyServiceAmount, 240);
check("...taxed like anything else", money4h.totalAmount, 275.94);

check(
  "the stored `price` is IGNORED when the hourly line exists — the columns win",
  computeJobMoney({ ...HOURLY_4H, price: 999, addOns: [] }, RATES).subtotalAmount,
  240
);
check(
  "...and is the fallback when they don't, so an un-threaded select still prices",
  computeJobMoney({ price: 240, addOns: [] }, RATES).subtotalAmount,
  240
);
check(
  "a FLAT job is byte-identical to before Stage 8",
  computeJobMoney({ price: 240, discountAmount: 0, addOns: [] }, RATES),
  computeJobMoney(
    { price: 240, discountAmount: 0, addOns: [], billingType: "FLAT" },
    RATES
  )
);

// PDF #8: "unless admin manually overrides the price".
const overridden = computeJobMoney(
  { ...HOURLY_4H, pricingMode: "FINAL_PRICE", price: 200, subtotalAmount: 200, addOns: [] },
  RATES
);
check("a FINAL_PRICE override beats rate × hours", overridden.subtotalAmount, 200);
check("...and editing the hours no longer moves the total",
  computeJobMoney(
    { ...HOURLY_4H, billedEstimatedHours: 40, pricingMode: "FINAL_PRICE", price: 200, subtotalAmount: 200, addOns: [] },
    RATES
  ).subtotalAmount,
  200
);
check(
  "...but the hourly line is still reported, so the UI can show what was overridden",
  overridden.hourlyServiceAmount,
  240
);
check(
  "an override typed into a live form with nothing stored still wins (LEGACY_PRICE)",
  computeJobMoney(
    { ...HOURLY_4H, pricingMode: "FINAL_PRICE", price: 200, addOns: [] },
    RATES
  ).subtotalAmount,
  200
);

check(
  "add-ons still add on top of the hourly line",
  computeJobMoney(
    { ...HOURLY_4H, price: null, addOns: [{ name: "Fridge", price: 25, quantity: 2 }] },
    RATES
  ).subtotalAmount,
  290
);
check(
  "a discount still comes off it",
  computeJobMoney({ ...HOURLY_4H, price: null, discountAmount: 40, addOns: [] }, RATES)
    .subtotalAmount,
  200
);
check(
  '"recalculate from items" on an hourly job means rate × hours + add-ons',
  computeJobMoney(
    {
      ...HOURLY_4H,
      pricingMode: "FINAL_PRICE",
      price: 200,
      subtotalAmount: 200,
      addOns: [{ name: "Fridge", price: 25, quantity: 1 }],
    },
    RATES
  ).itemizedSubtotal,
  265
);
check(
  "tax exemption is unaffected by billing type",
  computeJobMoney({ ...HOURLY_4H, price: null, taxExempt: true, addOns: [] }, RATES)
    .totalAmount,
  240
);

/* ═══════════════ 5. CLEANER PAY (step 8.6) ════════════════════════════════ */
// PDF #8: "Cleaner pay should calculate correctly for hourly jobs based on the
// assigned pay logic." Nothing branches on billing type — the basis follows the
// money, because both go through computeJobMoney.

check(
  "the pay basis of an hourly job is rate × hours",
  jobPayBasis({ ...HOURLY_4H, price: null, addOns: [] }),
  240
);
check(
  "...and follows the actual hours once they are snapshotted",
  jobPayBasis({ ...HOURLY_4H, billedActualHours: 5, price: null, addOns: [] }),
  300
);
check(
  "...gross of the discount, exactly like a flat job (decision D5)",
  jobPayBasis({ ...HOURLY_4H, price: null, discountAmount: 40, addOns: [] }),
  240
);

const CREW_BASE = {
  id: "j1",
  employeeId: "c1",
  cleaners: [{ id: "c1" }],
  employeePay: null,
  totalTip: null,
  jobDate: null,
  startTime: null,
  endTime: null,
  clockInTime: null,
  clockOutTime: null,
  addOns: [],
  price: null,
};
const RATE_MAP = new Map([
  ["c1", { id: "c1", tier: "STANDARD" as const, multiplier: 1, avgRating: null, ratingCount: 0 }],
]);

const pctShare = computeJobPayShares(
  { ...CREW_BASE, ...HOURLY_4H, payType: "PERCENTAGE", hourlyRate: null },
  RATE_MAP
).get("c1");
const pctFlatEquivalent = computeJobPayShares(
  { ...CREW_BASE, price: 240, payType: "PERCENTAGE", hourlyRate: null },
  RATE_MAP
).get("c1");
check(
  "a PERCENTAGE crew on a $60/hr × 4h job is paid exactly as on a $240 flat job",
  pctShare?.base,
  pctFlatEquivalent?.base
);
ok("...and that is a real, non-zero payout", (pctShare?.base ?? 0) > 0);
check(
  "...and it moves with the actual hours",
  computeJobPayShares(
    { ...CREW_BASE, ...HOURLY_4H, billedActualHours: 5, payType: "PERCENTAGE", hourlyRate: null },
    RATE_MAP
  ).get("c1")?.base,
  computeJobPayShares(
    { ...CREW_BASE, price: 300, payType: "PERCENTAGE", hourlyRate: null },
    RATE_MAP
  ).get("c1")?.base
);

// The two hourly numbers must never be crossed: a job billed at $60/hr that
// pays its cleaner $25/hr pays $25/hr, and the customer's rate touches nothing.
check(
  "an HOURLY-PAY cleaner is paid `employeePay`, whatever the customer is billed",
  computeJobPayShares(
    { ...CREW_BASE, ...HOURLY_4H, payType: "HOURLY", hourlyRate: 25, employeePay: 100 },
    RATE_MAP
  ).get("c1")?.base,
  100
);
check(
  "...unchanged when the CUSTOMER's rate triples",
  computeJobPayShares(
    {
      ...CREW_BASE,
      ...HOURLY_4H,
      billedHourlyRate: 180,
      payType: "HOURLY",
      hourlyRate: 25,
      employeePay: 100,
    },
    RATE_MAP
  ).get("c1")?.base,
  100
);
check(
  "a manual team total still overrides everything (D2)",
  computeJobPayShares(
    {
      ...CREW_BASE,
      ...HOURLY_4H,
      payType: "PERCENTAGE",
      hourlyRate: null,
      employeePay: 88.5,
      employeePayIsManual: true,
    },
    RATE_MAP
  ).get("c1")?.base,
  88.5
);

/* ═══════════════ 6. SOURCE SWEEP ══════════════════════════════════════════ */

const SAVE_ACTION = "src/app/admin/actions/saveJob.ts";
const SAVE_PAGE = "src/app/admin/jobs/new/page.tsx";
const MODAL = "src/app/admin/jobs/JobModal.tsx";
const MONEY = "src/lib/job-money.ts";
const PURE = "src/lib/hourly-billing.ts";
const SERVER = "src/lib/hourly-billing.server.ts";

// ── The two save paths change TOGETHER (TODO §4's ⚠️, and step 14.3). ───────
for (const [label, path] of [
  ["the shared action", SAVE_ACTION],
  ["the full-page form", SAVE_PAGE],
] as const) {
  has(`${label} persists billingType`, path, "billingType,");
  has(`${label} persists the customer rate`, path, "billedHourlyRate,");
  has(`${label} persists both hour columns`, path, "billedEstimatedHours,");
  has(`${label} validates the rate`, path, "hourly rate for an hourly job");
  has(`${label} validates the hours`, path, "estimated hours for an hourly job");
  has(`${label} rounds hours on the way in (D7)`, path, "roundBilledHours(");
  has(`${label} derives the price through the shared helper`, path, "hourlyServiceAmount(");
  // Step 8.8 — flat-rate residential assumptions must not fire.
  has(`${label} skips sqft pricing on an hourly job`, path, 'billingType !== "HOURLY" &&');
  // The tri-state that stops a form without the control resetting the job.
  has(`${label} preserves billing when the form doesn't own the control`, path, 'formData.has("billingType")');
}

// ── The money helper stays the authority, and stays client-safe. ───────────
has("computeJobMoney asks the pure helper for the hourly line", MONEY, "hourlyServiceAmount(job)");
has("...and reports it for labelling", MONEY, "hourlyServiceAmount: hourly");
ok(
  "...and the FINAL_PRICE branches read the TYPED price, never the derived one",
  /pricingMode === "FINAL_PRICE" && storedPrice > 0/.test(read(MONEY))
);
for (const forbidden of ['from "@/db"', '"server-only"', "@/lib/stripe", "@/lib/job-billing"]) {
  ok(
    `hourly-billing.ts stays client-safe: no ${forbidden}`,
    !read(PURE).includes(forbidden)
  );
}
// Round 4 gave this module ONE import — `./work-sessions`, which is itself pure
// and holds the crew-hours measurement that fixes 4 and 5 now share. The check
// was "imports nothing at all"; it is now an allow-list of exactly that one, so
// the client-safety guarantee survives while the sharing is possible.
{
  const imports = [...read(PURE).matchAll(/^\s*import\s[\s\S]*?from\s+"([^"]+)"/gm)].map(
    (m) => m[1]
  );
  check("hourly-billing.ts imports only the pure sessions module", imports, [
    "./work-sessions",
  ]);
  ok(
    "...and that module is itself import-free, so the chain ends there",
    !/^\s*import\s/m.test(read("src/lib/work-sessions.ts"))
  );
}

// ── The two hourly rates are never crossed (decision D6). ──────────────────
lacks(
  "the pure module never reads the cleaner's hourlyRate",
  PURE,
  "job.hourlyRate"
);
has(
  "the modal labels the cleaner's rate as the cleaner's",
  MODAL,
  "Cleaner hourly rate"
);
has("the modal labels the customer's rate as the customer's", MODAL, "Customer hourly rate");
has("the full-page form does too", SAVE_PAGE.replace("page.tsx", "BillingTypeFields.tsx"), "Customer hourly rate");

// ── The snapshot (step 8.5). ───────────────────────────────────────────────
has("clock-out snapshots the hours it measured", "src/app/admin/actions/clockOut.ts", "snapshotBilledActualHours(");
ok(
  "...only on the FINAL clock-out, so a teammate still on site can't bill early",
  /isFinalClockOut\)\s*\{\s*\n\s*await snapshotBilledActualHours/.test(
    read("src/app/admin/actions/clockOut.ts")
  )
);
has(
  "an admin editing the clock re-measures the bill",
  "src/app/admin/actions/updateClockTimes.ts",
  "snapshotBilledActualHours("
);
has("the snapshot refuses to re-price a settled job", SERVER, 'reason: "SETTLED"');
has("...and refuses to write zero hours over a real figure", SERVER, 'reason: "NO_HOURS"');
has("...and is a no-op on a flat job", SERVER, 'reason: "NOT_HOURLY"');
has("...and keeps Job.price in sync as the mirror", SERVER, "{ price: money.hourlyServiceAmount as number }");
ok(
  "...but NEVER over a FINAL_PRICE override — a clock-out must not undo a manual price",
  /money\.pricingMode !== "FINAL_PRICE"/.test(read(SERVER))
);

// ── Series propagation (step 8.1). ─────────────────────────────────────────
ok(
  "the billing TERMS carry across a recurring series",
  (["billingType", "billedHourlyRate", "billedEstimatedHours"] as const).every((f) =>
    (SERIES_PROPAGATED_FIELDS as readonly string[]).includes(f)
  )
);
ok(
  "...but the MEASURED hours never do — each occurrence has its own clock",
  !(SERIES_PROPAGATED_FIELDS as readonly string[]).includes("billedActualHours")
);
has(
  "a recurring child is created with no measured hours",
  SAVE_ACTION,
  "billedActualHours: null,"
);

// ── Payroll and the display surfaces (steps 8.6, 8.7). ─────────────────────
has(
  "payroll's shared select carries the billing columns",
  "src/lib/cleaner-earnings.ts",
  "billedActualHours: true,"
);
has(
  "the calendar feeds carry them too",
  "src/app/admin/actions/_calendarSelect.ts",
  "billedActualHours: true,"
);
has(
  "the job summary DTO exposes them for the drawer and the modal prefill",
  "src/app/admin/actions/getJobSummary.ts",
  "billedActualHours: job.billedActualHours,"
);
has(
  "the job detail page threads them into computeJobMoney",
  "src/app/admin/jobs/[id]/page.tsx",
  "billedActualHours: job.billedActualHours,"
);
has(
  "the jobs list carries them, so a quick edit can't reset an hourly job",
  "src/app/admin/jobs/page.tsx",
  "billedActualHours: true,"
);

// The cleaner surface shows HOURS and never the customer's price.
const CLEANER_VIEW = "src/app/cleaners/my-jobs/[jobId]/page.tsx";
has("the cleaner job view shows the billed hours", CLEANER_VIEW, "billedActualHours ?? job.billedEstimatedHours");
lacks(
  "...and never the customer's hourly rate",
  CLEANER_VIEW,
  "billedHourlyRate"
);
lacks(
  "the cleaner pay payload carries no customer billing at all",
  "src/app/admin/actions/getPayBreakdown.types.ts",
  "billedHourlyRate: number | null;\n  /** This cleaner"
);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
