// WHO a calendar viewer may see, and WHAT they may see about it.
//
// Two questions that used to be one boolean. `getJobsForDay` had a single
// `isAdmin = role === ADMIN || OWNER` flag doing three jobs at once: choosing
// the job scope, choosing whose inventory the missing-kit badge checks, and —
// implicitly — deciding nothing at all about money, because every viewer got the
// same `metadata` block. That block carries `price`, `employeePay`, `totalTip`,
// `parking`, `paymentReceived`, `invoiceSent` and RAW `notes`.
//
// That was survivable only while non-admins saw exclusively their own jobs.
// Stage 7 widens FIELD_LEAD to their whole group (PDF #7), which would have
// handed a Field Lead the billing value of every job their crew works — so the
// widening and the projection land together, and `fieldLeadScopedJobsWhere` is
// deliberately unreachable from the feeds without going through
// `projectCalendarMetadata`.
//
// SERVER-ONLY (`db`, `next/headers`). Not a `"use server"` module: these are
// helpers the two feeds call, not actions a client may invoke.

import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import type { Prisma } from "@prisma/client";
import { sanitizeCleanerNotes } from "@/lib/cleaner-notes";
import { fieldLeadScopedJobsWhere } from "@/lib/cleaner-jobs";
import { fieldLeadGroupIds } from "@/lib/field-lead-group.server";

/**
 * Roles that see the whole company's calendar. Unchanged from the old
 * `isAdmin` — OPS_MANAGER is NOT in here, and this stage does not put it there.
 */
const CALENDAR_ALL_ROLES = ["OWNER", "ADMIN"] as const;

/**
 * Roles allowed to read money on a calendar card.
 *
 * Same two roles, but a SEPARATE list on purpose: "whose jobs" and "how much"
 * are different questions, and the next role that needs one of them should not
 * silently inherit the other. OPS_MANAGER loses the card's price label here and
 * keeps full figures in the job drawer, which is still gated to
 * OWNER/ADMIN/OPS_MANAGER by `getJobSummary`.
 */
const CALENDAR_MONEY_ROLES = ["OWNER", "ADMIN"] as const;

export type CalendarScope =
  | { kind: "ALL" }
  | { kind: "GROUP"; memberIds: string[] }
  | { kind: "SELF" };

export interface CalendarViewer {
  viewerId: string;
  role: string | undefined;
  scope: CalendarScope;
  /**
   * May this viewer see prices, cleaner pay, tips, parking and payment state?
   * When false, `projectCalendarMetadata` nulls all of them and sanitizes notes.
   */
  canSeeMoney: boolean;
  /**
   * Should the missing-equipment badge check EVERY assigned cleaner's kit rather
   * than just the viewer's own? True for the company calendar and for a Field
   * Lead's group calendar — in both cases the jobs on screen are already scoped,
   * so this only ever reads kits the viewer is entitled to know about.
   */
  allAssignedCleaners: boolean;
}

/**
 * Resolve the viewer once per request. Throws on a missing session so a feed can
 * never fall through to an unscoped query.
 */
export async function resolveCalendarViewer(): Promise<CalendarViewer> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new Error("Unauthorized");

  const viewerId = session.user.id;
  const role = (session.user as { role?: string }).role;

  const canSeeMoney = !!role && (CALENDAR_MONEY_ROLES as readonly string[]).includes(role);

  if (role && (CALENDAR_ALL_ROLES as readonly string[]).includes(role)) {
    return { viewerId, role, scope: { kind: "ALL" }, canSeeMoney, allAssignedCleaners: true };
  }

  if (role === "FIELD_LEAD") {
    // Resolved SERVER-side from `User.fieldLeadId`. The client never names a
    // group; there is nothing here for it to widen.
    const memberIds = await fieldLeadGroupIds(viewerId);
    return {
      viewerId,
      role,
      scope: { kind: "GROUP", memberIds },
      canSeeMoney,
      allAssignedCleaners: true,
    };
  }

  return { viewerId, role, scope: { kind: "SELF" }, canSeeMoney, allAssignedCleaners: false };
}

/**
 * The job-scope predicate for a resolved viewer, as an AND-able fragment.
 * Returns null for the company-wide scope (nothing to narrow).
 */
export function calendarScopeFilter(
  viewer: CalendarViewer
): Prisma.JobWhereInput | null {
  switch (viewer.scope.kind) {
    case "ALL":
      return null;
    case "GROUP":
      // Fails closed on an empty group — see fieldLeadScopedJobsWhere.
      return fieldLeadScopedJobsWhere(viewer.scope.memberIds);
    case "SELF":
      return {
        OR: [
          { employeeId: viewer.viewerId },
          { cleaners: { some: { id: viewer.viewerId } } },
        ],
      };
  }
}

/**
 * The money/PII fields a calendar event's `metadata` carries, and which of them
 * a non-privileged viewer must not receive.
 *
 * Exported so `scripts/verify-stage7-field-lead.ts` can assert that every one of
 * them is actually handled by the projection below — a field added to
 * `CALENDAR_JOB_SELECT` and to `metadata` but forgotten here would otherwise
 * leak silently.
 */
export const REDACTED_CALENDAR_KEYS = [
  "price",
  "employeePay",
  "totalTip",
  "parking",
  "paymentReceived",
  "invoiceSent",
  // Stage 8 — the customer's hourly RATE is a price, so it is withheld from the
  // same viewers `price` is. `billingType` and `billedHours` deliberately are
  // NOT here: "this job is billed hourly, for 4 hours" is scheduling
  // information a field lead needs and carries no dollar figure.
  "billedHourlyRate",
] as const;

type Metadata = Record<string, unknown>;

/**
 * Strip money and billing text from an event's metadata for viewers who may not
 * see them.
 *
 * NULLED, NOT DELETED. `status-meta.ts::priceLabel` / `payLabel` already return
 * null for a null value, so the card simply stops printing the figure; deleting
 * the keys would change the payload's shape and risk `undefined` reaching a
 * `.toFixed()` somewhere downstream. `notes` goes through
 * `sanitizeCleanerNotes` rather than being nulled, because a genuine access
 * instruction ("side door, dog is friendly") is operational information a lead
 * needs — it is only the machine-generated billing lines that must go.
 */
export function projectCalendarMetadata<T extends Metadata>(
  metadata: T,
  viewer: Pick<CalendarViewer, "canSeeMoney">
): T {
  if (viewer.canSeeMoney) return metadata;
  const out: Metadata = { ...metadata };
  for (const key of REDACTED_CALENDAR_KEYS) out[key] = null;
  out.notes = sanitizeCleanerNotes(
    typeof metadata.notes === "string" ? metadata.notes : null
  );
  return out as T;
}
