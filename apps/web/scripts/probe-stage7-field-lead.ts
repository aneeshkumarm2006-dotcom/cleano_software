/**
 * READ-ONLY probe for Stage 7 (Field Lead group views, PDF #7).
 *
 * `verify-stage7-field-lead.ts` proves the RULES; this reports the DATA those
 * rules will meet — how many Field Lead groups exist, whether the role and the
 * tier agree on who a lead is, and what a lead's fortnight actually contains. It
 * exists because the two "field lead" columns are independent (`User.role` puts
 * someone in the admin app; `User.cleanerTier` makes them pickable as a group's
 * lead), so a group can exist whose lead never sees /admin/my-team, and that is
 * a data condition, not a code bug.
 *
 * PERFORMS NO WRITES. Safe to run against production.
 *
 * Run: npx tsx scripts/probe-stage7-field-lead.ts
 */
import { db } from "../src/db";
import {
  fieldLeadGroupIds,
  fieldLeadGroupMembers,
} from "../src/lib/field-lead-group.server";
import { fieldLeadScopedJobsWhere } from "../src/lib/cleaner-jobs";
import { addStoreDays, storeDateKey, storeDayRange } from "../src/lib/timezone";
import { SCHEDULE_HORIZON_DAYS } from "../src/app/admin/actions/getMyTeam.types";

async function main() {
  console.log("── Roles vs tiers ───────────────────────────────────────────");
  const [roleLeads, tierLeads] = await Promise.all([
    db.user.findMany({
      where: { role: "FIELD_LEAD", deletedAt: null },
      select: { id: true, name: true, cleanerTier: true },
      orderBy: { name: "asc" },
    }),
    db.user.findMany({
      where: { cleanerTier: "FIELD_LEAD", deletedAt: null },
      select: { id: true, name: true, role: true },
      orderBy: { name: "asc" },
    }),
  ]);
  console.log(`role = FIELD_LEAD:       ${roleLeads.length}`);
  console.log(`cleanerTier = FIELD_LEAD: ${tierLeads.length}`);

  console.log("\n── Groups that actually exist (someone points at them) ──────");
  const owners = await db.user.findMany({
    where: { deletedAt: null, groupMembers: { some: { deletedAt: null } } },
    select: {
      id: true,
      name: true,
      role: true,
      cleanerTier: true,
      _count: { select: { groupMembers: true } },
    },
    orderBy: { name: "asc" },
  });

  if (owners.length === 0) {
    console.log(
      "NONE. No cleaner has a fieldLeadId set, so every My Team page would render\n" +
        "its empty state. Assign cleaners to a lead from Employees before demoing\n" +
        "this stage. (The empty state is correct behaviour, not a failure — and\n" +
        "`fieldLeadScopedJobsWhere([])` is asserted to match nothing, so an empty\n" +
        "group can never fall through to the whole company's schedule.)"
    );
  }

  const { start } = storeDayRange(new Date());
  const end = addStoreDays(start, SCHEDULE_HORIZON_DAYS);

  for (const owner of owners) {
    const reachesPage = owner.role === "FIELD_LEAD";
    const [ids, members] = await Promise.all([
      fieldLeadGroupIds(owner.id),
      fieldLeadGroupMembers(owner.id),
    ]);
    const jobCount = await db.job.count({
      where: {
        AND: [
          fieldLeadScopedJobsWhere(ids),
          { status: { not: "CANCELLED" } },
          {
            OR: [
              { jobDate: { gte: start, lt: end } },
              { startTime: { gte: start, lt: end } },
            ],
          },
        ],
      },
    });
    const [slots, exceptions] = await Promise.all([
      db.employeeAvailability.count({ where: { employeeId: { in: ids } } }),
      db.availabilityException.count({
        where: { employeeId: { in: ids }, date: { gte: start } },
      }),
    ]);

    console.log(
      `\n${owner.name}  (role=${owner.role}, tier=${owner.cleanerTier})\n` +
        `  members (incl. lead): ${members.length}   direct reports: ${owner._count.groupMembers}\n` +
        `  jobs in next ${SCHEDULE_HORIZON_DAYS}d:  ${jobCount}\n` +
        `  weekly availability rows: ${slots}   upcoming blocked dates: ${exceptions}\n` +
        `  reaches /admin/my-team: ${reachesPage ? "YES" : "NO — role is not FIELD_LEAD"}`
    );
    if (!reachesPage) {
      console.log(
        `  ⚠ This group's lead has tier FIELD_LEAD but role ${owner.role}. The page\n` +
          `    gates on ROLE (that is what admits someone to /admin/*), so this lead\n` +
          `    cannot open it. Either set their role to FIELD_LEAD, or an OWNER/ADMIN\n` +
          `    can inspect the group at /admin/my-team?leadId=${owner.id}`
      );
    }
    if (slots === 0) {
      console.log(
        "  ⚠ Nobody in this group has entered weekly availability, so the\n" +
          "    Availability tab will render its empty state."
      );
    }
  }

  console.log("\n── Sanity: the closed door ──────────────────────────────────");
  // A lead id nobody points at. The predicate must still be satisfiable-by-lead
  // only (the lead is always in their own group), never company-wide.
  const orphan = roleLeads.find((l) => !owners.some((o) => o.id === l.id));
  if (orphan) {
    const ids = await fieldLeadGroupIds(orphan.id);
    const count = await db.job.count({
      where: { AND: [fieldLeadScopedJobsWhere(ids)] },
    });
    const total = await db.job.count({ where: { deletedAt: null } });
    console.log(
      `${orphan.name} has no group. Their scope returns ${count} of ${total} jobs ` +
        `(their own only — NOT all ${total}).`
    );
  } else {
    const count = await db.job.count({
      where: { AND: [fieldLeadScopedJobsWhere([])] },
    });
    const total = await db.job.count({ where: { deletedAt: null } });
    console.log(
      `An EMPTY group id list returns ${count} of ${total} jobs — must be 0.` +
        (count === 0 ? " ✓" : " ✗ FAIL")
    );
    if (count !== 0) process.exitCode = 1;
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
