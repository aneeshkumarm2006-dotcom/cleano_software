// Verification for fix list item 29 — discount reason field.
import fs from "node:fs";
import {
  AUTO_REASON,
  DISCOUNT_REASONS,
  NO_REASON_LABEL,
  discountReasonLabel,
  isMissingReason,
  isPresetReason,
  normalizeDiscountReason,
} from "../src/lib/discount-reasons";

let pass = 0, fail = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const okv = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${okv ? "PASS" : "FAIL"}  ${name}`);
  if (!okv) console.log(`        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  okv ? pass++ : fail++;
}
const ok = (n: string, c: boolean) => check(n, c, true);

// ── The presets the spec names, in its order ───────────────────────────────
check("exactly the reasons the spec lists",
  [...DISCOUNT_REASONS],
  ["Marketing", "Recurring Discount", "Complaint", "Courtesy", "Referral",
   "Manual Adjustment", "Other"]);
ok("preset guard works",
  isPresetReason("Courtesy") && !isPresetReason("Nonsense"));

// ── "select OR enter" — custom text is a first-class value ─────────────────
check("a typed reason is kept", normalizeDiscountReason("Price match vs competitor"),
  "Price match vs competitor");
check("whitespace is trimmed", normalizeDiscountReason("  Courtesy  "), "Courtesy");
check("blank becomes null, not an empty string",
  normalizeDiscountReason("   "), null);
check("non-strings are null", normalizeDiscountReason(undefined), null);
ok("an over-long reason is capped",
  (normalizeDiscountReason("x".repeat(500)) ?? "").length === 120);

// ── Display rules ──────────────────────────────────────────────────────────
check("a discount with a reason shows it",
  discountReasonLabel({ discountAmount: 20, discountReason: "Complaint" }), "Complaint");
// The spec: existing discounts without a reason "can remain blank or show as
// No reason assigned".
check("a discount with NO reason reads as 'No reason assigned'",
  discountReasonLabel({ discountAmount: 20, discountReason: null }), NO_REASON_LABEL);
// A job with no discount must show nothing — "No reason assigned" there would
// imply a discount exists that nobody explained.
check("NO discount shows nothing at all",
  discountReasonLabel({ discountAmount: 0, discountReason: null }), null);
check("a null discount shows nothing", discountReasonLabel({}), null);
ok("missing-reason flag only fires when a discount exists",
  isMissingReason({ discountAmount: 20, discountReason: null }) &&
  !isMissingReason({ discountAmount: 0, discountReason: null }) &&
  !isMissingReason({ discountAmount: 20, discountReason: "Referral" }));

// ── System-applied reasons must group with the manual ones ─────────────────
ok("auto reasons are exact preset strings, so reporting groups them",
  isPresetReason(AUTO_REASON.RECURRING) && isPresetReason(AUTO_REASON.REFERRAL));
check("recurring auto-reason", AUTO_REASON.RECURRING, "Recurring Discount");

// ── Source sweep ───────────────────────────────────────────────────────────
const read = (p: string) => fs.readFileSync(p, "utf8");

const schema = read("prisma/schema.prisma");
ok("Job.discountReason exists and is nullable",
  /discountReason\s+String\?/.test(schema));
const migration = read("prisma/migrations/20260726030000_job_discount_reason/migration.sql");
ok("migration adds a nullable column with no backfill",
  migration.includes('ADD COLUMN "discountReason" TEXT') &&
  !migration.includes("UPDATE"));

const saveJob = read("src/app/admin/actions/saveJob.ts");
ok("saveJob reads the reason", saveJob.includes('formData.get("discountReason")'));
ok("saveJob persists it", /discountReason,/.test(saveJob));
ok("a system-applied recurring discount is labelled, not left blank",
  saveJob.includes("AUTO_REASON.RECURRING"));
ok("an admin-entered reason wins over the auto label",
  saveJob.includes("if (!discountReason && (discountAmount ?? 0) > 0 && recurringFrequency)"));
ok("recurring CHILDREN are labelled with the recurring reason",
  saveJob.includes("recurringDiscount > 0 ? AUTO_REASON.RECURRING"));

const modal = read("src/app/admin/jobs/JobModal.tsx");
ok("modal offers the preset reasons", modal.includes("DISCOUNT_REASONS.map"));
ok("modal supports typing a custom reason", modal.includes("Type the reason"));
ok("the field only appears when a discount is set", modal.includes("discountIsSet &&"));
ok("modal loads a saved reason when editing",
  modal.includes("setDiscountReason(job.discountReason ?? \"\")"));
ok("modal clears it for a new job", modal.includes('setDiscountReason("")'));
ok("the placeholder 'Other' is never stored as the reason",
  modal.includes('discountReason === "Other" ? "" : discountReason'));

const detail = read("src/app/admin/jobs/[id]/JobDetailView.tsx");
ok("job details show the reason beside the discount",
  detail.includes("discountReasonLabel(job)"));
ok("a missing reason is styled differently from a real one",
  detail.includes("isMissingReason(job)"));

const exp = read("src/app/admin/actions/exportJobs.ts");
ok("reporting export carries the reason", exp.includes('"Discount Reason"'));
ok("export header includes it even with no rows",
  (exp.match(/"Discount Reason"/g) || []).length >= 2);

console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail === 0 ? 0 : 1);
