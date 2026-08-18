/**
 * Clock-out rules that need no database — cleano_new_fixes.pdf fix 6
 * (`_ai_context/TODO.md` § Stage 5) and the closing inventory report
 * (cleano_inventory_operations_fixes.pdf #2, § Stage 3).
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
 * ── WHAT STAGE 3 CHANGED ───────────────────────────────────────────────────
 * This module used to validate an ESTIMATED USAGE payload: sprays at 1.25 ml a
 * pull, mop counts, disposable counts, and a "how much is left" box, all of
 * which the server converted into a deduction from the cleaner's kit. Every one
 * of those numbers was invented — nobody counts trigger pulls — and they were
 * driving real stock levels, real supplies costs and real restock alerts.
 *
 * PDF #2 replaces the whole idea: at clock-out a cleaner REPORTS the state of
 * the things that changed, and nothing is deducted from anything. So the
 * payload is now a list of reports, one per item the cleaner actually touched,
 * in the vocabulary that fits the product's item type:
 *
 *   LIQUID                → LEVEL     (Full / Good / Half / Low / Empty)
 *   COUNTABLE_CONSUMABLE  → COUNT     (a quantity, plus an optional status chip)
 *   REUSABLE_EQUIPMENT    → CONDITION (Available / Missing / Damaged / …)
 *
 * The all-blank case the page-6 screenshot reported is now the DEFAULT rather
 * than an edge case: "No changes" submits an empty list, which is valid, cheap
 * and writes nothing at all.
 */

import type { ItemType } from "./item-type";
import {
  isCountableStatus,
  isEquipmentCondition,
  isLiquidLevel,
  type CountableStatus,
  type EquipmentCondition,
  type LiquidLevel,
} from "./inventory-status";

/** Which vocabulary one reported line is written in. */
export type ClosingReportKind = "LEVEL" | "COUNT" | "CONDITION";

/** One item the cleaner touched. Untouched items are simply absent. */
export interface ClosingReportEntry {
  productId: string;
  kind: ClosingReportKind;
  /** LEVEL only. */
  levelStatus?: LiquidLevel | null;
  /** COUNT only — what is left, as a whole number. */
  quantity?: number | null;
  /** COUNT only — the optional chip beside the number. */
  status?: CountableStatus | null;
  /** CONDITION only. */
  condition?: EquipmentCondition | null;
  /** Optional free text, per item. */
  note?: string | null;
}

/** The closing inventory report both clock-out screens submit. */
export interface ClosingReport {
  items: ClosingReportEntry[];
}

/** The maximum length of a per-item note. Anything longer is truncated. */
export const CLOSING_NOTE_MAX = 300;

/** Guardrail: a reported kit count above this is a typo, not a recount. */
export const MAX_KIT_QUANTITY = 1000;

export type ClockOutErrorCode =
  | "NOT_AUTHENTICATED"
  | "JOB_NOT_FOUND"
  | "NOT_ASSIGNED"
  | "NOT_CLOCKED_IN"
  /**
   * This cleaner's clock-out already went through, tail and all, and this
   * submission reports inventory that would be thrown away. Distinct from a
   * retry — a retry resends the payload the committed attempt already recorded,
   * so dropping it is correct and the answer is success. Here the entries are
   * new, and answering "done" would be a lie about where they went.
   */
  | "ALREADY_CLOCKED_OUT"
  /**
   * The writes committed and the shift IS saved, but a step after the
   * transaction did not finish. Its own code because it is the one failure the
   * cleaner must NOT read as "nothing happened" — the message says the shift is
   * safe, and Retry resumes rather than re-reporting.
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
   * failure was transport or timing, not what the cleaner reported. The client
   * shows a Retry button on these and asks for a correction on the rest.
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
  /**
   * Which vocabulary this product reports in. Optional so a caller that
   * predates Stage 1 still compiles; when it is absent the kind check is
   * skipped rather than guessed at, because refusing a cleaner's report over a
   * classification WE failed to load is the page-6 failure with a new hat on.
   */
  itemType?: ItemType | null;
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
 * are idempotent — and never re-applies a report. Fifteen minutes is long
 * enough for a cleaner to notice an error, walk somewhere with signal and tap
 * Retry, and short enough that it can't be confused with genuinely clocking out
 * of a second stretch of work.
 */
export const CLOCK_OUT_RESUME_WINDOW_MS = 15 * 60_000;

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

/** One validated line, with everything the server needs already resolved. */
export interface ValidatedReportEntry {
  productId: string;
  name: string;
  unit: string;
  kind: ClosingReportKind;
  /** What the kit holds now — unchanged by LEVEL and CONDITION reports. */
  previousQuantity: number;
  /** What the kit should hold after this report. Only COUNT can move it. */
  quantity: number;
  levelStatus: LiquidLevel | null;
  status: CountableStatus | null;
  condition: EquipmentCondition | null;
  note: string | null;
}

export type ClosingReportValidation =
  | { ok: true; entries: ValidatedReportEntry[] }
  | { ok: false; failure: ClockOutFailure };

const isFiniteNumber = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v);

const CLOSING_REPORT_KINDS: readonly ClosingReportKind[] = [
  "LEVEL",
  "COUNT",
  "CONDITION",
];

export function isClosingReportKind(v: unknown): v is ClosingReportKind {
  return typeof v === "string" && (CLOSING_REPORT_KINDS as readonly string[]).includes(v);
}

/** Which kind a product's type expects. */
export function kindForItemType(itemType: ItemType): ClosingReportKind {
  switch (itemType) {
    case "LIQUID":
      return "LEVEL";
    case "REUSABLE_EQUIPMENT":
      return "CONDITION";
    case "COUNTABLE_CONSUMABLE":
      return "COUNT";
  }
}

const KIND_NOUN: Record<ClosingReportKind, string> = {
  LEVEL: "a level (Full / Good / Half / Low / Empty)",
  COUNT: "a count",
  CONDITION: "a condition (Available / Missing / Damaged …)",
};

const trimNote = (note: unknown): string | null => {
  if (typeof note !== "string") return null;
  const trimmed = note.trim().slice(0, CLOSING_NOTE_MAX);
  return trimmed.length > 0 ? trimmed : null;
};

/**
 * Turn a submitted closing report into the lines the server should write, or
 * the one specific complaint that stops the clock-out.
 *
 * Deliberately NOT a Zod schema: the interesting rules here are not "is this a
 * number" but "which of these does the cleaner have to go and fix", and a schema
 * error (`items.2.quantity: Expected number`) is the blanket string this work
 * exists to delete, wearing a different hat.
 *
 * WHAT IS REFUSED
 *   • a product that is not in this cleaner's kit          → PRODUCT_NOT_IN_KIT
 *   • a report in the wrong vocabulary for the item type   → INVALID_USAGE
 *   • a missing / unrecognised level, status or condition  → INVALID_USAGE
 *   • a negative, fractional or absurd count               → INVALID_USAGE
 *
 * WHAT IS NOT
 *   • an empty list. "No changes" is the fast path and the commonest answer.
 *   • the same product twice — the last line wins, because a client that
 *     re-renders a row must not be able to fail a clock-out with a duplicate.
 */
export function validateClosingReport(
  report: Partial<ClosingReport> | null | undefined,
  kit: ClockOutKit
): ClosingReportValidation {
  const items = report?.items;

  // A missing list is fine ("No changes"). A list that arrived as something
  // else is a broken submission, and saying so beats iterating `undefined` and
  // reporting a TypeError as "Failed to clock out" — which is what happened
  // before Stage 5.
  if (items !== undefined && items !== null && !Array.isArray(items)) {
    return {
      ok: false,
      failure: failure(
        "INVALID_USAGE",
        "Your inventory report didn't arrive correctly. Close this and reopen the clock-out form, then try again.",
        { retryable: false }
      ),
    };
  }

  // Keyed by product so a duplicated row is a correction, not a conflict.
  const byProduct = new Map<string, ValidatedReportEntry>();

  for (const row of items ?? []) {
    const productId = row?.productId;
    if (typeof productId !== "string" || productId.length === 0) {
      return {
        ok: false,
        failure: failure(
          "INVALID_USAGE",
          "One of the items you reported is missing its identifier. Close this and reopen the clock-out form, then try again.",
          { retryable: false }
        ),
      };
    }

    const item = kit.get(productId);
    if (!item) {
      return {
        ok: false,
        failure: failure(
          "PRODUCT_NOT_IN_KIT",
          "You reported on an item that is no longer assigned to you. Refresh the page to pick up your current kit, then clock out again.",
          { field: { productId, name: "this item" }, retryable: false }
        ),
      };
    }

    const field = { productId: item.productId, name: item.name };
    const invalid = (message: string): ClosingReportValidation => ({
      ok: false,
      failure: failure("INVALID_USAGE", message, { field, retryable: false }),
    });

    // The kind has to be one of the three, and it has to match what the product
    // IS. A liquid reported as a condition would put "Damaged" on a bottle of
    // Windex and raise a flag an admin cannot act on; the kit column it would be
    // written to does not even exist for that type.
    if (!isClosingReportKind(row?.kind)) {
      return invalid(
        `“${item.name}” was reported in a way we don't recognise. Refresh the page to pick up your current kit, then clock out again.`
      );
    }
    // `itemType` absent means the caller predates Stage 1 and could not tell us.
    // Refusing a cleaner's report over a classification WE failed to load is the
    // page-6 failure with a new hat on, so the kind is taken at face value.
    const expected = item.itemType ? kindForItemType(item.itemType) : row.kind;
    if (row.kind !== expected) {
      return invalid(
        `“${item.name}” reports ${KIND_NOUN[expected]}, and this form sent something else. Refresh the page to pick up your current kit, then clock out again.`
      );
    }

    const note = trimNote(row?.note);

    if (row.kind === "LEVEL") {
      if (!isLiquidLevel(row.levelStatus)) {
        return invalid(
          `Pick how much “${item.name}” you have left — Full, Good, Half, Low or Empty.`
        );
      }
      byProduct.set(productId, {
        productId,
        name: item.name,
        unit: item.unit,
        kind: "LEVEL",
        previousQuantity: item.quantity,
        // A level report says nothing about the count, so the count is left
        // exactly where it was. This is the line that makes "no automatic
        // deduction of anything" true (PDF #2).
        quantity: item.quantity,
        levelStatus: row.levelStatus,
        status: null,
        condition: null,
        note,
      });
      continue;
    }

    if (row.kind === "CONDITION") {
      if (!isEquipmentCondition(row.condition)) {
        return invalid(
          `Pick the condition of “${item.name}” — Available, Missing, Damaged, Needs replacement or Needs maintenance.`
        );
      }
      byProduct.set(productId, {
        productId,
        name: item.name,
        unit: item.unit,
        kind: "CONDITION",
        previousQuantity: item.quantity,
        quantity: item.quantity,
        levelStatus: null,
        status: null,
        condition: row.condition,
        note,
      });
      continue;
    }

    // COUNT. The number is what the cleaner has LEFT — it replaces the kit
    // count outright rather than being subtracted from it, because a recount is
    // a measurement and the old number was the estimate.
    const quantity = row.quantity;
    const statusGiven = row.status != null && row.status !== undefined;
    if (!isFiniteNumber(quantity)) {
      // A status on its own is a legitimate report ("I can't find them"), so
      // only insist on a number when there is nothing else to go on.
      if (!statusGiven) {
        return invalid(
          `Enter how many “${item.name}” you have left, or pick a status for it.`
        );
      }
    } else {
      if (quantity < 0) {
        return invalid(
          `“${item.name}” can't be a negative number. Enter how many you have left.`
        );
      }
      if (!Number.isInteger(quantity)) {
        return invalid(
          `Enter a whole number of “${item.name}” — you can't have part of one.`
        );
      }
      if (quantity > MAX_KIT_QUANTITY) {
        return invalid(
          `${quantity} “${item.name}” looks like a typo. Enter how many you have left.`
        );
      }
    }
    if (statusGiven && !isCountableStatus(row.status)) {
      return invalid(
        `“${item.name}” has a status we don't recognise. Refresh the page, then clock out again.`
      );
    }

    byProduct.set(productId, {
      productId,
      name: item.name,
      unit: item.unit,
      kind: "COUNT",
      previousQuantity: item.quantity,
      quantity: isFiniteNumber(quantity) ? quantity : item.quantity,
      levelStatus: null,
      status: isCountableStatus(row.status) ? row.status : null,
      condition: null,
      note,
    });
  }

  return { ok: true, entries: [...byProduct.values()] };
}

/**
 * A one-line, PII-free summary of what was submitted, for the failure JobLog
 * row (5.3). Names and units come from our own product catalogue and the
 * statuses are values from our own enums — nothing the cleaner typed as free
 * text reaches the log, because an admin reads these rows and a log is not a
 * place to put unescaped input.
 */
export function describeReportForLog(
  report: Partial<ClosingReport> | null | undefined,
  kit: ClockOutKit,
  maxItems = 6
): string {
  const items = Array.isArray(report?.items) ? report.items : [];
  const rows = items.length;
  const plural = `${rows} item${rows === 1 ? "" : "s"}`;

  const validated = validateClosingReport(report, kit);
  if (!validated.ok) {
    return `${plural} reported; payload rejected (${validated.failure.code})`;
  }
  if (validated.entries.length === 0) {
    return "no inventory changes reported";
  }

  const named = validated.entries
    .map((e) => {
      const value =
        e.kind === "LEVEL"
          ? e.levelStatus
          : e.kind === "CONDITION"
            ? e.condition
            : `${e.quantity} ${e.unit}${e.status ? ` (${e.status})` : ""}`;
      return `${e.name} → ${value}`;
    })
    .sort();

  const shown = named.slice(0, maxItems).join(", ");
  const extra = named.length - maxItems;
  return `${plural} reported; ${shown}${extra > 0 ? ` (+${extra} more)` : ""}`;
}

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
 * job without re-reporting anything) or it did not (in which case nothing
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
