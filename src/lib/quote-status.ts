// Quote lifecycle for post-construction bookings (PDF #9, Stage 11).
//
// ## What this is
//
// A post-construction booking is not a priced job — it is a QUOTE REQUEST that
// the customer has already paid a deposit on. `Job.quoteStatus` is the state
// machine for the part of its life before it becomes a normal job:
//
//   PENDING_REVIEW  paid, photos uploaded, waiting for an admin to look
//   QUOTED          admin set a final price and sent it to the customer
//   ACCEPTED        customer said yes; from here it behaves like any other job
//   DECLINED        customer said no; the deposit disposition is a separate call
//
// `null` means "not a quote" — every job in the business that isn't one of
// these, which is every row that predates this stage.
//
// ## Why this is NOT a `JobStatus`
//
// `JobStatus` (CREATED/SCHEDULED/IN_PROGRESS/COMPLETED/PAID/CANCELLED) drives
// clock-in, payroll, invoicing, the calendars, the cleaner app and about a dozen
// admin filters. Adding two states to it would put every one of those code paths
// in the blast radius of a quote. A parallel nullable column touches only the
// surfaces that opt in — which is exactly the guard-rail list in step 11.7.
//
// So a quote-pending job carries BOTH: `status = CREATED` (it is not scheduled
// work) and `quoteStatus = PENDING_REVIEW` (and that second column is what hides
// it from cleaners).
//
// PURE — no DB, no framework, no `@prisma/client` import. Client components
// render off these labels (the admin quote panel, the customer portal), so
// anything server-only here would break the build at the far end of the app. The
// union below mirrors `enum QuoteStatus` in schema.prisma; the verify script
// asserts the two lists match.

/** `Job.quoteStatus`. Spelled as a union, not imported — see the header. */
export type QuoteStatus = "PENDING_REVIEW" | "QUOTED" | "ACCEPTED" | "DECLINED";

export const QUOTE_STATUSES: readonly QuoteStatus[] = [
  "PENDING_REVIEW",
  "QUOTED",
  "ACCEPTED",
  "DECLINED",
] as const;

export function isQuoteStatus(v: unknown): v is QuoteStatus {
  return (
    v === "PENDING_REVIEW" ||
    v === "QUOTED" ||
    v === "ACCEPTED" ||
    v === "DECLINED"
  );
}

/**
 * Parse an untrusted value into a column value. Returns null for anything that
 * isn't one of the four, so a crafted request can't invent a state.
 */
export function parseQuoteStatus(v: unknown): QuoteStatus | null {
  if (typeof v !== "string") return null;
  const up = v.trim().toUpperCase();
  return isQuoteStatus(up) ? up : null;
}

export const QUOTE_STATUS_LABEL: Record<QuoteStatus, string> = {
  PENDING_REVIEW: "Awaiting review",
  QUOTED: "Quote sent",
  ACCEPTED: "Quote accepted",
  DECLINED: "Quote declined",
};

/** One line of plain English per state, for the admin panel and the portal. */
export const QUOTE_STATUS_HINT: Record<QuoteStatus, string> = {
  PENDING_REVIEW:
    "The customer paid the deposit and uploaded photos. Review them and send a final price.",
  QUOTED:
    "The final price was emailed to the customer. Mark it accepted once they confirm.",
  ACCEPTED:
    "The customer accepted. This is a normal job now — schedule it and assign a crew.",
  DECLINED:
    "The customer declined. Decide what happens to their deposit: refund, keep, or partial.",
};

/** `ok` / `warn` / `critical`, matching the tone vocabulary used elsewhere. */
export type QuoteTone = "ok" | "warn" | "critical";

export const QUOTE_STATUS_TONE: Record<QuoteStatus, QuoteTone> = {
  PENDING_REVIEW: "warn",
  QUOTED: "warn",
  ACCEPTED: "ok",
  DECLINED: "critical",
};

/** Human label for a stored value, or null when the job isn't a quote. */
export function quoteStatusLabel(v: unknown): string | null {
  return isQuoteStatus(v) ? QUOTE_STATUS_LABEL[v] : null;
}

/**
 * States in which the job is NOT real work yet, and so must not appear on any
 * cleaner-facing surface (step 11.7).
 *
 * DECLINED is in here with the two pending states on purpose: a declined quote
 * is dead, not merely unscheduled, and it would otherwise sit on the available-
 * jobs board forever. ACCEPTED is deliberately absent — that is the moment the
 * job becomes ordinary — and so is `null`, which is every non-quote job.
 */
export const QUOTE_STATUSES_HIDDEN_FROM_CLEANERS: readonly QuoteStatus[] = [
  "PENDING_REVIEW",
  "QUOTED",
  "DECLINED",
] as const;

/**
 * Should this job be hidden from cleaners because its quote isn't settled?
 *
 * Accepts the raw column so a `select` that fetched it as a string still gets
 * the right answer, and treats an absent/garbage value as "not a quote" — a
 * caller that forgot the column degrades to today's behaviour (job visible)
 * rather than to an empty job board.
 */
export function isAwaitingQuote(v: unknown): boolean {
  return isQuoteStatus(v) && QUOTE_STATUSES_HIDDEN_FROM_CLEANERS.includes(v);
}

/** True while an admin still owes the customer a price. */
export function needsQuoteReview(v: unknown): boolean {
  return v === "PENDING_REVIEW";
}

/* ------------------------- deposit disposition (D11) ----------------------- */
//
// Decision D11: no automatic behaviour. When a quote is declined (or the booking
// is cancelled) the admin picks one of three, every time, and the choice is
// logged. Nothing here decides policy — it only names the three options so the
// action, the UI and the audit log word them identically.

export type DepositDisposition = "REFUND" | "KEEP" | "PARTIAL";

export const DEPOSIT_DISPOSITIONS: readonly DepositDisposition[] = [
  "REFUND",
  "KEEP",
  "PARTIAL",
] as const;

export function isDepositDisposition(v: unknown): v is DepositDisposition {
  return v === "REFUND" || v === "KEEP" || v === "PARTIAL";
}

export const DEPOSIT_DISPOSITION_LABEL: Record<DepositDisposition, string> = {
  REFUND: "Refund the deposit",
  KEEP: "Keep the deposit",
  PARTIAL: "Refund part of the deposit",
};

export const DEPOSIT_DISPOSITION_HINT: Record<DepositDisposition, string> = {
  REFUND: "Sends the whole remaining deposit back to the customer's card.",
  KEEP: "No money moves. Record why — the customer may ask.",
  PARTIAL: "Refunds an amount you choose, up to the remaining deposit.",
};
