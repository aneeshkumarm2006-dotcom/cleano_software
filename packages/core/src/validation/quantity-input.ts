/**
 * Reading a quantity box a person is allowed to leave empty.
 *
 * ── WHY THIS EXISTS (Stage 6 · `cleano_inventory_operations_fixes.pdf` #3) ───
 * The p.3 screenshot shows a cleaner's "Update count" modal with a faint `1`
 * sitting in the quantity field. That `1` could not be deleted, and the reason
 * was the same three-line pattern repeated in every inventory modal:
 *
 *     onChange={(e) => setQty(Math.max(1, Math.floor(Number(e.target.value) || 1)))}
 *
 * Clearing the box gave `""` → `Number("") === 0` → `|| 1` → `Math.max(1, …)`,
 * so a `1` was written straight back under the cursor on the very keystroke that
 * deleted it. Typing `12` meant fighting the clamp for every digit.
 *
 * The fix is a rule, not a tweak: **quantity fields hold a string, and a string
 * is parsed once, on submit.** An empty box is a legitimate state while typing —
 * it becomes an error only when the form is sent, and then with a message that
 * says what to do about it. Everything a caller needs to enforce that is here,
 * so the three surfaces that had their own copy of the clamp now share one rule
 * instead of three regexes.
 *
 * Pure by design: no imports, no framework, no DB — `scripts/verify-stage6-mobile-ui.ts`
 * exercises it directly.
 */

export type QuantityParseResult =
  | { ok: true; value: number }
  | { ok: false; error: string };

export interface QuantityParseOptions {
  /** Smallest accepted value. 0 for a recount ("I have none"), 1 for a request. */
  min: number;
  /** Largest accepted value, when there is a real ceiling (e.g. what's in the kit). */
  max?: number;
  /** Unit name, so a ceiling message reads "You only have 3 bottles." */
  unit?: string;
}

/** Digits only — one rule that rejects "abc", "1.5", "-2" and "1e3" alike. */
const DIGITS_ONLY = /^\d+$/;

/**
 * Parse what the person typed.
 *
 * Deliberately strict about the *shape* of the input and deliberately generous
 * about *when* it is checked. Messages are written for a cleaner holding a phone
 * mid-shift: they name the fix, not the rule that was broken.
 */
export function parseQuantityInput(
  raw: string,
  opts: QuantityParseOptions
): QuantityParseResult {
  const trimmed = raw.trim();
  if (trimmed === "") return { ok: false, error: "Enter a number." };
  if (!DIGITS_ONLY.test(trimmed)) {
    return { ok: false, error: "Whole numbers only — digits, no decimals (e.g. 12)." };
  }
  const value = Number(trimmed);
  // A long-enough run of digits overflows the safe integer range before it
  // overflows the regex, and silently storing 1e21 in a kit count is worse than
  // saying no.
  if (!Number.isSafeInteger(value)) return { ok: false, error: "That number is too large." };
  if (value < opts.min) {
    return {
      ok: false,
      error: opts.min === 0 ? "Enter 0 or more." : `Enter ${opts.min} or more.`,
    };
  }
  if (opts.max !== undefined && value > opts.max) {
    return {
      ok: false,
      error: `You only have ${opts.max}${opts.unit ? ` ${opts.unit}` : ""}.`,
    };
  }
  return { ok: true, value };
}

/**
 * The live-typing counterpart: is this draft already a usable quantity?
 *
 * For the one box whose value is owned by a parent (the pickup cart, where the
 * number IS the cart line), so it can push valid drafts up as they are typed
 * while still letting the field sit empty. Never use this to *block* input —
 * that is how the clamp got written in the first place.
 */
export function isUsableQuantity(raw: string, min = 1): boolean {
  const result = parseQuantityInput(raw, { min });
  return result.ok;
}
