/**
 * Verification for the third AWER fixes round (`_ai_context/TODO.md`, 20 items).
 *
 * SKELETON — Stage 0. Each stage appends its own `section(...)` block as it
 * lands; nothing else in this file needs to change. Modelled on
 * `verify-awer-new-fixes.ts`, including its two kinds of check:
 *
 *   • BEHAVIOUR — pure logic imported and exercised directly (money math,
 *     rate resolution, parsers). Preferred: it tests the thing, not its spelling.
 *   • SOURCE    — fixes that live in a Prisma `where`, a JSX string or a form
 *     contract can't run without a database or a browser, so they're asserted
 *     against the source. A regression there is a deleted line, which is
 *     exactly what these catch.
 *
 * No check in this file may write to the database. Live-data questions belong
 * in `scripts/probe-awer-fixes-3.ts` (read-only), which is where the Stage 0.3
 * baselines came from.
 *
 *   npx tsx scripts/verify-awer-fixes-3.ts
 */
import fs from "node:fs";
import {
  computeJobPayShares,
  type JobPayInput,
} from "../src/lib/cleaner-earnings";
import {
  FIELD_LEAD_RATE,
  STANDARD_FLOOR_RATE,
  STANDARD_RATINGS_REQUIRED,
  TRAINEE_RATE,
  fallbackRateInput,
  individualRate,
  type CleanerRateInput,
} from "../src/lib/pay-tiers";
import {
  DEFAULT_RATING_MULTIPLIERS,
  effectiveMultiplier,
  multiplierForRating,
} from "../src/lib/pay-multiplier";
import { sanitizeRatingMultiplierMap } from "../src/lib/pay-multiplier-config";
import {
  MAX_ADDON_QUANTITY,
  addOnLineTotal,
  addOnMoneyBasis,
  addOnQuantity,
  computeJobMoney,
  sumAddOns,
} from "../src/lib/job-money";
import { DEFAULT_TAX_RATES, computeJobTaxes, type TaxRates } from "../src/lib/tax";
import {
  parseBkAddOns,
  splitBkAddOnList,
} from "../src/lib/bookingkoala/core";
import {
  ADDON_POPUP_MESSAGE_MAX,
  ADDON_POPUP_TITLE_MAX,
  normalizeAddOn,
  resolveBkAddOns,
} from "../src/lib/addon-catalog";
import {
  ADDON_ICONS,
  ADDON_ICON_KEYS,
  ADDON_ICON_KEY_SET,
  addonIcon,
} from "../src/lib/addon-icons";
import { Refrigerator, Sofa, Sparkles, Wind } from "lucide-react";
import {
  BILLING_SEGMENT_STRICT,
  hasBillingSegments,
  sanitizeCleanerNotes,
  stripBillingSegments,
} from "../src/lib/cleaner-notes";
import { needsPopup } from "../src/app/(book)/book/types";
// Stage 4 (item 2). Pure by design — src/lib/client-address.ts imports no
// Prisma, precisely so these can be exercised here without a database.
import {
  autoAddressLabel,
  formatAddressLine,
  normalizeAddressKey,
  pickDefaultAddress,
  stripDuplicatedApt,
} from "../src/lib/client-address";
// Stage 5 (items 12–15). Same reasoning as Stage 4: the rules live in pure
// modules with no Prisma import, so they are exercised here rather than grepped.
import {
  checklistSignature,
  isUntouched,
  pendingRequiredItems,
  requiredItemsSatisfied,
  resolveChecklistAction,
} from "../src/lib/job-checklist";
import { afterPhotosAllowed } from "../src/lib/job-photos";
import {
  activeSessionMinutes,
  canResume,
  sessionsForCleaner,
  sessionsFromLegacyPair,
  summariseSessions,
} from "../src/lib/work-sessions";
import { resolveClockEntry } from "../src/lib/time-tracking";
import { CLOCK_IN_BLOCKED_STATUSES } from "../src/lib/cleaner-jobs";
// Stage 6 (items 16–17). Both modules are deliberately Prisma-free so the
// permission rule and the availability evaluator can be exercised for real here.
import { CATEGORY_ALIASES, normalizeJobType } from "../src/lib/calendar-labels";
import {
  MOVE_FAMILY,
  PERMISSION_CATEGORIES,
  canonicalPermissionCategory,
  categoryMismatchWarning,
  isCategoryAllowed,
  normalizeAllowedCategories,
} from "../src/lib/service-permissions";
import { evaluateAvailability } from "../src/lib/availability";
// Stage 7 (item 19). Same reasoning again: the upload rule is a pure module so
// the browser pre-check and the server check are one function, exercised here.
import {
  MAX_VOID_CHEQUE_BYTES,
  resourceTypeFor,
  validateVoidCheque,
} from "../src/lib/employee-files";
// Stage 7 (item 20). The replacement for InventoryRule.usagePerJob — pure, with
// the DB half split into inventory-forecast.server.ts, so the maths runs here.
import { perJobAverages, projectUsage } from "../src/lib/inventory-forecast";
import {
  DEFAULT_CLEANER_RESTOCK_THRESHOLD,
  cleanerRestockThreshold,
} from "../src/lib/inventory-thresholds";

// ── Stage 0.1 baselines, recorded 2026-08-06 ────────────────────────────────
// `npx tsc --noEmit` clean · `npm run build` compiles · migrations in sync.
// 21.b compares the final lint count against this number.
export const LINT_BASELINE = 325; // 203 errors, 122 warnings

let pass = 0,
  fail = 0;

function check(name: string, actual: unknown, expected: unknown) {
  const okv = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${okv ? "PASS" : "FAIL"}  ${name}`);
  if (!okv) {
    console.log(`        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
  if (okv) pass++;
  else fail++;
}
const ok = (n: string, c: boolean) => check(n, c, true);

const read = (p: string) => fs.readFileSync(p, "utf8");
// The helpers below are the skeleton's API for the stages still to land, so
// they're exported: unused today, imported-or-used as each stage appends.
/** Assert a file contains a snippet. */
export const has = (name: string, path: string, needle: string) =>
  ok(name, read(path).includes(needle));
/** Assert a file does NOT contain a snippet (a removal stays removed). */
export const lacks = (name: string, path: string, needle: string) =>
  ok(name, !read(path).includes(needle));
/**
 * A file with its comment lines dropped, for "X no longer appears" checks where
 * the fix's own explanation legitimately NAMES the thing it removed. Same
 * line-based approach as the probe write-guard above.
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
export const lacksInCode = (name: string, path: string, needle: string) =>
  ok(name, !codeOf(path).includes(needle));
/** Assert a regex matches nowhere under a directory — the sweep checks. */
export const noMatchUnder = (name: string, dir: string, re: RegExp) => {
  const hits: string[] = [];
  for (const file of walk(dir)) {
    read(file)
      .split("\n")
      .forEach((line, i) => {
        if (re.test(line)) hits.push(`${file}:${i + 1}`);
      });
  }
  check(name, hits, []);
};

/**
 * Like `noMatchUnder`, but ignoring comment lines — the code-sweep counterpart
 * to `lacksInCode`. A removal whose replacement legitimately explains what it
 * replaced ("this used to read X") would otherwise flag itself, and the choice
 * would be between a weaker check and an unexplained diff.
 */
export const noCodeMatchUnder = (name: string, dir: string, re: RegExp) => {
  const hits: string[] = [];
  for (const file of walk(dir)) {
    read(file)
      .split("\n")
      .forEach((line, i) => {
        const t = line.trim();
        if (t.startsWith("//") || t.startsWith("*") || t.startsWith("/*")) return;
        if (re.test(line)) hits.push(`${file}:${i + 1}`);
      });
  }
  check(name, hits, []);
};

function walk(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = `${dir}/${e.name}`;
    if (e.isDirectory()) return walk(full);
    return /\.tsx?$/.test(e.name) ? [full] : [];
  });
}

/**
 * Every stage registers its checks through `section`, keyed by the PDF item
 * number from the TODO's execution map. The key is not decoration — the
 * completeness guard at the bottom uses it to prove no item was ticked off
 * without a check being written for it.
 */
const covered = new Set<number>();
export function section(item: number, title: string, body: () => void) {
  covered.add(item);
  console.log(`\n── Item ${item} · ${title} ──`);
  body();
}

// ═══════════════════════════════════════════════════════════════════════════
// Stage 0 — baseline & safety rails
// ═══════════════════════════════════════════════════════════════════════════

console.log("\n── Stage 0 · safety rails ──");

// The probe scripts are the only things in this round pointed at the LIVE
// database, and the house rules say they stay read-only until a fix explicitly
// calls for a `--commit`. Assert that mechanically rather than trusting them.
for (const probePath of [
  "scripts/probe-awer-fixes-3.ts",
  // Fix 1 (1.h) — the old-vs-new payout delta the owner signs off against.
  "scripts/probe-pay-multiplier-delta.ts",
  // Stage 5 — the checklist-duplicate count that decided whether the @@unique
  // index could ship, and the reported-hours delta for item 15.d.
  "scripts/probe-stage5.ts",
] as const) {
  const label = probePath.split("/").pop()!;
  const exists = fs.existsSync(probePath);
  ok(`live-data probe exists: ${label}`, exists);
  if (!exists) continue;
  const probe = read(probePath)
    .split("\n")
    .filter((l) => {
      const t = l.trim();
      return !t.startsWith("*") && !t.startsWith("//") && !t.startsWith("/*");
    })
    .join("\n");
  const writes = [
    ".create(",
    ".createMany(",
    ".update(",
    ".updateMany(",
    ".upsert(",
    ".delete(",
    ".deleteMany(",
    "$executeRaw",
    "$transaction",
  ].filter((w) => probe.includes(w));
  check(`${label} performs no writes`, writes, []);
  ok(
    `${label} has no --commit switch to flip`,
    !probe.includes("--commit") && !probe.includes("process.argv")
  );
}

// Stage 0.2 — the two 2026-07-28 migrations the previous round shipped must
// still be present, since this round's migrations stack on top of them.
for (const dir of [
  "prisma/migrations/20260728000000_rating_exclusion",
  "prisma/migrations/20260728010000_align_schema_drift",
] as const) {
  ok(`prior-round migration present: ${dir.split("/").pop()}`, fs.existsSync(dir));
}

// ═══════════════════════════════════════════════════════════════════════════
// Stages 1–7 — appended per item as each lands.
//
//   section(1, "pay multiplier drives cleaner pay", () => { … })
//
// ═══════════════════════════════════════════════════════════════════════════

section(1, "pay multiplier drives cleaner pay", () => {
  const r2 = (n: number) => Math.round(n * 100) / 100;
  const rate4 = (c: CleanerRateInput) =>
    Math.round(individualRate(c) * 10000) / 10000;

  // ── Fixtures, modelled on scripts/verify-cleaner-pay.ts ───────────────────
  const rate = (
    id: string,
    opts: Partial<CleanerRateInput> = {}
  ): [string, CleanerRateInput] => [id, { ...fallbackRateInput(id), ...opts }];

  // The PDF's worked example. 4.5 floors to the "4.5" step, which the default
  // map prices at 1.13x — read FROM the map rather than hardcoded, so editing
  // DEFAULT_RATING_MULTIPLIERS can never quietly invalidate the example.
  const M45 = multiplierForRating(4.5, DEFAULT_RATING_MULTIPLIERS).multiplier;
  const RATED = { avgRating: 4.5, ratingCount: 9, multiplier: M45 };

  const RATES = new Map<string, CleanerRateInput>([
    rate("nina", { role: "EMPLOYEE", ...RATED }), // STANDARD 40% x 1.13
    rate("bob", { role: "EMPLOYEE" }), // no ratings -> 1.00x
    rate("newbie", {
      role: "EMPLOYEE",
      avgRating: 5,
      ratingCount: 4,
      multiplier: 1,
    }),
    rate("tim", { role: "EMPLOYEE", tier: "TRAINEE", ...RATED }),
    rate("fay", { role: "EMPLOYEE", tier: "FIELD_LEAD", ...RATED }),
  ]);

  // NOTE: no `payRateMultiplier` key. Its absence from the fixture is itself an
  // assertion — the field is deprecated-optional and the math must not want it.
  const job = (over: Partial<JobPayInput>): JobPayInput => ({
    id: "j", employeeId: null, cleaners: [], price: null, employeePay: null,
    payType: "PERCENTAGE", hourlyRate: null, totalTip: null, jobDate: null,
    startTime: null, endTime: null, clockInTime: null, clockOutTime: null,
    assignments: [], ...over,
  });
  const paid = (j: JobPayInput, id: string) =>
    computeJobPayShares(j, RATES).get(id)?.total ?? 0;

  // ── (a) The PDF's acceptance example ──────────────────────────────────────
  check("the settings map prices a 4.5 average at 1.13x", M45, 1.13);
  check(
    "individualRate = tier base x multiplier (40% x 1.13 = 45.2%)",
    rate4(RATES.get("nina")!),
    0.452
  );
  check(
    "PDF example: $100 job, Standard, 4.5 stars -> $45.20",
    paid(job({ price: 100, cleaners: [{ id: "nina" }] }), "nina"),
    45.2
  );
  // $42.00 is what the retired standardRateForRating ladder paid the SAME
  // cleaner (4.4-4.59 -> 41%... 42% band). Asserting it is gone is what proves
  // the ladder is not silently still in charge.
  ok(
    "the retired 40-45% ladder no longer sets the rate",
    paid(job({ price: 100, cleaners: [{ id: "nina" }] }), "nina") !== 42
  );

  // ── (b) A manual override is never multiplied ─────────────────────────────
  const overridden = job({
    price: 100,
    cleaners: [{ id: "nina" }],
    assignments: [{ cleanerId: "nina", payAmount: 60 }],
  });
  check("a manual $60 override stays exactly $60 with a 1.13x in play",
    paid(overridden, "nina"), 60);
  check("...and the SAME cleaner unoverridden IS multiplied, so 1.13x is real",
    paid(job({ price: 100, cleaners: [{ id: "nina" }] }), "nina"), 45.2);
  // The old code multiplied overrides too (cleaner-earnings.ts:250), which was
  // invisible only while every job carried 1.0.
  ok("an override is not silently scaled to $67.80",
    paid(overridden, "nina") !== 67.8);

  // ── (c) FLAT / HOURLY are unaffected by the multiplier ────────────────────
  const flat = job({
    price: 0, employeePay: 100, payType: "FLAT",
    cleaners: [{ id: "nina" }, { id: "bob" }],
  });
  check("FLAT: the 1.13x cleaner still gets half the typed total",
    paid(flat, "nina"), 50);
  check("FLAT: the 1.00x cleaner gets the same half", paid(flat, "bob"), 50);
  check("FLAT: the crew total equals the admin-typed employeePay",
    r2(paid(flat, "nina") + paid(flat, "bob")), 100);
  check("HOURLY: the computed hourly total is not multiplied",
    paid(job({ price: 0, employeePay: 150, payType: "HOURLY", hourlyRate: 30,
               cleaners: [{ id: "nina" }] }), "nina"), 150);
  // FLAT + a partial override: the override comes off the top, the rest splits
  // the remainder, and the crew total is still the typed figure.
  const flatMixed = job({
    price: 0, employeePay: 100, payType: "FLAT",
    cleaners: [{ id: "nina" }, { id: "bob" }],
    assignments: [
      { cleanerId: "nina", payAmount: 70 },
      { cleanerId: "bob", payAmount: null },
    ],
  });
  check("FLAT + override: the override is exact", paid(flatMixed, "nina"), 70);
  check("FLAT + override: the remainder is not multiplied",
    paid(flatMixed, "bob"), 30);
  check("FLAT + override: the crew total is still the typed $100",
    r2(paid(flatMixed, "nina") + paid(flatMixed, "bob")), 100);
  // A legacy PERCENTAGE row with no price falls back to employeePay, also a
  // recorded/imported amount — must not be scaled either.
  check("legacy no-price PERCENTAGE splits employeePay unscaled",
    paid(job({ price: 0, employeePay: 80, cleaners: [{ id: "nina" }, { id: "bob" }] }), "nina"),
    40);

  // ── (d) A settings change moves pay on the very next read ─────────────────
  const GENEROUS = { ...DEFAULT_RATING_MULTIPLIERS, "4.5": 1.2 };
  const RATES_AFTER = new Map<string, CleanerRateInput>([
    rate("nina", {
      role: "EMPLOYEE", avgRating: 4.5, ratingCount: 9,
      multiplier: multiplierForRating(4.5, GENEROUS).multiplier,
    }),
  ]);
  const j100 = job({ price: 100, cleaners: [{ id: "nina" }] });
  check("editing Settings -> multipliers.ratings repays the job: 40% x 1.20 -> $48.00",
    computeJobPayShares(j100, RATES_AFTER).get("nina")?.total ?? 0, 48);
  ok("the same job pays differently before and after the settings edit",
    (computeJobPayShares(j100, RATES_AFTER).get("nina")?.total ?? 0) !==
      paid(j100, "nina"));

  // ── The gate: no premium under STANDARD_RATINGS_REQUIRED ratings ──────────
  check("STANDARD_RATINGS_REQUIRED is still 5", STANDARD_RATINGS_REQUIRED, 5);
  check("a 5-star cleaner with only 4 ratings is locked at 1.00x -> $40.00",
    paid(job({ price: 100, cleaners: [{ id: "newbie" }] }), "newbie"), 40);
  check("a cleaner with no ratings at all is locked at 1.00x -> $40.00",
    paid(job({ price: 100, cleaners: [{ id: "bob" }] }), "bob"), 40);
  check("the gate helper: 4 ratings -> 1.0",
    effectiveMultiplier(5, 4, DEFAULT_RATING_MULTIPLIERS), 1);
  check("the gate helper: 5 ratings -> the mapped value",
    effectiveMultiplier(4.5, 5, DEFAULT_RATING_MULTIPLIERS), 1.13);
  // individualRate re-applies the gate, so a hand-built input cannot smuggle a
  // premium past it.
  check("individualRate ignores a multiplier the cleaner has not earned",
    rate4({ ...fallbackRateInput("x"), avgRating: 5, ratingCount: 1, multiplier: 1.25 }),
    0.4);
  // Defensive clamp — an absurd stored value can never out-pay the customer.
  check("an absurd multiplier is clamped to 100% of price",
    rate4({ ...fallbackRateInput("x"), avgRating: 5, ratingCount: 9, multiplier: 50 }),
    1);
  // The read-side sanitiser: the live row may hold zeros from the old `?? 0`
  // bug, which would otherwise pay a whole rating band $0.00.
  check("a stored 0 is rejected and falls back to the default",
    sanitizeRatingMultiplierMap({ "4.5": 0 })["4.5"],
    DEFAULT_RATING_MULTIPLIERS["4.5"]);
  check("an out-of-range multiplier is rejected",
    sanitizeRatingMultiplierMap({ "5.0": 113 })["5.0"],
    DEFAULT_RATING_MULTIPLIERS["5.0"]);
  check("an in-range multiplier is kept",
    sanitizeRatingMultiplierMap({ "5.0": 1.4 })["5.0"], 1.4);

  // ── Tips ride on top and are never multiplied ─────────────────────────────
  const tipped = computeJobPayShares(
    job({ price: 100, totalTip: 20, cleaners: [{ id: "nina" }] }), RATES
  ).get("nina")!;
  check("the tip is passed through whole", tipped.tip, 20);
  check("total = multiplied base + unmultiplied tip", tipped.total, 65.2);
  ok("the tip was not scaled by 1.13x", tipped.tip !== 22.6);
  check("tips still split evenly across a mixed-multiplier pair",
    computeJobPayShares(
      job({ price: 100, totalTip: 20, cleaners: [{ id: "nina" }, { id: "bob" }] }),
      RATES
    ).get("bob")!.tip, 10);

  // ── Every tier takes the multiplier on its own base ───────────────────────
  check("TRAINEE base is 30%", TRAINEE_RATE, 0.3);
  check("STANDARD base is 40%", STANDARD_FLOOR_RATE, 0.4);
  check("FIELD_LEAD base is 46%", FIELD_LEAD_RATE, 0.46);
  check("TRAINEE at 4.5 stars: 30% x 1.13 -> $33.90",
    paid(job({ price: 100, cleaners: [{ id: "tim" }] }), "tim"), 33.9);
  check("FIELD_LEAD at 4.5 stars: 46% x 1.13 -> $51.98",
    paid(job({ price: 100, cleaners: [{ id: "fay" }] }), "fay"), 51.98);
  check("a mixed-tier pair: neither cleaner's rate touches the other",
    [paid(job({ price: 100, cleaners: [{ id: "tim" }, { id: "fay" }] }), "tim"),
     paid(job({ price: 100, cleaners: [{ id: "tim" }, { id: "fay" }] }), "fay")],
    [33.9, 51.98]);

  // ══ SOURCE — 1.c: the ladder is retired but still exported ════════════════
  lacks("individualRate no longer calls the retired rating ladder",
    "src/lib/pay-tiers.ts", "return standardRateForRating(");
  has("standardRateForRating is kept, deprecated, so a stale import is caught",
    "src/lib/pay-tiers.ts", "export function standardRateForRating");
  has("...and it carries the @deprecated marker",
    "src/lib/pay-tiers.ts", "@deprecated");
  // pay-tiers.ts itself legitimately still names it, so sweep the app surfaces.
  noMatchUnder("no app surface imports the retired ladder", "src/app",
    /\bstandardRateForRating\b/);
  lacks("the money module does not use the retired ladder",
    "src/lib/cleaner-earnings.ts", "standardRateForRating");
  has("the multiplier is REQUIRED on CleanerRateInput",
    "src/lib/pay-tiers.ts", "multiplier: number;");
  has("one shared fallback so the call sites cannot drift",
    "src/lib/pay-tiers.ts", "export function fallbackRateInput");

  // ══ SOURCE — 1.b/1.e: window, gate and the display cache ══════════════════
  has("the rate loader reads the settings map",
    "src/lib/cleaner-rates.ts", "getRatingMultiplierMap()");
  has("the rate loader still excludes admin-excluded ratings",
    "src/lib/cleaner-rates.ts", "excludedAt: null");
  lacks("recalculateMultiplier no longer uses a 30-day window",
    "src/app/admin/actions/recalculateMultiplier.ts", "since.getDate() - 30");
  has("recalculateMultiplier stamps the run",
    "src/app/admin/actions/recalculateMultiplier.ts",
    "multiplierLastRecalculatedAt");
  has("the round-2 excludedAt contract survives in recalculateMultiplier",
    "src/app/admin/actions/recalculateMultiplier.ts", "excludedAt: null");
  has("the round-2 exclusion call site survives",
    "src/app/admin/actions/setRatingExcluded.ts",
    "recalculateMultiplier({ employeeId: rating.employeeId })");
  has("saving the map recalculates every cleaner's cached multiplier",
    "src/app/admin/settings/tabs/MultipliersTab.tsx",
    "recalculateAllMultipliers()");
  lacks("an empty multiplier input can no longer persist 0",
    "src/app/admin/settings/tabs/MultipliersTab.tsx", "values[step] ?? 0");
  has("the map is sanitised on read",
    "src/lib/pay-multiplier-config.ts", "sanitizeRatingMultiplierMap");

  // ══ SOURCE — 1.f: Job.payRateMultiplier is out of the money path ══════════
  lacks("computeJobPayShares no longer reads Job.payRateMultiplier",
    "src/lib/cleaner-earnings.ts", "job.payRateMultiplier");
  lacks("the payroll select no longer pulls the dead column",
    "src/lib/cleaner-earnings.ts", "payRateMultiplier: true");
  lacks("payRateMultiplier is out of SERIES_PROPAGATED_FIELDS",
    "src/lib/job-series.ts", '"payRateMultiplier"');
  lacks("saveJob no longer writes payRateMultiplier",
    "src/app/admin/actions/saveJob.ts", "payRateMultiplier:");
  lacks("the new-job page no longer writes payRateMultiplier",
    "src/app/admin/jobs/new/page.tsx", "payRateMultiplier:");
  lacks("getPayBreakdown no longer reads the job column",
    "src/app/admin/actions/getPayBreakdown.ts", "job.payRateMultiplier");
  // The sweep: nothing under src/ reads the column off a job any more.
  noMatchUnder("nothing under src/ reads Job.payRateMultiplier", "src",
    /\bjob\.payRateMultiplier\b/);
  // The column SURVIVES — this fix deprecates in place, it does not migrate.
  has("the schema still declares the column (no destructive migration)",
    "prisma/schema.prisma", "payRateMultiplier              Float?");
  has("...and it is marked deprecated where it lives",
    "prisma/schema.prisma", "DEPRECATED (AWER round 3, fix 1)");
  has("the CSV importer deliberately still accepts the column",
    "src/app/admin/actions/importCsv.ts", "payRateMultiplier");
  has("the CSV template warns that the column is ignored",
    "src/lib/csv/entities.ts", "Deprecated — stored but ignored");

  // ══ SOURCE — 1.g: every payout surface on the one calculation ═════════════
  has("the job detail page computes the payout server-side",
    "src/app/admin/jobs/[id]/page.tsx", "computedEmployeePay");
  has("the Financials tab prints the computed total",
    "src/app/admin/jobs/[id]/JobDetailView.tsx", "computedEmployeePay.toFixed(2)");
  lacks("net profit no longer subtracts the stored column",
    "src/app/admin/jobs/[id]/JobDetailView.tsx",
    "(job.price || 0) - (job.employeePay || 0)");
  has("a divergent stored value is surfaced, not hidden",
    "src/app/admin/jobs/[id]/JobDetailView.tsx", "storedPayDiffers");
  has("the available-jobs estimate uses the shared fallback",
    "src/app/cleaners/available-jobs/page.tsx", "fallbackRateInput(id)");
  has("the admin breakdown reports the RESOLVED cleaner multiplier",
    "src/app/admin/actions/getPayBreakdown.ts", "payMultiplier: resolvedMultiplier");
  has("...and says when it does not apply",
    "src/app/admin/actions/getPayBreakdown.ts", "payMultiplierApplies");
  has("getPayBreakdown computes the payout by ONE route",
    "src/app/admin/actions/getPayBreakdown.ts", "computeJobPayShares(");
  lacks("...the second, diverging route is gone",
    "src/app/admin/actions/getPayBreakdown.ts", "computeJobPayout(");
  has("the cleaner payload carries a rating-boost state",
    "src/app/admin/actions/getPayBreakdown.types.ts", "ratingBoost");
  has("the cleaner modal renders the multiplier line",
    "src/app/cleaners/my-jobs/PayBreakdownModal.tsx", "Rating bonus");
  has("...conditionally, so FLAT/HOURLY/override jobs never show one",
    "src/app/cleaners/my-jobs/PayBreakdownModal.tsx", "NOT_APPLICABLE");
  has("payroll still routes through the one calculation",
    "src/lib/pay-period.server.ts", "computeJobPayShares(input, rateInputs)");
  has("the Field Lead bonus excludes admin-excluded ratings",
    "src/lib/field-lead-bonus.server.ts", "excludedAt: null");
  has("performance data is sourced from the all-time average",
    "src/app/admin/actions/getPerformanceData.ts", "ratingAllTime");
  has("...via the same loader payroll uses",
    "src/app/admin/actions/getPerformanceData.ts", "getCleanerRateInputs");
  lacks("the 30-day rating expiry (which no longer exists) is gone",
    "src/app/admin/actions/getPerformanceData.ts", "RATING_EXPIRY_DAYS");
  lacks("...and so is the 'expiring soon' claim it powered",
    "src/app/admin/actions/getPerformanceData.ts", "expiringSoon");
  lacks("the profile hero no longer labels the score '30-day'",
    "src/app/admin/settings/tabs/ProfileTab.tsx", "30-day rating");
});

// ═══════════════════════════════════════════════════════════════════════════
// Stage 2 — quick, isolated wins
// ═══════════════════════════════════════════════════════════════════════════

section(2, 'the "usually $10 less" price claim is gone', () => {
  const STEP3 = "src/app/(book)/book/steps/Step3Schedule.tsx";

  lacks("the flexible option no longer promises a discount", STEP3, "usually $10 less");
  has("...and still says what flexible actually means", STEP3,
    "Our team picks the best time for the day (9AM–7PM).");

  // The claim was false, not merely stale: nothing in pricing reads isFlexible.
  // If someone later wires a real flexible discount, this check fails and the
  // copy can be restored deliberately rather than by accident.
  const pricing = read("src/lib/booking-pricing.ts");
  const inputShape = pricing.slice(
    pricing.indexOf("export interface PricingInput"),
    pricing.indexOf("}", pricing.indexOf("export interface PricingInput"))
  );
  ok("PricingInput still has no flexible-time term", !/flexible/i.test(inputShape));
  ok(
    "computeBookingPrice still never reads isFlexible",
    !pricing.includes("isFlexible")
  );

  // And no price claim crept back in anywhere else in the booking flow.
  noMatchUnder("no '$10 less' style claim under /book", "src/app/(book)",
    /\$10\b|10 less|usually \$/);
});

section(3, "price column and its row are readable", () => {
  // ── BEHAVIOUR — WCAG 2.1 relative luminance / contrast ratio ──────────────
  // These pairs are CSS, so they can't be exercised in a browser from here.
  // The ratio itself is arithmetic, though, so it can be: the check below is
  // the real WCAG formula, not a source string match.
  type RGB = [number, number, number];
  const hex = (h: string): RGB => [
    parseInt(h.slice(1, 3), 16),
    parseInt(h.slice(3, 5), 16),
    parseInt(h.slice(5, 7), 16),
  ];
  const lum = ([r, g, b]: RGB) => {
    const f = (c: number) => {
      const s = c / 255;
      return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const ratio = (fg: RGB, bg: RGB) => {
    const [hi, lo] = [lum(fg), lum(bg)].sort((a, b) => b - a);
    return (hi + 0.05) / (lo + 0.05);
  };
  /** Composite a translucent foreground over an opaque background. */
  const over = (fg: RGB, alpha: number, bg: RGB): RGB =>
    fg.map((c, i) => Math.round(c * alpha + bg[i] * (1 - alpha))) as RGB;

  const WHITE: RGB = [255, 255, 255];
  const CREAM = hex("#f3f6f9");
  const INK = hex("#0e1a1c");
  const TEAL: RGB = [0, 140, 156];
  const PRIMARY_800 = hex("#005a63");
  const PRIMARY_10 = over(TEAL, 0.1, WHITE);
  const INK_SOFT = over(INK, 0.65, WHITE);

  // AA for normal-size text. None of these qualify as "large" (that needs
  // 18.66px bold or 24px) — .jcard-price at 18px/600 is the closest and misses.
  const AA = 4.5;
  const passes = (name: string, fg: RGB, bg: RGB) =>
    ok(`${name} ≥ AA (${ratio(fg, bg).toFixed(2)}:1)`, ratio(fg, bg) >= AA);

  passes("price cell — --ink on white", INK, WHITE);
  passes("price cell — --ink on hovered row (--cream)", INK, CREAM);
  passes("mobile .jcard-price — --ink on white", INK, WHITE);
  passes("pay-icon unpaid/unsent — --primary-800 on --cream", PRIMARY_800, CREAM);
  passes("TypePill RESIDENTIAL — --primary-800 on --primary-10", PRIMARY_800, PRIMARY_10);
  passes("StatusPill PAID — white on emerald-700", WHITE, hex("#047857"));
  passes("profit-pct.good — emerald-700 on white", hex("#047857"), WHITE);
  passes("empty-cell em-dash — --ink-soft on white", INK_SOFT, WHITE);
  passes("payment-type label — --ink-soft on white", INK_SOFT, WHITE);

  // The values these replaced, asserted as failures — so a revert can't pass
  // this suite by quietly restoring the old colours.
  const fails = (name: string, fg: RGB, bg: RGB) =>
    ok(`(regression guard) ${name} was BELOW AA (${ratio(fg, bg).toFixed(2)}:1)`,
      ratio(fg, bg) < AA);
  fails("--primary-50 on --cream", over(TEAL, 0.7, CREAM), CREAM);
  fails("--primary on white", TEAL, WHITE);
  fails("--primary on --primary-10", TEAL, PRIMARY_10);
  fails("white on emerald-600", WHITE, hex("#059669"));
  fails("--primary-40 on white", over(TEAL, 0.62, WHITE), WHITE);

  // Alpha steps of #008C9C cannot reach AA at ANY alpha. This is why the fix
  // introduced a solid token instead of darkening the ramp again — and why the
  // ramp itself is recorded in the TODO as a separate item.
  ok("the --primary alpha ramp cannot reach AA on white at alpha 1.0",
    ratio(TEAL, WHITE) < AA);

  // ── SOURCE — the rules and call sites the ratios above describe ───────────
  const CSS = "src/app/globals.css";
  has("the readable-teal token exists", CSS, "--primary-800:   #005a63");
  has("the readable-green token exists", CSS, "--emerald-700:   #047857");
  has("the price cell has its own rule", CSS,
    ".atable .col-price { color: var(--ink); font-weight: 600; }");
  has("unpaid pay-icons are solid teal with a border", CSS,
    ".pay-icon.unpaid { background: var(--cream); color: var(--primary-800); border-color: var(--primary-20); }");
  has("...and unsent ones match", CSS,
    ".pay-icon.unsent { background: var(--cream); color: var(--primary-800); border-color: var(--primary-20); }");
  has("all pay-icon variants reserve the border so sizes stay equal", CSS,
    "border: 1px solid transparent;");
  has("the mobile card price uses --ink", CSS, "color: var(--ink); font-weight: 600; }");
  has("good profit uses emerald-700", CSS, ".profit-pct.good { color: var(--emerald-700); }");

  const JOBS = "src/app/admin/jobs/JobsView.tsx";
  const DETAIL = "src/app/admin/jobs/[id]/JobDetailView.tsx";
  has("the price cell carries the class", JOBS, 'className="num col-price"');
  has("the discount em-dash is readable", JOBS,
    `: <span style={{ color: 'var(--ink-soft)' }}>—</span>`);
  has("the payment-type label is readable", JOBS,
    `<span style={{ fontSize: 12, color: 'var(--ink-soft)' }}>{payTypeLabel(job.paymentType)}</span>`);

  // StatusPill and TYPE_PILL_COLORS are duplicated verbatim in these two files.
  // Both must move together or the list and the detail page disagree — which is
  // exactly what the comment above each copy promises won't happen.
  for (const [label, path] of [["jobs list", JOBS], ["job detail", DETAIL]] as const) {
    has(`${label}: PAID pill uses emerald-700`, path,
      `PAID:        { label: 'Paid',        bg: '#047857', color: '#ffffff', dot: '#a7f3d0' },`);
    lacks(`${label}: ...and not the failing emerald-600`, path, `bg: '#059669'`);
    has(`${label}: RESIDENTIAL pill uses the readable teal`, path,
      `RESIDENTIAL:       { bg: 'var(--primary-10)', color: 'var(--primary-800)' },`);
  }

  // 3.d — admin ships no dark theme, so there is no second palette to check.
  // If one is ever added this fails, and the pairs above must be re-measured.
  const css = read(CSS);
  ok("admin is still light-only (no theme switching to re-audit)",
    !css.includes("[data-theme") && !/\.dark\b/.test(css));
});

section(4, "job details opens at the top", () => {
  const DETAIL = "src/app/admin/jobs/[id]/JobDetailView.tsx";
  const PAGE = "src/app/admin/jobs/[id]/page.tsx";
  const TOP = "src/app/admin/jobs/[id]/ScrollToTop.tsx";
  const JOBS = "src/app/admin/jobs/JobsView.tsx";
  const CLIENT = "src/app/admin/clients/[id]/ClientDetailView.tsx";

  // 4.a — the real scroller is a grandchild of <main>, which ScrollReset skips
  // by design; the opt-in attribute is what brings it into scope.
  has("the page scroller opts into the global reset", DETAIL,
    `<div data-scroll-reset className="admin-font relative h-full overflow-y-auto pb-8 px-4">`);
  has("ScrollReset still honours that attribute", "src/components/ScrollReset.tsx",
    `querySelectorAll<HTMLElement>("[data-scroll-reset]")`);

  // 4.b — the full-page-load safety net.
  ok("a per-page ScrollToTop exists", fs.existsSync(TOP));
  has("it is mounted on the job page", PAGE, "<ScrollToTop jobId={id} />");
  has("...keyed on the job id", TOP, "}, [jobId]);");
  // The trap documented in JobDetailView: the admin shell wrapper is itself
  // .overflow-y-auto and comes first in the DOM, so a previous attempt at this
  // fix reset the sidebar instead of the page.
  lacksInCode("it never matches .overflow-y-auto (that reset the sidebar)", TOP,
    "overflow-y-auto");
  has("it targets the tagged scroller instead", TOP, "[data-scroll-reset]");
  // The calendar deep-links to #photos; a blind reset would fight the anchor.
  has("it stands down when the URL carries a hash", TOP,
    "if (window.location.hash) return;");

  // 4.c — SPA navigation, so ScrollReset applies at all.
  lacks("the jobs table navigates without a full page load", JOBS,
    "window.location.href");
  has("...via the router it already had", JOBS,
    "router.push(`/admin/jobs/${job.id}`)");
  lacks("the client detail jobs tables do the same", CLIENT, "window.location.href");
  has("...with a router of its own", CLIENT, "const router = useRouter();");

  // Tab switches and log pagination must NOT be reset — an admin paging through
  // an audit trail keeps their place. Both go through scroll-preserving replaces.
  has("tab switching preserves scroll", DETAIL,
    "router.replace(query ? `/admin/jobs/${job.id}?${query}` : `/admin/jobs/${job.id}`, { scroll: false });");
  // Log pagination does not go through the router AT ALL any more, so there is
  // no navigation left to preserve scroll across.
  //
  // The scroll-preserving replace this used to assert was correct but far too
  // expensive: it re-rendered the whole job route to swap ten rows, and that
  // render is slow enough (~14s against a remote pooler, ~33s before this
  // page's reads were parallelised) that the page turn routinely never landed.
  // Browser-tested: the pager was dead, not slow. It now fetches the rows from
  // a route handler and syncs the URL with history.replaceState — one query, no
  // render, and therefore no scroll change to protect.
  has("log pagination fetches rows instead of re-rendering the route", DETAIL,
    "`/api/admin/jobs/${job.id}/logs?page=${encodeURIComponent(String(page))}`");
  ok("...and that route handler exists",
    fs.existsSync("src/app/api/admin/jobs/[id]/logs/route.ts"));
  lacksInCode("...so the pager never calls the router", DETAIL,
    "router.replace(`/admin/jobs/${job.id}?${params.toString()}`");
  has("...it updates the URL without navigating", DETAIL,
    "window.history.replaceState(");
  // Passing the existing state back is what keeps Next's own navigation state
  // intact, so Back/Forward still work after paging.
  has("...preserving Next's navigation state", DETAIL,
    "window.history.state,");
  lacks("...and still no hard navigation", DETAIL, "?tab=logs&logsPage=");
  // The rows are client state now; a pager still reading the props would be
  // frozen on page 1 for ever.
  has("the pager reads live paging state, not the props", DETAIL,
    "updateLogsPage(logPage + 1)");
  // The deep link has to work on the FIRST render. An effect cannot do it here:
  // this page's subtree is not interactive for seconds after load, so
  // `?tab=logs` visibly landed on "Job details" and stayed there.
  has("the tab is seeded from the URL, not corrected by an effect", DETAIL,
    "useState<TabView>(() => {");
  lacksInCode("ScrollToTop is not keyed on searchParams (which tabs/logs change)",
    TOP, "searchParams");
});

section(5, "referral rewards follow Settings", () => {
  const FORM = "src/app/(customer)/(secured)/account/AccountForm.tsx";
  const PAGE = "src/app/(customer)/(secured)/account/page.tsx";

  // The money paths already read Settings; only the promise was hardcoded.
  lacks("the account card no longer hardcodes the discount", FORM, "$15 off");
  lacks("...nor the credit", FORM, "$10 credit");
  has("it renders the configured discount", FORM, "{formatReward(referralDiscount)} off");
  has("...and the configured credit", FORM, "{formatReward(referrerCredit)} credit");

  has("the page reads the discount key", PAGE, `"customer.newClientReferralDiscountUsd"`);
  has("...and the credit key", PAGE, `"customer.referrerCreditUsd"`);
  has("...through the batched loader it already used", PAGE, "await getSettings([");

  // Same keys the booking action actually pays out on — that identity is the
  // whole point of the fix, so assert it rather than assuming it.
  const SUBMIT = "src/app/(book)/actions/submitBooking.ts";
  has("submitBooking pays the discount from the same key", SUBMIT,
    `getSetting("customer.newClientReferralDiscountUsd")`);
  has("...and credits the referrer from the same key", SUBMIT,
    `getSetting("customer.referrerCreditUsd")`);

  // 5.b — orphaned constants that could drift back into use.
  const REF = "src/lib/referral.ts";
  // Comment-stripped: the file's header explains what was removed and why, and
  // naming the dead constants there is the point of that note.
  lacksInCode("the orphaned discount constant is gone", REF, "NEW_CLIENT_DISCOUNT");
  lacksInCode("the orphaned credit constant is gone", REF, "REFERRER_CREDIT");
  has("the code generator it shared a file with survives", REF,
    "export async function ensureClientReferralCode");
  lacks("the booking form no longer suggests a fake coded discount",
    "src/app/(book)/book/steps/Step4Contact.tsx", "FRIEND15");

  // 5.c — the sweep. Verified clean at fix time; this keeps it clean. Matches a
  // dollar amount sitting next to referral/credit wording, which is how the
  // AccountForm bug read before the fix.
  const REFERRAL_MONEY =
    /\$\d+(\.\d+)?\s*(off|credit)|(referral|referrer)[^\n]{0,40}\$\d/i;
  noMatchUnder("no hardcoded referral amounts in the customer portal",
    "src/app/(customer)", REFERRAL_MONEY);
  noMatchUnder("no hardcoded referral amounts in the booking flow",
    "src/app/(book)", REFERRAL_MONEY);
  for (const lib of ["src/lib/email.ts", "src/lib/sms.ts", "src/lib/notifications/catalog.ts"]) {
    const hits = read(lib)
      .split("\n")
      .map((line, i) => (REFERRAL_MONEY.test(line) ? `${lib}:${i + 1}` : null))
      .filter(Boolean);
    check(`no hardcoded referral amounts in ${lib.split("/").pop()}`, hits, []);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Stage 3 — the add-on platform arc (items 6–10)
// ─────────────────────────────────────────────────────────────────────────────

const RATES: TaxRates = DEFAULT_TAX_RATES;

section(6, "Add-on quantities on /book (PDF #7)", () => {
  // ── BEHAVIOUR: the quantity primitives ──────────────────────────────────
  check("quantity: absent reads as 1", addOnQuantity({}), 1);
  check("quantity: null reads as 1", addOnQuantity({ quantity: null }), 1);
  check("quantity: 0 clamps up to 1", addOnQuantity({ quantity: 0 }), 1);
  check("quantity: negative clamps up to 1", addOnQuantity({ quantity: -3 }), 1);
  check("quantity: fractional floors", addOnQuantity({ quantity: 2.7 }), 2);
  check(
    "quantity: clamps down to MAX_ADDON_QUANTITY",
    addOnQuantity({ quantity: 999 }),
    MAX_ADDON_QUANTITY
  );

  check("line total is unit x quantity", addOnLineTotal({ price: 12.5, quantity: 3 }), 37.5);
  // Without the rounding this is 0.30000000000000004, which reaches a receipt.
  check("line total is rounded", addOnLineTotal({ price: 0.1, quantity: 3 }), 0.3);
  check(
    "sum uses line totals, not unit prices",
    sumAddOns([
      { price: 25, quantity: 2 },
      { price: 10, quantity: 3 },
    ]),
    80
  );
  check("sum of none is 0", sumAddOns([]), 0);
  check("sum of null is 0", sumAddOns(null), 0);

  // A web booking carrying a x2 add-on must read back EXACTLY what is stored.
  const web = computeJobMoney(
    {
      bookingSource: "web",
      price: 284.55,
      subtotalAmount: 247.5,
      gstAmount: 12.38,
      qstAmount: 24.69,
      totalAmount: 284.55,
      discountAmount: 25,
      addOns: [{ name: "Inside Fridge", price: 25, quantity: 2 }],
    },
    RATES
  );
  check("web booking subtotal is unchanged by quantity", web.subtotalAmount, 247.5);
  check("web booking total is unchanged by quantity", web.totalAmount, 284.55);
  check("web booking base is the residual", web.basePrice, 197.5);
  check("web add-on total counts the quantity", web.addOnTotal, 50);

  // ── SOURCE ──────────────────────────────────────────────────────────────
  const MIGRATION = "prisma/migrations/20260806000000_job_addon_quantity/migration.sql";
  ok("the quantity migration exists", fs.existsSync(MIGRATION));
  has("migration adds the column defaulting to 1", MIGRATION,
    'ADD COLUMN "quantity" INTEGER NOT NULL DEFAULT 1');
  {
    const schema = read("prisma/schema.prisma");
    const block = schema.slice(schema.indexOf("model JobAddOn {"));
    const body = block.slice(0, block.indexOf("\n}"));
    ok("schema declares quantity Int @default(1)",
      /quantity\s+Int\s+@default\(1\)/.test(body));
    ok("price is still the UNIT price, and says so", /UNIT price/.test(body));
  }

  // The nested-button blocker: the add-on card is a <button>, so the quantity
  // stepper must be its SIBLING. Nested buttons are invalid HTML that React
  // renders without complaint, so only a structural check catches a regression.
  {
    const step2 = read("src/app/(book)/book/steps/Step2Property.tsx");
    has("add-on card has a shell to hang the stepper off",
      "src/app/(book)/book/steps/Step2Property.tsx", "cl-addon-card-shell");
    const cardStart = step2.indexOf('className="cl-addon-card"');
    const cardEnd = step2.indexOf("</button>", cardStart);
    ok("no <button> nested inside the add-on card button",
      cardStart > 0 && cardEnd > cardStart &&
        !step2.slice(cardStart, cardEnd).includes("<button"));
    has("the card carries a quantity stepper",
      "src/app/(book)/book/steps/Step2Property.tsx", "QuantityStepper");
  }

  // Duplicate/blank catalog names collide on a name key and silently drop a row.
  lacksInCode("Step5Review no longer keys add-on rows by name",
    "src/app/(book)/book/steps/Step5Review.tsx", "key={a.name}");

  // Every quantity-blind sum is gone.
  lacksInCode("booking-pricing sums via the shared helper",
    "src/lib/booking-pricing.ts", "reduce((s, a) => s + a.price, 0)");
  lacksInCode("the /book sidebar sums via the shared helper",
    "src/app/(book)/book/page.tsx", "reduce((s, a) => s + a.price, 0)");
  lacksInCode("Step5Review sums via the shared helper",
    "src/app/(book)/book/steps/Step5Review.tsx", "reduce((s, a) => s + a.price, 0)");
  lacksInCode("receipt-pdf sums via the shared helper",
    "src/lib/receipt-pdf.ts", "reduce((s, a) => s + a.price, 0)");
  lacksInCode("getPayBreakdown sums via the shared helper",
    "src/app/admin/actions/getPayBreakdown.ts", "reduce((sum, a) => sum + (a.price || 0), 0)");

  // A restored draft used to replay only "which were selected", resetting every
  // quantity to 1 on reload.
  has("the draft restores quantities, not just the selection",
    "src/app/(book)/book/page.tsx", "restoredAddOnQtyRef");
  lacksInCode("the selection-only restore ref is gone",
    "src/app/(book)/book/page.tsx", "restoredAddOnKeysRef");

  // Both persist sites on the web path, all three on the admin path.
  {
    const submit = read("src/app/(book)/actions/submitBooking.ts");
    check("submitBooking writes quantity at both create sites",
      (submit.match(/quantity: a\.quantity/g) ?? []).length, 2);
    has("submitBooking clamps a client-supplied quantity",
      "src/app/(book)/actions/submitBooking.ts", "addOnQuantity(a)");
    has("submitBooking coalesces repeated add-ons instead of writing N rows",
      "src/app/(book)/actions/submitBooking.ts", "existing.quantity");
    const save = read("src/app/admin/actions/saveJob.ts");
    check("saveJob writes quantity at all three create sites",
      (save.match(/quantity: a\.quantity/g) ?? []).length, 3);
  }

  // The invoice hardcoded quantity: 1 on add-on lines; invoice-pdf already
  // renders a quantity column, so this is the only place that had to change.
  {
    const inv = read("src/app/admin/actions/generateInvoiceFromJob.ts");
    has("invoice add-on lines carry the real quantity",
      "src/app/admin/actions/generateInvoiceFromJob.ts", "quantity: addon.quantity");
    check("only the base service line is still quantity 1",
      (inv.match(/quantity: 1,/g) ?? []).length, 1);
    has("invoice-pdf already prints a quantity column",
      "src/lib/invoice-pdf.ts", "li.quantity");
  }

  // One bound, both ends: the stepper's max and the server clamp.
  has("the /book stepper uses the shared bound",
    "src/app/(book)/book/steps/Step2Property.tsx", "MAX_ADDON_QUANTITY");
  has("the admin stepper uses the shared bound",
    "src/app/admin/jobs/JobModal.tsx", "MAX_ADDON_QUANTITY");
  has("the server clamps to the shared bound",
    "src/app/(book)/actions/submitBooking.ts", "MAX_ADDON_QUANTITY");

  // Cleaners are non-financial viewers: quantity yes, price never.
  //
  // Stage 5 note: this page now renders the chip TWICE — once in the job-scope
  // card and once in the Add-ons card — so both are checked, and both read the
  // count through `addOnQuantity` rather than `a.quantity ?? 1`. The raw
  // fallback would have let the two disagree on a legacy or out-of-range row.
  {
    const cleaner = read("src/app/cleaners/my-jobs/[jobId]/page.tsx");
    const chips = [...cleaner.matchAll(/cl-jd-addon-chip/g)];
    ok("the cleaner page renders add-on chips", chips.length > 0);
    for (const m of chips) {
      const after = cleaner.slice(m.index ?? 0);
      const chipBlock = after.slice(0, after.indexOf("</div>"));
      // The clamped count is computed just above each chip.
      const before = cleaner.slice(0, m.index ?? 0).slice(-400);
      ok(
        "the cleaner add-on chip shows quantity",
        chipBlock.includes("qty") && before.includes("addOnQuantity(a)")
      );
      ok("the cleaner add-on chip never shows a price", !chipBlock.includes("a.price"));
    }
  }
});

section(7, "Custom extra charges are usable and COUNT (PDF #10)", () => {
  // ── BEHAVIOUR: the basis, which is the whole fix ────────────────────────
  check("web is INCLUSIVE", addOnMoneyBasis("web"), "INCLUSIVE");
  check("web (referral) is INCLUSIVE", addOnMoneyBasis("web (referral)"), "INCLUSIVE");
  check("BookingKoala imports are INCLUSIVE",
    addOnMoneyBasis("bookingkoala_import"), "INCLUSIVE");
  // null is what EVERY admin-created job carries — saveJob's create path never
  // writes bookingSource. Defaulting the other way reinterprets the whole
  // admin population.
  check("a null source is ADDITIVE", addOnMoneyBasis(null), "ADDITIVE");
  check("admin-recurring is ADDITIVE", addOnMoneyBasis("admin-recurring"), "ADDITIVE");
  check("the basis ignores case and padding", addOnMoneyBasis("  WEB  "), "INCLUSIVE");

  // THE fix: a $25 custom charge used to bill $0.
  const admin = computeJobMoney(
    { price: 100, discountAmount: 0, addOns: [{ name: "Balcony", price: 25, quantity: 1 }] },
    RATES
  );
  check("an admin add-on reaches the subtotal", admin.subtotalAmount, 125);
  check("...and is taxed: GST", admin.gstAmount, 6.25);
  check("...and is taxed: QST", admin.qstAmount, 12.47);
  check("...so the job bills $143.72, not $114.98", admin.totalAmount, 143.72);
  check("an admin job is ADDITIVE", admin.basis, "ADDITIVE");
  check("admin quantities count too",
    computeJobMoney({ price: 100, addOns: [{ name: "Windows", price: 15, quantity: 3 }] }, RATES)
      .subtotalAmount,
    145
  );

  // Regression guard, asserted structurally rather than against a literal: a
  // job with NO add-ons must still produce exactly the old formula's output.
  {
    const bare = computeJobMoney({ price: 100, discountAmount: 20, addOns: [] }, RATES);
    const old = computeJobTaxes(80, RATES, false);
    check("no add-ons: subtotal matches the pre-fix formula",
      bare.subtotalAmount, old.subtotalAmount);
    check("no add-ons: GST matches the pre-fix formula", bare.gstAmount, old.gstAmount);
    check("no add-ons: QST matches the pre-fix formula", bare.qstAmount, old.qstAmount);
    check("no add-ons: total matches the pre-fix formula", bare.totalAmount, old.totalAmount);
  }

  // The discount is INSIDE a web booking's stored subtotal. Subtracting it
  // again is the defect job-billing.ts records as costing ~$54 on a $25 credit.
  {
    const w = computeJobMoney(
      {
        bookingSource: "web",
        subtotalAmount: 100,
        totalAmount: 114.98,
        gstAmount: 5,
        qstAmount: 9.98,
        discountAmount: 25,
        addOns: [],
      },
      RATES
    );
    check("a web discount is never subtracted twice", w.subtotalAmount, 100);
    check("...and the helper says it applied none", w.discountApplied, 0);
    check("...while still reporting it for display", w.discountRecorded, 25);
  }

  // Item 8 creates add-on rows on ~200 settled, often already-paid jobs.
  {
    const imported = computeJobMoney(
      {
        bookingSource: "bookingkoala_import",
        price: 208.52,
        subtotalAmount: 208.52,
        gstAmount: 10.43,
        qstAmount: 20.8,
        totalAmount: 239.75,
        discountAmount: 0,
        addOns: [
          { name: "Inside fridge", price: 0, quantity: 1 },
          { name: "Inside oven", price: 0, quantity: 2 },
        ],
      },
      RATES
    );
    check("an imported job's subtotal cannot inflate", imported.subtotalAmount, 208.52);
    check("an imported job's total cannot inflate", imported.totalAmount, 239.75);
  }

  // Exemption still wins with add-ons present, for both reasons.
  {
    const ex = computeJobMoney(
      { price: 100, taxExempt: true, addOns: [{ price: 25, quantity: 2 }] },
      RATES
    );
    check("tax-exempt: no GST on add-ons", ex.gstAmount, 0);
    check("tax-exempt: no QST on add-ons", ex.qstAmount, 0);
    check("tax-exempt: total equals subtotal", ex.totalAmount, 150);
    check("cash jobs are untaxed too",
      computeJobMoney({ price: 100, isCashJob: true, addOns: [] }, RATES).gstAmount, 0);
  }

  // A pre-tax-columns web row must not read as $0 while the card is charged.
  {
    const legacy = computeJobMoney(
      { bookingSource: "web", subtotalAmount: 0, totalAmount: 0, price: 200, discountAmount: 20, addOns: [] },
      RATES
    );
    check("a legacy web row falls back like resolveAmountDue does", legacy.basis, "LEGACY_PRICE");
    check("...to price - discount", legacy.subtotalAmount, 180);
  }

  // ── SOURCE ──────────────────────────────────────────────────────────────
  // The helper must stay client-safe: JobModal's live preview, the Financials
  // tab and the /book steps all render from it. job-billing.ts is the trap —
  // it reaches lib/stripe.ts, whose first line imports the Stripe SDK.
  for (const forbidden of ['from "@/db"', '"server-only"', "@/lib/stripe", "@/lib/job-billing"]) {
    // Comment-stripped: the module's own docstring names these deliberately,
    // to explain why importing them would break JobModal's client-side preview.
    lacksInCode(
      `job-money.ts stays client-safe: no ${forbidden}`,
      "src/lib/job-money.ts",
      forbidden
    );
  }

  // Every writer and reader on the one helper.
  lacksInCode("saveJob no longer taxes add-ons out of existence",
    "src/app/admin/actions/saveJob.ts", "(price ?? 0) - (discountAmount ?? 0)");
  has("saveJob prices through the shared helper",
    "src/app/admin/actions/saveJob.ts", "computeJobMoney(");
  // Without bookingSource, saving a WEB booking from the modal would add its
  // add-ons on top of a subtotal that already contains them.
  has("saveJob loads the job's money basis before recomputing",
    "src/app/admin/actions/saveJob.ts", "bookingSource: true");
  has("saveJob preserves a stored subtotal while the price is untouched",
    "src/app/admin/actions/saveJob.ts", "priceUnchanged");
  // The full-page form is a live EDITOR with its own save path.
  lacksInCode("the full-page job form no longer taxes add-ons out of existence",
    "src/app/admin/jobs/new/page.tsx", "(price ?? 0) - (discountAmount ?? 0)");
  has("the full-page job form prices through the shared helper",
    "src/app/admin/jobs/new/page.tsx", "computeJobMoney(");

  for (const [label, file] of [
    ["the job detail Financials tab", "src/app/admin/jobs/[id]/JobDetailView.tsx"],
    ["the receipt", "src/lib/receipt-pdf.ts"],
    ["the invoice", "src/app/admin/actions/generateInvoiceFromJob.ts"],
    ["the pay breakdown", "src/app/admin/actions/getPayBreakdown.ts"],
    ["the job modal preview", "src/app/admin/jobs/JobModal.tsx"],
  ] as const) {
    has(`${label} reads the shared helper`, file, "computeJobMoney(");
  }

  // The three ad-hoc formulas that disagreed with each other.
  lacksInCode("the job detail page no longer derives its own gross revenue",
    "src/app/admin/jobs/[id]/JobDetailView.tsx", "const taxSubtotal = Math.max(0, grossRevenue)");
  lacksInCode("receipt-pdf no longer derives its own base price",
    "src/lib/receipt-pdf.ts", "job.subtotalAmount - addOnTotal");
  lacksInCode("getPayBreakdown no longer derives its own base price",
    "src/app/admin/actions/getPayBreakdown.ts", "job.price - addOnsTotal");

  // JobModal UX contract (7.a).
  has("the custom-charge block is labelled", "src/app/admin/jobs/JobModal.tsx",
    "Custom extra charge");
  has("Enter adds a charge instead of submitting the job",
    "src/app/admin/jobs/JobModal.tsx", "handleNewAddOnKeyDown");
  // The old gate was name-only, so a blank price silently became $0.
  lacksInCode("Add is no longer enabled with an empty price",
    "src/app/admin/jobs/JobModal.tsx", "disableForm || !newAddOnName.trim()");
  has("Add requires a valid price", "src/app/admin/jobs/JobModal.tsx", "newAddOnValid");
  has("chosen rows are keyed stably, not by index",
    "src/app/admin/jobs/JobModal.tsx", "key={a.rowId}");
  has("a one-off charge is tagged as custom",
    "src/app/admin/jobs/JobModal.tsx", "catalogAddOnKeys");
  // Two `.toLowerCase()` comparisons made "Inside  Fridge" a second add-on the
  // picker could never un-toggle.
  has("the catalog picker matches on the canonical key",
    "src/app/admin/jobs/JobModal.tsx", "addOnKey(a.name) === catKey");

  // applyToJobSeries uses updateMany, which throws on a relation write.
  lacksInCode("add-ons are not smuggled into the series propagation list",
    "src/lib/job-series.ts", "addOns");
});

section(8, "BookingKoala add-ons become structured rows (PDF #9)", () => {
  const cell = (cols: Record<string, string>) => (c: string) => cols[c] ?? "";
  const parse = (cols: Record<string, string>) =>
    parseBkAddOns(cell(cols)).map((a) => `${a.name}|${a.quantity}|${a.source}`);

  // ── BEHAVIOUR: the parser, against the real fixture shape ───────────────
  // The one populated add-on value in scripts/gen-test-bookings.mjs. Its NAME
  // starts with a digit, which is why the marker pattern is anchored at the end.
  check("the real fixture value parses with its leading digit intact",
    parse({ Packages: "2 Day Post Construction(1)" }),
    ["2 Day Post Construction|1|Packages"]);

  check("a trailing (N) is a quantity", parse({ Extras: "Inside Fridge(2)" }),
    ["Inside Fridge|2|Extras"]);
  check("...with or without a space", parse({ Extras: "Inside Fridge (2)" }),
    ["Inside Fridge|2|Extras"]);
  check("no marker means one", parse({ Extras: "Inside Fridge" }),
    ["Inside Fridge|1|Extras"]);
  check("(0) clamps up to 1", parse({ Extras: "Thing(0)" }), ["Thing|1|Extras"]);
  check("a 4-digit run is not a quantity", parse({ Extras: "Thing(9999)" }),
    ["Thing(9999)|1|Extras"]);
  check("the xN form is also read", parse({ Extras: "Windows x3" }),
    ["Windows|3|Extras"]);

  // The two traps. Digits-only capture makes these structurally unmatchable.
  check("descriptive parentheses are kept, not read as a quantity",
    parse({ Extras: "Windows (interior)" }), ["Windows (interior)|1|Extras"]);
  check("a Frequency-shaped value is kept whole",
    parse({ Extras: "Bi Weekly (2 Cleanings/Month -8%)" }),
    ["Bi Weekly (2 Cleanings/Month -8%)|1|Extras"]);

  check("semicolons split", splitBkAddOnList("A; B; C").length, 3);
  check("commas split", splitBkAddOnList("A, B").length, 2);
  // A regex cannot count nesting; this is why the splitter uses a depth counter.
  check("a comma inside parentheses does not split",
    splitBkAddOnList("Deep Clean (2 rooms), Windows"),
    ["Deep Clean (2 rooms)", "Windows"]);
  check("a bare marker names nothing and is dropped", parse({ Extras: "(3)" }), []);
  check("an empty cell yields nothing", parse({ Extras: "   " }), []);
  check("a bare number is not an add-on", parse({ Extras: "0.00" }), []);

  check("the same add-on in two columns merges, summing quantities",
    parse({ Extras: "Inside Fridge", Addons: "inside  fridge(2)" }),
    ["Inside Fridge|3|Extras"]);
  // `Extras` sits at column 53 and the rest at 65-68, so this proves the
  // header-name lookup rather than a positional assumption.
  check("all five add-on columns are read",
    parseBkAddOns(cell({
      Extras: "A", Items: "B", Packages: "C", "Package addons": "D", Addons: "E",
    })).length,
    5);

  // ── BEHAVIOUR: resolution, and the money rule ──────────────────────────
  {
    const parsed = parseBkAddOns(cell({ Extras: "inside fridge(2)", Addons: "Mystery Thing" }));
    const res = resolveBkAddOns(parsed, [{ name: "Inside Fridge" }]);
    check("a matched add-on takes the canonical catalog name", res.rows[0].name, "Inside Fridge");
    check("...and keeps its quantity", res.rows[0].quantity, 2);
    // The CSV "Service total" already includes the extras; a priced row would
    // make generateInvoiceFromJob bill them a second time.
    check("a matched add-on is priced at 0", res.rows[0].price, 0);
    check("an unmatched add-on keeps the CSV name", res.rows[1].name, "Mystery Thing");
    check("an unmatched add-on is priced at 0", res.rows[1].price, 0);
    check("nothing is dropped", res.rows.length, 2);
    check("only the unmatched one is flagged for review",
      res.review.map((a) => a.name), ["Mystery Thing"]);
  }

  // ── SOURCE ──────────────────────────────────────────────────────────────
  // Idempotency is structural: the dedupe branch `continue`s before the create
  // and there is no update path, so a nested create runs exactly once per job.
  {
    const run = read("src/app/admin/actions/runBookingKoalaImport.ts");
    const createAt = run.indexOf("const created = await db.job.create(");
    const addOnsAt = run.indexOf("addOns: { create: resolvedAddOns.rows }");
    ok("add-on rows are written INSIDE the job insert",
      createAt > 0 && addOnsAt > createAt);
    lacks("no separate add-on write that could orphan on a lost response",
      "src/app/admin/actions/runBookingKoalaImport.ts", "db.jobAddOn.create");
    lacks("no add-on upsert either",
      "src/app/admin/actions/runBookingKoalaImport.ts", "db.jobAddOn.upsert");
    has("unmatched names raise ONE admin alert per run",
      "src/app/admin/actions/runBookingKoalaImport.ts", "notifyAdmins(");
    has("...as a warning", "src/app/admin/actions/runBookingKoalaImport.ts",
      'severity: "WARNING"');
    // Resolving before the dry-run bail-out is what lets a dry run preview it.
    // Three `if (!commit)` blocks exist (cleaners, customers, jobs). The one
    // that matters is the job loop's, which is the last of them.
    ok("add-ons are resolved before the dry-run early return",
      run.indexOf("resolveBkAddOns(") < run.lastIndexOf("if (!commit) {"));
  }

  // The report-drift invariant. TypeScript catches a missing key in the client's
  // `acc` literal but NOT a missing `+=` in its accumulator loop, so a new field
  // can read correctly on the dry run and silently report 0 after a commit.
  // Checking EVERY key protects the next field too, not just this one.
  {
    const core = read("src/lib/bookingkoala/core.ts");
    const iface = core.slice(core.indexOf("export interface ImportReport {"));
    const body = iface.slice(0, iface.indexOf("\n}"));
    const keys = [...body.matchAll(/^\s{2}(\w+)[?]?:/gm)].map((m) => m[1]);
    const button = read("src/components/csv/BookingKoalaImportButton.tsx");
    ok("ImportReport was parsed", keys.length > 8);
    check("every ImportReport field is carried by the batching client",
      keys.filter((k) => !["ok", "error", "dryRun"].includes(k) && !button.includes(k)),
      []);
  }

  // 8.c — the raw text stays, so item 9 has something to preserve.
  has("the importer still keeps the raw add-on text in notes",
    "src/lib/bookingkoala/core.ts", "`Add-ons: ${addonText}`");
  has("the parsed interpretation goes to the admin-only log",
    "src/lib/bookingkoala/core.ts", "Add-ons parsed:");

  // 8.e — the drifted CLI cannot be run by habit.
  has("the CLI importer is stamped deprecated",
    "scripts/importBookingKoala.ts", "DEPRECATED");
  has("...and refuses to run without an explicit acknowledgement",
    "scripts/importBookingKoala.ts", "--i-know-this-is-deprecated");
  has("...and refuses to write at all",
    "scripts/importBookingKoala.ts", "can no longer write to the database");
  // The docstring's false "consumed by both" claim is what hid the drift.
  lacksInCode("core.ts no longer claims the CLI consumes it",
    "src/lib/bookingkoala/core.ts", "Consumed by both the CLI script");
});

section(9, "Price/tax out of imported job notes (PDF #15)", () => {
  // The shape 205 of 208 live rows actually have.
  const LIVE =
    "Provider/team: Alex Tester ($96) | Created on: 2026-07-18 | " +
    "Original payment method: CC | Final amount CAD: 208.52 | Tax CAD: 27.17";

  // ── BEHAVIOUR: the destructive rule ─────────────────────────────────────
  check("a wholly machine-generated note strips to nothing",
    stripBillingSegments(LIVE), null);
  // THE regression this fix exists for: the old script nulled the whole field.
  check("an Add-ons segment survives alongside billing text",
    stripBillingSegments("Add-ons: Inside Fridge | " + LIVE),
    "Add-ons: Inside Fridge");
  check("genuine instructions survive alongside billing text",
    stripBillingSegments("Add-ons: Windows | Gate code 4455 | Final amount CAD: 208.52"),
    "Add-ons: Windows\nGate code 4455");
  check("a note with no billing text is untouched",
    stripBillingSegments("Gate code 4455. Dog is friendly."),
    "Gate code 4455. Dog is friendly.");

  // False positives the DISPLAY rule accepts but a one-way write must not.
  check('"recharge" is not billing', stripBillingSegments("Please recharge the vacuum"),
    "Please recharge the vacuum");
  check('"Surcharge waived" is not billing', stripBillingSegments("Surcharge waived"),
    "Surcharge waived");
  check("a dollar figure alone is not billing",
    stripBillingSegments("Leave $20 tip envelope"), "Leave $20 tip envelope");

  // ...and the display rule still hides all three, which is the point of having
  // two rules: hiding is reversible, deleting is not.
  check("display still hides a dollar figure",
    sanitizeCleanerNotes("Leave $20 tip envelope"), null);
  check("display still hides billing text", sanitizeCleanerNotes(LIVE), null);
  check("display keeps a clean instruction",
    sanitizeCleanerNotes("Gate code 4455"), "Gate code 4455");

  check("the strict rule needs a label:value shape",
    BILLING_SEGMENT_STRICT.test("Final amount CAD: 208.52"), true);
  check("...and cannot match the add-ons label",
    BILLING_SEGMENT_STRICT.test("Add-ons: Inside Fridge"), false);
  check("...or prose", BILLING_SEGMENT_STRICT.test("The tax people came by"), false);
  check("...or a bare price", BILLING_SEGMENT_STRICT.test("$217.31"), false);

  // Selection is on "contains billing text", not "stripping changes the
  // string" — the latter also fires on CRLF normalisation and would rewrite
  // clean rows. The live dry run showed 208 vs 205 because of exactly this.
  check("a CRLF-only difference is not a reason to rewrite a row",
    hasBillingSegments("Unit code: 7670\r\nUnit code: 8247"), false);
  check("...while real billing text is", hasBillingSegments(LIVE), true);
  // A second --commit must be a no-op.
  check("stripping is idempotent",
    stripBillingSegments(stripBillingSegments("Add-ons: X | " + LIVE)),
    stripBillingSegments("Add-ons: X | " + LIVE));

  // ── SOURCE ──────────────────────────────────────────────────────────────
  has("the cleanup script uses the shared pure rule",
    "scripts/cleanupImportNotes.ts", "stripBillingSegments");
  has("...and selects on containment, not on string difference",
    "scripts/cleanupImportNotes.ts", "hasBillingSegments(j.notes)");
  // Its old selector matched 0 of the 205 affected rows.
  lacksInCode("the startsWith selector that matched nothing is gone",
    "scripts/cleanupImportNotes.ts", 'startsWith: "Source Booking ID"');
  // It used to set notes: null unconditionally, destroying the add-on text.
  has("survivors are written back rather than the field nulled",
    "scripts/cleanupImportNotes.ts", "notes: kept");
  has("the original is preserved verbatim in an admin-only log",
    "scripts/cleanupImportNotes.ts", 'action: "NOTE_ADDED"');
  has("...behind a stable marker that also guards a re-run",
    "scripts/cleanupImportNotes.ts", "ORIGINAL_MARKER");
  has("the script stays dry-run by default",
    "scripts/cleanupImportNotes.ts", 'process.argv.includes("--commit")');

  // The third copy of the vocabulary is gone.
  has("the probe builds its regex from the shared source",
    "scripts/probe-awer-fixes-3.ts", "BILLING_LINE_SOURCE");
  lacksInCode("the probe no longer hand-maintains the vocabulary",
    "scripts/probe-awer-fixes-3.ts", "imported from bookingkoala|provider/team");

  // 9.b — every non-financial viewer.
  has("the customer portal sanitizes notes",
    "src/app/(customer)/(secured)/bookings/[id]/page.tsx", "sanitizeCleanerNotes(job.notes)");
  // This branch is the CLEANER calendar and its card also shows cleaner pay.
  has("the cleaner calendar sanitizes notes server-side",
    "src/app/admin/calendar/page.tsx", "sanitizeCleanerNotes(j.notes)");
  // Sanitized at the server mapper, so the raw string never enters the client
  // payload at all — which is why the client may still render its `notes` prop.
  // What must stay true is that the mapper never passes the column through raw.
  lacksInCode("...and the mapper never passes raw notes through",
    "src/app/admin/calendar/page.tsx", "notes: j.notes");
  noMatchUnder("no cleaner-app surface renders raw notes",
    "src/app/cleaners", /\{\s*job\.notes\s*\}/);
  // Admin stays raw ON PURPOSE — they are the financial audience. Asserted so a
  // later "helpful" change has to be deliberate.
  has("the admin job page still shows raw notes, deliberately",
    "src/app/admin/jobs/[id]/JobDetailView.tsx", "{job.notes ||");
});

section(10, "Add-on icons and customer pop-ups (PDF #17)", () => {
  // ── BEHAVIOUR: the catalog gate ─────────────────────────────────────────
  // `pricing.addOns` is not in the settings registry, so updateAppSetting
  // writes it with NO validation. normalizeAddOn is the only gate between an
  // admin's browser and every public /book visitor.
  const base = { id: "a1", name: "Couch Cleaning", price: 40 };

  check("an old 5-key entry still normalises",
    normalizeAddOn({ ...base, roomType: "LIVING_ROOM", services: ["STANDARD"] }),
    { id: "a1", name: "Couch Cleaning", price: 40, roomType: "LIVING_ROOM", services: ["STANDARD"] });
  check("...and gains no keys it did not have",
    Object.keys(normalizeAddOn(base) ?? {}).sort(),
    ["id", "name", "price", "roomType", "services"]);

  {
    const full = normalizeAddOn(
      {
        ...base,
        icon: "sofa",
        popupEnabled: true,
        popupTitle: "About couch cleaning",
        popupMessage: "Priced per piece.",
        popupRequestPhoto: true,
      },
      ADDON_ICON_KEY_SET
    );
    check("a configured icon survives", full?.icon, "sofa");
    check("a configured pop-up survives", full?.popupEnabled, true);
    check("...with its title", full?.popupTitle, "About couch cleaning");
    check("...and its message", full?.popupMessage, "Priced per piece.");
    check("...and its photo request", full?.popupRequestPhoto, true);
  }

  check("an unknown icon key is dropped rather than reaching the renderer",
    normalizeAddOn({ ...base, icon: "not-an-icon" }, ADDON_ICON_KEY_SET)?.icon,
    undefined);
  check("a truthy non-boolean does not enable a pop-up",
    normalizeAddOn({ ...base, popupEnabled: "yes" })?.popupEnabled, undefined);
  check("an over-long message is bounded",
    normalizeAddOn({ ...base, popupMessage: "x".repeat(5000) })?.popupMessage?.length,
    ADDON_POPUP_MESSAGE_MAX);
  check("an over-long title is bounded",
    normalizeAddOn({ ...base, popupTitle: "x".repeat(500) })?.popupTitle?.length,
    ADDON_POPUP_TITLE_MAX);

  // ── BEHAVIOUR: icon resolution ─────────────────────────────────────────
  // Compared by identity against the imported component — exact, and immune to
  // minification renaming.
  check("an explicit key wins over the name",
    addonIcon({ name: "Anything At All", icon: "fridge" }) === Refrigerator, true);
  check("the keyword guess still works with no key",
    addonIcon({ name: "Inside Fridge" }) === Refrigerator, true);
  // The original signature still compiles — no flag day for existing callers.
  check("a bare name still resolves", addonIcon("Inside Fridge") === Refrigerator, true);
  check("an unknown name falls back", addonIcon({ name: "Zzzz" }) === Sparkles, true);
  // Documented current behaviour, and why the key exists: "air" inside "Chair".
  check("the keyword rules still misfire on 'Chair'",
    addonIcon({ name: "Chair Cleaning" }) === Wind, true);
  check("...which an explicit key now escapes",
    addonIcon({ name: "Chair Cleaning", icon: "sofa" }) === Sofa, true);
  check("every icon key resolves to a component",
    ADDON_ICON_KEYS.filter((k) => !ADDON_ICONS[k]), []);

  // Deselecting must never open a pop-up.
  check("selecting a configured add-on prompts",
    needsPopup({ name: "X", price: 1, selected: false, quantity: 0, popupEnabled: true }), true);
  check("DEselecting never prompts",
    needsPopup({ name: "X", price: 1, selected: true, quantity: 1, popupEnabled: true }), false);
  check("an unconfigured add-on never prompts",
    needsPopup({ name: "X", price: 1, selected: false, quantity: 0 }), false);

  // ── SOURCE ──────────────────────────────────────────────────────────────
  has("the settings editor offers the icon picker",
    "src/app/admin/settings/tabs/PricingRulesTab.tsx", "ADDON_ICON_KEYS");
  for (const field of ["popupEnabled", "popupTitle", "popupMessage", "popupRequestPhoto"]) {
    has(`the settings editor exposes ${field}`,
      "src/app/admin/settings/tabs/PricingRulesTab.tsx", field);
  }
  // The shape was declared three times and had already drifted.
  lacksInCode("the settings editor no longer declares its own add-on shape",
    "src/app/admin/settings/tabs/PricingRulesTab.tsx", "interface AddOn {");
  lacksInCode("...nor its own room enum",
    "src/app/admin/settings/tabs/PricingRulesTab.tsx", 'export type RoomType =\n');
  has("the settings editor uses the shared catalog module",
    "src/app/admin/settings/tabs/PricingRulesTab.tsx", 'from "@/lib/addon-catalog"');
  has("getBookingConfig validates through the shared module",
    "src/app/(book)/actions/getBookingConfig.ts", "normalizeAddOnCatalog(");
  lacksInCode("...and no longer keeps its own copy of the normalizer",
    "src/app/(book)/actions/getBookingConfig.ts", "function normalizeAddOn(");

  // The /book tree had no modal at all. CustomerModal is the right one: it is
  // already .cl-* styled, locks body scroll and handles Escape; ui/Modal is
  // Tailwind admin chrome with no Escape handling.
  has("the booking flow uses the customer-styled modal",
    "src/app/(book)/book/steps/Step2Property.tsx", '@/components/customer/Modal');
  lacks("...not the admin one",
    "src/app/(book)/book/steps/Step2Property.tsx", "@/components/ui/Modal");
  has("the pop-up gate is the shared pure predicate",
    "src/app/(book)/book/steps/Step2Property.tsx", "needsPopup(a)");
  has("both renderers pass the whole add-on so a stored icon wins",
    "src/app/(book)/book/steps/Step2Property.tsx", "addonIcon(a)");
  has("...including the admin picker",
    "src/app/admin/jobs/JobModal.tsx", "addonIcon(cat)");

  // ⚠️ SUPERSEDED BY STAGE 11 (PDF #9) — deliberately inverted, not deleted.
  //
  // Decision 9 originally landed as "pop-ups without the uploader", and these two
  // assertions recorded WHY: `JobPhoto.employeeId` was a required FK to User, and
  // a web booking has neither a customer User row nor an assigned cleaner, so
  // there was nowhere to attribute a photo. They asserted the absence of an
  // upload on /book.
  //
  // Stage 11 removes that blocker — the migration makes `employeeId` nullable,
  // and NULL now means "the customer uploaded this at booking" — because PDF #9
  // requires the upload outright: *"the client uploads pictures of the space"*.
  // The pop-up prompt still exists for add-ons that want a photo later; what
  // changed is that post-construction no longer has to settle for a promise to
  // email.
  //
  // So the assertions now check the OPPOSITE, which keeps the file a live record
  // of the constraint rather than a stale claim about it.
  has("the booking flow now collects photos (Stage 11 / PDF #9)",
    "src/app/(book)/book/steps/Step2Property.tsx", "BookingPhotoUpload");
  has("...uploaded through the public booking action, not the admin one",
    "src/app/(book)/book/steps/BookingPhotoUpload.tsx", "uploadBookingPhoto");
  has("...and attached to the job the booking creates",
    "src/app/(book)/actions/submitBooking.ts", "photos: {");
  has("...only for URLs that came from THIS company's upload folder",
    "src/app/(book)/actions/submitBooking.ts", "isBookingPhotoUrl(u, cloudName, bookingFolder)");
  has("the nullable uploader is what made that possible",
    "prisma/schema.prisma", "employeeId String?");
});

// ═══════════════════════════════════════════════════════════════════════════
// Stage 4 — Addresses
// ═══════════════════════════════════════════════════════════════════════════

section(11, "Multiple saved addresses with dropdowns everywhere (PDF #2)", () => {
  // ── BEHAVIOUR ────────────────────────────────────────────────────────────
  // The de-duplication rule. The old inline check in admin/jobs/new/page.tsx
  // compared the raw `address` string case-sensitively and IGNORED aptNumber,
  // so these two assertions are the bug it had.
  ok(
    "two units at one street are two different addresses",
    normalizeAddressKey("4820 Sherbrooke", "Apt 2") !==
      normalizeAddressKey("4820 Sherbrooke", "Apt 12")
  );
  check(
    "case and whitespace don't fork a duplicate row",
    normalizeAddressKey("  4820   SHERBROOKE ", "apt 2"),
    normalizeAddressKey("4820 Sherbrooke", "Apt 2")
  );
  // A BookingKoala-imported row stores "Apt 12 – 4820 Sherbrooke" in `address`
  // AND "Apt 12" in `aptNumber`. It must collapse onto the hand-typed form of
  // the same door instead of being saved again.
  check(
    "an imported row and a hand-typed one for the same door share a key",
    normalizeAddressKey("Apt 12 - 4820 Sherbrooke", "Apt 12"),
    normalizeAddressKey("4820 Sherbrooke", "Apt 12")
  );

  // The unit must never be printed twice on one line.
  check(
    "the unit is not rendered twice for an imported row",
    formatAddressLine({
      address: "Apt 12 - 4820 Sherbrooke",
      aptNumber: "Apt 12",
      city: "Montreal",
      postalCode: "H3Z 1H2",
    }),
    "4820 Sherbrooke, Apt 12, Montreal H3Z 1H2"
  );
  check(
    "a sparse address renders as just its street",
    formatAddressLine({ address: "4820 Sherbrooke" }),
    "4820 Sherbrooke"
  );
  // Stripping is conservative: a prefix collision must not eat part of a street,
  // and a row holding nothing but a unit must not be emptied.
  check(
    "a prefix collision is not mistaken for a duplicated unit",
    stripDuplicatedApt("Apt 1200 Main St", "Apt 12"),
    "Apt 1200 Main St"
  );
  check(
    "a unit-only address survives stripping",
    stripDuplicatedApt("Apt 12", "Apt 12"),
    "Apt 12"
  );

  // Which address a picker pre-selects.
  check(
    "the default address wins the pre-selection",
    pickDefaultAddress([
      { isDefault: false, id: "a" },
      { isDefault: true, id: "b" },
    ])?.id,
    "b"
  );
  check(
    "with no default, the first (oldest) is used",
    pickDefaultAddress([{ isDefault: false, id: "a" }])?.id,
    "a"
  );
  check("an empty book pre-selects nothing", pickDefaultAddress([]), null);
  check("the client's first address is labelled Home", autoAddressLabel(0), "Home");
  check("every later auto-saved address is Other", autoAddressLabel(3), "Other");

  // ── SOURCE ───────────────────────────────────────────────────────────────
  // The migration. ClientAddress was never in migration history (created by
  // `db push`), so this migration also backfills it — idempotently, because the
  // deployed database already has the table.
  const MIGRATION = "prisma/migrations/20260806100000_client_address_details";
  ok("the stage-4 migration exists", fs.existsSync(`${MIGRATION}/migration.sql`));
  has("...it captures the drifted ClientAddress table",
    `${MIGRATION}/migration.sql`, 'CREATE TABLE IF NOT EXISTS "ClientAddress"');
  has("...it adds the three new address columns",
    `${MIGRATION}/migration.sql`, 'ADD COLUMN IF NOT EXISTS "accessNotes"');
  has("...and Job.clientAddressId is SET NULL, so deleting an address can't"
    + " blank a finished job",
    `${MIGRATION}/migration.sql`, "ON DELETE SET NULL");

  // All three admin client queries feed the modal its address book. Missing any
  // one of them silently disables the dropdown on that page only.
  for (const page of [
    "src/app/admin/jobs/page.tsx",
    "src/app/admin/calendar/page.tsx",
    "src/app/admin/jobs/[id]/page.tsx",
  ] as const) {
    has(`${page.split("/").slice(-2).join("/")} loads the client address book`,
      page, "SAVED_ADDRESS_SELECT");
  }

  // JobModal: the dropdown, and the id reaching the server.
  has("JobModal renders the saved-address picker",
    "src/app/admin/jobs/JobModal.tsx", "+ Type a new address");
  has("...and submits which address was chosen",
    "src/app/admin/jobs/JobModal.tsx", 'addressChoice === NEW_ADDRESS ? "" : addressChoice');
  has("...re-selecting it when an existing job is edited",
    "src/app/admin/jobs/JobModal.tsx", "setAddressChoice(job.clientAddressId || NEW_ADDRESS)");
  has("...setting BOTH location and apt on client pick (apt was never set)",
    "src/app/admin/jobs/JobModal.tsx", 'setValue("aptNumber", c.aptNumber || ""');
  has("saveJob writes the provenance link",
    "src/app/admin/actions/saveJob.ts", "clientAddressId,");

  // A picked id round-trips through the browser on the two admin forms and on
  // the PUBLIC booking action, so all three resolve it through the one guard
  // that checks BOTH ownership and that the id still matches what was typed.
  // Honouring a stale id would show a cleaner one address's door codes while
  // sending them to another.
  for (const f of [
    "src/app/admin/actions/saveJob.ts",
    "src/app/admin/jobs/new/page.tsx",
    "src/app/(book)/actions/submitBooking.ts",
  ] as const) {
    has(`${f.split("/").pop()} resolves its address link through the guard`,
      f, "resolveJobAddressId");
    lacksInCode(`${f.split("/").pop()} doesn't trust a raw picked id`,
      f, "resolveOwnedAddressId(");
  }
  has("the guard re-checks ownership",
    "src/lib/client-address-store.ts", "resolveOwnedAddressId(clientId, input.addressId)");
  has("...and that the picked row still describes the typed address",
    "src/lib/client-address-store.ts",
    "normalizeAddressKey(picked.address, picked.aptNumber) ===");
  has("...falling back to adding the typed address to the book",
    "src/lib/client-address-store.ts", "return upsertClientAddress(clientId, input);");

  // THE booking bug: the update branch clobbered Client.address every booking.
  lacksInCode("submitBooking no longer overwrites Client.address on update",
    "src/app/(book)/actions/submitBooking.ts", "address: input.address.trim(),\n            serviceFrequency");
  has("...it records the address in the customer's book instead",
    "src/app/(book)/actions/submitBooking.ts", "resolveJobAddressId(client.id");
  has("...and links every job it creates to that address",
    "src/app/(book)/actions/submitBooking.ts", "clientAddress: { connect: { id: clientAddressId } }");
  has("...web bookings finally record the unit number",
    "src/app/(book)/actions/submitBooking.ts", "aptNumber: bookingApt,");
  has("...and finally persist the postal code step 1 collected",
    "src/app/(book)/actions/submitBooking.ts", "postalCode: input.postalCode");

  // /book Step 2 and the portal.
  has("/book offers the saved-address dropdown",
    "src/app/(book)/book/steps/Step2Property.tsx", "+ Use a new address");
  has("...and re-runs the coverage check when the postal code moves",
    "src/app/(book)/book/steps/Step2Property.tsx", "checkServiceArea(nextPostal)");
  has("the portal renders the address book",
    "src/app/(customer)/(secured)/account/SavedAddresses.tsx", "SavedAddressManager");
  lacks("...and its single Default address textbox is gone",
    "src/app/(customer)/(secured)/account/AccountForm.tsx", "Default address");
  lacksInCode("...so the portal can't overwrite Client.address either",
    "src/app/(customer)/actions/updateClientProfile.ts", "data.address =");
  // Customer-scoped actions must never take a clientId from the caller.
  lacksInCode("customer address actions never trust a caller-supplied clientId",
    "src/app/(customer)/actions/clientAddresses.ts", 'formData.get("clientId")');

  // Surfaces.
  has("the cleaner job page loads the address's access notes",
    "src/app/cleaners/my-jobs/[jobId]/page.tsx", "accessNotes: true");
  has("...and renders them",
    "src/app/cleaners/my-jobs/[jobId]/page.tsx", "cl-jd-access");
  has("the cleaner calendar drawer shows access notes too",
    "src/app/admin/calendar/CleanerCalendarClient.tsx", "job.accessNotes");
  has("calendar cards carry the unit number",
    "src/app/admin/actions/getJobsForDay.ts", "aptNumber: job.aptNumber");
  has("the invoice prints a Service address block",
    "src/lib/invoice-pdf.ts", '"Service address"');
  has("...resolved from the JOB, not the client's billing scalar",
    "src/lib/invoice-pdf.ts", "distinctAddresses.size === 1");
  has("Bill to still prints the client's billing address",
    "src/lib/invoice-pdf.ts", "data.client.address");
  has("a recurring series carries the address choice to its siblings",
    "src/lib/job-series.ts", '"clientAddressId"');

  // The importer's double-unit bug (found while here).
  lacksInCode("the BookingKoala importer stops prefixing the unit into the street",
    "src/app/admin/actions/runBookingKoalaImport.ts", "`${a.apt} – ${a.address}`");

  // Sweep: nothing may reintroduce a blind Client.address overwrite. The two
  // legitimate writes are the brand-new-client seeds, which have nothing to
  // clobber; both name a literal, so this pattern targets the input form.
  noMatchUnder(
    "no code writes Client.address from a booking's typed address on update",
    "src/app/(customer)",
    /data\.address\s*=/
  );
});

// ═══════════════════════════════════════════════════════════════════════════
// Stage 5 — Cleaner job workflow
// ═══════════════════════════════════════════════════════════════════════════

section(12, "Checklist + job scope visible without pressing anything (PDF #5)", () => {
  // ── BEHAVIOUR ────────────────────────────────────────────────────────────
  // The drift rule. `checklistSignature` is order-insensitive on purpose:
  // sortOrder is derived from a template's position in an in-memory filter, so
  // two runs can number identical items differently without the job changing.
  const itemA = { title: "Wipe counters", description: null, isRequired: true, sortOrder: 0 };
  const itemB = { title: "Vacuum", description: null, isRequired: false, sortOrder: 1 };
  check(
    "reordering the same items is not a change",
    checklistSignature([itemA, itemB]),
    checklistSignature([{ ...itemB, sortOrder: 0 }, { ...itemA, sortOrder: 9 }])
  );
  ok(
    "changing an item from optional to required IS a change",
    checklistSignature([itemA]) !== checklistSignature([{ ...itemA, isRequired: false }])
  );
  check(
    "case and padding in a title don't fork a signature",
    checklistSignature([{ ...itemA, title: "  WIPE Counters " }]),
    checklistSignature([itemA])
  );

  const untouched = { status: "PENDING", notes: null };
  const ticked = { status: "COMPLETED", notes: null };
  const noted = { status: "PENDING", notes: "left a message" };
  ok("a fresh checklist is untouched", isUntouched([untouched, untouched]));
  ok("a ticked item makes it touched", !isUntouched([untouched, ticked]));
  // A note on a still-PENDING item is work too — regenerating would bin it.
  ok("a note makes it touched even while PENDING", !isUntouched([noted]));
  ok("an empty checklist is vacuously untouched", isUntouched([]));

  const stored = [{ ...itemA, ...untouched }];
  const storedTouched = [{ ...itemA, ...ticked }];
  check("matching items are left alone", resolveChecklistAction(stored, [itemA]), "KEEP");
  check(
    "drift on an untouched checklist rebuilds it",
    resolveChecklistAction(stored, [itemA, itemB]),
    "REGENERATE"
  );
  check(
    "drift on a STARTED checklist keeps the cleaner's progress",
    resolveChecklistAction(storedTouched, [itemA, itemB]),
    "STALE"
  );
  check(
    "an untouched checklist whose templates all vanished is discarded",
    resolveChecklistAction(stored, []),
    "DISCARD"
  );

  // The clock-out gate — ONE predicate, now shared by both clock-out buttons.
  const req = { isRequired: true, status: "PENDING", notes: null };
  const optional = { isRequired: false, status: "PENDING", notes: null };
  ok("a pending required item blocks clock-out", !requiredItemsSatisfied([req]));
  ok("a pending OPTIONAL item does not", requiredItemsSatisfied([optional]));
  ok("an empty checklist gates nothing", requiredItemsSatisfied([]));
  ok(
    "SKIPPED does not satisfy a required item",
    !requiredItemsSatisfied([{ ...req, status: "SKIPPED" }])
  );
  check(
    "the gate names what's outstanding, not just a count",
    pendingRequiredItems([{ ...req, title: "Lock up" }, optional]).length,
    1
  );

  // The photo policy — one helper, four call sites that used to each write it.
  ok("after-photos are allowed by default", afterPhotosAllowed({ afterPhotoConsent: true, afterPhotoOverrideAt: null }));
  ok("an admin can turn them off", !afterPhotosAllowed({ afterPhotoConsent: false, afterPhotoOverrideAt: null }));
  ok(
    "an explicit re-allow overrides the opt-out",
    afterPhotosAllowed({ afterPhotoConsent: false, afterPhotoOverrideAt: new Date() })
  );

  // ── SOURCE ───────────────────────────────────────────────────────────────
  const PAGE = "src/app/cleaners/my-jobs/[jobId]/page.tsx";
  const PANEL = "src/app/cleaners/my-jobs/[jobId]/JobChecklistPanel.tsx";
  const STORE = "src/lib/job-checklist.server.ts";
  const ACTION = "src/app/admin/actions/generateJobChecklist.ts";

  // 12.a — generation moved OUT of the action so a server component can call
  // it during render. revalidatePath during render throws, which is the whole
  // reason for the split.
  has("the page ensures the checklist on open", PAGE, "await ensureJobChecklist(job.id, session.user.id)");
  lacksInCode("the render-safe store never revalidates", STORE, "revalidatePath");
  has("the action still revalidates", ACTION, "revalidatePath(");
  has("...by delegating to the same store", ACTION, "ensureJobChecklist(jobId, session.user.id");
  // A finished job keeps what it had rather than regenerating against today's
  // templates, which would rewrite history.
  has("finished jobs read, never regenerate", PAGE, "readJobChecklist(job.id, session.user.id)");

  // The empty-checklist trap: the old code created a row with zero items when
  // no template matched, and its own findFirst early-return made that permanent.
  has("no row is created when nothing matches", STORE, 'if (expected.length === 0) return EMPTY("NO_TEMPLATES")');
  has("a duplicate loses to the unique index and re-reads", STORE, 'if (code !== "P2002") throw e');
  has("the migration adds the constraint", "prisma/migrations/20260807000000_job_checklist_unique/migration.sql",
    'CREATE UNIQUE INDEX IF NOT EXISTS "JobChecklist_jobId_employeeId_key"');
  has("...and the schema agrees", "prisma/schema.prisma", "@@unique([jobId, employeeId])");
  // Both readers must agree which row wins if a pre-constraint duplicate exists.
  has("getJobChecklist reads deterministically", "src/app/admin/actions/getJobChecklist.ts",
    'orderBy: { createdAt: "asc" }');

  // 12.b — the button and the on-mount fetch are gone. `lacksInCode` because
  // the panel's own header comment explains what was removed and why.
  lacksInCode("the Generate Checklist button is gone", PANEL, "Generate Checklist");
  lacksInCode("...and so is generateJobChecklist", PANEL, "generateJobChecklist");
  lacksInCode("...and so is the client-side fetch", PANEL, "getJobChecklist(");
  has("items arrive as a prop", PANEL, "items: JobChecklistItemDTO[]");
  has("the empty state uses the agreed copy", "src/lib/job-checklist.ts",
    '"No checklist configured for this job type."');

  // 12.c — the scope card, and the add-on quantity read through the clamp.
  has("a job-scope card is rendered", PAGE, 'className="cl-jd-scope"');
  has("...with the required-item count", PAGE, "requiredItemCount");
  has("...and the photo expectation line", PAGE, "photoExpectationLine(job)");
  has("add-on quantities go through addOnQuantity", PAGE, "addOnQuantity(a)");
  has("the scope card is styled", "src/app/globals.css", ".cl-jd-scope {");

  // 12.d — the hint.
  has("the panel shows the stale hint", PANEL, "CHECKLIST_STALE_HINT");

  // 12.e — the bypass. ClockOutButton is the one on the job page, and it had
  // no checklist code at all while the clock screen's button had the gate.
  const CLOCK_OUT_BTN = "src/app/cleaners/my-jobs/ClockOutButton.tsx";
  has("the job-page clock-out has the gate", CLOCK_OUT_BTN, "pendingRequiredItems(checklistItems)");
  has("...and it actually disables the button", CLOCK_OUT_BTN, "disabled={loading || gateBlocked}");
  has("the page feeds it the ensured items", PAGE, "checklistItems={checklistItems}");
  // Both buttons on one predicate, so they can't drift apart again.
  has("the clock screen uses the shared predicate",
    "src/app/cleaners/my-jobs/[jobId]/clock/ClockPageClient.tsx",
    "requiredItemsSatisfied(checklistItems)");

  // The four hand-written copies of the photo predicate are down to one. Scans
  // src/app only — src/lib/job-photos.ts is where the one copy now lives.
  noMatchUnder(
    "no call site re-implements the after-photo predicate inline",
    "src/app",
    /afterPhotoConsent\s*\|\|\s*[\w.]*afterPhotoOverrideAt/
  );
});

section(13, "Preview an available job before claiming (PDF #8)", () => {
  const ACTION = "src/app/cleaners/available-jobs/getAvailableJobPreview.ts";
  const TYPES = "src/app/cleaners/available-jobs/getAvailableJobPreview.types.ts";
  const CARD = "src/app/cleaners/available-jobs/AvailableJobsClient.tsx";
  const MODAL = "src/app/cleaners/available-jobs/JobPreviewModal.tsx";

  // 13.b — THE promise of this item: previewing changes nothing. Asserted
  // mechanically rather than trusted, because "read-only" is one careless
  // db.job.update away from being false.
  const previewSrc = fs.readFileSync(ACTION, "utf8");
  check(
    "the preview action performs NO writes",
    [...previewSrc.matchAll(/db\.\w+\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\b/g)].map(
      (m) => m[0]
    ),
    []
  );
  lacksInCode("...and never opens a transaction", ACTION, "$transaction");
  // In particular it matches checklist TEMPLATES without creating a checklist.
  // Stage 10 (PDF #10) swapped the flat `templateMatchesJob` filter for the
  // precedence resolver — same read-only property, and now the same answer the
  // cleaner gets after claiming, instead of the service default on a job whose
  // customer has a bespoke list.
  has("checklist matching is template-only", ACTION, "resolveChecklistTemplates(");
  lacksInCode("...no JobChecklist row is minted", ACTION, "jobChecklist");

  // 13.a — authorisation reuses the claimable rule rather than restating it,
  // so a job a cleaner can't claim is a job they can't preview, permanently.
  has("visibility reuses claimableJobsWhere", ACTION, "claimableJobsWhere(cleanerId, new Date())");
  has("...and the capacity filter the list applies in JS", ACTION,
    "job.cleaners.length >= job.requiredCleaners");

  // Redactions. These are the reason the detail route hard-redirects
  // non-assigned cleaners in the first place.
  lacksInCode("the payload has no client price", TYPES, "price:");
  lacksInCode("...no door/gate codes", ACTION, "accessNotes");
  lacksInCode("...and no customer contact details", ACTION, "client: {");
  has("the address is still shown, formatted", ACTION, "formatAddressLine({");
  has("notes are sanitised of billing text", ACTION, "sanitizeCleanerNotes(job.notes)");
  has("add-on quantities go through the clamp", ACTION, "addOnQuantity(a)");

  // There is no per-jobType duration anywhere in this codebase, so the preview
  // says so instead of inventing one.
  has("duration falls back honestly", MODAL, '"Set by dispatch"');

  // 13.b — two actions on the card.
  has("the card has a Preview button", CARD, 'className="cl-preview-btn"');
  has("...beside the existing claim button", CARD, 'className="cl-claim-btn"');
  has("the modal is mounted", CARD, "<JobPreviewModal");
  has("copy-address is offered", MODAL, "navigator.clipboard.writeText");
  has("...with a fallback when the API is absent", MODAL, "navigator.clipboard?.writeText");
  has("the actions row is styled", "src/app/globals.css", ".cl-job-card-actions {");
});

section(14, 'Kill the 10-minute "pending assignment" experience (PDF #4)', () => {
  const PANEL = "src/app/cleaners/my-jobs/PendingInvitesPanel.tsx";
  const CRON = "src/app/api/cron/notifications/route.ts";
  const INVITES = "src/lib/invites.ts";

  // 14.a — the countdown survives ONLY for last-minute broadcasts, which
  // genuinely are a race. A direct assignment cannot lapse, so counting down
  // was threatening something that can't happen.
  has("direct invites are separated from broadcasts", PANEL, "const direct = list.filter((i) => !i.isLastMinute)");
  has("the direct heading is a confirmation", PANEL, '"New assignment — please confirm"');
  has("direct invites say the job is already theirs", PANEL,
    '"This job is yours — tap Accept to confirm."');
  // The countdown must be unreachable for a direct invite. Line-based because
  // this repo mixes CRLF and LF, so a multi-line string needle is a coin flip.
  {
    const lines = read(PANEL).split(/\r?\n/);
    const idx = lines.findIndex((l) => /Expires in \$\{minutesUntil/.test(l));
    ok("a countdown still exists for broadcasts", idx > 0);
    // Walk back to the nearest branch and confirm it is the isLastMinute one.
    const guard = lines.slice(Math.max(0, idx - 5), idx).join(" ");
    ok("...and only broadcasts reach it", /invite\.isLastMinute/.test(guard));
  }
  // Accept stays one tap; decline keeps its existing flow.
  has("accept is still one tap", PANEL, 'onClick={() => respond(invite, "ACCEPT")}');
  has("decline is untouched", PANEL, 'onClick={() => respond(invite, "DECLINE")}');

  // 14.b — the sweep. Last-minute still expires; direct never does.
  has("only broadcasts are swept to EXPIRED", CRON,
    'where: { decision: "PENDING", isLastMinute: true, expiresAt: { lt: now } }');
  // Direct invites: the sweep reads them but writes NO decision. This is the
  // whole of item 4 — stamping "EXPIRED" on a row that cannot expire is what
  // produced the pending-hold experience. Checked structurally rather than by
  // string, by slicing the direct-invite pass out of the file.
  {
    const cron = read(CRON);
    const start = cron.indexOf("Nudge admins about UNCONFIRMED DIRECT assignments");
    ok("the direct-invite pass exists", start > 0);
    const rest = cron.slice(start);
    const end = rest.indexOf("─── Scheduled gift card");
    // Comment lines stripped: this block EXPLAINS what it no longer does, and
    // the explanation quotes the very strings being asserted absent.
    const pass = (end > 0 ? rest.slice(0, end) : rest)
      .split(/\r?\n/)
      .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
      .join("\n");
    ok("...it selects only direct invites", pass.includes("isLastMinute: false,"));
    ok("...only ones not already alerted on", pass.includes("unconfirmedAlertAt: null,"));
    // `decision: "PENDING"` in the WHERE is a read filter and is fine; what
    // must not exist is a decision WRITE.
    // [\s\S] rather than the `s` flag — tsconfig targets below es2018.
    ok("...and it never writes a decision", !/data:\s*\{[\s\S]*?decision:/.test(pass));
    ok("...never stamps EXPIRED", !pass.includes('"EXPIRED"'));
    ok("...nor fakes a response that never happened", !pass.includes("respondedAt:"));
  }
  // The card is titled by JOB NUMBER, not client name: an admin acts on it by
  // opening the job, and a name they have to look up first is a worse handle.
  has("the admin WARNING survives on the same timer", CRON,
    '`Assignment unconfirmed — Job #${inv.job.jobNumber}`');
  has("...deduped so it fires once", CRON, "data: { unconfirmedAlertAt: now },");
  has("a cleaner taken off the job is not chased", CRON, "const stillOnJob =");
  has("the sweep is visible in the cron response", CRON, "invite_unconfirmed_alert: number;");
  // Re-assigning must re-arm the nudge, or a re-invited cleaner is never chased.
  has("re-inviting re-arms the alert", INVITES, "unconfirmedAlertAt: null,");
  has("the migration adds the column",
    "prisma/migrations/20260807010000_invite_unconfirmed_alert/migration.sql",
    'ADD COLUMN IF NOT EXISTS "unconfirmedAlertAt"');

  // The copy that still promised the retired behaviour.
  lacks("the settings tab no longer promises a release", "src/app/admin/settings/tabs/SchedulingTab.tsx",
    "released back to the unassigned folder");
  lacks("...and neither does the invites module header", INVITES,
    "the cron sweep marks it EXPIRED and removes them from the job");

  // 14.c — the claim path was already clean. These lock it that way.
  const CLAIM = "src/app/cleaners/available-jobs/claimJob.ts";
  has("claiming is an atomic compare-and-set", CLAIM, "data: { cleaners: { connect: { id: userId } } },");
  has("over-capacity rolls the claim straight back", CLAIM,
    "data: { cleaners: { disconnect: { id: userId } } },");
  lacksInCode("a claim leaves no invite residue", CLAIM, "jobAssignmentInvite");

  // 14.d — admin assign/reassign is unrestricted by any hold.
  lacksInCode("assignment isn't blocked by a pending invite",
    "src/app/admin/actions/assignCleaners.ts", "decision: \"PENDING\"");
});

section(15, "Clock back into a job (PDF #6)", () => {
  const now = new Date("2026-08-07T18:00:00Z");
  const at = (h: number, m = 0) =>
    new Date(Date.UTC(2026, 7, 7, h, m)).toISOString();

  // ── BEHAVIOUR ────────────────────────────────────────────────────────────
  // 15.g — in → out → back in → out yields 2 sessions, total = sum.
  const two = [
    { startedAt: at(9), endedAt: at(11) },   // 2h
    { startedAt: at(15), endedAt: at(16) },  // 1h
  ];
  const summary = summariseSessions(two, [], now);
  check("two sessions are two sessions", summary.count, 2);
  check("the total is their SUM, not first-in to last-out", summary.totalMinutes, 180);
  check("first start is the job's clock-in", summary.firstStartedAt?.toISOString(), at(9));
  check("last end is the job's clock-out", summary.lastEndedAt?.toISOString(), at(16));
  ok("a closed pair is not open", !summary.isOpen);
  // The single-pair maths this replaces would have said seven hours.
  ok("the old first-to-last span would have been wrong", summary.totalMinutes !== 420);

  // An open session: no finished total, and the job has no clock-out yet.
  const openSummary = summariseSessions(
    [{ startedAt: at(9), endedAt: at(11) }, { startedAt: at(17), endedAt: null }],
    [],
    now
  );
  ok("an open session marks the whole thing open", openSummary.isOpen);
  check("...and withholds the clock-out entirely", openSummary.lastEndedAt, null);
  check("a running session counts up to now", openSummary.totalMinutes, 180);

  // Breaks are allocated by INTERVAL OVERLAP. JobBreak has no session
  // reference, so subtracting the job-wide total from every session would
  // double-count it and subtracting it once would put it in the wrong row.
  const breaks = [{ startedAt: at(9, 30), endedAt: at(10, 0) }]; // 30m, inside session 1
  check("a break is deducted from the session it falls in",
    Math.round(activeSessionMinutes(two[0], breaks, now)), 90);
  check("...and not from the one it doesn't",
    Math.round(activeSessionMinutes(two[1], breaks, now)), 60);
  check("the total deducts it exactly once",
    summariseSessions(two, breaks, now).activeMinutes, 150);
  // A break spanning the gap between sessions only counts while working.
  const spanning = [{ startedAt: at(10, 30), endedAt: at(15, 30) }];
  check("a break outside the session is clipped to it",
    summariseSessions(two, spanning, now).activeMinutes, 180 - 30 - 30);

  // 15.d — the legacy fallback. A job with no session rows must read EXACTLY
  // as it always did; nothing about historical payroll may move.
  const legacy = sessionsFromLegacyPair(at(9), at(11));
  check("a legacy pair reads as one session", legacy.length, 1);
  check("...of the same length", summariseSessions(legacy, [], now).totalMinutes, 120);
  check("a clock-in with no clock-out is one OPEN session",
    sessionsFromLegacyPair(at(9), null)[0].endedAt, null);
  check("no clock-in at all is no sessions", sessionsFromLegacyPair(null, null).length, 0);

  check(
    "a cleaner with sessions reads their own",
    sessionsForCleaner("me", [{ cleanerId: "me", startedAt: at(9), endedAt: at(10) }]).length,
    1
  );
  check(
    "a cleaner with none falls back to the pair",
    sessionsForCleaner("me", [{ cleanerId: "other", startedAt: at(9), endedAt: at(10) }],
      { clockInTime: at(13), clockOutTime: at(14) }).length,
    1
  );

  // 15.b — PAID and CANCELLED refuse a resume; COMPLETED is exactly what
  // "clock back in" reopens, so it must NOT be blocked.
  ok("a completed job can be resumed", canResume("COMPLETED"));
  ok("a paid job refuses resume", !canResume("PAID"));
  ok("a cancelled job refuses resume", !canResume("CANCELLED"));
  check("the clock-in block list is down to two", [...CLOCK_IN_BLOCKED_STATUSES], ["CANCELLED", "PAID"]);

  // resolveClockEntry: sessions win, legacy still works.
  const entry = resolveClockEntry({ sessions: two }, now);
  check("minutes worked is the session sum", entry.minutesWorked, 180);
  check("...and the entry knows how many there were", entry.sessionCount, 2);
  check("status after the last clock-out", entry.status, "CLOCKED_OUT");
  const openEntry = resolveClockEntry(
    { sessions: [{ startedAt: at(17), endedAt: null }] },
    now
  );
  check("an open shift reports no worked total", openEntry.minutesWorked, null);
  check("...and reads as clocked in", openEntry.status, "CLOCKED_IN");
  const legacyEntry = resolveClockEntry(
    { assignment: { clockInTime: at(9), clockOutTime: at(11), status: "CLOCKED_OUT" } },
    now
  );
  check("a session-less assignment still reports", legacyEntry.minutesWorked, 120);
  check("...as one session", legacyEntry.sessionCount, 1);

  // 15.d — payroll hours. Per-cleaner where sessions exist, the old even split
  // where they don't. Money is untouched either way: `hours` is reporting-only.
  const baseJob: JobPayInput = {
    id: "j1",
    employeeId: "a",
    cleaners: [{ id: "a" }, { id: "b" }],
    price: 200,
    employeePay: null,
    payType: "PERCENTAGE",
    hourlyRate: null,
    totalTip: null,
    jobDate: new Date(at(9)),
    startTime: new Date(at(9)),
    endTime: new Date(at(17)),
    clockInTime: new Date(at(9)),
    clockOutTime: new Date(at(11)),
  };
  const rates = new Map<string, CleanerRateInput>([
    ["a", fallbackRateInput("a")],
    ["b", fallbackRateInput("b")],
  ]);

  // No sessions → the old shape, exactly: one job span ÷ participants.
  const legacyShares = computeJobPayShares(baseJob, rates);
  check("without sessions, hours are the old even split", legacyShares.get("a")?.hours, 1);
  check("...for everyone on the job", legacyShares.get("b")?.hours, 1);

  // With sessions → each cleaner's own time. Two cleaners who each worked 2h
  // are reported 2h each; the old maths said 1h each.
  const sessionJob: JobPayInput = {
    ...baseJob,
    workSessions: [
      { cleanerId: "a", startedAt: at(9), endedAt: at(11) },
      { cleanerId: "a", startedAt: at(15), endedAt: at(16) },
      { cleanerId: "b", startedAt: at(9), endedAt: at(11) },
    ],
  };
  const sessionShares = computeJobPayShares(sessionJob, rates);
  check("a cleaner's hours are the sum of THEIR sessions", sessionShares.get("a")?.hours, 3);
  check("...and their teammate's are their own", sessionShares.get("b")?.hours, 2);
  // Money must not move with it.
  check("the payout is unchanged by the hours model",
    sessionShares.get("a")?.total, legacyShares.get("a")?.total);
  check("...for the teammate too",
    sessionShares.get("b")?.total, legacyShares.get("b")?.total);

  // One cleaner's break must not be deducted from another's time.
  const withBreaks: JobPayInput = {
    ...sessionJob,
    breaks: [{ cleanerId: "a", startedAt: at(9, 30), endedAt: at(10, 0) }],
  };
  const breakShares = computeJobPayShares(withBreaks, rates);
  check("a break comes off its own cleaner's hours", breakShares.get("a")?.hours, 2.5);
  check("...and nobody else's", breakShares.get("b")?.hours, 2);

  // ── SOURCE ───────────────────────────────────────────────────────────────
  const CLOCK_IN = "src/app/admin/actions/clockIn.ts";
  const CLOCK_OUT = "src/app/admin/actions/clockOut.ts";
  const MIGRATION = "prisma/migrations/20260807020000_job_work_sessions/migration.sql";

  // 15.a — the model, keyed like JobBreak so removing a cleaner from a job
  // can't cascade away the record of work they did.
  ok("the migration exists", fs.existsSync(MIGRATION));
  has("it creates the table", MIGRATION, 'CREATE TABLE IF NOT EXISTS "JobWorkSession"');
  has("...indexed per cleaner per job", MIGRATION, '"JobWorkSession_jobId_cleanerId_idx"');
  has("...FK'd to the JOB, not the assignment", MIGRATION,
    'FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE');
  lacks("...and never to JobAssignment", MIGRATION, 'REFERENCES "JobAssignment"');
  has("the schema declares the model", "prisma/schema.prisma", "model JobWorkSession {");

  // The backfill is optional and says so, because the fallback covers it.
  const BACKFILL = "scripts/backfillJobWorkSessions.ts";
  ok("a backfill script exists", fs.existsSync(BACKFILL));
  has("it defaults to a dry run", BACKFILL, 'const commit = process.argv.includes("--commit")');
  has("it is idempotent", BACKFILL, "if (job.workSessions.length > 0)");

  // 15.b — THE two latent bugs. Both guards were job-level; both are now
  // per-cleaner, which is what stops one teammate blocking the crew.
  lacksInCode("clock-in no longer blocks on the JOB's clock", CLOCK_IN, "if (job.clockInTime)");
  has("...it asks about THIS cleaner", CLOCK_IN, "findOpenSession(jobId, session.user.id)");
  lacksInCode("clock-out no longer blocks on the JOB's clock", CLOCK_OUT, "if (job.clockOutTime)");
  has("...it closes THIS cleaner's session", CLOCK_OUT, "db.jobWorkSession.update({");
  has("markArrived got the same treatment", "src/app/admin/actions/markArrived.ts",
    "findOpenSession(jobId, session.user.id)");

  // The job only finishes when everybody has.
  has("completion waits for the last open session", CLOCK_OUT, "const isFinalClockOut = !mirrors.anyOpen");
  // The tail lives in `finishClockOut(args)` now, so these read `args.*`. Same
  // rule, one function further out — which is what makes the resume path able
  // to re-run it without re-running the transaction.
  has("...and PAID is never downgraded", CLOCK_OUT,
    'args.jobStatus === "PAID" || args.paymentReceived ? "PAID" : "COMPLETED"');

  // Resuming at 6pm is not a late arrival.
  has("lateness is measured on the first session only", CLOCK_IN, "const minutesLate = isResume");
  has("...and so is the strike", CLOCK_IN, "const penalty = isResume ? null :");

  // The mirrors. clockOutTime must stay NULL while anyone is on site.
  const MIRRORS = "src/lib/work-sessions.server.ts";
  has("mirrors are recomputed from the sessions", MIRRORS, "summariseSessions(sessions)");
  has("...and a cancelled assignment is left as history", MIRRORS, 'existing?.status === "CANCELLED"');
  has("clock-in syncs them", CLOCK_IN, "await syncClockMirrors(jobId)");
  has("clock-out syncs them", CLOCK_OUT, "await syncClockMirrors(args.jobId)");
  // Deleting a session has to CLEAR the mirrors it left behind. The rebuild is
  // driven by the sessions that survive, so a cleaner with none left is never
  // visited — and every reader falls back to the pair, which would go on
  // reporting the deleted work in hours, payroll and time tracking. `reconcile`
  // is the hint that says "this cleaner had sessions; they are gone now".
  has("the mirror rebuild accepts a reconcile list", MIRRORS, "reconcile?: string[]");
  has("...and visits cleaners whose last session went", MIRRORS,
    "(id) => id && !byCleaner.has(id)");
  has("...clearing their pair rather than leaving it stale", MIRRORS,
    'data: { status: "ASSIGNED", clockInTime: null, clockOutTime: null }');
  has("...and the job pair with it when the job has none left", MIRRORS,
    "if (sessions.length === 0 && orphaned.length === 0) return state;");
  has("deleting a session reconciles its cleaner",
    "src/app/admin/actions/updateClockTimes.ts",
    "syncClockMirrors(job.id, { reconcile: [row.cleanerId] })");

  // 15.c — the resume UI.
  const CLOCK_PAGE = "src/app/cleaners/my-jobs/[jobId]/clock/ClockPageClient.tsx";
  has('the clock screen offers "Clock back in"', CLOCK_PAGE, '"Clock back in"');
  has("...only when the job allows it", CLOCK_PAGE, "const canResumeJob = isDone && canResume(status)");
  has("the session log maps every session", CLOCK_PAGE, "sortSessionsDesc(mySessions).map(");
  lacks("...and is no longer a one-row ternary", CLOCK_PAGE, "isLive && clockInDate ? (");
  has("the job page relabels the button on a return",
    "src/app/cleaners/my-jobs/ClockInButton.tsx", '? "Clock back in"');

  // 15.e — admin. Editing a derived column would be silently overwritten, so
  // the server refuses it and points at the session.
  const UPDATE = "src/app/admin/actions/updateClockTimes.ts";
  has("admins can edit one session", UPDATE, "db.jobWorkSession.update({");
  has("...and delete one recorded in error", UPDATE, "export async function deleteJobWorkSession");
  has("editing a derived pair is refused, not silently lost", UPDATE,
    "edit the session times instead");
  has("every session edit is logged", UPDATE, "`sessionTimes:${sessionId}`");
  has("...and so is every deletion", UPDATE, "`sessionDeleted:${row.cleanerId}`");
  has("the locked-payout warning still fires", UPDATE, "Payroll for this date is already");
  has("validation still comes from clock-edit.ts", UPDATE, "validateClockEdit({ clockIn: parsedIn, clockOut: parsedOut })");
  has("the Team card lists sessions", "src/app/admin/jobs/[id]/JobDetailView.tsx", "Session {i + 1}");
  has("the time-tracking page does too", "src/app/admin/time-tracking/TimeTrackingClient.tsx",
    "e.sessions.length > 1");

  // 15.f — side effects. Usage upserts stay per-clock-out and idempotent; the
  // customer-facing ones fire once per job.
  // The rating request must sit INSIDE the final-clock-out branch: asking a
  // customer to rate a job a teammate is still working, or asking twice after
  // a resume, are both wrong (Decision 4).
  {
    // Line-based, not a multi-line string needle: this repo's files are CRLF,
    // so an embedded "\n" never matches.
    const lines = read(CLOCK_OUT).split(/\r?\n/);
    const callIdx = lines.findIndex((l) => /await ensureRatingRequest\(/.test(l));
    ok("the rating request is still made", callIdx > 0);
    ok(
      "the rating request is gated on the final clock-out",
      callIdx > 0 && /if \(isFinalClockOut\) \{/.test(lines[callIdx - 1])
    );
    check(
      "...and it is the only place it fires",
      lines.filter((l) => /ensureRatingRequest\(args\.jobId\)/.test(l)).length,
      1
    );
  }
  // WAS: "inventory usage still merges rather than duplicating", asserting the
  // JobProductUsage upsert. Stage 3 deleted estimated usage outright — nothing
  // is deducted at clock-out and nothing is written to that table — so the
  // property worth pinning is its ABSENCE, plus the report that replaced it.
  lacksInCode("clock-out records no estimated usage at all", CLOCK_OUT, "jobProductUsage");
  has("...it records what the cleaner reported instead", CLOCK_OUT,
    'action: "JOB_REPORT",');
  has("wash projection still recomputes every time", CLOCK_OUT, "washProjectedRags: projection.projectedRags");
  has("the tip nudge's existing per-job dedupe is documented as covering resume",
    "src/app/api/cron/notifications/route.ts",
    "one tip nudge per job, per Decision 4");
});

section(16, "Service category permissions per employee (PDF #3)", () => {
  // ── BEHAVIOUR ────────────────────────────────────────────────────────────
  //
  // 16.0 first: a permission rule is only as good as the alias map underneath
  // it. The Stage-0 probe counted 97 of 221 live jobs (44%) on free text that
  // normalizeJobType returned null for — a filter written against the old map
  // would have hidden nearly half the board from every restricted cleaner.
  // These are the exact distinct jobType values the probe found.
  const LIVE_JOB_TYPES: Array<[string, string | null]> = [
    ["Commercial", "COMMERCIAL"],
    ["House", "RESIDENTIAL"],
    ["Apartment", "RESIDENTIAL"],
    ["Move In & Out", "MOVE_IN_OUT"],
    ["MOVE_IN_OUT", "MOVE_IN_OUT"],
    ["Deep Cleaning", "DEEP"],
    ["RESIDENTIAL", "RESIDENTIAL"],
    ["Detached Home (2000+ sqft)", "RESIDENTIAL"],
    ["Post Construction Cleaning", "POST_CONSTRUCTION"],
    ["MOVE_IN", "MOVE_IN"],
  ];
  for (const [raw, expected] of LIVE_JOB_TYPES) {
    check(`"${raw}" folds to a category`, normalizeJobType(raw), expected);
  }
  check(
    "every live jobType now maps — the probe's 44% gap is closed",
    LIVE_JOB_TYPES.filter(([raw]) => normalizeJobType(raw) === null).map(
      ([raw]) => raw
    ),
    []
  );
  // The legacy spellings must keep working — this was a widening, not a swap.
  check("short codes still fold", normalizeJobType("R - Residential"), "RESIDENTIAL");
  check("...and so do booking-flow values", normalizeJobType("STANDARD"), "RESIDENTIAL");
  check("genuinely unknown text still returns null", normalizeJobType("Window Washing"), null);
  ok("the alias map is exported for this check", Object.keys(CATEGORY_ALIASES).length > 20);

  // 16.a / Decision 8 — an empty list is NOT "nothing allowed".
  ok("no restriction means every job is allowed", isCategoryAllowed("Commercial", []));
  ok("...including when the column is undefined", isCategoryAllowed("Commercial", undefined));

  // 16.c — the rule itself.
  ok("a RESIDENTIAL-only cleaner may take a House", isCategoryAllowed("House", ["RESIDENTIAL"]));
  ok("...and may NOT take a Commercial job", !isCategoryAllowed("Commercial", ["RESIDENTIAL"]));
  ok("...nor a Deep Clean", !isCategoryAllowed("Deep Cleaning", ["RESIDENTIAL"]));

  // The move family is one permission: ticking the combined service must not
  // silently block the legacy MOVE_IN / MOVE_OUT rows that exist in live data.
  check("the family is the three move keys", [...MOVE_FAMILY], ["MOVE_IN", "MOVE_OUT", "MOVE_IN_OUT"]);
  ok("MOVE_IN_OUT permits a legacy MOVE_IN job", isCategoryAllowed("MOVE_IN", ["MOVE_IN_OUT"]));
  ok("...and a legacy MOVE_OUT job", isCategoryAllowed("MOVE_OUT", ["MOVE_IN_OUT"]));
  ok("...and the combined one", isCategoryAllowed("Move In & Out", ["MOVE_IN_OUT"]));
  ok("...but still not a Commercial job", !isCategoryAllowed("Commercial", ["MOVE_IN_OUT"]));
  check("the family folds to one key", canonicalPermissionCategory("MOVE_OUT"), "MOVE_IN_OUT");
  // ...so the admin sees 7 checkboxes, not 9 with three that overlap.
  check("the picker collapses the move rows", PERMISSION_CATEGORIES.length, 7);
  ok(
    "...and offers no separate MOVE_IN / MOVE_OUT row",
    !PERMISSION_CATEGORIES.some((c) => c.key === "MOVE_IN" || c.key === "MOVE_OUT")
  );

  // FAIL OPEN. A job whose type doesn't resolve is visible to everyone. Failing
  // closed here would hide work from every restricted cleaner the moment an
  // import spelled a service a new way, with no signal to anyone.
  ok("an unmapped jobType stays claimable", isCategoryAllowed("Window Washing", ["RESIDENTIAL"]));
  ok("...and so does a null one", isCategoryAllowed(null, ["RESIDENTIAL"]));

  // Nothing invalid may reach the column — a bad key would lock a cleaner out
  // of work they are approved for, silently.
  check("junk is rejected", normalizeAllowedCategories(["NOT_A_CATEGORY", 7, null]), []);
  check("a non-array is rejected", normalizeAllowedCategories("RESIDENTIAL"), []);
  check("duplicates collapse", normalizeAllowedCategories(["DEEP", "DEEP"]), ["DEEP"]);
  check(
    "move keys normalise to the family key",
    normalizeAllowedCategories(["MOVE_IN", "MOVE_OUT"]),
    ["MOVE_IN_OUT"]
  );
  check("lowercase input is accepted", normalizeAllowedCategories(["residential"]), ["RESIDENTIAL"]);

  // 16.d — the admin warning. Advisory copy, never a blocked path.
  check(
    "an approved cleaner produces no warning",
    categoryMismatchWarning("Ana", "House", ["RESIDENTIAL"]),
    null
  );
  check(
    "...an unapproved one names the category",
    categoryMismatchWarning("Ana", "Commercial", ["RESIDENTIAL"]),
    "Ana is not approved for Commercial work"
  );
  check(
    "an unrestricted cleaner is never warned about",
    categoryMismatchWarning("Ana", "Commercial", []),
    null
  );

  // ── SOURCE ───────────────────────────────────────────────────────────────
  const MIGRATION =
    "prisma/migrations/20260807030000_user_service_categories/migration.sql";
  ok("the migration exists", fs.existsSync(MIGRATION));
  has("it adds the column", MIGRATION, 'ADD COLUMN IF NOT EXISTS "allowedServiceCategories"');
  has("...as an empty-defaulted array", MIGRATION, "TEXT[] DEFAULT ARRAY[]::TEXT[]");
  // Empty = all allowed, so no backfill exists and none is needed. A migration
  // that wrote categories onto existing users would restrict them on deploy.
  lacks("...and writes nothing to existing rows", MIGRATION, "UPDATE \"User\"");
  has("the schema declares the field", "prisma/schema.prisma", "allowedServiceCategories     String[]");

  // 16.b — both admin surfaces, and neither writes the column raw.
  const SET_ACTION = "src/app/admin/actions/setEmployeeServiceCategories.ts";
  ok("the action exists", fs.existsSync(SET_ACTION));
  has("it is OWNER/ADMIN only", SET_ACTION, "requireOwnerAdmin()");
  has("...and normalises before writing", SET_ACTION, "normalizeAllowedCategories(categories)");
  has("the detail page renders the picker",
    "src/app/admin/employees/[id]/EmployeeDetailView.tsx", "PERMISSION_CATEGORIES.map");
  has("...and says what an empty list means",
    "src/app/admin/employees/[id]/EmployeeDetailView.tsx",
    "No restriction — this employee can work every service category.");
  has("the employee modal renders it too",
    "src/app/admin/employees/EmployeeModal.tsx", "PERMISSION_CATEGORIES.map");
  // Without the marker, the modal's empty selection would clear a restriction
  // set from the detail-page card — the saveJob `cleanersSubmitted` lesson.
  has("the modal marks that it owns the picker",
    "src/app/admin/employees/EmployeeModal.tsx", '"categoriesSubmitted", "1"');
  has("...and updateEmployee honours the marker",
    "src/app/admin/actions/updateEmployee.ts",
    'formData.get("categoriesSubmitted") === "1"');
  has("...normalising there as well",
    "src/app/admin/actions/updateEmployee.ts",
    'normalizeAllowedCategories(formData.getAll("serviceCategories"))');

  // 16.c — all three cleaner surfaces enforce, and all three ask the SAME
  // function. A surface that restated the rule would drift from the other two.
  const BOARD = "src/app/cleaners/available-jobs/page.tsx";
  const PREVIEW = "src/app/cleaners/available-jobs/getAvailableJobPreview.ts";
  const CLAIM = "src/app/cleaners/available-jobs/claimJob.ts";
  for (const [label, path] of [
    ["the board filters on it", BOARD],
    ["the preview refuses on it", PREVIEW],
    ["the claim refuses on it", CLAIM],
  ] as const) {
    has(label, path, "isCategoryAllowed(");
  }
  has("the claim can see the job's type", CLAIM, "jobType: true,");
  has("...and the cleaner's categories", CLAIM, "allowedServiceCategories: true");
  has("the two blocked surfaces share one message", PREVIEW, "CATEGORY_BLOCKED_MESSAGE");
  has("...both of them", CLAIM, "CATEGORY_BLOCKED_MESSAGE");
  // The preview is read-only and must stay that way — the category check added
  // a db.user read, not a write.
  lacksInCode("the preview still writes nothing", PREVIEW, "db.user.update");
  // Two JS-side filters now run after the fetch; a 100-row page would truncate
  // a restricted cleaner's board to whatever survived.
  has("the board fetch was widened to match", BOARD, "take: 300");

  // 16.d — advisory on every admin path, and never a block.
  has("the shared conflict finder exists", "src/lib/job-assignments.ts",
    "export async function findCategoryConflicts");
  has("...and fails quiet like its availability twin", "src/lib/job-assignments.ts",
    'console.error("findCategoryConflicts failed", e)');
  has("assignCleaners returns the mismatches",
    "src/app/admin/actions/assignCleaners.ts", "categoryConflicts");
  has("...and audit-logs the override",
    "src/app/admin/actions/assignCleaners.ts", "Service category mismatch overridden —");
  has("previewAssignmentConflicts grew the dimension",
    "src/app/admin/actions/checkAvailability.ts", "findCategoryConflicts(ids, job.jobType)");
  has("the Team card shows them", "src/app/admin/jobs/[id]/JobDetailView.tsx",
    "res.categoryConflicts");
  has("bulk assign warns as well", "src/app/admin/actions/bulkAssignCleaner.ts",
    "categoryMismatchWarning(");
  has("...and notes the override in the job log",
    "src/app/admin/actions/bulkAssignCleaner.ts", "service category mismatch overridden");
  has("the New Job picker warns", "src/app/admin/jobs/new/CleanerSelector.tsx",
    "categoryMismatchWarning(");
  has("...and so does JobModal", "src/app/admin/jobs/JobModal.tsx",
    "categoryMismatchWarning(");
  // The PDF is explicit: warn, never block. No admin surface may refuse.
  lacks("assignment is never refused over a category",
    "src/app/admin/actions/assignCleaners.ts", "success: false, error: CATEGORY_BLOCKED_MESSAGE");
  lacks("...nor by bulk assign",
    "src/app/admin/actions/bulkAssignCleaner.ts", "CATEGORY_BLOCKED_MESSAGE");
});

section(17, "Cleaner availability in the booking flow (PDF #19)", () => {
  // ── BEHAVIOUR ────────────────────────────────────────────────────────────
  // The panel is JSX, but what it says comes from the evaluator — so prove the
  // evaluator answers the two cases 17.d asks about. 2026-08-10 is a Monday.
  const MONDAY = "2026-08-10";
  const nineToFive = [
    { day: "MONDAY" as const, startTime: "09:00", endTime: "17:00", isAvailable: true },
  ];
  const coveredSlot = evaluateAvailability(
    { dateKey: MONDAY, startTime: "10:00", endTime: "12:00" },
    nineToFive
  );
  check("a covered Monday slot is available", coveredSlot.result, "AVAILABLE");
  check("...with nothing to warn about", coveredSlot.reason, null);

  const blockedMonday = evaluateAvailability(
    { dateKey: MONDAY, startTime: "10:00", endTime: "12:00" },
    nineToFive,
    [{ date: MONDAY, reason: "Vacation" }]
  );
  check("a blocked Monday is unavailable", blockedMonday.result, "UNAVAILABLE");
  ok("...and says it came from a blocked date", blockedMonday.blockedDate);

  const afterHours = evaluateAvailability(
    { dateKey: MONDAY, startTime: "20:00", endTime: "21:00" },
    nineToFive
  );
  check("an after-hours slot is outside hours", afterHours.result, "OUTSIDE_HOURS");

  // A cleaner who never filled the availability form in must NOT read as
  // unavailable — that is what keeps 17.b's "no coverage" line from crying wolf
  // on a fresh install.
  check(
    "silence is not unavailability",
    evaluateAvailability({ dateKey: MONDAY, startTime: "10:00", endTime: "12:00" }, []).result,
    "NO_DATA"
  );

  // ── SOURCE ───────────────────────────────────────────────────────────────
  const MODAL = "src/app/admin/jobs/JobModal.tsx";
  const PANEL = "src/components/admin/AssignmentIndicators.tsx";
  const SELECTOR = "src/app/admin/jobs/new/CleanerSelector.tsx";

  // 17.a — the modal had zero availability code; this is the whole item.
  has("JobModal asks the shared server helper", MODAL, "checkAvailabilityBatch({");
  has("...keyed off the controlled picker state", MODAL, 'const watchedStartDate = watch("startDate")');
  has("...and discards superseded responses", MODAL, "if (run !== availabilityRun.current) return;");
  // The 500ms DOM poll on /jobs/new exists only because those pickers are hidden
  // inputs that emit no events. JobModal's are Controllers — copying the poll in
  // would have been cargo cult.
  lacksInCode("no polling hack was copied into the modal", MODAL, "setInterval(");
  lacksInCode("...and no DOM scraping either", MODAL, 'document.querySelector<HTMLInputElement>');
  has("the modal renders the advisory panel", MODAL, "<AssignmentWarningPanel");
  has("...with per-row indicators", MODAL, "<StatusIndicator status={statuses.get(item.id)} />");

  // The two pickers must render ONE implementation, or they drift.
  ok("the shared indicator module exists", fs.existsSync(PANEL));
  has("the new-job picker imports it", SELECTOR, '@/components/admin/AssignmentIndicators');
  has("...and so does the modal", MODAL, '@/components/admin/AssignmentIndicators');
  lacksInCode("the old local copy is gone", SELECTOR, "function StatusIndicator(");

  // The copy is load-bearing: the PDF asks for a warning that never blocks.
  has("the panel still says the booking can proceed", PANEL,
    "You can still book them — this is only a warning.");
  has("...under the same heading", PANEL, "Availability conflict");
  // 17.b
  has("no-coverage has its own line", PANEL, "No cleaner is available for this time slot.");
  has("...computed from the candidate list", MODAL, "const noCoverage = useMemo");
  // NO_DATA cleaners must not count toward "nobody is free".
  lacks("...ignoring cleaners with no availability on file", MODAL,
    'return s?.result === "UNAVAILABLE" || s?.result === "OUTSIDE_HOURS" || s?.result === "NO_DATA"');
  // Nothing may gate the save on any of this.
  lacksInCode("the panel never disables anything", PANEL, "disabled");

  // 17.c — the already-shipped availability surfaces, linked from the warning.
  has("the warning links to the cleaner's availability", PANEL, "?tab=availability");
  has("...and the detail page honours that param",
    "src/app/admin/employees/[id]/EmployeeDetailView.tsx", 'searchParams.get("tab")');
  has("...rendering the availability tab", "src/app/admin/employees/[id]/EmployeeDetailView.tsx",
    'activeView === "availability"');
  // SUPERSEDED BY STAGE 12 (PDF #12), not deleted. This asserted the collapsed
  // all-cleaner grid on the Employees page. Step 12.6 retired that card — it
  // could only speak about weekly hours, never about a specific date — and
  // replaced it with a link to /admin/availability, which answers both. What
  // item 17.c actually needs is unchanged: an all-cleaner availability surface
  // exists and the Employees page still reaches it. Both are checked here, and
  // the new page is verified in full by scripts/verify-stage12-availability-view.ts.
  has("the employees page still reaches the all-cleaner grid",
    "src/app/admin/employees/page.tsx", "AVAILABILITY_VIEW_PATH");
  has("...and that grid is mounted on its own page",
    "src/app/admin/availability/AvailabilityBoardClient.tsx", "<AvailabilityWeekGrid");

  // ── The lookup must never fail SILENTLY ──────────────────────────────────
  //
  // Browser-tested finding: this advisory was reported as completely dead. It
  // was not — the answer simply took ~67 seconds to arrive, and until it did,
  // the panel rendered nothing at all. "Still asking" and "everyone is free"
  // were pixel-identical, so a slow answer was indistinguishable from a clean
  // one. Worse, the promise had no rejection handler whatsoever, so a genuinely
  // failed lookup was also silent.
  //
  // These checks pin the three-state contract that fixes both.
  has("the modal tracks where the lookup has got to", MODAL,
    '"idle" | "loading" | "loaded" | "error"');
  has("...and says so while it is in flight", PANEL,
    "Checking cleaner availability…");
  has("...and says so when it fails", PANEL, "Couldn&apos;t check availability");
  has("the modal handles a rejected lookup", MODAL, 'setAvailabilityState("error")');
  has("the new-job picker does too", SELECTOR, 'setAvailabilityState("error")');
  // Both pickers feed the shared panel their state, or they drift again. Each
  // passes it through the same "only once somebody is selected" gate, so the
  // panel cannot announce "checking availability…" before there is anyone the
  // answer could be about.
  check(
    "both pickers report their state to the panel",
    (read(MODAL) + read(SELECTOR)).match(/availabilityState=\{\s*\w+\.length > 0 \? availabilityState : "idle"\s*\}/g)
      ?.length ?? 0,
    2
  );
  // "We couldn't ask" must never be rendered as "nobody is free".
  has("no-coverage is only claimed on a complete answer", MODAL,
    'if (availabilityState !== "loaded") return false;');
  // The override line promises something that has not been offered yet if it
  // prints under a bare "checking…" panel.
  has("the never-blocks line needs an actual warning", PANEL, "{hasWarnings && (");
});

section(18, "Sidebar attention badges (PDF #11)", () => {
  const SIDEBAR = "src/app/admin/Sidebar.tsx";
  const ACTION = "src/app/admin/actions/getAdminAttentionCounts.ts";
  const HOOK = "src/components/AdminAttentionCounts.tsx";

  // ── 18.a — one action, one hook, and the pollers it replaced ──────────────
  ok("the consolidated counts action exists", fs.existsSync(ACTION));
  ok("the shared hook exists", fs.existsSync(HOOK));
  // "a single batched query set" — not seven sequential round trips.
  check(
    "counts are issued as batched transactions",
    (read(ACTION).match(/db\.\$transaction\(\[/g) ?? []).length,
    2
  );
  // The interval is a knob, not a contract: what matters is that ONE key covers
  // every badge and that the beat is slow enough not to starve the pooler. It
  // was tuned 30s → 60s after this was written.
  has("the hook polls on a slow, fixed beat", HOOK, "refreshInterval: 60_000");
  // One SWR key for the whole set, so seven badges cost one request per poll.
  has("...behind one shared key", HOOK, '["admin-attention-counts"]');
  // The 5s requests poller is gone — action and caller both.
  ok(
    "the old per-badge requests action is deleted",
    !fs.existsSync("src/app/admin/actions/getPendingRequestCount.ts")
  );
  lacksInCode("...and the sidebar no longer imports it", SIDEBAR, "getPendingRequestCount");
  // Exactly ONE poll loop may survive: the chat poll, which also drives the
  // "new message" toast and genuinely needs its faster beat.
  //
  // It is a self-pacing setTimeout, NOT setInterval, and that distinction is
  // load-bearing rather than stylistic. This poll is a server action, so its
  // response carries a re-render of whatever page the admin is on; on the job
  // detail page that render takes seconds. `setInterval(poll, 5000)` fired
  // regardless of whether the previous call had returned, so the queue grew
  // without bound and starved every action the admin actually initiated —
  // browser-tested as the amplifier behind both the dead logs pager and the
  // availability check that never appeared. A timer that cannot outrun its own
  // work cannot do that on any connection.
  // The cadence moved to a named constant (and 5s → 30s) after this was
  // written. Asserted through the constant, so the next tuning pass changes one
  // number rather than a check.
  has("the poll's cadence is one named constant", SIDEBAR, "const CHAT_UNREAD_POLL_MS =");
  check(
    "only the chat/toast poll remains",
    (codeOf(SIDEBAR).match(/setTimeout\(poll, CHAT_UNREAD_POLL_MS\)/g) ?? []).length,
    1
  );
  lacksInCode(
    "...and it cannot outrun itself (no fixed-rate setInterval)",
    SIDEBAR,
    "setInterval("
  );
  has("...it schedules the next run only once this one settles", SIDEBAR,
    "if (!cancelled) timer = setTimeout(poll, CHAT_UNREAD_POLL_MS);");
  has("...and it is still the toast's source", SIDEBAR, "setChatToast({");

  // ── 18.b — status semantics, and the role split that goes with them ───────
  // The TODO's shorthand said "PENDING" for quotes/applications/leads; those
  // three enums have no PENDING member, so NEW is the actionable state.
  has("applications count the untriaged", ACTION,
    'db.jobApplication.count({ where: { status: "NEW", deletedAt: null } })');
  has("quotes count the uncontacted", ACTION,
    'db.quoteRequest.count({ where: { status: "NEW", deletedAt: null } })');
  has("leads count the uncontacted", ACTION,
    'db.lead.count({ where: { status: "NEW", deletedAt: null } })');
  has("payouts count periods awaiting approval", ACTION,
    'db.payPeriod.count({ where: { status: "PENDING_APPROVAL" } })');
  has("inventory counts unresolved supply requests", ACTION,
    'db.inventoryRequest.count({ where: { status: "PENDING" } })');
  // Documents is the VIEWER'S queue — /admin/documents reads
  // `where: { employeeId: session.user.id }`, so an org-wide number would not
  // match the page it decorates.
  has("documents counts the viewer's own unsigned", ACTION,
    "where: { employeeId: session.user.id, status: \"PENDING\" }");
  has("...which is what that page actually lists",
    "src/app/admin/documents/page.tsx", "where: { employeeId },");
  // Soft-deleted rows must never inflate a badge (the round-2 archive rule).
  check(
    "every soft-deletable count excludes archived rows",
    (read(ACTION).match(/deletedAt: null/g) ?? []).length,
    4
  );
  // A server action is an independently callable endpoint: hiding the nav entry
  // is not authorization. The three adminOnly counts sit behind the role branch.
  has("the OWNER/ADMIN-only counts are gated in the action", ACTION,
    "if (isOwnerAdmin) {");
  has("...and the four-role set is checked first", ACTION, "if (!isAdmin) return ZERO;");
  // Never throws — a badge must not take down the page it decorates.
  has("the action fails to zero, not to an error", ACTION, "  } catch {\n    return ZERO;");

  // ── 18.c — the union, the NAV entries, the pill ───────────────────────────
  for (const key of [
    "chat", "requests", "jobChat", "applications",
    "quotes", "documents", "leads", "payouts", "inventory",
  ] as const) {
    has(`Badge union carries "${key}"`, SIDEBAR, `| "${key}"`);
  }
  for (const [label, href, badge] of [
    ["job applications", "/admin/job-applications", "applications"],
    ["quotes", "/admin/quotes", "quotes"],
    ["documents", "/admin/documents", "documents"],
    ["leads", "/admin/leads", "leads"],
    ["payouts", "/admin/payouts", "payouts"],
    ["inventory", "/admin/inventory", "inventory"],
  ] as const) {
    const nav = read(SIDEBAR);
    const at = nav.indexOf(`href: "${href}"`);
    ok(`the ${label} nav entry exists`, at >= 0);
    // The badge must be declared on THAT entry, not merely somewhere in the file.
    ok(
      `...and carries badge: "${badge}"`,
      at >= 0 && nav.slice(at, at + 400).includes(`badge: "${badge}"`)
    );
  }
  // The resolver is a lookup now, so a new key cannot silently render 0.
  has("badge counts resolve through an exhaustive record", SIDEBAR,
    "const badgeCounts: Record<Badge, number> = {");
  lacksInCode("...and the ternary chain is gone", SIDEBAR, 'item.badge === "requests"');
  // 18.c: render through the EXISTING pill, capped at 99+. Unchanged on purpose.
  has("the alert pill is unchanged", SIDEBAR, '<span className="anav-count alert">');
  has("...and still caps at 99+", SIDEBAR, 'badgeCount > 99 ? "99+" : badgeCount');
  // Role-gating: the three OWNER/ADMIN badges hang off adminOnly entries, so the
  // nav hides them for OPS_MANAGER / FIELD_LEAD as well.
  //
  // Asserted as the PREDICATE plus the absence of a bypass, not as one exact
  // source line. Stage 7 added a second visibility flag (`fieldLeadOnly`, for
  // /admin/my-team) which reformatted this filter across several lines; pinning
  // the formatting made the check fail while the rule it protects was intact.
  // The rule is: adminOnly items are visible only to OWNER/ADMIN, and there is
  // exactly one filter doing it.
  has("the nav still filters adminOnly entries by role", SIDEBAR,
    "!item.adminOnly || isOwnerAdmin");
  has("...through the section-items filter", SIDEBAR, "items: section.items.filter(");
  check("...and there is exactly one nav visibility filter, so no entry can slip past",
    (read(SIDEBAR).match(/section\.items\.filter\(/g) ?? []).length, 1);
  check("...and adminOnly is consulted exactly once, in that filter",
    (read(SIDEBAR).match(/item\.adminOnly/g) ?? []).length, 1);
});

section(19, "Void cheque upload in cleaner Documents (PDF #16)", () => {
  // ── BEHAVIOUR ────────────────────────────────────────────────────────────
  // The size/type rule is a pure module precisely so it can run here — and so
  // the browser and the server reject the same files for the same reason.
  const pdf = { size: 1024, type: "application/pdf" };
  check("a small PDF is accepted", validateVoidCheque(pdf), null);
  check("a JPG is accepted", validateVoidCheque({ size: 1024, type: "image/jpeg" }), null);
  check("a PNG is accepted", validateVoidCheque({ size: 1024, type: "image/png" }), null);
  // Case and whitespace come from the browser, not from us.
  check("...whatever case the browser reports",
    validateVoidCheque({ size: 1024, type: "IMAGE/PNG " }), null);
  check("exactly 8MB is still fine",
    validateVoidCheque({ size: MAX_VOID_CHEQUE_BYTES, type: "application/pdf" }), null);
  check("one byte over is not",
    validateVoidCheque({ size: MAX_VOID_CHEQUE_BYTES + 1, type: "application/pdf" }),
    "File exceeds the 8MB limit.");
  check("an empty file is rejected",
    validateVoidCheque({ size: 0, type: "application/pdf" }), "That file is empty.");
  check("a text file is rejected",
    validateVoidCheque({ size: 10, type: "text/plain" }), "Use a PDF, JPG or PNG.");
  // Narrower than the job-photo allowlist on purpose — a void cheque gets
  // forwarded to a payroll provider, so it must open anywhere.
  check("HEIC is rejected", validateVoidCheque({ size: 10, type: "image/heic" }),
    "Use a PDF, JPG or PNG.");
  check("GIF is rejected", validateVoidCheque({ size: 10, type: "image/gif" }),
    "Use a PDF, JPG or PNG.");
  // Cloudinary stores PDFs raw and images as images; signing needs the right one.
  check("a PDF signs as a raw asset", resourceTypeFor("application/pdf"), "raw");
  check("...and a JPG as an image", resourceTypeFor("image/jpeg"), "image");

  // ── SOURCE ───────────────────────────────────────────────────────────────
  const UPLOAD = "src/app/admin/actions/uploadVoidCheque.ts";
  const MINT = "src/app/admin/actions/getEmployeeFileUrl.ts";
  const MINE = "src/app/admin/actions/getMyVoidCheque.ts";
  const CLOUD = "src/lib/cloudinary.ts";
  const DOCS_CLIENT = "src/app/admin/documents/DocumentsClient.tsx";
  const CARD = "src/app/admin/documents/VoidChequeCard.tsx";
  const DETAIL = "src/app/admin/employees/[id]/EmployeeDetailView.tsx";

  // 19.a — the migration and the model.
  ok("the EmployeeFile migration exists",
    fs.existsSync("prisma/migrations/20260808000000_employee_files/migration.sql"));
  has("...creating the table", "prisma/migrations/20260808000000_employee_files/migration.sql",
    'CREATE TABLE IF NOT EXISTS "EmployeeFile"');
  has("...cascading from the employee",
    "prisma/migrations/20260808000000_employee_files/migration.sql",
    'REFERENCES "User"("id") ON DELETE CASCADE');
  has("the model is declared", "prisma/schema.prisma", "model EmployeeFile {");
  // History is the whole point of a table over a column: a replacement appends.
  has("...indexed for 'newest of this kind'", "prisma/schema.prisma",
    "@@index([employeeId, kind, uploadedAt])");
  // Signing needs both; re-parsing the URL would not work for authenticated
  // delivery paths (deleteJobPhoto's parser assumes an /upload/ segment).
  has("...storing the Cloudinary public id", "prisma/schema.prisma", "  publicId     String");
  has("...and its resource type", "prisma/schema.prisma", "  resourceType String");

  // 19.b — upload is private, self-scoped, and validated by the shared rule.
  has("the upload is authenticated, not public", UPLOAD, 'type: "authenticated"');
  has("...into a folder that is this company's and this employee's", UPLOAD,
    'const folder = await orgAssetFolder("void-cheques", employeeId);');
  has("...with the employee id taken from the session", UPLOAD,
    "const employeeId = session.user.id;");
  // No parameter an attacker could aim at someone else.
  lacksInCode("...never from the caller", UPLOAD, 'formData.get("employeeId")');
  has("...and validated by the shared rule", UPLOAD, "validateVoidCheque({");
  // Append-only: a replacement must not overwrite the previous row.
  has("a replacement appends a row", UPLOAD, "db.employeeFile.create({");
  lacksInCode("...rather than updating in place", UPLOAD, "db.employeeFile.update(");
  lacksInCode("...or upserting over the old one", UPLOAD, "db.employeeFile.upsert(");

  // Reading is OWNER/ADMIN only — NOT the four-role admin set. A page redirect
  // alone would leave this action callable by OPS_MANAGER / FIELD_LEAD.
  has("minting a URL requires OWNER/ADMIN", MINT, "const guard = await requireOwnerAdmin();");
  has("...from the action guards, not the page guards", MINT,
    'import { requireOwnerAdmin } from "@/lib/action-guards";');
  has("...refusing anyone else", MINT, "if (!guard.ok) return { success: false, error: guard.error };");
  has("the URL is signed and short-lived", MINT, "ttlSeconds: 300,");
  has("...and the access is logged", MINT, 'action: "employee_file.view"');
  // The audit trail must not become a second copy of the thing it audits. Scope
  // the check to the logActivity call itself — `publicId` legitimately appears
  // ABOVE it, as an argument to the signer, which is the one place it belongs.
  {
    // codeOf, not read: the call's own comment explains that the URL and the
    // publicId stay out of the log, so a raw read would match its explanation.
    const mint = codeOf(MINT);
    const from = mint.indexOf("await logActivity({");
    ok("the access log call is findable", from >= 0);
    const logCall = mint.slice(from, mint.indexOf("});", from));
    has("...recording only which file", MINT,
      "metadata: { employeeFileId: file.id, kind: file.kind },");
    ok("the log never carries the signed URL", !logCall.includes("url"));
    ok("...nor the Cloudinary public id", !logCall.includes("publicId"));
    ok("...nor the stored file URL", !logCall.includes("fileUrl"));
  }

  // The signing helper itself.
  has("the signed-URL helper exists", CLOUD, "export function signedFileUrl(");
  has("...targeting authenticated delivery", CLOUD, 'type: "authenticated"');
  has("...and actually signing", CLOUD, "sign_url: true");
  // expires_at is SECONDS since epoch; milliseconds would expire in 1970.
  has("...with a seconds-based expiry", CLOUD,
    "expires_at: Math.floor(Date.now() / 1000) + ttl,");

  // getMyVoidCheque is metadata-only — decision 7 keeps every read of the file
  // behind the logged OWNER/ADMIN path, so there is no second minting route.
  has("the cleaner's own read is self-scoped", MINE,
    "where: { employeeId: session.user.id, kind: VOID_CHEQUE_KIND },");
  has("...returning newest first", MINE, 'orderBy: { uploadedAt: "desc" }');
  lacksInCode("...and no URL at all", MINE, "fileUrl");
  lacksInCode("...not even a signed one", MINE, "signedFileUrl");

  // 19.c — the section is cleaner-only, via the mechanism already in the file.
  ok("the upload card exists", fs.existsSync(CARD));
  has("the payroll section is gated to the cleaner route", DOCS_CLIENT, "{!isAdminView && (");
  has("...under its own heading", DOCS_CLIENT, "Payroll documents");
  has("...rendering the card", DOCS_CLIENT, "<VoidChequeCard current={voidCheque} />");
  has("the card carries the PDF's label", CARD, "{VOID_CHEQUE_LABEL}");
  has("...defined once, shared by both sides", "src/lib/employee-files.ts",
    'export const VOID_CHEQUE_LABEL = "Void Cheque / Direct Deposit Info";');
  has("...and offers Replace once a file exists", CARD, '{current ? "Replace" : "Upload"}');
  // The 2-line re-export must survive — that is what keeps the two routes in sync.
  has("the cleaner route still re-exports the shared page",
    "src/app/cleaners/documents/page.tsx",
    'export { default } from "@/app/admin/documents/page";');

  // 19.d — admin side reads metadata, opens through the guarded action.
  has("the employee page loads the newest file", "src/app/admin/employees/[id]/page.tsx",
    "db.employeeFile.findFirst({");
  has("...as metadata only", "src/app/admin/employees/[id]/page.tsx",
    "select: { id: true, fileName: true, mimeType: true, uploadedAt: true },");
  has("the detail view renders a payroll card", DETAIL, "<VoidChequeAdminCard file={voidCheque} />");
  has("...opening via the guarded action", DETAIL, "const res = await getEmployeeFileUrl(file.id);");
  // A URL rendered into the page would sit in the HTML and the history; the
  // whole design is that it is fetched on click and thrown away.
  lacksInCode("...and never renders a stored file URL", DETAIL, "file.fileUrl");
});

section(20, "Remove Inventory Rules auto-deduction settings (PDF #14)", () => {
  // ── BEHAVIOUR ────────────────────────────────────────────────────────────
  // The replacement for `usagePerJob`. 2026-08-07 is "now" for these fixtures.
  const NOW = new Date("2026-08-07T12:00:00Z");
  const day = (n: number) => new Date(NOW.getTime() - n * 86400000);
  const rows = [
    // Product A: 3 jobs inside the window (2 + 4 + 6 = 12 → 4/job), 1 outside.
    { productId: "A", jobId: "j1", quantity: 2, jobDate: day(1) },
    { productId: "A", jobId: "j2", quantity: 4, jobDate: day(10) },
    { productId: "A", jobId: "j3", quantity: 6, jobDate: day(29) },
    { productId: "A", jobId: "old", quantity: 999, jobDate: day(45) },
    // Product B: one job, two clock-outs — one JOB, not two.
    { productId: "B", jobId: "j4", quantity: 3, jobDate: day(2) },
    { productId: "B", jobId: "j4", quantity: 1, jobDate: day(2) },
  ];
  const avg = perJobAverages(rows, { now: NOW });
  check("averages over jobs inside the window only", avg.get("A"), 4);
  // The distinction that makes the number mean "per job" rather than "per visit".
  check("a job clocked out twice counts once", avg.get("B"), 4);
  // Absent, not zero: "no evidence" and "measured zero" are different claims,
  // and collapsing them is how the old forecast made products disappear.
  check("a product with no usage is absent, not zero", avg.has("C"), false);
  check("...so the map reports what it knows", avg.size, 2);
  // A job with no date can't be windowed, so it is skipped rather than guessed.
  check(
    "undated jobs are skipped",
    perJobAverages([{ productId: "D", jobId: "j9", quantity: 5, jobDate: null }], {
      now: NOW,
    }).size,
    0
  );
  check("projection multiplies out", projectUsage(4, 5), 20);
  check("...and rounds to money-free two decimals", projectUsage(1 / 3, 2), 0.67);
  check("no history projects nothing", projectUsage(undefined, 5), 0);
  check("no upcoming jobs project nothing", projectUsage(4, 0), 0);

  // 20.c — the floor term is gone; the two maintained knobs remain.
  check(
    "a configured product threshold wins",
    cleanerRestockThreshold({ cleanerRestockThreshold: 2, defaultThreshold: 5 }),
    2
  );
  check(
    "...then the admin's global default",
    cleanerRestockThreshold({ cleanerRestockThreshold: 0, defaultThreshold: 5 }),
    5
  );
  check(
    "...then the built-in",
    cleanerRestockThreshold({ cleanerRestockThreshold: 0 }),
    DEFAULT_CLEANER_RESTOCK_THRESHOLD
  );

  // ── SOURCE ───────────────────────────────────────────────────────────────
  // 20.a — the Settings surface, the actions and the CSV entity are gone.
  for (const gone of [
    "src/app/admin/settings/tabs/InventoryRulesTab.tsx",
    "src/app/admin/actions/createInventoryRule.ts",
    "src/app/admin/actions/updateInventoryRule.ts",
  ] as const) {
    ok(`deleted: ${gone.split("/").pop()}`, !fs.existsSync(gone));
  }
  const SETTINGS_CLIENT = "src/app/admin/settings/SettingsClient.tsx";
  lacksInCode("the settings shell has no Inventory Rules tab", SETTINGS_CLIENT, "inventoryRules");
  lacksInCode("...and no import of it", SETTINGS_CLIENT, "InventoryRulesTab");
  lacksInCode("the CSV entity is gone", "src/lib/csv/entities.ts", "inventory-rules");
  lacksInCode("...and its importer with it", "src/app/admin/actions/importCsv.ts",
    "inventoryRulesHandler");
  // The settings page's non-admin fallback is POSITIONAL — 12 empty arrays for
  // 12 destructured names. Losing one name without losing one array shifts
  // every later binding silently, and no type error catches it.
  {
    const page = read("src/app/admin/settings/page.tsx");
    const names = page
      .slice(page.indexOf("const ["), page.indexOf("] = isAdmin"))
      .split("\n")
      .map((l) => l.trim().replace(/,$/, ""))
      .filter((l) => l && !l.startsWith("//") && !l.startsWith("const ["));
    const fallback = page.match(/ {4}: (\[.*\]);/)?.[1] ?? "";
    check(
      "the non-admin fallback still has one slot per binding",
      (fallback.match(/\[\]/g) ?? []).length,
      names.length
    );
  }

  // 20.b — the forecast is sourced from actuals, through the shared helper.
  const INV_PAGE = "src/app/admin/inventory/page.tsx";
  const EMP_PAGE = "src/app/admin/employees/[id]/page.tsx";
  ok("the shared usage module exists", fs.existsSync("src/lib/inventory-forecast.ts"));
  ok("...with a server-side loader", fs.existsSync("src/lib/inventory-forecast.server.ts"));
  has("the loader reads reported usage", "src/lib/inventory-forecast.server.ts",
    "db.jobProductUsage.findMany({");
  // Windowed on the JOB's date: the row's createdAt is the first clock-out,
  // while its quantity accumulates across later ones.
  has("...windowed on the job's date", "src/lib/inventory-forecast.server.ts",
    "where: { job: { jobDate: { gte: from, lte: now } } },");
  for (const [label, path] of [
    ["the inventory forecast", INV_PAGE],
    ["the per-employee forecast", EMP_PAGE],
  ] as const) {
    has(`${label} uses the shared loader`, path, "await loadPerJobAverages()");
    has(`...and the shared projection`, path, "projectUsage(averagePerJob");
    // Stage 3 / decision D3: with per-job usage no longer recorded, the window
    // empties out and every product projects 0 — which would read as "everyone
    // is fully stocked" rather than "we stopped measuring". Both surfaces are
    // hidden behind ONE switch, and neither may hide independently of the other.
    has(`...and ${label} is gated on the shared switch`, path,
      "INVENTORY_FORECAST_ENABLED");
  }
  ok(
    "the forecast switch is off while nothing measures usage",
    /INVENTORY_FORECAST_ENABLED = false/.test(read("src/lib/inventory-forecast.flag.ts"))
  );
  // THE bug 20.b names: products with no rule vanished from the forecast, and
  // an employee whose whole kit was rule-less vanished with them.
  lacksInCode("no product is filtered out of the forecast", INV_PAGE, ".filter((f) => f.usagePerJob > 0)");
  lacksInCode("...on either forecast", EMP_PAGE, ".filter((f) => f.usagePerJob > 0)");
  // The employee forecast used to read rule.refillThreshold directly, so it
  // disagreed with every other low-stock surface.
  has("the per-employee forecast uses the shared threshold", EMP_PAGE,
    "const refillThreshold = cleanerRestockThreshold({");
  has("the forecast card still renders", "src/app/admin/inventory/ForecastView.tsx",
    "<ForecastCard");
  lacksInCode("...and its empty state no longer mentions rules",
    "src/app/admin/inventory/ForecastView.tsx", "set inventory rules");

  // 20.c/20.f — THE SWEEP. Not one live reference may survive, or the drop
  // migration (20.e) cannot run. Comments naming the removal are fine.
  noCodeMatchUnder("no code anywhere still reads InventoryRule", "src",
    /\binventoryRules?\b|\bInventoryRule\b|\busagePerJob\b/);
  // `avgUsagePerJob` in analytics is a DIFFERENT concept — average supply COST
  // per job — and must survive untouched. Prove the sweep didn't eat it.
  has("the unrelated analytics metric survives", "src/app/admin/analytics/page.tsx",
    "const avgUsagePerJob =");

  // 20.d — SUPERSEDED by Stage 3 of the inventory-fixes TODO. This round left
  // the cleaner-reported flow alone because it "already IS the spec"; the
  // inventory PDF then established that what it recorded was an ESTIMATE the
  // app invented (Light use = 15 sprays × 1.25 ml) and deducted as if measured.
  // The checks below are the same four properties, restated against what the
  // flow does now: it records a REPORT, and deducts nothing.
  const CLOCK_OUT = "src/app/admin/actions/clockOut.ts";
  lacksInCode("clock-out no longer records estimated usage", CLOCK_OUT, "jobProductUsage");
  has("...it writes the cleaner's report to their kit", CLOCK_OUT, "db.employeeProduct.update({");
  has("...still writes the audit row, now with the status transition", CLOCK_OUT,
    "newStatus: reportedStatus,");
  has("...and raises an admin flag rather than deducting stock", CLOCK_OUT,
    "db.inventoryFlag.createMany({");
  has("...restock alerts fire from what was REPORTED low or empty", CLOCK_OUT,
    'flagType === "LOW" || flagType === "EMPTY"');
  // Admin review surfaces named in 20.d.
  has("the job detail lists products used",
    "src/app/admin/jobs/[id]/JobDetailView.tsx", "Products used ·");
  has("...and Inventory keeps its Activity tab",
    "src/app/admin/inventory/InventoryPageClient.tsx", 'id: "activity", label: "Activity"');

  // 20.e — DONE in Stage 3.6. It was deferred here because dropping a table is
  // a destructive deploy that needs a backup point behind it; the inventory
  // batch is that deploy, so the model is gone and the migration is written.
  lacksInCode("the InventoryRule model is gone from the schema", "prisma/schema.prisma",
    "model InventoryRule {");
  ok(
    "...and its drop migration is staged",
    fs
      .readdirSync("prisma/migrations")
      .some((d) => d.toLowerCase().includes("drop_inventory_rule"))
  );
  has("...as a plain DROP TABLE, touching nothing else",
    "prisma/migrations/20260817020000_drop_inventory_rule/migration.sql",
    'DROP TABLE IF EXISTS "InventoryRule";');
});

// ═══ Stage 9 — the two defects the browser round found, and their shared cause ═══
//
// Items 17 and 4's pager were reported as not working. Both reproduced, both
// traced to the same thing: this app starves itself of server round trips, so
// anything that needs one appears dead. The framework was never at fault — a
// bare probe route under the same admin layout did a query-only
// `router.replace` in 271ms.

section(22, "the job detail page fetches in parallel, not one await at a time", () => {
  const PAGE = "src/app/admin/jobs/[id]/page.tsx";

  // Eleven sequential round trips at ~1.3s each measured 33.5s per render; two
  // waves measured 13.9s. Because a server action's response carries a
  // re-render of the current page, EVERY button on this page paid that bill —
  // which is what made the logs pager look dead rather than slow.
  has("session and job are fetched together", PAGE, "const [session, job] = await Promise.all([");
  has("...and the other nine reads in one wave", PAGE, "  ] = await Promise.all([");
  // The two genuine dependencies must survive: the job has to exist before its
  // participants can be priced, and the rate lookup needs those ids.
  has("participant ids are derived before the second wave", PAGE,
    "const participantIds = Array.from(");
  has("...and the rate lookup joins that wave", PAGE, "getCleanerRateInputs(participantIds),");
  // The redirects still run before anything is rendered or returned.
  has("an unauthenticated request is still redirected", PAGE, 'redirect("/sign-in");');
  has("...and a missing job too", PAGE, 'redirect("/admin/jobs");');
  // Regression guard: if these come back as separate awaits the page silently
  // returns to costing the SUM of its queries.
  const src = codeOf(PAGE);
  check(
    "no read is left awaiting on its own line",
    ["const users = await", "const clients = await", "const logs = await",
     "const photos = await", "const reviewPhotos = await", "const taxRates = await",
     "const gpsEnabled = await", "const rateInputs = await"].filter((s) => src.includes(s)),
    []
  );
});

section(23, "the sidebar poll cannot outrun its own work", () => {
  const SIDEBAR = "src/app/admin/Sidebar.tsx";
  // Covered in full by section 18's poll checks; this section exists so the
  // TODO item is registered against the property it introduced.
  has("the chat poll is self-pacing", SIDEBAR,
    "if (!cancelled) timer = setTimeout(poll, CHAT_UNREAD_POLL_MS);");
  lacksInCode("...never a fixed-rate interval", SIDEBAR, "setInterval(");
  // The fetch's own catch SWALLOWS, so the reschedule below it is reached on
  // every path — an erroring poll keeps the badge alive instead of stopping the
  // loop dead. (This was a `finally` when the check was written; the swallow
  // gives the same guarantee without the block.)
  has("...and a failed poll still reschedules", SIDEBAR,
    "/* ignore — an erroring poll must still keep the badge alive */");
  has("the cleanup clears the pending timer", SIDEBAR, "if (timer) clearTimeout(timer);");
});

section(24, "log pagination costs one query, not a route render", () => {
  const ROUTE = "src/app/api/admin/jobs/[id]/logs/route.ts";
  const DETAIL = "src/app/admin/jobs/[id]/JobDetailView.tsx";

  ok("the logs route handler exists", fs.existsSync(ROUTE));
  // It is independently callable, so it repeats the page's own gate.
  has("it authenticates", ROUTE, "auth.api.getSession({ headers: await headers() })");
  has("...and applies the page's own access rule", ROUTE,
    "if (!isAdmin && job.employeeId !== session.user.id)");
  // Authorisation must be enforced before rows are RETURNED, even though they
  // are fetched concurrently with the gate.
  has("rows are never returned ahead of the gate", ROUTE, '{ error: "Not authorized" }, { status: 403 }');
  // The endpoint exists to be cheap; three sequential round trips would put it
  // straight back where it started.
  has("it reads in one wave", ROUTE, "const [session, job, optimisticLogs] = await Promise.all([");
  // A hand-built page 900 must get the real last page, not an empty list.
  has("an out-of-range page is clamped", ROUTE, "const page = Math.min(optimisticPage, totalPages);");
  has("...and only that case pays for a second query", ROUTE, "page === optimisticPage");
  has("the audit trail is never cached", ROUTE, '"Cache-Control": "no-store"');
  // Same per-page count as the page's first render, or the two disagree.
  has("the route agrees with the page on page size", ROUTE, "const PER_PAGE = 10;");
  has("...as the page still uses", "src/app/admin/jobs/[id]/page.tsx", "const logsPerPage = 10;");

  // Client side: rows are state, seeded from the server and re-adopted when a
  // fresh server render arrives (a save, a router.refresh).
  has("the rows are client state", DETAIL, "useState<JobLog[]>(logs);");
  has("...re-seeded by a fresh server render", DETAIL, "}, [logs, logsPage, totalLogs]);");
  has("the pager shows it is working", DETAIL, "logsLoading && ' · loading…'");
  has("...and reports a failure", DETAIL, "setLogsError(");
  // A double-click must not queue two pages.
  has("controls are disabled in flight", DETAIL, "disabled={logsLoading || logPage === 1}");
  has("...and stale responses are discarded", DETAIL, "if (run !== logsRun.current) return;");
});

section(25, "the availability lookup cannot fail, or wait, in silence", () => {
  // The behavioural contract lives in section 17; this section registers the
  // TODO item and pins the one property 17 could not have had: that a lookup
  // which is merely SLOW is distinguishable from one that found nothing.
  const MODAL = "src/app/admin/jobs/JobModal.tsx";
  const PANEL = "src/components/admin/AssignmentIndicators.tsx";
  has("the panel can render without any warnings to show", PANEL, "const showStatusLine =");
  has("...for the in-flight case", PANEL, 'availabilityState === "loading"');
  has("...and the failed case", PANEL, 'availabilityState === "error"');
  // The original bug in one line: the rejection path did not exist. `.then()`
  // is called with TWO arguments now, so a rejected call lands somewhere.
  has("the lookup announces itself before it starts", MODAL,
    'setAvailabilityState("loading");');
  has("...records success or a failed result", MODAL,
    'setAvailabilityState(res.success ? "loaded" : "error");');
  has("...and has a rejection handler at all", MODAL,
    'setAvailabilityState("error");');
  // Deliberately structural rather than a multi-line needle: this tree is CRLF,
  // and an assertion carrying a literal \n can never match (the trap recorded
  // against verify-awer-new-fixes.ts:178 in Stage 1). `.then` must be called
  // with two arguments — one fulfil handler and one reject handler.
  check(
    "...passed as .then's second argument, not left off",
    (codeOf(MODAL).match(/\}\).then\(\s*$/gm) ?? []).length,
    1
  );
});

// ── Completeness guard: no item is ticked off without a check ───────────────
//
// The house rule is "tick the box only after verification". This enforced it by
// reading THIS ROUND's `_ai_context/TODO.md`: every item heading marked
// `### [x] N.` had to have registered a `section(N, …)` above.
//
// That document has since been replaced — `_ai_context/TODO.md` now holds the
// inventory-and-operations work (stages, not `### [x] N.` items), and this
// round's execution map is gone with it. The guard is kept, and keeps working
// the moment such a document is present again, but it cannot be allowed to pass
// VACUOUSLY: a file with no matching headings would silently satisfy "every
// ticked item has checks" while checking nothing, which is worse than not
// running at all. So it says which of the two it did.
{
  const todo = "../_ai_context/TODO.md";
  const round = fs.existsSync(todo) ? read(todo) : "";
  const done = [...round.matchAll(/^###\s*\[x\]\s*(\d+)\./gim)].map((m) =>
    Number(m[1])
  );
  const known = new Set(
    [...round.matchAll(/^###\s*\[[ x~!]\]\s*(\d+)\./gim)].map((m) => Number(m[1]))
  );

  console.log("");
  if (known.size > 0) {
    check(
      "every item marked done in TODO.md has checks here",
      done.filter((n) => !covered.has(n)),
      []
    );
    // The reverse, as a typo catcher: a section for an item that doesn't exist
    // in the execution map means a wrong number was passed to section().
    check(
      "every section() here names a real TODO item",
      [...covered].filter((n) => !known.has(n)),
      []
    );
  } else {
    // No execution map to check against. Assert what still holds without one:
    // this round covered 25 numbered items, so every section() must name one of
    // them exactly once. A typo'd number — the failure the reverse check above
    // existed to catch — is still caught.
    console.log(
      "NOTE  this round's item-by-item TODO has been superseded; checking section numbering instead"
    );
    const numbers = [...covered];
    check(
      "every section() names one of this round's 25 items",
      numbers.filter((n) => !Number.isInteger(n) || n < 1 || n > 25),
      []
    );
    check("...and no item is registered twice", numbers.length, new Set(numbers).size);
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
