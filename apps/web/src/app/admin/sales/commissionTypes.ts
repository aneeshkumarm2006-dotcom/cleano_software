// Client-safe shapes + constants for the Commissions tab (item 20, Stage 11.2).
// No server imports here: the tab, the page loader and the server actions all
// read from this file, which is why SALES_REP_ROLES cannot live in the actions
// module ("use server" only exports async functions).

import type { Roles } from "@prisma/client";

/**
 * Who a commission can be paid to. CLIENT is excluded — a customer is not a
 * rep. Everything else is offered because this app has no SALES_REP role, and
 * adding one would mean putting a new access level into the auth system to make
 * a dropdown read better.
 *
 * TODO(client): commissions are attached to a `User`, so a rep needs a login.
 * If Cleano pays canvassers who aren't staff accounts, the fix is a small
 * `SalesRep` table (name/email/active) and repointing `Commission.salesRepId`
 * at it — the ledger, the totals and this whole tab are unaffected.
 */
export const SALES_REP_ROLES: Roles[] = ["OWNER", "ADMIN", "OPS_MANAGER", "FIELD_LEAD", "EMPLOYEE"];

export interface CommissionRow {
  id: string;
  salesRepId: string;
  salesRepName: string;
  amount: number;
  rate: number | null;
  period: string;
  note: string | null;
  paidAt: string | null;
  createdAt: string;
  jobId: string | null;
  jobNumber: number | null;
  leadId: string | null;
  leadLabel: string | null;
}

export interface SalesRepOption {
  id: string;
  name: string;
  role: string;
}

export interface CommissionLeadOption {
  id: string;
  label: string;
}

export interface RepTotals {
  repId: string;
  repName: string;
  entries: number;
  pending: number;
  paid: number;
  total: number;
  pendingIds: string[];
}

/** Exact cents. Money tiles round to whole dollars in a couple of places in this
 *  app and it is what let two screens quote different figures for the same
 *  definition (Stage 3.3) — commissions are amounts owed to a person, so they
 *  are never rounded. */
export function commissionMoney(n: number): string {
  return n.toLocaleString("en-CA", { style: "currency", currency: "CAD" });
}

/** "2026-08" → "August 2026". Pure string maths on the stored bucket: the
 *  period is already a store-timezone month, so re-parsing it as a Date would
 *  only reintroduce a UTC shift. */
export function periodLabel(period: string): string {
  const [y, m] = period.split("-").map(Number);
  if (!y || !m || m < 1 || m > 12) return period;
  const names = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ];
  return `${names[m - 1]} ${y}`;
}

/** Per-rep pending/paid split — the tab's headline reading. */
export function totalsByRep(rows: CommissionRow[]): RepTotals[] {
  const map = new Map<string, RepTotals>();
  for (const r of rows) {
    const t =
      map.get(r.salesRepId) ??
      map
        .set(r.salesRepId, {
          repId: r.salesRepId,
          repName: r.salesRepName,
          entries: 0,
          pending: 0,
          paid: 0,
          total: 0,
          pendingIds: [],
        })
        .get(r.salesRepId)!;
    t.entries += 1;
    t.total += r.amount;
    if (r.paidAt) t.paid += r.amount;
    else {
      t.pending += r.amount;
      t.pendingIds.push(r.id);
    }
  }
  // Most owed first — the list is a to-pay queue, not an address book.
  return [...map.values()].sort((a, b) => b.pending - a.pending || b.total - a.total);
}
