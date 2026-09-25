"use server";

import { Prisma } from "@prisma/client";
import { db } from "@/lib/org-db";
import { requireOwnerAdmin } from "@/lib/action-guards";
import {
  addDateKeyDays,
  dateKeyFromStoredDate,
  dateKeyToStoredDate,
  dayFromDateKey,
  evaluateAvailability,
  summarizeDayAvailability,
  weekDateKeys,
} from "@/lib/availability";
import {
  MOVE_CANONICAL,
  MOVE_FAMILY,
  canonicalPermissionCategory,
} from "@/lib/service-permissions";
import {
  NO_FIELD_LEAD,
  matchesStatusFilter,
  parseAvailabilityViewQuery,
} from "@/lib/availability-view";
import { formatDate, storeCivilDayRange, storeDateKey } from "@/lib/timezone";
import { AVAILABILITY_BOARD_MAX_ROWS } from "./getAvailabilityBoard.types";
import type {
  AvailabilityBoardDTO,
  AvailabilityBoardResult,
  AvailabilityBoardRowDTO,
  AvailabilityBoardWeekDayDTO,
} from "./getAvailabilityBoard.types";

/** Weekday key → the short header the dated grid prints ("Mon 17"). */
function columnLabel(dateKey: string): string {
  // A civil date is not an instant — cross the boundary explicitly rather than
  // handing "2026-08-17" to a formatter, which reads it as UTC midnight and can
  // print the day before in a western timezone.
  return formatDate(storeCivilDayRange(dateKey).start, {
    weekday: "short",
    day: "numeric",
  });
}

/**
 * Everything /admin/availability renders: the roster after the PDF's five
 * filters, each cleaner's weekly rules for the visible week, the one-off blocks
 * inside it, and — for the day view — the selected date evaluated per cleaner.
 *
 * READ-ONLY, and deliberately so (step 12.4 / decision D12): editing stays on
 * the cleaner's own profile. There is no companion `setX` action in this stage,
 * and every row links to `/admin/employees/{id}?tab=availability` instead.
 *
 * ── AUTHORIZATION ──────────────────────────────────────────────────────────
 * OWNER/ADMIN only, checked here as well as on the page. A `"use server"` export
 * is an independently callable endpoint; the page's `requireOwnerAdmin` redirect
 * does nothing for someone who POSTs straight at the action. A Field Lead is NOT
 * admitted — their group-scoped view is /admin/my-team, and widening this would
 * hand one lead every other group's roster.
 *
 * ── WHERE THE FILTERING HAPPENS ────────────────────────────────────────────
 * The four ROSTER filters (search, category, group, deactivated) are SQL, so a
 * 200-cleaner business ships 12 rows and not 200. The fifth — availability
 * status — cannot be: it is the output of the evaluator, not a column. It is
 * applied here, on the server, after evaluation, so the browser still never
 * receives the rows it would have hidden.
 */
export async function getAvailabilityBoard(
  rawParams: Record<string, string | string[] | undefined>
): Promise<AvailabilityBoardResult> {
  const gate = await requireOwnerAdmin();
  if (!gate.ok) return { success: false, error: gate.error };

  try {
    const query = parseAvailabilityViewQuery(rawParams ?? {});
    const todayKey = storeDateKey(new Date());
    // An unparseable or absent `date` lands on today rather than on an error —
    // /admin/availability with no query string is the common entry point.
    const dateKey = query.date ?? todayKey;
    const week = weekDateKeys(dateKey);

    // ── Roster (SQL-filtered) ─────────────────────────────────────────────
    // EMPLOYEE + FIELD_LEAD, matching what the retired Employees-page card
    // counted as "a cleaner". OWNER/ADMIN/OPS_MANAGER keep no availability.
    const roleScope: Prisma.UserWhereInput = {
      role: { in: ["EMPLOYEE", "FIELD_LEAD"] },
    };

    // Two different ways a cleaner leaves the roster, and the toggle covers
    // BOTH — see `OFF_ROSTER` below.
    const offRoster: Prisma.UserWhereInput = {
      OR: [{ deletedAt: { not: null } }, { isActive: false }],
    };

    const where: Prisma.UserWhereInput = {
      ...roleScope,
      /**
       * Off-roster cleaners are out by default: showing one as "Available"
       * invites an admin to book somebody who cannot take the job. The toggle
       * exists because their stored hours are still the record of what they
       * worked.
       *
       * "Off the roster" is TWO states in this product, and the toggle used to
       * cover only one of them:
       *
       *   DEACTIVATED  `isActive: false` — login switched off, row still in the
       *                Employees list. Set by "Deactivate" (bulkSetEmployeeActive).
       *   ARCHIVED     `deletedAt != null` — soft-deleted, moved to Employees →
       *                Archived, restorable. Set by "Archive" (bulkSoftDelete).
       *
       * `deletedAt: null` used to be pinned here unconditionally, so ticking
       * "Include deactivated" only ever relaxed `isActive` — and Archive is the
       * button this business actually presses. The result was a control that
       * changed the URL and nothing else. Both states are the same question
       * ("show me the people who are no longer on the roster"), each row says
       * which one it is, and the page is read-only either way (decision D12).
       */
      ...(query.includeInactive ? {} : { deletedAt: null, isActive: true }),
    };

    if (query.q) {
      where.OR = [
        { name: { contains: query.q, mode: "insensitive" } },
        { email: { contains: query.q, mode: "insensitive" } },
      ];
    }

    if (query.category) {
      // RULE 1 of service-permissions: an EMPTY list means every category is
      // allowed. Filtering with `has` alone would hide every unrestricted
      // cleaner — i.e. the default — from every category filter.
      const wanted =
        canonicalPermissionCategory(query.category) === MOVE_CANONICAL
          ? [...MOVE_FAMILY]
          : [query.category];
      where.AND = [
        {
          OR: [
            { allowedServiceCategories: { isEmpty: true } },
            { allowedServiceCategories: { hasSome: wanted } },
          ],
        },
      ];
    }

    if (query.lead === NO_FIELD_LEAD) where.fieldLeadId = null;
    else if (query.lead) where.fieldLeadId = query.lead;

    const [cleaners, totalCleaners, offRosterCleaners, leadRows] = await Promise.all([
      db.user.findMany({
        where,
        select: {
          id: true,
          name: true,
          cleanerTier: true,
          isActive: true,
          deletedAt: true,
          allowedServiceCategories: true,
          fieldLead: { select: { id: true, name: true } },
        },
        orderBy: { name: "asc" },
        // One over the ceiling, so `truncated` is a fact rather than a guess.
        take: AVAILABILITY_BOARD_MAX_ROWS + 1,
      }),
      db.user.count({ where: { ...roleScope, deletedAt: null, isActive: true } }),
      // How many the toggle has to offer. Counted whether it is on or off, so
      // the footer can say "3 hidden" when it is off and — the case that made
      // the control look broken — "none to show" when it is on and there are
      // none. A filter that cannot report an empty result is indistinguishable
      // from a filter that is not wired up.
      db.user.count({ where: { ...roleScope, ...offRoster } }),
      // The group filter's options. "Is a lead" means SOMEBODY POINTS AT THEM,
      // not `cleanerTier === FIELD_LEAD` — the same definition `listFieldLeads`
      // uses, and the only one that lists every group that actually exists.
      db.user.findMany({
        where: { deletedAt: null, groupMembers: { some: { deletedAt: null } } },
        select: { id: true, name: true },
        orderBy: { name: "asc" },
      }),
    ]);

    const truncated = cleaners.length > AVAILABILITY_BOARD_MAX_ROWS;
    const roster = truncated
      ? cleaners.slice(0, AVAILABILITY_BOARD_MAX_ROWS)
      : cleaners;
    const ids = roster.map((c) => c.id);

    // ── Rules + blocks, two batched queries ───────────────────────────────
    const weekDates = week
      .map((k) => dateKeyToStoredDate(k))
      .filter((d): d is Date => d !== null);

    const [slots, exceptions] =
      ids.length === 0
        ? [[], []]
        : await Promise.all([
            db.employeeAvailability.findMany({
              where: { employeeId: { in: ids } },
              select: {
                employeeId: true,
                day: true,
                startTime: true,
                endTime: true,
                isAvailable: true,
                // Both evaluators honour the effective range; omitting these
                // would make the grid claim hours a rule has already expired out
                // of, and disagree with the job form's own check.
                effectiveFrom: true,
                effectiveTo: true,
              },
            }),
            weekDates.length === 0
              ? Promise.resolve([])
              : db.availabilityException.findMany({
                  where: {
                    employeeId: { in: ids },
                    date: { in: weekDates },
                  },
                  orderBy: { date: "asc" },
                  select: { employeeId: true, date: true, reason: true },
                }),
          ]);

    // ── Evaluate the selected day ─────────────────────────────────────────
    const dayCounts = { available: 0, unavailable: 0, unknown: 0 };
    const rows: AvailabilityBoardRowDTO[] = [];

    for (const cleaner of roster) {
      const rules = slots.filter((s) => s.employeeId === cleaner.id);
      const blocks = exceptions
        .filter((e) => e.employeeId === cleaner.id)
        .map((e) => ({
          date: dateKeyFromStoredDate(e.date),
          reason: e.reason,
        }));

      // Two questions, two evaluators, ONE rule set. With a time window the
      // admin is asking the job form's question ("who can work 9–12?"), so it
      // runs the job form's evaluator verbatim; with no window they are asking
      // a day-level question, which `evaluateAvailability` cannot answer without
      // inventing a window it would then judge people against.
      const summary = summarizeDayAvailability(dateKey, rules, blocks);
      const windowed = query.from !== null;
      const evaluated = windowed
        ? evaluateAvailability(
            {
              dateKey,
              startTime: query.from!,
              // No end time is a zero-length window that still has to touch an
              // open slot — the same contract the New Job form relies on.
              endTime: query.to ?? query.from!,
            },
            rules,
            blocks
          )
        : summary;

      const day = {
        result: evaluated.result,
        reason: evaluated.reason,
        blockedDate: evaluated.blockedDate,
        // The HOURS always come from the day summary, even when the verdict came
        // from a window: a windowed evaluation answers yes/no, and an admin told
        // "no" needs to see which hours would have worked.
        windows: summary.windows,
        windowed,
      };

      if (day.result === "AVAILABLE") dayCounts.available++;
      else if (day.result === "NO_DATA") dayCounts.unknown++;
      else dayCounts.unavailable++;

      if (!matchesStatusFilter(day.result, query.status)) continue;

      rows.push({
        employeeId: cleaner.id,
        employeeName: cleaner.name,
        slots: rules.map((s) => ({
          day: s.day as string,
          startTime: s.startTime,
          endTime: s.endTime,
          isAvailable: s.isAvailable,
        })),
        timeOff: blocks,
        fieldLeadName: cleaner.fieldLead?.name ?? null,
        allowedServiceCategories: cleaner.allowedServiceCategories,
        cleanerTier: cleaner.cleanerTier as string,
        isActive: cleaner.isActive,
        // Distinct from `isActive`: archived is soft-deleted and restorable,
        // deactivated is a switched-off login. Both only ever reach the client
        // with the toggle on, and each gets its own badge — an archived cleaner
        // showing an "Available" verdict must not read as bookable.
        isArchived: cleaner.deletedAt !== null,
        day,
      });
    }

    // ── Calendar chrome ───────────────────────────────────────────────────
    const weekColumns: AvailabilityBoardWeekDayDTO[] = week.map((key) => ({
      dateKey: key,
      day: dayFromDateKey(key) ?? "",
      label: columnLabel(key),
      isToday: key === todayKey,
      isSelected: key === dateKey,
    }));

    const board: AvailabilityBoardDTO = {
      query,
      dateKey,
      dateLabel: formatDate(storeCivilDayRange(dateKey).start, {
        weekday: "long",
        month: "short",
        day: "numeric",
        year: "numeric",
      }),
      isToday: dateKey === todayKey,
      week: weekColumns,
      weekLabel:
        week.length === 7
          ? `${columnLabel(week[0])} – ${columnLabel(week[6])}`
          : "",
      prevWeekDate: addDateKeyDays(dateKey, -7) ?? dateKey,
      nextWeekDate: addDateKeyDays(dateKey, 7) ?? dateKey,
      prevDayDate: addDateKeyDays(dateKey, -1) ?? dateKey,
      nextDayDate: addDateKeyDays(dateKey, 1) ?? dateKey,
      todayDate: todayKey,
      rows,
      fieldLeads: leadRows.map((l) => ({ id: l.id, name: l.name })),
      matchedCleaners: roster.length,
      totalCleaners,
      offRosterCleaners,
      dayCounts,
      truncated,
    };

    return { success: true, board };
  } catch (error) {
    console.error("getAvailabilityBoard", error);
    return { success: false, error: "Could not load availability" };
  }
}
