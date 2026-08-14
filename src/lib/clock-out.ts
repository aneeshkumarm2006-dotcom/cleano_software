/**
 * Clock-out rules that need no database — cleano_new_fixes.pdf fix 6
 * (`_ai_context/TODO.md` § Stage 5).
 *
 * WHY THIS FILE EXISTS. `clockOut.ts` is a `"use server"` module, so every one
 * of its exports has to be an async server action. That makes the three pieces
 * of logic most worth testing — is this payload sane, what does the cleaner get
 * told when it isn't, and what class of failure just happened — unreachable
 * from a script. They live here instead: pure functions, no `db`, no `auth`, so
 * `scripts/verify-pricing-fixes.ts` can exercise the real code path rather than
 * grepping the action's source for a string and hoping.
 *
 * THE RULE THE PDF ASKS FOR: "identify the exact field or inventory item".
 * Every failure below therefore carries a machine-readable `code`, a sentence a
 * cleaner standing in someone's kitchen can act on, and — where one product is
 * to blame — the `field` that names it so the client can mark that input.
 *
 * THE RULE THE SCREENSHOT ASKS FOR: an all-blank submit must succeed. Optional
 * quantities are already tolerated client-side (NaN filtered out, an unchanged
 * remaining-quantity yields used = 0); this file mirrors that server-side
 * instead of trusting it, because the action is a public entry point and the
 * page-6 failure is exactly the blank case.
 */

/** The post-job inventory payload both clock-out modals submit. */
export interface ClockOutUsage {
  sprays: Array<{ productId: string; sprayCount: number }>;
  mops: Array<{ productId: string; mopCount: number }>;
  disposables: Array<{ productId: string; quantity: number }>;
  /** Products in category OTHER — the legacy remaining-quantity input. */
  remaining: Array<{ productId: string; inventoryAfter: number }>;
}

export type ClockOutErrorCode =
  | "NOT_AUTHENTICATED"
  | "JOB_NOT_FOUND"
  | "NOT_ASSIGNED"
  | "NOT_CLOCKED_IN"
  /**
   * This cleaner's clock-out already went through, tail and all, and this
   * submission reports product usage that would be thrown away. Distinct from a
   * retry — a retry resends the payload the committed attempt already recorded,
   * so dropping it is correct and the answer is success. Here the entries are
   * new, and answering "done" would be a lie about where they went.
   */
  | "ALREADY_CLOCKED_OUT"
  /**
   * The writes committed and the shift IS saved, but a step after the
   * transaction did not finish. Its own code because it is the one failure the
   * cleaner must NOT read as "nothing happened" — the message says the shift is
   * safe, and Retry resumes rather than re-deducts.
   */
  | "SYNC_INCOMPLETE"
  | "INVALID_USAGE"
  | "PRODUCT_NOT_IN_KIT"
  | "DB_TIMEOUT"
  | "DB_UNAVAILABLE"
  | "DB_ERROR"
  | "UNKNOWN";

/** The product a failure is about, so the client can mark that input. */
export interface ClockOutField {
  productId: string;
  name: string;
}

export interface ClockOutFailure {
  success: false;
  code: ClockOutErrorCode;
  error: string;
  field?: ClockOutField;
  /**
   * True when resubmitting the SAME payload is expected to work — i.e. the
   * failure was transport or timing, not the numbers the cleaner typed. The
   * client shows a Retry button on these and asks for a correction on the rest.
   */
  retryable: boolean;
}

/** One line of the cleaner's kit, as the validator needs to see it. */
export interface KitItem {
  productId: string;
  name: string;
  unit: string;
  /** What the cleaner is recorded as holding right now. */
  quantity: number;
}

export type ClockOutKit = Map<string, KitItem>;

/**
 * How long after a session closes a resubmission is still treated as "finish
 * what you started" rather than "you are not clocked in".
 *
 * The window exists because the clock-out transaction and the steps that follow
 * it are not one atomic act: once the transaction commits, the cleaner's session
 * IS closed even if the response never made it back to their phone. Every retry
 * inside this window re-runs only the steps after the transaction — all of which
 * are idempotent — and never re-applies a deduction. Fifteen minutes is long
 * enough for a cleaner to notice an error, walk somewhere with signal and tap
 * Retry, and short enough that it can't be confused with genuinely clocking out
 * of a second stretch of work.
 */
export const CLOCK_OUT_RESUME_WINDOW_MS = 15 * 60_000;

/** ml of product per trigger pull. Mirrored by both clock-out modals. */
export const ML_PER_SPRAY = 1.25;

const failure = (
  code: ClockOutErrorCode,
  error: string,
  opts: { field?: ClockOutField; retryable?: boolean } = {}
): ClockOutFailure => ({
  success: false,
  code,
  error,
  ...(opts.field ? { field: opts.field } : {}),
  retryable: opts.retryable ?? false,
});

export type UsageValidation =
  | { ok: true; deductions: Map<string, number> }
  | { ok: false; failure: ClockOutFailure };

const isFiniteNumber = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v);

/**
 * Blank means blank. `parseFloat("")` is NaN and both modals already drop those
 * rows before posting; a NaN that arrives anyway is read the same way — the
 * cleaner left the box alone — and never as an error.
 */
const isBlank = (v: unknown): boolean =>
  v === null || v === undefined || v === "" || (typeof v === "number" && Number.isNaN(v));

const SECTION_LABEL: Record<keyof ClockOutUsage, string> = {
  sprays: "liquid sprays",
  mops: "mop-based liquids",
  disposables: "disposables",
  remaining: "other products",
};

/**
 * Turn a submitted usage payload into the per-product amounts to deduct, or the
 * one specific complaint that stops the clock-out.
 *
 * Deliberately NOT a Zod schema: the interesting rules here are not "is this a
 * number" but "which of these numbers is the cleaner going to have to change",
 * and a schema error (`remaining.2.inventoryAfter: Expected number`) is the
 * blanket string this stage exists to delete, wearing a different hat.
 */
export function validateClockOutUsage(
  usage: Partial<ClockOutUsage> | null | undefined,
  kit: ClockOutKit
): UsageValidation {
  const payload = usage ?? {};

  // A missing section is fine (a cleaner with no mops posts no mops). A section
  // that arrived as something other than a list is a broken submission, and
  // saying so beats iterating `undefined` and reporting a TypeError as "Failed
  // to clock out" — which is what happened before this stage.
  for (const key of Object.keys(SECTION_LABEL) as (keyof ClockOutUsage)[]) {
    const section = payload[key];
    if (section !== undefined && section !== null && !Array.isArray(section)) {
      return {
        ok: false,
        failure: failure(
          "INVALID_USAGE",
          `Your ${SECTION_LABEL[key]} entries didn't arrive correctly. Close this and reopen the clock-out form, then try again.`,
          { retryable: false }
        ),
      };
    }
  }

  const deductions = new Map<string, number>();
  const add = (productId: string, amount: number) => {
    if (amount > 0) {
      deductions.set(productId, (deductions.get(productId) ?? 0) + amount);
    }
  };

  /**
   * A row is only worth complaining about once it claims real usage. A stale
   * kit line the cleaner never touched must never block a clock-out — that is
   * the all-blank page-6 case, and the whole point of the fix.
   */
  const resolve = (
    productId: unknown,
    reportsUsage: boolean
  ): { item: KitItem } | { skip: true } | { failure: ClockOutFailure } => {
    if (typeof productId !== "string" || productId.length === 0) {
      if (!reportsUsage) return { skip: true };
      return {
        failure: failure(
          "INVALID_USAGE",
          "One of the products you logged is missing its identifier. Close this and reopen the clock-out form, then try again.",
          { retryable: false }
        ),
      };
    }
    const item = kit.get(productId);
    if (!item) {
      if (!reportsUsage) return { skip: true };
      return {
        failure: failure(
          "PRODUCT_NOT_IN_KIT",
          "You logged usage for a product that is no longer assigned to you. Set it back to “None”, or refresh the page to pick up your current kit, then clock out again.",
          { field: { productId, name: "this product" }, retryable: false }
        ),
      };
    }
    return { item };
  };

  const numberProblem = (
    item: KitItem,
    label: string
  ): { ok: false; failure: ClockOutFailure } => ({
    ok: false,
    failure: failure(
      "INVALID_USAGE",
      `“${item.name}” has an invalid ${label}. Enter a number that is zero or more, then clock out again.`,
      { field: { productId: item.productId, name: item.name }, retryable: false }
    ),
  });

  for (const row of payload.sprays ?? []) {
    const count = row?.sprayCount;
    if (isBlank(count)) continue;
    const resolved = resolve(row?.productId, !isFiniteNumber(count) || count > 0);
    if ("failure" in resolved) return { ok: false, failure: resolved.failure };
    if ("skip" in resolved) continue;
    if (!isFiniteNumber(count) || count < 0) {
      return numberProblem(resolved.item, "spray count");
    }
    add(resolved.item.productId, count * ML_PER_SPRAY);
  }

  for (const row of payload.mops ?? []) {
    const count = row?.mopCount;
    if (isBlank(count)) continue;
    const resolved = resolve(row?.productId, !isFiniteNumber(count) || count > 0);
    if ("failure" in resolved) return { ok: false, failure: resolved.failure };
    if ("skip" in resolved) continue;
    if (!isFiniteNumber(count) || count < 0) {
      return numberProblem(resolved.item, "mop count");
    }
    add(resolved.item.productId, count);
  }

  for (const row of payload.disposables ?? []) {
    const count = row?.quantity;
    if (isBlank(count)) continue;
    const resolved = resolve(row?.productId, !isFiniteNumber(count) || count > 0);
    if ("failure" in resolved) return { ok: false, failure: resolved.failure };
    if ("skip" in resolved) continue;
    if (!isFiniteNumber(count) || count < 0) {
      return numberProblem(resolved.item, "quantity");
    }
    add(resolved.item.productId, count);
  }

  // OTHER products post what is LEFT, not what was used. An untouched box comes
  // back equal to the starting quantity → used = 0 → nothing to deduct, which is
  // why the screenshot's all-blank submit should be the cheapest clock-out there
  // is rather than the one that fails.
  for (const row of payload.remaining ?? []) {
    const left = row?.inventoryAfter;
    if (isBlank(left)) continue;
    // `reportsUsage: false` on purpose. The other three sections post what was
    // USED, so a non-zero row is unambiguously a claim and a missing kit line is
    // worth stopping for. This one posts what is LEFT, and both modals prefill it
    // with the starting quantity — so a kit line removed between page load and
    // submit arrives looking identical to one the cleaner never touched. There is
    // no way to tell them apart, and refusing the clock-out over a box nobody
    // typed in is the page-6 failure with a nicer message on it.
    const resolved = resolve(row?.productId, false);
    if ("failure" in resolved) return { ok: false, failure: resolved.failure };
    if ("skip" in resolved) continue;
    const item = resolved.item;
    if (!isFiniteNumber(left) || left < 0) {
      return numberProblem(item, "remaining quantity");
    }
    if (left > item.quantity) {
      return {
        ok: false,
        failure: failure(
          "INVALID_USAGE",
          `You entered ${left} ${item.unit} remaining for “${item.name}”, but you only started with ${item.quantity}. Enter what you have left, not what you used.`,
          { field: { productId: item.productId, name: item.name }, retryable: false }
        ),
      };
    }
    add(item.productId, item.quantity - left);
  }

  return { ok: true, deductions };
}

/**
 * A one-line, PII-free summary of what was submitted, for the failure JobLog
 * row (5.3). Names and units come from our own product catalogue and the counts
 * are numbers we computed — nothing the cleaner typed as free text reaches the
 * log, because an admin reads these rows and a log is not a place to put
 * unescaped input.
 */
export function describeUsageForLog(
  usage: Partial<ClockOutUsage> | null | undefined,
  kit: ClockOutKit,
  maxItems = 6
): string {
  const payload = usage ?? {};
  const counts = {
    sprays: Array.isArray(payload.sprays) ? payload.sprays.length : 0,
    mops: Array.isArray(payload.mops) ? payload.mops.length : 0,
    disposables: Array.isArray(payload.disposables) ? payload.disposables.length : 0,
    remaining: Array.isArray(payload.remaining) ? payload.remaining.length : 0,
  };
  const rows = counts.sprays + counts.mops + counts.disposables + counts.remaining;

  const validated = validateClockOutUsage(payload, kit);
  if (!validated.ok) {
    return `${rows} product row${rows === 1 ? "" : "s"} submitted; payload rejected (${validated.failure.code})`;
  }

  const named = [...validated.deductions.entries()]
    .map(([productId, amount]) => {
      const item = kit.get(productId);
      return item
        ? `${item.name} −${round2(amount)} ${item.unit}`
        : `${productId} −${round2(amount)}`;
    })
    .sort();

  if (named.length === 0) {
    return `${rows} product row${rows === 1 ? "" : "s"} submitted, none reporting usage`;
  }
  const shown = named.slice(0, maxItems).join(", ");
  const extra = named.length - maxItems;
  return `${rows} product row${rows === 1 ? "" : "s"} submitted; ${shown}${
    extra > 0 ? ` (+${extra} more)` : ""
  }`;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Prisma codes that mean "we ran out of time", not "your data is wrong". */
const TIMEOUT_CODES = new Set(["P1008", "P2024", "P2028", "P2034"]);
/** Prisma codes that mean the database was not reachable at all. */
const UNAVAILABLE_CODES = new Set(["P1000", "P1001", "P1002", "P1011", "P1017", "P5010"]);

const errorCodeOf = (error: unknown): string | null => {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "string" ? code : null;
};

/**
 * The class of a failure, in a form safe to write to a log: constructor name
 * plus Prisma's error code. Never the message — Prisma puts the failing query
 * (and therefore row data) in there.
 */
export function clockOutErrorClass(error: unknown): string {
  const name =
    (error as { name?: unknown } | null)?.name ??
    (error as { constructor?: { name?: string } } | null)?.constructor?.name ??
    typeof error;
  const code = errorCodeOf(error);
  return code ? `${String(name)}(${code})` : String(name);
}

/**
 * Map a thrown error to what the cleaner is told and whether Retry is offered.
 *
 * Retry is safe for every code below precisely BECAUSE the writes are one
 * transaction: either it committed (in which case the resume path finishes the
 * job without re-deducting anything) or it did not (in which case nothing
 * happened at all). There is no third state in which a second submit
 * double-counts, which is what makes offering the button honest.
 */
export function classifyClockOutError(error: unknown): ClockOutFailure {
  const code = errorCodeOf(error);
  const message = typeof (error as { message?: unknown })?.message === "string"
    ? ((error as { message: string }).message)
    : "";

  if (
    (code && TIMEOUT_CODES.has(code)) ||
    /timed?\s*out|timeout|transaction already closed/i.test(message)
  ) {
    return failure(
      "DB_TIMEOUT",
      "The server took too long to save your clock-out, so nothing was saved. Your entries are still here — tap Retry.",
      { retryable: true }
    );
  }

  if (
    (code && UNAVAILABLE_CODES.has(code)) ||
    /ECONNRESET|ECONNREFUSED|ETIMEDOUT|fetch failed|socket hang up/i.test(message)
  ) {
    return failure(
      "DB_UNAVAILABLE",
      "We couldn't reach the server. Check your signal and tap Retry — your entries are still here.",
      { retryable: true }
    );
  }

  return failure(
    "DB_ERROR",
    `Something went wrong saving your clock-out${code ? ` (${code})` : ""}. Your entries are still here — tap Retry, and tell your manager if it keeps happening.`,
    { retryable: true }
  );
}
