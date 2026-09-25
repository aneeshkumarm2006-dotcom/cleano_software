"use server";

import { db } from "@/lib/org-db";
import { getActor } from "@/lib/action-guards";
import { fieldLeadScopedJobsWhere } from "@/lib/cleaner-jobs";
import {
  fieldLeadGroupIds,
  fieldLeadGroupMembers,
} from "@/lib/field-lead-group.server";
import { sanitizeCleanerNotes } from "@/lib/cleaner-notes";
import { addressArea, clientFirstName } from "@/lib/team-schedule";
import { jobTypeLabel } from "@/lib/calendar-labels";
import { getServiceCatalogWithLabels } from "@/lib/service-catalog.server";
import {
  addStoreDays,
  formatDate,
  formatTime,
  storeDateKey,
  storeDayRange,
} from "@/lib/timezone";
import { dateKeyFromStoredDate, dateKeyToStoredDate, dateKeyTz } from "@/lib/availability";
import { SCHEDULE_HORIZON_DAYS } from "./getMyTeam.types";
import type {
  MyTeamDTO,
  MyTeamResult,
  TeamAvailabilityRowDTO,
  TeamDayDTO,
  TeamJobDTO,
  TeamMemberDTO,
} from "./getMyTeam.types";

/**
 * Cap on rows returned. A two-week window for a group of six will not come
 * close; the cap exists so a mis-set `fieldLeadId` fan-out can't turn this into
 * an unbounded scan.
 */
const MAX_JOBS = 500;

/**
 * Authorize a My Team read and resolve WHOSE team it is.
 *
 * Two callers, one gate:
 *   • a FIELD_LEAD reading their own group — `leadId` is ignored entirely, so a
 *     lead cannot pass someone else's id and read their crew;
 *   • an OWNER/ADMIN inspecting a specific lead — `leadId` is required, because
 *     "the admin's own group" is not a thing that exists.
 *
 * Every other role is refused, including OPS_MANAGER: this page is a Field
 * Lead's own view, and an ops manager already has the full Employees list.
 */
async function authorize(
  leadId?: string
): Promise<
  | { ok: true; leadId: string; viewingAsAdmin: boolean }
  | { ok: false; error: string }
> {
  const { userId, role } = await getActor();
  if (!userId) return { ok: false, error: "Not authenticated" };

  if (role === "FIELD_LEAD") {
    return { ok: true, leadId: userId, viewingAsAdmin: false };
  }
  if (role === "OWNER" || role === "ADMIN") {
    if (typeof leadId !== "string" || !leadId.trim()) {
      return { ok: false, error: "Pick a Field Lead to view" };
    }
    return { ok: true, leadId: leadId.trim(), viewingAsAdmin: true };
  }
  return { ok: false, error: "Not authorized" };
}

/**
 * Everything the /admin/my-team page renders: the group's members, their next
 * `SCHEDULE_HORIZON_DAYS` of work, and their weekly availability.
 *
 * READ-ONLY, and by design: PDF #7 asks a Field Lead to *see* the group's
 * schedule and availability, and grants no new write permission anywhere. There
 * is no companion `setX` action in this stage — availability writes stay
 * OWNER/ADMIN-only in `setAvailability.ts` / `availabilityExceptions.ts`.
 *
 * Every query below is filtered by `fieldLeadGroupIds`, resolved server-side
 * from `User.fieldLeadId`. The client never supplies an employee id, so there is
 * nothing for it to tamper with; the OWNER/ADMIN debug path supplies a LEAD id,
 * which is then expanded to a group by the same helper.
 *
 * See `./getMyTeam.types.ts` for what this payload must never carry.
 */
export async function getMyTeam(leadId?: string): Promise<MyTeamResult> {
  const gate = await authorize(leadId);
  if (!gate.ok) return { success: false, error: gate.error };

  try {
    const [members, groupIds] = await Promise.all([
      fieldLeadGroupMembers(gate.leadId),
      fieldLeadGroupIds(gate.leadId),
    ]);

    const lead = members.find((m) => m.isLead);
    if (!lead) {
      // The lead's own User row is gone or archived. Not an error the page can
      // do anything with, and definitely not a reason to fall back to a wider
      // scope.
      return { success: false, error: "Field Lead not found" };
    }

    const now = new Date();
    // Store-timezone civil day bounds. A raw `Date` day boundary would be the
    // host's midnight (UTC on Vercel), which puts late-evening jobs on the wrong
    // day — see the timezone discipline note in src/lib/tz-calendar.ts.
    const { start } = storeDayRange(now);
    const end = addStoreDays(start, SCHEDULE_HORIZON_DAYS);
    const todayKey = storeDateKey(now);

    const [{ labels: serviceLabels }, jobs, slots, timeOff] = await Promise.all([
      getServiceCatalogWithLabels(),
      db.job.findMany({
        where: {
          AND: [
            fieldLeadScopedJobsWhere(groupIds),
            // CANCELLED work is not a schedule. It stays out rather than being
            // shown greyed out, matching what `upcomingFilter` does for the
            // cleaner's own surfaces.
            { status: { not: "CANCELLED" } },
            {
              OR: [
                { jobDate: { gte: start, lt: end } },
                { startTime: { gte: start, lt: end } },
              ],
            },
          ],
        },
        // A LEAN, EXPLICIT select — this is the privacy boundary, not the mapper
        // below. Fields the DTO must never carry (price, employeePay, totalTip,
        // parking, paymentReceived, invoiceSent, payType, hourlyRate) are not
        // fetched at all, so they cannot be leaked by a later mapper edit.
        select: {
          id: true,
          jobNumber: true,
          jobDate: true,
          startTime: true,
          endTime: true,
          status: true,
          jobType: true,
          location: true,
          clientName: true,
          notes: true,
          employeeId: true,
          cleaners: { select: { id: true, name: true } },
        },
        orderBy: [{ startTime: "asc" }, { id: "asc" }],
        take: MAX_JOBS,
      }),
      db.employeeAvailability.findMany({
        where: { employeeId: { in: groupIds } },
        select: {
          employeeId: true,
          day: true,
          startTime: true,
          endTime: true,
          isAvailable: true,
        },
      }),
      // Upcoming one-off blocked dates only. These BEAT the weekly rule, so the
      // grid has to show them or it lies about who is free — the same reason
      // AvailabilityOverview carries them on the Employees page.
      (async () => {
        const today = dateKeyToStoredDate(dateKeyTz(now));
        if (!today) return [];
        return db.availabilityException.findMany({
          where: { employeeId: { in: groupIds }, date: { gte: today } },
          orderBy: { date: "asc" },
          select: { employeeId: true, date: true, reason: true },
        });
      })(),
    ]);

    // ── Jobs → per-day buckets ───────────────────────────────────────────────
    const perMember = new Map<string, number>();
    const byDay = new Map<string, TeamJobDTO[]>();

    for (const job of jobs) {
      const when = job.startTime ?? job.jobDate;
      if (!when) continue;
      const dateKey = storeDateKey(when);

      const cleanerIds = new Set(job.cleaners.map((c) => c.id));
      if (job.employeeId) cleanerIds.add(job.employeeId);
      for (const id of cleanerIds) {
        if (groupIds.includes(id)) {
          perMember.set(id, (perMember.get(id) ?? 0) + 1);
        }
      }

      const row: TeamJobDTO = {
        id: job.id,
        jobNumber: job.jobNumber,
        dateKey,
        startLabel: job.startTime ? formatTime(job.startTime) : null,
        endLabel: job.endTime ? formatTime(job.endTime) : null,
        clientFirstName: clientFirstName(job.clientName),
        area: addressArea(job.location),
        serviceType: jobTypeLabel(job.jobType, serviceLabels) || null,
        status: job.status,
        cleanerNames: job.cleaners.map((c) => c.name),
        isMine: cleanerIds.has(gate.leadId),
        // Sanitized SERVER-side so the raw column never reaches the client
        // payload, the same rule the cleaner calendar applies.
        notes: sanitizeCleanerNotes(job.notes),
      };

      const bucket = byDay.get(dateKey);
      if (bucket) bucket.push(row);
      else byDay.set(dateKey, [row]);
    }

    // Pre-seed every civil day in the horizon so an empty day renders as "no
    // jobs" rather than silently vanishing from the list.
    const days: TeamDayDTO[] = [];
    for (let i = 0; i < SCHEDULE_HORIZON_DAYS; i++) {
      const instant = addStoreDays(start, i);
      const dateKey = storeDateKey(instant);
      days.push({
        dateKey,
        label: formatDate(instant, {
          weekday: "short",
          month: "short",
          day: "numeric",
        }),
        isToday: dateKey === todayKey,
        jobs: byDay.get(dateKey) ?? [],
      });
    }

    // ── Availability rows, in the same order as the Members card ─────────────
    const availability: TeamAvailabilityRowDTO[] = members.map((m) => ({
      employeeId: m.id,
      employeeName: m.isLead ? `${m.name} (you)` : m.name,
      slots: slots
        .filter((s) => s.employeeId === m.id)
        .map((s) => ({
          day: s.day as string,
          startTime: s.startTime,
          endTime: s.endTime,
          isAvailable: s.isAvailable,
        })),
      timeOff: timeOff
        .filter((t) => t.employeeId === m.id)
        .map((t) => ({ date: dateKeyFromStoredDate(t.date), reason: t.reason })),
    }));

    const memberDTOs: TeamMemberDTO[] = members.map((m) => ({
      id: m.id,
      name: m.name,
      email: m.email,
      phone: m.phone,
      role: m.role,
      cleanerTier: m.cleanerTier,
      isActive: m.isActive,
      isLead: m.isLead,
      upcomingJobCount: perMember.get(m.id) ?? 0,
    }));

    const team: MyTeamDTO = {
      leadId: gate.leadId,
      leadName: lead.name,
      horizonDays: SCHEDULE_HORIZON_DAYS,
      members: memberDTOs,
      days,
      availability,
      viewingAsAdmin: gate.viewingAsAdmin,
    };

    return { success: true, team };
  } catch (error) {
    console.error("getMyTeam", error);
    return { success: false, error: "Could not load your team" };
  }
}

export interface FieldLeadSummary {
  id: string;
  name: string;
  memberCount: number;
  /** The lead's app role — what decides which app they land in. */
  role: string;
  /**
   * Can this lead open /admin/my-team THEMSELVES?
   *
   * False when they lead a group but their app role is not FIELD_LEAD — the
   * role/tier split described in `field-lead-group.server.ts`. The picker says so
   * out loud, because otherwise an admin sees a healthy-looking group and has no
   * way to know the lead it belongs to cannot reach the page.
   */
  canOpenOwnView: boolean;
}

/**
 * Field Leads an OWNER/ADMIN may inspect via `?leadId=`.
 *
 * Returns an empty list for everyone else — a Field Lead must not be handed a
 * roster of other leads, which would be exactly the cross-group visibility this
 * stage exists to prevent.
 *
 * "Is a lead" here means *someone points at them* (`groupMembers` is non-empty),
 * NOT `cleanerTier === "FIELD_LEAD"` and NOT `role === "FIELD_LEAD"`. That is
 * deliberate: it is the only definition that lists every group that actually
 * exists, including one whose lead cannot open the page for themselves — which
 * `scripts/probe-stage7-field-lead.ts` found to be the case for the sole group in
 * the live database. An admin must be able to see and inspect that group.
 */
export async function listFieldLeads(): Promise<FieldLeadSummary[]> {
  const { role } = await getActor();
  if (role !== "OWNER" && role !== "ADMIN") return [];

  try {
    const rows = await db.user.findMany({
      where: { deletedAt: null, groupMembers: { some: { deletedAt: null } } },
      select: {
        id: true,
        name: true,
        role: true,
        _count: { select: { groupMembers: true } },
      },
      orderBy: { name: "asc" },
    });
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      memberCount: r._count.groupMembers,
      role: r.role as string,
      canOpenOwnView: r.role === "FIELD_LEAD",
    }));
  } catch (error) {
    console.error("listFieldLeads", error);
    return [];
  }
}
