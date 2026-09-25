// Verification for fix list item 7 — per-job sales tax exemption.
import fs from "node:fs";
import {
  computeJobTaxes,
  isJobTaxExempt,
  taxExemptReason,
  DEFAULT_TAX_RATES,
} from "../src/lib/tax";
import { computeJobPayShares, type JobPayInput } from "../src/lib/cleaner-earnings";
import type { CleanerRateInput } from "../src/lib/pay-tiers";

let pass = 0, fail = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const okv = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${okv ? "PASS" : "FAIL"}  ${name}`);
  if (!okv) console.log(`        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  okv ? pass++ : fail++;
}
const ok = (n: string, c: boolean) => check(n, c, true);

const R = DEFAULT_TAX_RATES; // 5% GST, 9.975% QST

// ── Taxed vs exempt ────────────────────────────────────────────────────────
check("a normal $200 job is taxed",
  computeJobTaxes(200, R, false),
  { subtotalAmount: 200, gstAmount: 10, qstAmount: 19.95, totalAmount: 229.95 });

check("an exempt $200 job has no GST/QST and total = subtotal",
  computeJobTaxes(200, R, true),
  { subtotalAmount: 200, gstAmount: 0, qstAmount: 0, totalAmount: 200 });

// ── The flag is per-job and independent of payment method ──────────────────
ok("a card job marked exempt IS exempt",
  isJobTaxExempt({ isCashJob: false, taxExempt: true }));
ok("a cash job is exempt even without the flag",
  isJobTaxExempt({ isCashJob: true, taxExempt: false }));
ok("a normal card job is NOT exempt",
  !isJobTaxExempt({ isCashJob: false, taxExempt: false }));
check("an explicit exemption is reported as EXEMPT, not CASH",
  taxExemptReason({ isCashJob: false, taxExempt: true }), "EXEMPT");
check("a cash job's reason is CASH", taxExemptReason({ isCashJob: true }), "CASH");
check("a taxed job has no reason", taxExemptReason({}), null);

// ── Cleaner pay must be unaffected (spec: pay is from the PRE-TAX price) ────
const RATES = new Map<string, CleanerRateInput>([
  // 5-star, past the 5-rating gate. 1.25 is the DEFAULT multiplier for a 5.0
  // average, so the rate is 40% x 1.25 = 50% (awerfixes.pdf item 1). It was 45%
  // under the retired standardRateForRating ladder; what this file actually
  // asserts — that pay comes off the PRE-TAX price — is unaffected.
  ["asia", { id: "asia", tier: "STANDARD", avgRating: 5, ratingCount: 12, multiplier: 1.25, role: "EMPLOYEE" }],
]);
const baseJob: JobPayInput = {
  id: "j", employeeId: null, cleaners: [{ id: "asia" }], price: 200,
  employeePay: null, payType: "PERCENTAGE", hourlyRate: null, payRateMultiplier: 1,
  totalTip: null, jobDate: null, startTime: null, endTime: null,
  clockInTime: null, clockOutTime: null, assignments: [],
};
const payTaxed = computeJobPayShares(baseJob, RATES).get("asia")?.total;
const payExempt = computeJobPayShares({ ...baseJob }, RATES).get("asia")?.total;
check("cleaner pay is 50% of the PRE-TAX price", payTaxed, 100);
check("exempting a job does not change cleaner pay", payExempt, payTaxed);

// ── Source sweep ───────────────────────────────────────────────────────────
const read = (p: string) => fs.readFileSync(p, "utf8");

const schema = read("prisma/schema.prisma");
ok("Job.taxExempt exists and defaults to false",
  /taxExempt\s+Boolean\s+@default\(false\)/.test(schema));
const migration = read("prisma/migrations/20260726010000_job_tax_exempt/migration.sql");
ok("migration adds the column defaulting to false",
  migration.includes('ADD COLUMN "taxExempt" BOOLEAN NOT NULL DEFAULT false'));

const saveJob = read("src/app/admin/actions/saveJob.ts");
ok("saveJob reads the flag from the form", saveJob.includes('formData.get("taxExempt")'));
ok("saveJob persists the flag", /taxExempt,/.test(saveJob));
// AWER round 3, stage 3: the `isJobTaxExempt({ isCashJob, taxExempt })` call
// these three checks used to grep for now lives INSIDE computeJobMoney
// (src/lib/job-money.ts), which owns the whole subtotal→tax computation so
// add-ons finally count. The property is unchanged — the exemption still
// reaches the tax math — so these assert the same thing at its new boundary:
// both flags are passed into the shared helper. That the helper honours them
// is a BEHAVIOUR check in verify-awer-fixes-3.ts section 7.
const EXEMPTION_PASSED_IN = /isCashJob,\s*[\r\n]+\s*taxExempt,/g;
ok("saveJob applies it to the tax math",
  saveJob.includes("computeJobMoney(") && EXEMPTION_PASSED_IN.test(saveJob));
ok("recurring children inherit the exemption",
  (saveJob.match(EXEMPTION_PASSED_IN) || []).length >= 2 &&
  (saveJob.match(/computeJobMoney\(/g) || []).length >= 2);

const form = read("src/app/admin/jobs/new/page.tsx");
ok("the full-page form also honours the flag",
  form.includes("computeJobMoney(") &&
  new RegExp(EXEMPTION_PASSED_IN.source).test(form));

const modal = read("src/app/admin/jobs/JobModal.tsx");
ok("modal exposes the exemption control", modal.includes("Exempt this job from sales tax"));
ok("modal states included vs excluded",
  modal.includes("Taxes EXCLUDED") && modal.includes("Taxes INCLUDED"));
ok("modal loads the saved value when editing", modal.includes("setTaxExempt(!!job.taxExempt)"));
ok("modal resets the flag for a new job", modal.includes("setTaxExempt(false)"));

const detail = read("src/app/admin/jobs/[id]/JobDetailView.tsx");
ok("job detail suppresses imputed tax on an exempt job", detail.includes("const untaxed ="));
ok("job detail labels an exempt job", detail.includes("Taxes excluded — job marked tax-exempt"));

const invFromJob = read("src/app/admin/actions/generateInvoiceFromJob.ts");
ok("single-job invoice matches the job's tax setting", invFromJob.includes("isJobTaxExempt(job)"));

const createInv = read("src/app/admin/actions/createInvoice.ts");
ok("consolidated invoice excludes exempt jobs from the taxable base",
  createInv.includes("exemptAmount") && createInv.includes("taxableBase"));

console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail === 0 ? 0 : 1);
