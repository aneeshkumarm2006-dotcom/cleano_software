// Who is in a Field Lead's group — the one database read every group-scoped
// surface authorizes against.
//
// "Group" is `User.fieldLeadId`, a self-relation on User (schema:33). It was
// introduced for the weekly group-revenue bonus and had exactly one consumer
// (`field-lead-bonus.server.ts`), which resolved the membership inline. Stage 7
// adds three more consumers — the My Team page, the calendar scope, and the
// group availability read — so the resolution moved here rather than being
// copied a fourth time. A group-scoping bug in one copy is a privacy bug.
//
// SERVER-ONLY (`db`). The pure where-clause builder that consumes these ids is
// `fieldLeadScopedJobsWhere()` in `src/lib/cleaner-jobs.ts`, which client
// components may import. Same split as `field-lead-bonus.ts` /
// `field-lead-bonus.server.ts` and `inventory-thresholds.ts` / `.server.ts`.
//
// ⚠️ TWO COLUMNS, ONE NAME. `User.role = FIELD_LEAD` is what puts someone in the
// admin app (`isAdminRole`), while `User.cleanerTier = FIELD_LEAD` is what makes
// them selectable as a group's lead in the Employees list. They are independent,
// so a lead is resolved here purely by "who points at me", never by tier —
// otherwise a group would silently empty out the moment an admin changed a tier.

import { db } from "@/db";

export interface FieldLeadGroupMember {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  role: string;
  cleanerTier: string;
  isActive: boolean;
  /** True for the lead's own row, which is always first. */
  isLead: boolean;
  /** Soft-deleted (archived) — only ever true when includeArchived is set. */
  isArchived: boolean;
}

export interface GroupIdsOptions {
  /**
   * Include soft-deleted (archived) members.
   *
   * Default false: an archived cleaner has no upcoming schedule and no
   * availability worth showing a lead.
   *
   * The weekly bonus passes TRUE, and must keep doing so. Its window is
   * historical — a cleaner archived last Tuesday still worked Monday's jobs, and
   * dropping them would quietly reduce a Field Lead's group revenue (and so
   * their pay) for a week they had already earned.
   */
  includeArchived?: boolean;
}

/**
 * The group's user ids, LEAD FIRST.
 *
 * Order is load-bearing for the UI (the lead's own row heads the Members card
 * and the availability grid), and de-duplication matters because a malformed
 * row where a lead points at themselves would otherwise double-count them.
 */
export async function fieldLeadGroupIds(
  leadId: string,
  opts: GroupIdsOptions = {}
): Promise<string[]> {
  if (!leadId) return [];
  const members = await db.user.findMany({
    where: {
      fieldLeadId: leadId,
      ...(opts.includeArchived ? {} : { deletedAt: null }),
    },
    select: { id: true },
  });
  const ids = new Set<string>([leadId]);
  for (const m of members) ids.add(m.id);
  return [...ids];
}

/**
 * The group as rows the Members card can render.
 *
 * NO PAY FIELDS. `payMultiplier`, `ragCredits`/`padCredits` and every money
 * column on User are deliberately not selected — see the privacy note in
 * `src/app/admin/actions/getMyTeam.types.ts`. `cleanerTier` is here because it
 * is a *skill/seniority* label the lead needs when deciding who to send where;
 * the pay percentages attached to a tier live in `src/lib/pay-tiers.ts` and are
 * never sent to this surface.
 */
export async function fieldLeadGroupMembers(
  leadId: string,
  opts: GroupIdsOptions = {}
): Promise<FieldLeadGroupMember[]> {
  if (!leadId) return [];
  const rows = await db.user.findMany({
    where: {
      OR: [{ id: leadId }, { fieldLeadId: leadId }],
      ...(opts.includeArchived ? {} : { deletedAt: null }),
    },
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      role: true,
      cleanerTier: true,
      isActive: true,
      deletedAt: true,
    },
    orderBy: { name: "asc" },
  });

  const mapped = rows.map((r) => ({
    id: r.id,
    name: r.name,
    email: r.email,
    phone: r.phone,
    role: r.role as string,
    cleanerTier: r.cleanerTier as string,
    isActive: r.isActive,
    isLead: r.id === leadId,
    isArchived: r.deletedAt !== null,
  }));

  // Lead first, then the crew alphabetically (the query already sorted by name).
  return [
    ...mapped.filter((m) => m.isLead),
    ...mapped.filter((m) => !m.isLead),
  ];
}

/**
 * THE authorization primitive: may this lead see this employee's data?
 *
 * Every group-scoped read that takes an employee id from the client must pass
 * through here before it queries anything — the UI never gets to be the check.
 *
 * Archived members are allowed on purpose. They were assigned to this lead, the
 * lead may well be looking at last week, and a 403 on someone who is visibly in
 * their group reads as a bug rather than as a boundary.
 */
export async function isFieldLeadGroupMember(
  leadId: string,
  employeeId: string
): Promise<boolean> {
  if (!leadId || !employeeId) return false;
  if (leadId === employeeId) return true;
  const row = await db.user.findFirst({
    where: { id: employeeId, fieldLeadId: leadId },
    select: { id: true },
  });
  return row !== null;
}
