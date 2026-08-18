// STAGE 14 — cross-cutting regression pass, mechanised.
//
// Stage 14 is the checklist that runs EVERY release, so the parts of it that a
// machine can answer belong in a script rather than in someone's memory of last
// time. This covers 14.3, 14.4, 14.5, 14.6 and 14.8. Deliberately NOT covered:
//   • 14.1 — `npx tsc --noEmit && npm run build` IS the check; nothing to pin.
//   • 14.2 — `npm run verify` runs the whole suite, this script included.
//   • 14.7 — a real phone. No script substitutes for it; it stays manual.
//
// The three regressions this pass actually found are pinned at their root, not
// at their symptom, so the next edit that re-breaks them fails here:
//   1. /admin/jobs dropped six modal-owned columns between its `select` and the
//      row it hands the client, so a quick edit un-hourlied a job.
//   2. /admin/jobs/new read `taxExempt` from a control it never rendered, so
//      editing an exempt job put GST/QST back on it.
//   3. …and the same for `paymentReceived`/`invoiceSent`, so editing a PAID job
//      marked it unpaid.
// (2) and (3) are one bug class — an action reading a key its own form does not
// post — so §14.3.b asserts the class, not the two instances.
import fs from "node:fs";
import { SERIES_PROPAGATED_FIELDS } from "../src/lib/job-series";
import {
  PC_DEPOSIT_DEFAULT_USD,
  STANDARD_BOOKING_DEPOSIT_USD,
  resolveDepositCredit,
} from "../src/lib/booking-deposit";

let pass = 0,
  fail = 0;

function check(name: string, actual: unknown, expected: unknown) {
  const okv = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${okv ? "PASS" : "FAIL"}  ${name}`);
  if (!okv) {
    console.log(`        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
  okv ? pass++ : fail++;
}
const ok = (n: string, c: boolean) => check(n, c, true);
const read = (p: string) => fs.readFileSync(p, "utf8");
const section = (t: string) => console.log(`\n── ${t} ──`);

/* ═══════════════ 14.3 · the two save paths ═══════════════════════════════ */
//
// `/admin/jobs/JobModal.tsx` and `/admin/jobs/new/page.tsx` are two
// IMPLEMENTATIONS, not two callers of one endpoint: the modal posts to
// actions/saveJob.ts, the full page declares its own inline "use server"
// action. That is why they drift, and why this section exists.

section("14.3.a · every modal-owned control is fed by the row the list hands it");

const jobsPage = read("src/app/admin/jobs/page.tsx");
const jobModal = read("src/app/admin/jobs/JobModal.tsx");

// The invariant: the modal renders a control for each of these and posts it on
// EVERY save (asserted below). A mount point that hands the modal a row without
// them therefore does not "leave them alone" — it posts the control's default
// and rewrites the job. `/admin/jobs` selected all six and typed all six, but
// never copied them into the mapped row, so every quick edit from the list
// silently flattened an hourly job and reverted an hourly-paid one.
const MODAL_OWNED_COLUMNS = [
  "payType",
  "hourlyRate",
  "billingType",
  "billedHourlyRate",
  "billedEstimatedHours",
  "billedActualHours",
  "propertyType",
  "checklistTemplateId",
  "taxExempt",
  // The discount pair. `discountAmount` was carried from the start;
  // `discountReason` was not, and the modal posts BOTH on every save — so a
  // quick edit from the list silently cleared the reason on any discounted job
  // while leaving the money alone. Exactly the failure this section describes,
  // on a column it did not happen to list.
  "discountAmount",
  "discountReason",
];

// The mapped row is the object returned by the `.map(...)` that builds the
// client payload — NOT the `select`, which is what made the bug survive review.
const mapperStart = jobsPage.indexOf("    return {");
const mapper = jobsPage.slice(mapperStart, jobsPage.indexOf("  });", mapperStart));
ok("the mapped row was located (the object the client actually receives)",
  mapperStart !== -1 && mapper.includes("clientName: job.clientName"));

for (const col of MODAL_OWNED_COLUMNS) {
  ok(`/admin/jobs MAPS ${col} (not merely selects it)`,
    new RegExp(`\\b${col}:\\s*job\\.${col}\\b`).test(mapper));
}

// The other half of the invariant. If the modal ever stops posting these
// unconditionally the mapper requirement softens — so if someone changes that,
// this fails and sends them back here rather than letting the pair drift.
for (const f of ["billingType", "payType", "propertyType", "checklistTemplateId"]) {
  ok(`the modal posts ${f} on every save, which is WHY the row must carry it`,
    jobModal.includes(`formData.append("${f}", `));
}

section("14.3.b · no action may read a form key its own form never posts");

// The bug class behind BOTH remaining 14.3 findings. An unchecked checkbox and
// an absent control are indistinguishable in FormData, so `=== "on"` on a field
// nobody renders is a permanent `false` — and on an edit path that false is
// spread into db.job.update. Generic on purpose: it catches the NEXT one.
const newDir = "src/app/admin/jobs/new";
const newPage = read(`${newDir}/page.tsx`);
const newFormSource = fs
  .readdirSync(newDir)
  .filter((f) => f.endsWith(".tsx"))
  .map((f) => read(`${newDir}/${f}`))
  .join("\n");

const keysRead = new Set(
  [...newPage.matchAll(/formData\.(?:get|has)\("([^"]+)"\)/g)].map((m) => m[1]),
);
const namesRendered = new Set(
  [...newFormSource.matchAll(/name="([^"]+)"/g)].map((m) => m[1]),
);

// Keys that are legitimately read without a control of their own.
const NOT_A_CONTROL = new Map<string, string>([
  // Routing/identity, put on the form by the page itself, not typed by anyone.
  ["jobId", "hidden identity field"],
  ["fromQuoteId", "hidden provenance field"],
  // Read ONLY to derive hourly cleaner pay from a scheduled window. This page
  // renders start date/time but no END, so the derivation never fires here —
  // a dead branch, not data loss: neither key is ever written to the job, so
  // the stored endTime survives. Logged in Stage 14's report rather than
  // fixed, because closing it means giving the page an end-time control, which
  // is a form change and the owner's call.
  ["endDate", "read for hourly-pay derivation; page renders no end-date control"],
  ["endTime", "read for hourly-pay derivation; page renders no end-time control"],
]);

const unbacked = [...keysRead]
  .filter((k) => !namesRendered.has(k) && !NOT_A_CONTROL.has(k))
  .sort();
check("every key /admin/jobs/new reads is posted by a control it renders",
  unbacked, []);

// ── THE SAME SWEEP, on the OTHER implementation ───────────────────────────
//
// This section always said the two save paths "are two IMPLEMENTATIONS, not
// two callers of one endpoint… that is why they drift". It then swept only
// `src/app/admin/jobs/new/`. So when the settlement-flag fix landed on the
// full page and not on the shared action, this file stayed green while a PAID,
// invoiced job could still be marked unpaid by a description edit from the
// modal, the job detail editor or either calendar — four surfaces, none of
// them looked at. A guard that passes while the bug is live is worse than no
// guard, so the sweep now covers both.
//
// `actions/saveJob.ts` has no form of its own: its controls live in the four
// components that post to it, and two of those build FormData by hand, so
// `.append(…)`/`.set(…)` count as "rendering" a control just as `name=` does.
const sharedAction = read("src/app/admin/actions/saveJob.ts");
const SHARED_ACTION_POSTERS = [
  "src/app/admin/jobs/JobModal.tsx",
  "src/app/admin/jobs/JobsPageClient.tsx",
  "src/app/admin/jobs/[id]/JobDetailView.tsx",
  "src/components/calendar/Calendar.tsx",
  "src/components/calendar/CalendarJobActions.tsx",
];
const sharedPosterSource = SHARED_ACTION_POSTERS.map(read).join("\n");

const sharedKeysRead = new Set(
  [...sharedAction.matchAll(/formData\.(?:get|getAll|has)\("([^"]+)"\)/g)].map(
    (m) => m[1],
  ),
);
const sharedNamesPosted = new Set([
  ...[...sharedPosterSource.matchAll(/name="([^"]+)"/g)].map((m) => m[1]),
  ...[...sharedPosterSource.matchAll(/\.append\(\s*"([^"]+)"/g)].map((m) => m[1]),
  ...[...sharedPosterSource.matchAll(/\.set\(\s*"([^"]+)"/g)].map((m) => m[1]),
]);

const sharedUnbacked = [...sharedKeysRead]
  .filter((k) => !sharedNamesPosted.has(k))
  .sort();
check("every key actions/saveJob.ts reads is posted by one of its forms",
  sharedUnbacked, []);

// The two that were NOT in the allowlist, pinned individually so the fix that
// closed each of them can't be reverted quietly.
ok("...including taxExempt, which now has a control instead of a silent false",
  namesRendered.has("taxExempt") && newPage.includes('name="taxExempt"'));
ok("...and the modal and the full page word that control the same way",
  jobModal.includes("Exempt this job from sales tax") &&
  newPage.includes("Exempt this job from sales tax"));

section("14.3.c · settlement flags survive an edit through the full-page form");

// These two have no control on this page and should not grow one — they are
// payment state, not job setup — so the fix is preservation, not a checkbox.
ok("paymentReceived is preserved when editing, not reset to false",
  /paymentReceived: isEditingMoneyJob/.test(newPage));
ok("invoiceSent is preserved when editing, not reset to false",
  /invoiceSent: isEditingMoneyJob/.test(newPage));
ok("...and the stored values are actually fetched to preserve FROM",
  /invoiceSent: true/.test(newPage) && /paymentReceived: true/.test(newPage));
ok("a genuinely NEW job still starts unpaid and un-invoiced",
  /isEditingMoneyJob\s*\?\s*\(?moneyJob\?\.paymentReceived \?\? false\)?\s*:\s*false/.test(newPage));

// …and the same three guarantees on the SHARED action, which is the half this
// section used to miss entirely. Pinned by behaviour rather than by spelling,
// so a rewrite that keeps the guarantee still passes.
ok("the shared action preserves paymentReceived on an edit too",
  /paymentReceived: editingJobId \? existingPaymentReceived : false/.test(sharedAction));
ok("...and invoiceSent",
  /invoiceSent: editingJobId \? existingInvoiceSent : false/.test(sharedAction));
ok("...reading both out of the job it is about to update",
  /existingPaymentReceived = current\?\.paymentReceived/.test(sharedAction) &&
  /existingInvoiceSent = current\?\.invoiceSent/.test(sharedAction));
// The exact expression that caused the blocker, in either implementation.
for (const [label, src] of [
  ["actions/saveJob.ts", sharedAction],
  ["/admin/jobs/new", newPage],
] as const) {
  ok(`${label} never derives a settlement flag from FormData`,
    !/paymentReceived:\s*formData\.get/.test(src) &&
    !/invoiceSent:\s*formData\.get/.test(src));
}

/* ═══════════════ 14.3.d · a page that prints money is OWNER/ADMIN only ════ */

section("14.3.d · every money page carries a real owner/admin guard");

// `src/app/admin/layout.tsx` admits OWNER, ADMIN, OPS_MANAGER and FIELD_LEAD
// (`isAdminRole`). So `requireAdmin()` — which is that same predicate — is NOT
// an access control relative to the two roles this app denies money to
// everywhere else: calendar price labels, dashboard revenue tiles, analytics.
// `/admin/gift-cards` and `/admin/web-bookings` shipped real balances and
// booking totals to an OPS_MANAGER on exactly that mistake, and
// `/admin/inventory` did it with a check that only excluded EMPLOYEE — which
// the layout already excludes, so it was a no-op under a comment that said
// "OWNER or ADMIN". Hiding the nav entry is not a guard either; that is what
// made the inventory hole survive.
const MONEY_PAGES = [
  "src/app/admin/gift-cards/page.tsx",
  "src/app/admin/web-bookings/page.tsx",
  "src/app/admin/wash-payouts/page.tsx",
  "src/app/admin/recurring/page.tsx",
  "src/app/admin/promo-codes/page.tsx",
  "src/app/admin/inventory/page.tsx",
  "src/app/admin/inventory/[id]/page.tsx",
  "src/app/admin/analytics/page.tsx",
  "src/app/admin/finances/page.tsx",
  "src/app/admin/invoices/page.tsx",
  "src/app/admin/payouts/page.tsx",
  "src/app/admin/bulk-charge/page.tsx",
  "src/app/admin/employees/page.tsx",
  "src/app/admin/jobs/new/page.tsx",
];

/** Either the shared guard, or the inline `role !== OWNER && role !== ADMIN` + redirect. */
function hasOwnerAdminGuard(src: string): boolean {
  if (/await requireOwnerAdmin\(\)/.test(src)) return true;
  return (
    /!==\s*"OWNER"[\s\S]{0,40}!==\s*"ADMIN"/.test(src) && /redirect\(/.test(src)
  );
}

for (const page of MONEY_PAGES) {
  const src = read(page);
  ok(`${page.replace("src/app/admin/", "")} is OWNER/ADMIN only`, hasOwnerAdminGuard(src));
  // The specific mistake, named: `requireAdmin` on a page that prints money.
  ok(`...${page.replace("src/app/admin/", "")} does not rely on requireAdmin`,
    !/await requireAdmin\(\)/.test(src));
}

// `requireAdmin` must keep meaning what it says, or the sweep above is testing
// a name rather than a rule.
{
  const guards = read("src/lib/page-guards.ts");
  ok("requireOwnerAdmin still admits ONLY owner and admin",
    /requireOwnerAdmin[\s\S]{0,200}!==\s*"OWNER"\s*&&\s*role\s*!==\s*"ADMIN"/.test(guards));
  ok("...and requireAdmin is still the WIDER, layout-equivalent predicate",
    /requireAdmin[\s\S]{0,200}isAdminRole\(role\)/.test(guards));
}

/* ═══════════ 14.3.e · a field that is PARSED must also be WRITTEN ════════ */

section("14.3.e · discount reason survives a save");

// `discountReason` was read at the top of saveJob, used to auto-stamp the
// recurring reason, and read back by the CHILD payload — but never put into
// `jobData`, so the parent's column was never written. Every save stored the
// discount AMOUNT and forgot the REASON, and the children then inherited
// `jobData.discountReason === undefined`. The pair is asserted together
// because that asymmetry is the whole bug.
{
  const src = read("src/app/admin/actions/saveJob.ts");
  const jobDataBlock =
    /const jobData: [\s\S]*?\n    \};/.exec(src)?.[0] ?? "";
  ok("saveJob builds a jobData payload", jobDataBlock.length > 0);
  // Plain substring tests: the two lines are adjacent keys in one object
  // literal, and asserting them as text keeps the check readable.
  ok("...which writes discountAmount", jobDataBlock.includes("discountAmount,"));
  ok("...and discountReason beside it", jobDataBlock.includes("discountReason,"));
  ok("the job modal posts discountReason on every save",
    read("src/app/admin/jobs/JobModal.tsx").includes("\"discountReason\","));
}

/* ═══════════════ 14.4 · recurring integrity ══════════════════════════════ */

section("14.4 · a series carries the Stage 8–10 fields to every occurrence");

const propagated = new Set<string>(SERIES_PROPAGATED_FIELDS as readonly string[]);
for (const f of [
  "billingType",
  "billedHourlyRate",
  "billedEstimatedHours",
  "propertyType",
  "checklistTemplateId",
  "taxExempt",
]) {
  ok(`applyToJobSeries propagates ${f}`, propagated.has(f));
}

// The deliberate exclusion. `billedActualHours` is MEASURED from one
// occurrence's own clock, so propagating it would bill every future visit for
// hours nobody has worked.
ok("...but NOT billedActualHours, which is measured per occurrence",
  !propagated.has("billedActualHours"));

const saveJob = read("src/app/admin/actions/saveJob.ts");
ok("...and generation clears it on each child rather than inheriting visit 1's",
  /billedActualHours: null,/.test(saveJob));
ok("the child's hourly line is priced from the ESTIMATE, not the measurement",
  saveJob.includes("billedActualHours: null,") &&
  /billingType === "HOURLY" && pricingMode !== "FINAL_PRICE"/.test(saveJob));

/* ═══════════════ 14.5 · money reconciliation ═════════════════════════════ */

section("14.5 · legacy $20 deposits and Stage 11's variable ones, side by side");

// Stage 11 moved six hardcoded $20 deposits onto Job.depositAmount with NO
// backfill, so every pre-Stage-11 row is NULL. The whole no-backfill argument
// rests on NULL reading back as exactly $20 — if that ever stops being true,
// every historical booking silently re-prices.
check("a legacy web booking (depositAmount NULL) still credits $20",
  resolveDepositCredit({ depositPaid: true, depositAmount: null }),
  STANDARD_BOOKING_DEPOSIT_USD);
check("...and so does a stored 0, which is the same 'not recorded'",
  resolveDepositCredit({ depositPaid: true, depositAmount: 0 }), 20);
check("a post-construction job credits what it actually charged",
  resolveDepositCredit({ depositPaid: true, depositAmount: 200 }), 200);
check("an unpaid deposit credits nothing, whatever the amount says",
  resolveDepositCredit({ depositPaid: false, depositAmount: 200 }), 0);
check("a non-standard amount is credited verbatim, not rounded to a policy",
  resolveDepositCredit({ depositPaid: true, depositAmount: 137.5 }), 137.5);
check("the PC default is the PDF's $200", PC_DEPOSIT_DEFAULT_USD, 200);
// Read through Number() so this stays a RUNTIME check. Compared directly, both
// constants carry literal types and `tsc --noEmit` rejects the comparison as
// provably false — which is really TypeScript agreeing with the assertion, but
// 14.1 wants a clean typecheck more than it wants the joke.
ok("the two deposits are genuinely different numbers, so the pair is a real test",
  Number(STANDARD_BOOKING_DEPOSIT_USD) !== Number(PC_DEPOSIT_DEFAULT_USD));

/* ═══════════════ 14.6 · role sweep ═══════════════════════════════════════ */

section("14.6 · FIELD_LEAD money exposure");

const calendarScope = read("src/app/admin/actions/_calendarScope.ts");
ok("the calendar scope module still owns money redaction, not just scoping",
  /redact/i.test(calendarScope));

const myTeam = read("src/app/admin/actions/getMyTeam.ts");
for (const money of ["price", "employeePay", "totalTip", "parking", "hourlyRate"]) {
  ok(`the group schedule never SELECTS ${money}`,
    !new RegExp(`^\\s*${money}: true,`, "m").test(myTeam));
}

// D13, still open and deliberately not fixed here: /admin/jobs scopes a
// non-admin to their own jobs but hands those rows full client pricing. This
// asserts the exposure is still exactly what the decision describes — so if
// someone widens the scope without redacting, the shape changes and this fails
// while D13 is still open.
ok("D13 · /admin/jobs still scopes a non-admin to their OWN jobs",
  /if \(!isAdmin\) \{\s*baseWhere\.employeeId = session\.user\.id;/.test(jobsPage));
ok("D13 · ...and still hands those rows the price (the exposure, unresolved)",
  /price: job\.price,/.test(mapper));

/* ═══════════════ 14.8 · migration hygiene ═══════════════════════════════ */

section("14.8 · every deferred schema change has a migration");

// One row per migration in the TODO's "waiting to be applied" table, each
// pinned by a statement only that migration can contain — so a renamed folder
// or a half-written SQL file fails rather than passing on its filename.
const MIGRATIONS: Array<[string, string[]]> = [
  ["20260817000000_add_inventory_item_types", [
    'CREATE TYPE "ItemType"',
    'CREATE TYPE "LiquidLevel"',
    'CREATE TYPE "EquipmentCondition"',
    'CREATE TYPE "InventoryFlagType"',
    'CREATE TYPE "InventoryFlagStatus"',
    'CREATE TABLE "InventoryFlag"',
  ]],
  ["20260817010000_add_inventory_action", ['CREATE TYPE "InventoryAction"']],
  ["20260817020000_drop_inventory_rule", ['DROP TABLE IF EXISTS "InventoryRule"']],
  ["20260817030000_add_hourly_billing", ['CREATE TYPE "JobBillingType"']],
  ["20260817040000_add_property_type", ['CREATE TYPE "PropertyType"']],
  ["20260817050000_add_checklist_links", [
    '"ChecklistTemplate_clientId_idx"',
    '"Job_checklistTemplateId_idx"',
  ]],
  ["20260817060000_add_pc_quote_flow", [
    'CREATE TYPE "QuoteStatus"',
    'ALTER TABLE "JobPhoto" ALTER COLUMN "employeeId" DROP NOT NULL',
  ]],
];

for (const [dir, needles] of MIGRATIONS) {
  const path = `prisma/migrations/${dir}/migration.sql`;
  const exists = fs.existsSync(path);
  ok(`${dir} exists`, exists);
  if (!exists) continue;
  const sql = read(path);
  for (const needle of needles) {
    ok(`  …contains ${needle}`, sql.includes(needle));
  }
}

// The destructive one gets its own check: it is the only DROP TABLE in the
// batch, and it must stay guarded so a partial re-run can't fail the deploy.
const dropSql = read("prisma/migrations/20260817020000_drop_inventory_rule/migration.sql");
ok("the one destructive migration is idempotent (IF EXISTS)",
  dropSql.includes("DROP TABLE IF EXISTS"));
ok("...and it is still the ONLY DROP TABLE in the deferred batch",
  MIGRATIONS.filter(([d]) =>
    read(`prisma/migrations/${d}/migration.sql`).includes("DROP TABLE")).length === 1);

// Backfills. 14.8 asks for "an idempotent backfill script where needed", and
// the TODO names exactly these two.
for (const [script, why] of [
  ["prisma/backfillItemTypes.ts", "Stage 1 item types"],
  ["scripts/reconcileWarehouseStock.ts", "Stage 4 warehouse stock"],
] as const) {
  ok(`backfill for ${why} exists`, fs.existsSync(script));
  ok(`  …and offers a --dry-run, so it can be rehearsed on a copy of prod`,
    read(script).includes("--dry-run") || read(script).includes("dryRun"));
}

console.log(`\n${"═".repeat(60)}`);
console.log(`${pass} passed, ${fail} failed  (${pass + fail} checks)`);
console.log("═".repeat(60));
process.exit(fail === 0 ? 0 : 1);
