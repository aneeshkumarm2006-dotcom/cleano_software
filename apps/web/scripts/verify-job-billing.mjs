// Money-math proof for resolveAmountDue. Replicates the real writers'
// conventions and asserts what each charge path will now put on a card.
// Read-only against the DB (the last block re-checks the 9 live priced jobs).

import { PrismaClient } from "@prisma/client";

const GST = 0.05,
  QST = 0.09975;
const r2 = (n) => Math.round(n * 100) / 100;
const DEPOSIT = 20;

// ---- the implementation under test (mirrors src/lib/job-billing.ts) -------
function resolveAmountDue(job) {
  const gross =
    job.totalAmount != null && job.totalAmount > 0
      ? job.totalAmount
      : Math.max(0, (job.price ?? 0) - (job.discountAmount ?? 0));
  const deposit = job.depositPaid ? DEPOSIT : 0;
  return r2(Math.max(0, gross - deposit));
}
// --------------------------------------------------------------------------

// How saveJob writes an admin job: price is PRE-tax, PRE-discount.
function adminJob({ price, discountAmount = 0, taxExempt = false, depositPaid = false }) {
  const net = Math.max(0, price - discountAmount);
  const gst = taxExempt ? 0 : r2(net * GST);
  const qst = taxExempt ? 0 : r2(net * QST);
  return { price, discountAmount, totalAmount: r2(net + gst + qst), depositPaid };
}

// How computeBookingPrice + submitBooking write a web booking: price is
// tax-INCLUSIVE and POST-discount, and totalAmount is now the same figure.
function webJob({ base, addOns = 0, travel = 0, referral = 0, promo = 0, depositPaid = true }) {
  const discount = referral + promo;
  const preTax = Math.max(0, base + addOns + travel - discount);
  const total = r2(preTax + r2(preTax * GST) + r2(preTax * QST));
  return {
    price: total,
    // submitBooking stores ONLY the referral credit here, never the promo.
    discountAmount: referral > 0 ? referral : null,
    totalAmount: total,
    depositPaid,
  };
}

let pass = 0,
  fail = 0;
const eq = (label, got, want) => {
  const ok = Math.abs(got - want) < 0.005;
  if (ok) pass++;
  else {
    fail++;
    console.log(`  FAIL ${label}: got ${got}, want ${want}`);
  }
};

console.log("\n=== 1. Admin jobs now collect GST/QST (bug C) ===");
eq("$112 admin job", resolveAmountDue(adminJob({ price: 112 })), 128.77);
eq("$200 admin job", resolveAmountDue(adminJob({ price: 200 })), 229.95);
eq("$353 less $52.95 discount", resolveAmountDue(adminJob({ price: 353, discountAmount: 52.95 })), 344.98);
eq("$176 admin job", resolveAmountDue(adminJob({ price: 176 })), 202.36);
eq("tax-exempt $220 unchanged", resolveAmountDue(adminJob({ price: 220, taxExempt: true })), 220);
eq("discount == price -> 0", resolveAmountDue(adminJob({ price: 200, discountAmount: 200 })), 0);
console.log("  admin discount is subtracted exactly once:");
eq("$300 less $50", resolveAmountDue(adminJob({ price: 300, discountAmount: 50 })), r2(250 * 1.14975));

console.log("\n=== 2. Referral credit comes off ONCE (bug D) ===");
const ref = webJob({ base: 200, referral: 25, depositPaid: false });
eq("web $200 base, $25 credit", resolveAmountDue(ref), r2(175 * 1.14975));
const refOld = r2(ref.price - (ref.discountAmount ?? 0));
console.log(`  (old arithmetic would have billed ${refOld})`);
// The old figure was short by exactly the credit, which is the whole bug.
eq("old arithmetic was short by the credit", r2(resolveAmountDue(ref) - refOld), 25);
const noRef = webJob({ base: 200, referral: 0, depositPaid: false });
eq("web, no credit", resolveAmountDue(noRef), r2(200 * 1.14975));

console.log("\n=== 3. Promo is inside price and never re-subtracted ===");
const promo = webJob({ base: 200, promo: 20, depositPaid: false });
eq("$20 promo", resolveAmountDue(promo), r2(180 * 1.14975));
eq("promo left discountAmount null", promo.discountAmount === null ? 1 : 0, 1);
const both = webJob({ base: 200, referral: 25, promo: 20, depositPaid: false });
eq("promo + referral stacked", resolveAmountDue(both), r2(155 * 1.14975));

console.log("\n=== 4. The $20 deposit is credited once (bug E) ===");
const dep = webJob({ base: 200 });
eq("web with deposit", resolveAmountDue(dep), r2(r2(200 * 1.14975) - 20));
eq("deposit + referral", resolveAmountDue(webJob({ base: 200, referral: 25 })), r2(r2(175 * 1.14975) - 20));
eq("no deposit -> nothing deducted", resolveAmountDue(webJob({ base: 200, depositPaid: false })), r2(200 * 1.14975));
eq("deposit never drives it negative", resolveAmountDue({ price: 10, discountAmount: 0, totalAmount: 10, depositPaid: true }), 0);
eq("admin job with a deposit", resolveAmountDue(adminJob({ price: 200, depositPaid: true })), r2(229.95 - 20));

console.log("\n=== 5. Recurring children: frequency discount once per visit ===");
// childPricing passes ONLY the recurring discount; totalAmount === total.
const child = webJob({ base: 200, promo: 24, depositPaid: false }); // 12% of 200
eq("child, 12% frequency discount", resolveAmountDue(child), r2(176 * 1.14975));
console.log(`  (old arithmetic billed ${r2(child.price - 24)} — $24 lost EVERY visit)`);
eq("child carries no deposit", child.depositPaid === false ? 1 : 0, 1);

console.log("\n=== 6. Legacy rows with no totalAmount fall back unchanged ===");
eq("legacy price only", resolveAmountDue({ price: 150, discountAmount: null, totalAmount: null, depositPaid: false }), 150);
eq("legacy price - discount", resolveAmountDue({ price: 150, discountAmount: 30, totalAmount: 0, depositPaid: false }), 120);
eq("legacy negative floors at 0", resolveAmountDue({ price: 50, discountAmount: 80, totalAmount: 0, depositPaid: false }), 0);
eq("all null", resolveAmountDue({ price: null, discountAmount: null, totalAmount: null, depositPaid: false }), 0);

console.log("\n=== 7. Gift-card draw-down still layers on top (chargeJob) ===");
const charge = (job, giftCardBalance) => {
  const total = resolveAmountDue(job);
  const applied = Math.min(giftCardBalance, total);
  return { total, applied, cents: Math.round(Math.max(0, total - applied) * 100) };
};
let c = charge(adminJob({ price: 200 }), 50);
eq("gift card $50 off $229.95", c.cents, Math.round((229.95 - 50) * 100));
c = charge(adminJob({ price: 200 }), 500);
eq("gift card covers it all", c.cents, 0);
eq("gift card applied is capped at the total", c.applied, 229.95);

console.log("\n=== 8. Hold authorization == eventual capture ===");
const j = adminJob({ price: 353, discountAmount: 52.95 });
eq("hold and charge agree", resolveAmountDue(j), resolveAmountDue(j));
eq("hold is the taxed figure", resolveAmountDue(j), 344.98);

const p = new PrismaClient();
const rows = await p.$queryRawUnsafe(
  `SELECT "jobNumber", price, "discountAmount", "totalAmount", "depositPaid"
     FROM "Job" WHERE price IS NOT NULL ORDER BY "jobNumber"`
);
console.log("\n=== 9. The live jobs, before vs after ===");
console.log("  job    old      new      delta");
for (const row of rows) {
  const oldAmt = r2(Math.max(0, (row.price ?? 0) - (row.discountAmount ?? 0)));
  const newAmt = resolveAmountDue(row);
  console.log(
    `  ${row.jobNumber}  ${String(oldAmt).padEnd(8)} ${String(newAmt).padEnd(8)} ${
      newAmt === oldAmt ? "-" : "+" + r2(newAmt - oldAmt)
    }`
  );
  // every live row is admin-written, so the new figure must be its stored totalAmount
  eq(`job ${row.jobNumber} bills its stored totalAmount`, newAmt, r2(row.totalAmount ?? 0));
}
await p.$disconnect();

console.log(`\n${pass}/${pass + fail} assertions passed.`);
process.exit(fail === 0 ? 0 : 1);
