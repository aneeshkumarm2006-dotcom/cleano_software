/**
 * Stage 6 — Inventory mobile UI: readability & input usability.
 * Implements `cleano_inventory_operations_fixes.pdf` #3 (p.2–3).
 *
 * Three things are asserted, matching the three failures in the p.3 screenshot:
 *
 *   1. CONTRAST — every colour the inventory UI uses for a label, a value, a
 *      placeholder or helper copy is measured against white with the real WCAG
 *      formula and required to clear 4.5:1. This is the only way to state the
 *      acceptance criterion as a test rather than an opinion: the teal ramp
 *      *looks* fine on a desk monitor and fails on a phone in a lit room.
 *   2. INPUT — the quantity rule is exercised directly (it is a pure module for
 *      exactly this reason), and the source is swept to prove the clamp that
 *      produced the undeletable `1` is gone from every surface that had it.
 *   3. KEYBOARD — structural assertions on the sheet: footer outside the
 *      scroller, height capped from the visual viewport, dvh not vh.
 *
 * Run: npx tsx scripts/verify-stage6-mobile-ui.ts
 */
import fs from "node:fs";
import path from "node:path";
import { parseQuantityInput, isUsableQuantity } from "../src/lib/quantity-input";

let pass = 0;
let fail = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const okv = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${okv ? "PASS" : "FAIL"}  ${name}`);
  if (!okv) console.log(`        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  okv ? pass++ : fail++;
}
const ok = (n: string, c: boolean) => check(n, c, true);

const root = path.join(__dirname, "..");
const read = (p: string) => fs.readFileSync(path.join(root, p), "utf8");

const CSS = read("src/app/globals.css");
const MY_INV = read("src/app/cleaners/my-inventory/MyInventoryClient.tsx");
const CART = read("src/app/cleaners/my-inventory/checkout/CartItem.tsx");
const KITS = read("src/app/admin/inventory/kits/KitsAdminClient.tsx");
const HISTORY = read("src/app/cleaners/my-inventory/history/HistoryClient.tsx");
const RESOLVE = read("src/app/cleaners/my-inventory/resolve/ResolveClient.tsx");
const INPUT_UI = read("src/components/ui/Input.tsx");
const CLOSING = read("src/app/cleaners/my-jobs/ClosingInventoryReport.tsx");

/* ══════════════════════════════════════════════════════════════════════════
   1 · CONTRAST — the real WCAG 2.1 relative-luminance formula
   ══════════════════════════════════════════════════════════════════════════ */

/** sRGB channel → linear light. */
function linear(channel8: number): number {
  const c = channel8 / 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}
function luminance([r, g, b]: [number, number, number]): number {
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}
/** Composite a colour with alpha over an opaque backdrop. */
function over(
  fg: [number, number, number],
  alpha: number,
  bg: [number, number, number]
): [number, number, number] {
  return [
    fg[0] * alpha + bg[0] * (1 - alpha),
    fg[1] * alpha + bg[1] * (1 - alpha),
    fg[2] * alpha + bg[2] * (1 - alpha),
  ];
}
function contrast(a: [number, number, number], b: [number, number, number]): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}
function hex(h: string): [number, number, number] {
  const v = h.replace("#", "");
  return [
    parseInt(v.slice(0, 2), 16),
    parseInt(v.slice(2, 4), 16),
    parseInt(v.slice(4, 6), 16),
  ];
}

const WHITE: [number, number, number] = [255, 255, 255];
const AA = 4.5;
const ratioOnWhite = (c: [number, number, number]) => contrast(c, WHITE);
const round2 = (n: number) => Math.round(n * 100) / 100;

// ── The formula itself, against known-good reference pairs ────────────────
// If these drift, every number below is meaningless.
check("black on white is 21:1", round2(contrast([0, 0, 0], WHITE)), 21);
check("#767676 on white is the canonical 4.54:1 AA boundary",
  round2(ratioOnWhite(hex("#767676"))), 4.54);

// ── Why the old colours had to go ─────────────────────────────────────────
// This block is the *evidence* for the change, not decoration: it shows no
// member of the teal alpha ramp can reach AA, so "just bump the alpha" — the
// obvious cheap fix, and the one already tried once in this file's history —
// cannot work.
const TEAL = hex("#008C9C");
const rampFail: string[] = [];
for (const alpha of [0.4, 0.5, 0.62, 0.7, 0.78, 0.82, 0.9, 1.0]) {
  const r = ratioOnWhite(over(TEAL, alpha, WHITE));
  if (r < AA) rampFail.push(`${alpha}→${round2(r)}`);
}
check("no alpha of #008C9C reaches AA on white — including 1.0",
  rampFail.length, 8);
ok("solid brand teal tops out around 4.0:1", round2(ratioOnWhite(TEAL)) < AA);

// The three tokens the p.3 screenshot's text actually used.
ok("--primary-70 (old label colour) failed AA",
  ratioOnWhite(over(TEAL, 0.82, WHITE)) < AA);
ok("--primary-60 (old helper colour) failed AA",
  ratioOnWhite(over(TEAL, 0.78, WHITE)) < AA);
ok("--primary-40 (old 'Updated …' colour) failed AA",
  ratioOnWhite(over(TEAL, 0.62, WHITE)) < AA);

// ── The replacements all clear AA ─────────────────────────────────────────
const INK = hex("#0e1a1c");
const INK_SOFT = over(INK, 0.65, WHITE);
const PRIMARY_800 = hex("#005a63");

ok("--ink (labels, typed values) clears AA on white", ratioOnWhite(INK) >= AA);
ok("--ink-soft (placeholders, secondary) clears AA on white", ratioOnWhite(INK_SOFT) >= AA);
ok("--primary-800 (tinted helper copy) clears AA on white", ratioOnWhite(PRIMARY_800) >= AA);
// Rows tint their background when an item needs attention — the text has to hold
// up there too, or the fix only works for healthy items.
ok("--ink-soft clears AA on the low-row tint (#fffdf7)",
  contrast(INK_SOFT, hex("#fffdf7")) >= AA);
ok("--primary-800 clears AA on the empty-row tint (#fff8f8)",
  contrast(PRIMARY_800, hex("#fff8f8")) >= AA);
ok("--primary-800 clears AA on --cream (#f3f6f9)",
  contrast(PRIMARY_800, hex("#f3f6f9")) >= AA);
// The Input `form` variant's placeholder, at the alpha actually written.
ok("Input variant=form placeholder (#005a63 @ 0.85) clears AA",
  ratioOnWhite(over(PRIMARY_800, 0.85, WHITE)) >= AA);
// The Tailwind greys used by the swept files.
ok("text-gray-600 (#4b5563) clears AA", ratioOnWhite(hex("#4b5563")) >= AA);
ok("text-gray-500 (#6b7280) clears AA", ratioOnWhite(hex("#6b7280")) >= AA);
ok("text-gray-400 (#9ca3af) does NOT clear AA — which is why it was replaced",
  ratioOnWhite(hex("#9ca3af")) < AA);

// ── The colours are actually in the source ────────────────────────────────
// A contrast table that nothing reads is a table that proves nothing, so each
// class is pinned to the token it now uses.
const cssRule = (selector: string): string => {
  const i = CSS.indexOf(selector);
  if (i < 0) return "";
  const open = CSS.indexOf("{", i);
  const close = CSS.indexOf("}", open);
  return open < 0 || close < 0 ? "" : CSS.slice(open, close);
};
for (const [selector, token] of [
  [".ir-desc {", "--primary-800"],
  [".ir-updated {", "--ink-soft"],
  [".cl-inv-meter-thresh {", "--ink-soft"],
  [".cl-field-label {", "--ink"],
  [".cl-field-help {", "--primary-800"],
  [".cl-sheet-intro {", "--ink-soft"],
  [".cl-sheet-title {", "--ink"],
  [".cl-field-input::placeholder {", "--ink-soft"],
  [".cir-count-input::placeholder {", "--ink-soft"],
  [".cir-note::placeholder {", "--ink-soft"],
  [".co-subtitle {", "--ink-soft"],
  [".co-input-label {", "--primary-800"],
] as const) {
  ok(`${selector.replace(" {", "")} uses ${token}`, cssRule(selector).includes(token));
}
// The input must set a colour at all — the original bug was that it set none,
// so typed text inherited whatever the page happened to give it.
ok(".cl-field-input sets an explicit text colour", cssRule(".cl-field-input {").includes("color: var(--ink)"));
// Firefox dims placeholders unless told not to, which would silently undo the fix.
ok(".cl-field-input::placeholder pins opacity: 1",
  cssRule(".cl-field-input::placeholder {").includes("opacity: 1"));

// No faint token may come back to the four modals or the row copy.
for (const token of ["--primary-40", "--primary-50", "--primary-60", "--primary-70"]) {
  ok(`MyInventoryClient no longer paints text with ${token}`, !MY_INV.includes(token));
}
ok("no text-gray-400 left in the cleaner inventory area",
  !HISTORY.includes("text-gray-400") && !RESOLVE.includes("text-gray-400") && !CART.includes("text-gray-400"));
ok("no 0.6-alpha teal left in the cleaner inventory area",
  !HISTORY.includes("#008C9C]/6") && !RESOLVE.includes("#008C9C]/6"));
ok("Input variant=form no longer types in un-AA #008C9C",
  !INPUT_UI.includes('!text-[#008C9C]') && INPUT_UI.includes('!text-[#005a63]'));
ok("Input variant=form placeholder is no longer 0.40 alpha",
  !INPUT_UI.includes("placeholder:text-[#008C9C]/40"));

/* ══════════════════════════════════════════════════════════════════════════
   2 · INPUT — the quantity rule, and the clamp's absence
   ══════════════════════════════════════════════════════════════════════════ */

// The exact sequence from the screenshot: a cleaner clears the box to type 12.
// Under the old handler each of these keystrokes wrote a `1` back.
check("an empty box is not silently 1", parseQuantityInput("", { min: 1 }),
  { ok: false, error: "Enter a number." });
check("an empty box is not silently 0 either", parseQuantityInput("", { min: 0 }),
  { ok: false, error: "Enter a number." });
check("'12' parses to 12", parseQuantityInput("12", { min: 0 }), { ok: true, value: 12 });
check("'0' is a legitimate recount", parseQuantityInput("0", { min: 0 }), { ok: true, value: 0 });
check("'0' is refused where 1 is the floor", parseQuantityInput("0", { min: 1 }),
  { ok: false, error: "Enter 1 or more." });
check("surrounding whitespace is tolerated", parseQuantityInput("  7 ", { min: 0 }),
  { ok: true, value: 7 });

// The test plan's "typing abc" case — it must produce a message, not a blank.
const abc = parseQuantityInput("abc", { min: 1 });
ok("'abc' is an error, not a silent empty box", !abc.ok);
ok("'abc' error names the fix", !abc.ok && abc.error.includes("Whole numbers"));
for (const bad of ["1.5", "-2", "1e3", "1 2", "٣", "+4", "1,000", "Infinity", "NaN"]) {
  ok(`${JSON.stringify(bad)} is rejected`, !parseQuantityInput(bad, { min: 0 }).ok);
}
ok("an absurd run of digits is refused rather than stored",
  !parseQuantityInput("9".repeat(25), { min: 0 }).ok);

// Ceilings, for the issue report (you cannot write off more than you hold).
check("a ceiling is enforced with the unit in the message",
  parseQuantityInput("5", { min: 1, max: 3, unit: "Scrapers" }),
  { ok: false, error: "You only have 3 Scrapers." });
check("exactly the ceiling is fine", parseQuantityInput("3", { min: 1, max: 3 }),
  { ok: true, value: 3 });
ok("isUsableQuantity agrees with the parser on a blank draft", !isUsableQuantity(""));
ok("isUsableQuantity accepts a typed quantity", isUsableQuantity("4"));

// ── The clamp is gone from every surface that had it ──────────────────────
// The three exact expressions listed in the TODO's "current state".
const CLAMPS = [
  "Math.max(1, Math.floor(Number(e.target.value) || 1))",
  "Math.max(1, Number(e.target.value))",
  "Math.max(0, Math.floor(Number(e.target.value) || 0))",
  "parseFloat(e.target.value) || 0",
];
for (const [label, src] of [
  ["MyInventoryClient", MY_INV],
  ["CartItem", CART],
  ["KitsAdminClient", KITS],
] as const) {
  for (const clamp of CLAMPS) {
    ok(`${label} no longer clamps with ${clamp}`, !src.includes(clamp));
  }
  // Stronger than checking the four known strings: nothing may clamp or coerce
  // inside an onChange at all. That is the shape of the bug, whatever it is
  // spelled as next time.
  const onChanges = src.match(/onChange=\{[^}]*\}/g) ?? [];
  const coercing = onChanges.filter((h) => /Math\.(max|min|floor)|Number\(|parseFloat|parseInt/.test(h));
  check(`${label} has no coercion in any onChange handler`, coercing, []);
}

// Quantity state is a string everywhere, which is what makes "" representable.
for (const name of ["refillQty", "addQty", "editQty", "damageQty"]) {
  ok(`${name} is string state`, new RegExp(`\\[${name}, set\\w+\\] = useState\\(""\\)`).test(MY_INV));
}
ok("KitsAdminClient's add quantity is string state", /\[addQty, setAddQty\] = useState\(""\)/.test(KITS));
// The recount box opens EMPTY — the screenshot's complaint was a value the
// cleaner had to delete before they could enter the one they had just counted.
ok("openEdit does not seed the box with the stored count",
  /setEditQty\(""\)/.test(MY_INV) && !/setEditQty\(item\.quantity\)/.test(MY_INV));
ok("openDamage does not seed a 1", /setDamageQty\(""\)/.test(MY_INV) && !/setDamageQty\(1\)/.test(MY_INV));

// All four modals share ONE rule rather than growing three regexes again.
check("parseQuantityInput is the only quantity rule",
  (MY_INV.match(/parseQuantityInput\(/g) ?? []).length, 4);
for (const [label, src] of [["MyInventoryClient", MY_INV], ["CartItem", CART], ["KitsAdminClient", KITS]] as const) {
  ok(`${label} imports the shared rule`, src.includes('from "@/lib/quantity-input"'));
  ok(`${label} hand-rolls no second digit regex`, !src.includes("/^\\d+$/"));
}
// The module must stay pure — a client component imports it.
const QTY_SRC = read("src/lib/quantity-input.ts");
check("quantity-input.ts imports nothing", QTY_SRC.match(/^\s*import\s/gm), null);

// Numeric keypad on a phone, but a text field so bad input can be reported.
check("every quantity box asks for the numeric keypad",
  (MY_INV.match(/inputMode: "numeric"/g) ?? []).length, 1);
ok("quantity boxes select on focus so typing replaces a stale value",
  MY_INV.includes("e.currentTarget.select()"));
ok("the shared props are applied to all four boxes",
  (MY_INV.match(/\{\.\.\.qtyInputProps\}/g) ?? []).length === 4);

/* ══════════════════════════════════════════════════════════════════════════
   3 · KEYBOARD — the sheet stays usable with the keyboard open
   ══════════════════════════════════════════════════════════════════════════ */

// The footer must be a sibling of the scroller, not its last child. This is the
// whole fix: a footer inside the scroll area can always be scrolled away.
ok("the sheet has a dedicated footer slot", /footer\?: React\.ReactNode/.test(MY_INV));
const bodyIdx = MY_INV.indexOf('className="cl-sheet-body"');
const footIdx = MY_INV.indexOf('className="cl-sheet-foot"');
ok("the footer is rendered outside the scrolling body", bodyIdx > 0 && footIdx > bodyIdx);
ok("only the body scrolls", cssRule(".cl-sheet-body {").includes("overflow-y: auto"));
ok("the footer cannot be squeezed away", cssRule(".cl-sheet-foot {").includes("flex-shrink: 0"));
ok("the body can shrink below its content (min-height: 0)",
  cssRule(".cl-sheet-body {").includes("min-height: 0"));
ok("a focused field is kept clear of the keyboard (scroll-padding)",
  cssRule(".cl-sheet-body {").includes("scroll-padding-bottom"));
ok("the footer clears the iOS home indicator",
  cssRule(".cl-sheet-foot {").includes("env(safe-area-inset-bottom)"));

// Height: capped from the visual viewport, with a dvh fallback. vh is the wrong
// unit on iOS — it measures the viewport behind the browser chrome.
ok("the sheet is capped by --cl-sheet-max with a dvh fallback",
  cssRule(".cl-sheet {").includes("var(--cl-sheet-max, 88dvh)"));
ok("the sheet is lifted by the keyboard's height",
  cssRule(".cl-sheet-overlay {").includes("var(--cl-kb-inset, 0px)"));
ok("the Modal reads window.visualViewport", MY_INV.includes("window.visualViewport"));
ok("it writes both custom properties",
  MY_INV.includes('setProperty("--cl-kb-inset"') && MY_INV.includes('setProperty("--cl-sheet-max"'));
ok("it re-measures on visualViewport resize AND scroll",
  MY_INV.includes('vv.addEventListener("resize"') && MY_INV.includes('vv.addEventListener("scroll"'));
ok("the listeners are torn down", MY_INV.includes('vv.removeEventListener("resize"'));
ok("the focused control is scrolled into view", MY_INV.includes('scrollIntoView({ block: "center"'));
// Stage 3's clock-out sheet had the same vh mistake.
ok("the clock-out sheet also uses dvh, not vh",
  cssRule(".co-sheet {").includes("max-height: 92dvh"));

// 16px is not cosmetic: below it, iOS Safari zooms the page on focus, which is
// how the buttons ended up off-screen in the screenshot.
ok("sheet inputs are 16px", cssRule(".cl-field-input {").includes("font-size: 16px"));
ok("sheet inputs are at least 44px tall", cssRule(".cl-field-input {").includes("min-height: 44px"));
ok("footer buttons are at least 44px tall",
  cssRule(".cl-sheet-foot .cl-action-btn {").includes("min-height: 44px"));
ok("choice buttons are at least 44px tall", cssRule(".cl-choice {").includes("min-height: 44px"));
ok("the closing report's count box is 16px (Stage 3 kept the rule)",
  cssRule(".cir-count-input {").includes("font-size: 16px"));
// Row action buttons are the primary tap targets on a phone.
ok("row actions reach 44px on a phone",
  /@media \(max-width: 640px\) \{\s*\.cl-inv-row \.ir-actions \.cl-action-btn \{ min-height: 44px/.test(CSS));
ok("ghost sheet/row buttons type in an AA teal",
  cssRule(".cl-sheet-foot .cl-action-btn:not(.solid),").includes("--primary-800"));

// The quantity a cleaner opens the page to read must be ON the page. It used to
// be `display: none` below 900px.
ok("the meter column is no longer hidden on a phone",
  !/\.cl-inv-row \.ir-meter \{ display: none/.test(CSS));
ok("it reflows under the name instead of being duplicated",
  /\.cl-inv-row \.ir-meter \{ grid-column: 2 \/ -1/.test(CSS));
ok("there is still exactly one rendering of the quantity per row",
  (MY_INV.match(/className="cl-inv-meter-qty"/g) ?? []).length === 3 &&
    !MY_INV.includes("ir-meter-mobile"));

/* ══════════════════════════════════════════════════════════════════════════
   4 · ACCESSIBILITY (step 6.5)
   ══════════════════════════════════════════════════════════════════════════ */

// Every label points at a real id, and every id has a label. Checked as a set
// rather than a count so a renamed field can't quietly lose its label.
const labelledIds = [...MY_INV.matchAll(/htmlFor="(cl-[a-z-]+)"/g)].map((m) => m[1]).sort();
const fieldIds = [...MY_INV.matchAll(/\bid="(cl-[a-z-]+)"/g)]
  .map((m) => m[1])
  .filter((id) => !id.endsWith("-error"))
  .sort();
check("every labelled id exists as a field, and vice versa", labelledIds, fieldIds);
ok("all nine sheet fields are labelled", fieldIds.length === 9);

// Errors are announced. The region is mounted empty so the screen reader is
// already watching it when the message appears.
check("every sheet has a polite live region for its error",
  (MY_INV.match(/aria-live="polite"/g) ?? []).length, 5);
ok("the live regions are always mounted (rendered as \"\" when clean)",
  (MY_INV.match(/\?\.message \?\? ""/g) ?? []).length === 5);
ok("an empty error region is removed from the layout",
  cssRule(".cl-field-error:empty {").includes("display: none"));
ok("a quantity error marks its own field, not the whole sheet",
  (MY_INV.match(/aria-invalid=\{\w+Error\?\.field === "quantity"/g) ?? []).length === 4);
ok("aria-invalid is visible, not just announced",
  cssRule('.cl-field-input[aria-invalid="true"] {').includes("border-color"));
ok("KitsAdminClient announces its error too", KITS.includes('aria-live="polite"'));
ok("the sheet is a dialog", MY_INV.includes('role="dialog"') && MY_INV.includes('aria-modal="true"'));
ok("choice groups are grouped and named",
  (MY_INV.match(/role="group" aria-label=/g) ?? []).length === 2);
ok("choice buttons expose their selected state",
  (MY_INV.match(/aria-pressed=\{/g) ?? []).length === 2 && !MY_INV.includes("const active ="));
ok("Escape closes the sheet", MY_INV.includes('e.key === "Escape"'));
ok("the page behind the sheet stops scrolling",
  MY_INV.includes('document.body.style.overflow = "hidden"'));
ok("the cart's bare number box has an accessible name", CART.includes("aria-label={`Quantity of"));

/* ══════════════════════════════════════════════════════════════════════════
   5 · REGRESSION GUARDS — what must NOT have changed
   ══════════════════════════════════════════════════════════════════════════ */

// Stage 6 is a UI fix. None of the behaviour Stages 1–5 built may have moved.
ok("Save count still requires a reason", MY_INV.includes("editBusy || !editReason.trim()"));
ok("the destructive Report confirm is still the only red button",
  (MY_INV.match(/#dc2626/g) ?? []).length === 1);
ok("equipment still gets Update condition, never Request refill",
  MY_INV.includes("openCondition(item)") && MY_INV.includes("Update condition"));
ok("the attention count is still server-computed",
  MY_INV.includes("i.attention.needsAttention"));
ok("clearing the cart box no longer drops the line (draft state, revert on blur)",
  CART.includes("onBlur={() => setDraft(String(quantity))}"));
ok("the pickup cart still allows taking more than the locker shows",
  CART.includes("overLimit"));
// Stage 3's rule: rows start blank so untouched items are not re-submitted.
ok("the closing report's rows still start blank",
  CLOSING.includes("Deliberately NOT pre-seeded"));
ok("the old inline label/input style objects are gone",
  !MY_INV.includes("const labelStyle") && !MY_INV.includes("const inputStyle"));

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
