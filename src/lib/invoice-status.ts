// What "overdue" means for an invoice, in one place.
//
// WHY THIS EXISTS (Q-round 4 · J3): `Invoice.status` has an `OVERDUE` member
// and the UI reads it in eight places — the stats tile, the status filter, the
// row pill and icon, the due-date colour, the Mark-paid guards — but a
// repo-wide search finds NO code path that ever WRITES it. There is no cron, no
// nightly sweep, no transition inside sendInvoice/updateInvoice. So the tile
// read 0 / "all clear" while INV-202606-0002 sat 64 days past its due date, and
// picking "Overdue" in the status filter could only ever return nothing.
//
// Rather than add a writer (a status column that needs a scheduled job to stay
// true is a second source of truth waiting to drift), overdue is DERIVED from
// the two facts that are always current: the invoice was sent and is not yet
// paid, and its due date is behind us.
//
// A stored `OVERDUE` still counts. Nothing writes it today, but the enum member
// exists, bulk actions could set it tomorrow, and a row that says it is overdue
// must not be argued with.
//
// Client-safe: `@/lib/timezone` has no server-only imports, so the list page,
// the detail page and any server component can share this.

import { storeDateKey } from "./timezone";

/** The fields the rule needs. Prisma rows (Date) and DTOs (ISO string) both fit. */
export interface OverduableInvoice {
  status: string;
  dueDate: string | Date | null;
}

/**
 * Is this invoice past due?
 *
 * `todayKey` is a STORE-timezone civil day ("2026-08-13"), not the server's
 * clock — an invoice due today is not overdue at 8 PM in Montréal just because
 * the host in UTC has already rolled over to tomorrow (the Stage 2 convention).
 * Pass it in from the server render so a long-lived client page and the payload
 * it was given agree; it defaults to "now" for callers that have no better
 * answer.
 *
 * Both sides of the comparison go through `storeDateKey`, so `YYYY-MM-DD`
 * string ordering is a correct date comparison and no `Date` maths is needed.
 */
export function isInvoiceOverdue(
  invoice: OverduableInvoice,
  todayKey: string = storeDateKey()
): boolean {
  if (invoice.status === "OVERDUE") return true;
  // Sent-but-unpaid only. A DRAFT nobody has sent is not a late receivable, and
  // PAID / CANCELLED are settled.
  if (invoice.status !== "SENT") return false;
  if (!invoice.dueDate) return false;
  return storeDateKey(invoice.dueDate) < todayKey;
}

/**
 * The status to SHOW. The one value the pill, the icon, the filter and the
 * tiles all read, so they cannot disagree with each other.
 */
export function invoiceDisplayStatus(
  invoice: OverduableInvoice,
  todayKey?: string
): string {
  return isInvoiceOverdue(invoice, todayKey) ? "OVERDUE" : invoice.status;
}
