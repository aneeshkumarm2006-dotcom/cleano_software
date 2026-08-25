// NOT "use server" any more — see the note under "ROLE GATING" below and the
// full write-up in src/lib/chatUnread.ts. This is now a plain server module
// whose only caller is the GET handler at
// src/app/api/admin/attention-counts/route.ts.

import { db } from "@/lib/org-db";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";

/**
 * Every count behind a sidebar attention badge, in ONE batched round trip
 * (awerfixes.pdf item 11 — sidebar notification badges).
 *
 * Replaces the per-badge 5s pollers. The badges are STATUS-BASED, not
 * read-tracked: a row counts while it sits in an actionable state and stops
 * counting the moment an admin advances it. That is why no read-marker table
 * was added — resolving the thing IS marking it read.
 *
 * ROLE GATING LIVES HERE, not only in the nav. `Sidebar.tsx` hides `adminOnly`
 * entries from OPS_MANAGER / FIELD_LEAD, but this is reached through an
 * independently callable HTTP endpoint (it used to be an independently callable
 * server action — same exposure, see the note atop src/lib/action-guards.ts) —
 * without the branch below, those two roles could read a count for a page that
 * would bounce them. The split matches each destination page's own guard exactly:
 *
 *   all four admin roles → /admin/requests, /admin/job-applications,
 *                          /admin/quotes, /admin/documents
 *   OWNER/ADMIN only     → /admin/leads, /admin/payouts, /admin/inventory
 *
 * Never throws. A badge must not take down the page it decorates, so every
 * failure path returns ZERO — same contract as src/lib/jobChatUnread.ts.
 */
export interface AdminAttentionCounts {
  /** Customer-portal cancellation + reschedule requests still awaiting a decision. */
  requests: number;
  /** Careers applications nobody has triaged yet. */
  applications: number;
  /** Quote requests nobody has contacted yet. */
  quotes: number;
  /** The VIEWER'S OWN unsigned documents — see the note in the query below. */
  documents: number;
  /** Booking leads nobody has contacted yet. */
  leads: number;
  /** Pay periods waiting on an approve/reject decision. */
  payouts: number;
  /** Cleaner supply requests waiting on a resolve. */
  inventory: number;
}

// Module-private. The client-side fallback lives beside the hook in
// src/components/AdminAttentionCounts.tsx, which imports the interface above
// with `import type` so nothing in this file reaches the browser bundle.
const ZERO: AdminAttentionCounts = {
  requests: 0,
  applications: 0,
  quotes: 0,
  documents: 0,
  leads: 0,
  payouts: 0,
  inventory: 0,
};

export async function getAdminAttentionCounts(): Promise<AdminAttentionCounts> {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) return ZERO;

    const role = (session.user as { role?: string }).role;
    const isAdmin =
      role === "OWNER" ||
      role === "ADMIN" ||
      role === "OPS_MANAGER" ||
      role === "FIELD_LEAD";
    if (!isAdmin) return ZERO;
    const isOwnerAdmin = role === "OWNER" || role === "ADMIN";

    const [requests, applications, quotes, documents] = await db.$transaction([
      // Unchanged from the retired getPendingRequestCount: `resolveJobRequest`
      // clears the `*RequestedAt` field on approve/deny, so "field still set"
      // naturally means "still pending". Archived jobs excluded, matching the
      // Requests page.
      db.job.count({
        where: {
          deletedAt: null,
          OR: [
            { cancellationRequestedAt: { not: null } },
            { rescheduleRequestedAt: { not: null } },
          ],
        },
      }),
      // NEW, not PENDING — JobApplicationStatus has no PENDING member. The TODO
      // said "new/unreviewed"; NEW is exactly that, and `updateApplicationStatus`
      // moving a row to CONTACTED is what clears the badge.
      db.jobApplication.count({ where: { status: "NEW", deletedAt: null } }),
      // Likewise QuoteRequestStatus: NEW → CONTACTED clears it.
      db.quoteRequest.count({ where: { status: "NEW", deletedAt: null } }),
      // Scoped to the VIEWER on purpose. /admin/documents is a personal signing
      // queue (`where: { employeeId: session.user.id }`), not an org-wide view,
      // and the cleaner route re-exports that same page. A badge that counted
      // every employee's outstanding signature would show a number the page it
      // decorates never displays.
      db.documentSignature.count({
        where: { employeeId: session.user.id, status: "PENDING" },
      }),
    ]);

    // The three OWNER/ADMIN-only pages. Skipped entirely for OPS_MANAGER and
    // FIELD_LEAD rather than computed-and-discarded — the cheapest query is the
    // one not sent, and nothing leaks.
    let leads = 0;
    let payouts = 0;
    let inventory = 0;
    if (isOwnerAdmin) {
      [leads, payouts, inventory] = await db.$transaction([
        db.lead.count({ where: { status: "NEW", deletedAt: null } }),
        db.payPeriod.count({ where: { status: "PENDING_APPROVAL" } }),
        db.inventoryRequest.count({ where: { status: "PENDING" } }),
      ]);
    }

    return {
      requests,
      applications,
      quotes,
      documents,
      leads,
      payouts,
      inventory,
    };
  } catch {
    return ZERO;
  }
}
