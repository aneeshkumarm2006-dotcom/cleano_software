// Verification for STAGE 12 of `_ai_context/TODO.md` — the admin all-cleaner
// availability view (cleano_inventory_operations_fixes.pdf #12, p.8).
//
// Run: npx tsx scripts/verify-stage12-availability-view.ts
//
// Four parts, the shape every other verify-* script in this repo uses:
//   1. The PURE day evaluator — the one new rule this stage adds, exercised
//      directly against the four results and the precedence between them.
//   2. The AGREEMENT between it and `evaluateAvailability`. This is the whole
//      risk of the stage: a second reader of the same two tables that quietly
//      disagrees with the one the job form uses. Both now read `rulesForDate`,
//      and the checks below hold them to the same answers.
//   3. The URL CONTRACT, which is what makes the deep link from the job form
//      work — parse ∘ build must be the identity, and a hand-edited URL must be
//      able to widen nothing.
//   4. A SOURCE SWEEP: the page exists and is admin-only, the action authorizes
//      independently, the filtering really happens on the server, the grid is
//      shared rather than duplicated, and the Employees page's own grid is gone.
//
// The database is never touched — this stage adds no migration and no column.

import fs from "node:fs";
import type { AvailabilityDay } from "@prisma/client";
import {
  addDateKeyDays,
  evaluateAvailability,
  rulesForDate,
  startOfWeekDateKey,
  summarizeDayAvailability,
  weekDateKeys,
  type AvailabilityExceptionLite,
  type AvailabilityRuleLite,
} from "../src/lib/availability";
import {
  AVAILABILITY_RESULT_LABEL,
  AVAILABILITY_RESULT_TONE,
  AVAILABILITY_STATUS_FILTERS,
  AVAILABILITY_VIEW_DEFAULTS,
  AVAILABILITY_VIEW_PATH,
  NO_FIELD_LEAD,
  assignmentAvailabilityHref,
  availabilityViewHref,
  isAvailabilityFiltered,
  matchesStatusFilter,
  parseAvailabilityViewQuery,
  type AvailabilityViewQuery,
} from "../src/lib/availability-view";
import { AVAILABILITY_BOARD_MAX_ROWS } from "../src/app/admin/actions/getAvailabilityBoard.types";

let pass = 0;
let fail = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const okv = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${okv ? "PASS" : "FAIL"}  ${name}`);
  if (!okv) {
    console.log(
      `        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`
    );
  }
  okv ? pass++ : fail++;
}
const ok = (n: string, c: boolean) => check(n, c, true);

const read = (p: string) => fs.readFileSync(p, "utf8");
const has = (name: string, path: string, needle: string) =>
  ok(name, read(path).includes(needle));
const lacks = (name: string, path: string, needle: string) =>
  ok(name, !read(path).includes(needle));

const PAGE = "src/app/admin/availability/page.tsx";
const CLIENT = "src/app/admin/availability/AvailabilityBoardClient.tsx";
const ACTION = "src/app/admin/actions/getAvailabilityBoard.ts";
const TYPES = "src/app/admin/actions/getAvailabilityBoard.types.ts";
const GRID = "src/components/admin/AvailabilityWeekGrid.tsx";
const OVERVIEW = "src/app/admin/employees/AvailabilityOverview.tsx";
const EMPLOYEES = "src/app/admin/employees/page.tsx";
const SIDEBAR = "src/app/admin/Sidebar.tsx";
const INDICATORS = "src/components/admin/AssignmentIndicators.tsx";
const JOB_MODAL = "src/app/admin/jobs/JobModal.tsx";
const SELECTOR = "src/app/admin/jobs/new/CleanerSelector.tsx";
const MY_TEAM = "src/app/admin/my-team/MyTeamClient.tsx";
const AVAILABILITY_LIB = "src/lib/availability.ts";

/* ═══════════════ 1. THE DAY EVALUATOR ═════════════════════════════════════ */
// 2026-08-18 is a Tuesday; 2026-08-17 the Monday before it.

const rule = (
  day: AvailabilityDay,
  startTime: string,
  endTime: string,
  isAvailable = true,
  extra: Partial<AvailabilityRuleLite> = {}
): AvailabilityRuleLite => ({ day, startTime, endTime, isAvailable, ...extra });

const TUE = "2026-08-18";
const MON = "2026-08-17";
const WORKING_WEEK: AvailabilityRuleLite[] = [
  rule("MONDAY", "09:00", "17:00"),
  rule("TUESDAY", "09:00", "12:00"),
];

check(
  "an open weekday is AVAILABLE and reports its hours",
  summarizeDayAvailability(TUE, WORKING_WEEK),
  {
    result: "AVAILABLE",
    reason: null,
    blockedDate: false,
    windows: [{ startTime: "09:00", endTime: "12:00" }],
  }
);

// The question the day view exists to answer, and the reason it is not
// `evaluateAvailability` with a 00:00–23:59 window: that would report
// OUTSIDE_HOURS for this exact cleaner, on a day they plainly work.
check(
  "...where a whole-day WINDOW would have reported OUTSIDE_HOURS instead",
  evaluateAvailability(
    { dateKey: TUE, startTime: "00:00", endTime: "23:59" },
    WORKING_WEEK
  ).result,
  "OUTSIDE_HOURS"
);

check(
  "a weekday with no rule is OUTSIDE_HOURS, and names the day",
  summarizeDayAvailability("2026-08-19", WORKING_WEEK),
  {
    result: "OUTSIDE_HOURS",
    reason: "No availability set for Wednesday",
    blockedDate: false,
    windows: [],
  }
);

check(
  "a cleaner with no rules at all is NO_DATA, never 'unavailable'",
  summarizeDayAvailability(TUE, []),
  { result: "NO_DATA", reason: null, blockedDate: false, windows: [] }
);

// A day-level question has no window to miss, so an explicitly-off day is
// UNAVAILABLE here even though `evaluateAvailability` can answer OUTSIDE_HOURS
// for a window that doesn't touch the blocked slot.
check(
  "a day marked unavailable is UNAVAILABLE",
  summarizeDayAvailability(TUE, [rule("TUESDAY", "09:00", "12:00", false)]),
  {
    result: "UNAVAILABLE",
    reason: "Marked unavailable on Tuesday",
    blockedDate: false,
    windows: [],
  }
);
check(
  "...where the windowed evaluator, missing the slot, would say OUTSIDE_HOURS",
  evaluateAvailability(
    { dateKey: TUE, startTime: "18:00", endTime: "19:00" },
    [rule("TUESDAY", "09:00", "12:00", false)]
  ).result,
  "OUTSIDE_HOURS"
);

const BLOCKED: AvailabilityExceptionLite[] = [
  { date: TUE, reason: "Vacation" },
];
check(
  "a blocked date BEATS the weekly rule and carries the reason",
  summarizeDayAvailability(TUE, WORKING_WEEK, BLOCKED),
  {
    result: "UNAVAILABLE",
    reason: "Blocked date — Vacation",
    blockedDate: true,
    windows: [],
  }
);
check(
  "...a reasonless block still reads as time off, not as a data gap",
  summarizeDayAvailability(TUE, WORKING_WEEK, [{ date: TUE, reason: null }])
    .reason,
  "Blocked date (time off)"
);
check(
  "...and the block only lands on ITS OWN date",
  summarizeDayAvailability(MON, WORKING_WEEK, BLOCKED).result,
  "AVAILABLE"
);

// Effective ranges are the subtlest way a second grid could have drifted: a
// reader that forgot them would advertise hours the rule has already expired
// out of, while the job form refused the same booking.
const EXPIRED = [rule("TUESDAY", "09:00", "12:00", true, { effectiveTo: "2026-08-01" })];
check(
  "an expired rule does not apply",
  summarizeDayAvailability(TUE, EXPIRED).result,
  "OUTSIDE_HOURS"
);
const FUTURE = [
  rule("TUESDAY", "09:00", "12:00", true, { effectiveFrom: "2026-09-01" }),
];
check(
  "a not-yet-effective rule does not apply either",
  summarizeDayAvailability(TUE, FUTURE).result,
  "OUTSIDE_HOURS"
);

check(
  "windows come back in clock order",
  summarizeDayAvailability(TUE, [
    rule("TUESDAY", "13:00", "17:00"),
    rule("TUESDAY", "09:00", "12:00"),
  ]).windows,
  [
    { startTime: "09:00", endTime: "12:00" },
    { startTime: "13:00", endTime: "17:00" },
  ]
);

check(
  "a malformed date key is NO_DATA, not a guess",
  summarizeDayAvailability("18-08-2026", WORKING_WEEK).result,
  "NO_DATA"
);

/* ═══════════════ 2. ONE RULE SET, TWO QUESTIONS ═══════════════════════════ */
// The drift guard. Both evaluators must read the SAME rules for a date.

check(
  "rulesForDate picks the weekday's rule and nothing else",
  rulesForDate(TUE, WORKING_WEEK).map((r) => r.day),
  ["TUESDAY"]
);
check("...and drops an expired one", rulesForDate(TUE, EXPIRED), []);
check("...and a not-yet-effective one", rulesForDate(TUE, FUTURE), []);
check("...and answers nothing for a junk key", rulesForDate("nope", WORKING_WEEK), []);

ok(
  "both evaluators read the shared helper — the duplicated filter block is gone",
  (read(AVAILABILITY_LIB).match(/rulesForDate\(/g) ?? []).length >= 3
);

// The same three situations, asked both ways. A disagreement here is the bug
// this stage's extraction exists to make impossible.
ok(
  "an in-hours window agrees with an available day",
  summarizeDayAvailability(TUE, WORKING_WEEK).result === "AVAILABLE" &&
    evaluateAvailability(
      { dateKey: TUE, startTime: "09:00", endTime: "12:00" },
      WORKING_WEEK
    ).result === "AVAILABLE"
);
ok(
  "a blocked date is UNAVAILABLE in both, and flagged as a block in both",
  (() => {
    const day = summarizeDayAvailability(TUE, WORKING_WEEK, BLOCKED);
    const win = evaluateAvailability(
      { dateKey: TUE, startTime: "09:00", endTime: "12:00" },
      WORKING_WEEK,
      BLOCKED
    );
    return (
      day.result === win.result &&
      day.blockedDate &&
      win.blockedDate &&
      day.reason === win.reason
    );
  })()
);
ok(
  "an expired rule leaves the day ruleless for both",
  summarizeDayAvailability(TUE, EXPIRED).result === "OUTSIDE_HOURS" &&
    evaluateAvailability(
      { dateKey: TUE, startTime: "09:00", endTime: "12:00" },
      EXPIRED
    ).result === "OUTSIDE_HOURS"
);
ok(
  "neither invents availability for a cleaner who entered none",
  summarizeDayAvailability(TUE, []).result === "NO_DATA" &&
    evaluateAvailability(
      { dateKey: TUE, startTime: "09:00", endTime: "12:00" },
      []
    ).result === "NO_DATA"
);

/* ═══════════════ 3. CIVIL DATE ARITHMETIC ═════════════════════════════════ */
// Pure calendar maths on a UTC proxy. A date key is a civil date, not an
// instant — running it through a timezone is what puts a week grid a day out.

check("a day forward", addDateKeyDays("2026-08-17", 1), "2026-08-18");
check("a day back", addDateKeyDays("2026-08-17", -1), "2026-08-16");
check("across a month boundary", addDateKeyDays("2026-08-31", 1), "2026-09-01");
check("across a year boundary", addDateKeyDays("2026-12-31", 1), "2027-01-01");
check("through a leap day", addDateKeyDays("2028-02-28", 1), "2028-02-29");
check("a junk key yields null, not a plausible date", addDateKeyDays("nope", 1), null);

check("Monday is its own week start", startOfWeekDateKey("2026-08-17"), "2026-08-17");
check("Tuesday rolls back to Monday", startOfWeekDateKey("2026-08-18"), "2026-08-17");
// The rotation that a naive `-getUTCDay()` gets wrong: Sunday belongs to the
// week that STARTED six days earlier, not to the one about to begin.
check("Sunday belongs to the week that started six days ago", startOfWeekDateKey("2026-08-23"), "2026-08-17");
check("...the Sunday before is a different week", startOfWeekDateKey("2026-08-16"), "2026-08-10");
check("a junk key has no week", startOfWeekDateKey("2026-8-1"), null);

check("a week is seven consecutive days, Mon…Sun", weekDateKeys("2026-08-19"), [
  "2026-08-17",
  "2026-08-18",
  "2026-08-19",
  "2026-08-20",
  "2026-08-21",
  "2026-08-22",
  "2026-08-23",
]);
ok(
  "every day of that week yields the same seven keys",
  weekDateKeys("2026-08-17").join() === weekDateKeys("2026-08-23").join()
);
// North-American DST moves on 2026-03-08 and 2026-11-01. Civil arithmetic must
// not notice — a 23- or 25-hour day is still one day on the calendar.
check(
  "a spring-forward week is still seven distinct days",
  weekDateKeys("2026-03-08").length,
  7
);
check(
  "...and so is a fall-back week",
  new Set(weekDateKeys("2026-11-01")).size,
  7
);
check("a junk key has no week days", weekDateKeys("nope"), []);

/* ═══════════════ 4. THE URL CONTRACT ══════════════════════════════════════ */

check("an empty query is the defaults", parseAvailabilityViewQuery({}), AVAILABILITY_VIEW_DEFAULTS);
check(
  "the bare href is the bare path — defaults are never spelled out",
  availabilityViewHref({}),
  AVAILABILITY_VIEW_PATH
);
check(
  "...and neither are values that happen to equal a default",
  availabilityViewHref({ view: "week", status: "all", includeInactive: false }),
  AVAILABILITY_VIEW_PATH
);

// Junk in the URL widens nothing and breaks nothing.
check(
  "a malformed date is dropped",
  parseAvailabilityViewQuery({ date: "18/08/2026" }).date,
  null
);
check(
  "a malformed time is dropped",
  parseAvailabilityViewQuery({ from: "9am" }).from,
  null
);
check(
  "an out-of-range time is dropped",
  parseAvailabilityViewQuery({ from: "25:00" }).from,
  null
);
check(
  "an unknown view falls back to the week grid",
  parseAvailabilityViewQuery({ view: "gantt" }).view,
  "week"
);
check(
  "an unknown status falls back to everyone",
  parseAvailabilityViewQuery({ status: "maybe" }).status,
  "all"
);
check(
  "a category outside the catalog is dropped",
  parseAvailabilityViewQuery({ category: "PLUMBING" }).category,
  null
);
// Permissions are stored on the canonical move key, so the filter has to fold
// the same way or a legacy MOVE_IN link would match nobody.
check(
  "the move family folds onto the canonical key",
  parseAvailabilityViewQuery({ category: "MOVE_IN" }).category,
  "MOVE_IN_OUT"
);
check(
  "...case-insensitively",
  parseAvailabilityViewQuery({ category: "deep" }).category,
  "DEEP"
);
// An end without a start is not a window: left in, the day view would silently
// evaluate 00:00–12:00 and call the morning crew unavailable.
check(
  "an end time with no start is dropped",
  parseAvailabilityViewQuery({ to: "12:00" }).to,
  null
);
check(
  "...and so is the `to` half of a pair whose `from` is junk",
  parseAvailabilityViewQuery({ from: "nope", to: "12:00" }).to,
  null
);
// An inverted window isn't one either: `evaluateAvailability` would clamp it to
// a zero-length probe at the start time and answer a question nobody asked.
check(
  "an end BEFORE its start is dropped, keeping the start",
  parseAvailabilityViewQuery({ from: "14:00", to: "09:00" }),
  { ...AVAILABILITY_VIEW_DEFAULTS, from: "14:00" }
);
check(
  "...and a zero-length window is dropped too",
  parseAvailabilityViewQuery({ from: "09:00", to: "09:00" }).to,
  null
);
check(
  "the builder applies the same rule, so parse ∘ build stays the identity",
  availabilityViewHref({ from: "14:00", to: "09:00" }),
  `${AVAILABILITY_VIEW_PATH}?from=14%3A00`
);
check(
  "a search string is trimmed",
  parseAvailabilityViewQuery({ q: "  sarah  " }).q,
  "sarah"
);
check(
  "...and capped before it reaches a `contains` query",
  parseAvailabilityViewQuery({ q: "x".repeat(400) }).q.length,
  80
);
check(
  "an array param takes its first value rather than stringifying",
  parseAvailabilityViewQuery({ view: ["day", "week"] }).view,
  "day"
);
check(
  "the deactivated toggle reads both spellings",
  [
    parseAvailabilityViewQuery({ inactive: "1" }).includeInactive,
    parseAvailabilityViewQuery({ inactive: "true" }).includeInactive,
    parseAvailabilityViewQuery({ inactive: "0" }).includeInactive,
  ],
  [true, true, false]
);

/** href → the search params a Next.js page would hand the parser. */
function paramsOf(href: string): Record<string, string> {
  const qs = href.includes("?") ? href.slice(href.indexOf("?") + 1) : "";
  return Object.fromEntries(new URLSearchParams(qs));
}
function roundTrips(q: AvailabilityViewQuery): boolean {
  return (
    JSON.stringify(parseAvailabilityViewQuery(paramsOf(availabilityViewHref(q)))) ===
    JSON.stringify(q)
  );
}

// parse ∘ build = identity. This is what makes the job form's deep link work:
// a link that builds a param the page then ignores fails silently, because a
// page with an unread filter still renders perfectly — just wrongly.
ok(
  "a fully-loaded query survives the round trip",
  roundTrips({
    view: "day",
    date: "2026-08-18",
    from: "09:00",
    to: "12:00",
    q: "sarah",
    category: "DEEP",
    lead: "lead_123",
    status: "available",
    includeInactive: true,
  })
);
ok("...and the defaults do too", roundTrips(AVAILABILITY_VIEW_DEFAULTS));
ok(
  "...and the job form's own link shape does",
  roundTrips({
    ...AVAILABILITY_VIEW_DEFAULTS,
    view: "day",
    date: "2026-08-18",
    from: "09:00",
    to: "12:00",
  })
);
ok(
  "...and 'no group' survives as a filter rather than as an absent one",
  roundTrips({ ...AVAILABILITY_VIEW_DEFAULTS, lead: NO_FIELD_LEAD })
);

check(
  "the job form's link lands on the day view, on the job's date and window",
  assignmentAvailabilityHref("2026-08-18", "09:00", "12:00"),
  `${AVAILABILITY_VIEW_PATH}?view=day&date=2026-08-18&from=09%3A00&to=12%3A00`
);
check(
  "...with no date there is nothing to pre-filter, so there is no link",
  assignmentAvailabilityHref(null, "09:00", "12:00"),
  null
);
check(
  "...nor for a date that isn't one",
  assignmentAvailabilityHref("today", "09:00"),
  null
);
check(
  "...and a job with no end time still links its start",
  assignmentAvailabilityHref("2026-08-18", "09:00"),
  `${AVAILABILITY_VIEW_PATH}?view=day&date=2026-08-18&from=09%3A00`
);

// The status filter's three positions, and the deliberate hole in the middle:
// NO_DATA is in NEITHER bucket. A cleaner who never filled the form in is
// unknown, not busy, and sweeping them into "not available" would send an admin
// chasing people who are probably free.
check("the filter has exactly three positions", AVAILABILITY_STATUS_FILTERS, [
  "all",
  "available",
  "unavailable",
]);
check(
  "'available' means AVAILABLE and nothing else",
  ["AVAILABLE", "UNAVAILABLE", "OUTSIDE_HOURS", "NO_DATA"].map((r) =>
    matchesStatusFilter(r as never, "available")
  ),
  [true, false, false, false]
);
check(
  "'not available' means the two negative answers — never the unknown one",
  ["AVAILABLE", "UNAVAILABLE", "OUTSIDE_HOURS", "NO_DATA"].map((r) =>
    matchesStatusFilter(r as never, "unavailable")
  ),
  [false, true, true, false]
);
check(
  "'everyone' means everyone",
  ["AVAILABLE", "UNAVAILABLE", "OUTSIDE_HOURS", "NO_DATA"].map((r) =>
    matchesStatusFilter(r as never, "all")
  ),
  [true, true, true, true]
);
ok(
  "every result has a label and a badge tone — no surface invents wording",
  (["AVAILABLE", "UNAVAILABLE", "OUTSIDE_HOURS", "NO_DATA"] as const).every(
    (r) => !!AVAILABILITY_RESULT_LABEL[r] && !!AVAILABILITY_RESULT_TONE[r]
  )
);

check(
  "an unfiltered query offers nothing to clear",
  isAvailabilityFiltered(AVAILABILITY_VIEW_DEFAULTS),
  false
);
check(
  "...and a date alone is navigation, not a filter",
  isAvailabilityFiltered({ ...AVAILABILITY_VIEW_DEFAULTS, date: "2026-08-18" }),
  false
);
check(
  "...but a time window is",
  isAvailabilityFiltered({ ...AVAILABILITY_VIEW_DEFAULTS, from: "09:00" }),
  true
);
check(
  "...as is each of the PDF's four roster filters",
  [
    isAvailabilityFiltered({ ...AVAILABILITY_VIEW_DEFAULTS, q: "sarah" }),
    isAvailabilityFiltered({ ...AVAILABILITY_VIEW_DEFAULTS, category: "DEEP" }),
    isAvailabilityFiltered({ ...AVAILABILITY_VIEW_DEFAULTS, lead: "x" }),
    isAvailabilityFiltered({ ...AVAILABILITY_VIEW_DEFAULTS, status: "available" }),
  ],
  [true, true, true, true]
);

/* ═══════════════ 5. SOURCE SWEEP ══════════════════════════════════════════ */

/* 12.1 — the page exists, and is admin-only at BOTH ends. */
has("the page guards OWNER/ADMIN", PAGE, "await requireOwnerAdmin()");
has(
  "the action authorizes independently — a server action is its own endpoint",
  ACTION,
  "const gate = await requireOwnerAdmin();"
);
has("...from action-guards, not the page guard", ACTION, '@/lib/action-guards');
has("the nav entry exists", SIDEBAR, 'href: "/admin/availability"');
ok(
  "...and carries adminOnly, matching the page's own gate",
  /href: "\/admin\/availability",[\s\S]{0,160}adminOnly: true/.test(read(SIDEBAR))
);
// A FIELD_LEAD's group view is /admin/my-team. Admitting one here would hand a
// lead every other group's roster. (The role appears in the file only as part of
// WHOSE availability is listed — a Field Lead is a cleaner with a crew — never
// as a branch deciding who may read it.)
lacks("no Field Lead authorization branch", ACTION, 'role === "FIELD_LEAD"');
lacks("...and no role check outside the one gate", ACTION, "gate.role");
// Availability is a scheduling fact. Nothing on this page needs money.
lacks("no pay multiplier is selected", ACTION, "payMultiplier");
lacks("no hourly rate is selected", ACTION, "hourlyRate");
lacks("no job price is selected", ACTION, "price:");
lacks("...and the payload cannot carry one", TYPES, "price:");

/* 12.2 — two views, one extracted grid. */
has("the grid is shared, not duplicated", CLIENT, "AvailabilityWeekGrid");
has("...and the collapsed card renders the same component", OVERVIEW, "AvailabilityWeekGrid");
lacks("...and no longer carries a table of its own", OVERVIEW, "<table");
has("the week grid can be dated", GRID, "week?: AvailabilityGridDay[]");
has(
  "...and a dated cell strikes through a blocked date",
  GRID,
  'className="line-through"'
);
has("the day view runs the day evaluator", ACTION, "summarizeDayAvailability(dateKey, rules, blocks)");
has(
  "...and a time window runs the JOB FORM's evaluator verbatim",
  ACTION,
  "evaluateAvailability("
);
has("exceptions are applied to the day", ACTION, "availabilityException.findMany");
has(
  "...scoped to the visible week, so a dated cell can strike the right day",
  ACTION,
  "date: { in: weekDates }"
);
has(
  "effective ranges are fetched, so the grid can't advertise expired hours",
  ACTION,
  "effectiveFrom: true"
);

/* 12.3 — the PDF's five filters, applied on the server. */
has("cleaner search", ACTION, 'contains: query.q, mode: "insensitive"');
has("service category", ACTION, "allowedServiceCategories: { hasSome: wanted }");
has(
  "...honouring rule 1 — an empty permission list means EVERY category",
  ACTION,
  "allowedServiceCategories: { isEmpty: true }"
);
has(
  "...and folding the move family, which is one permission",
  ACTION,
  "MOVE_CANONICAL"
);
has("Field Lead group", ACTION, "where.fieldLeadId = query.lead");
has("...including the ungrouped", ACTION, "where.fieldLeadId = null");
has("availability status", ACTION, "matchesStatusFilter(day.result, query.status)");
has("date", ACTION, "const dateKey = query.date ?? todayKey;");
// "Server-filter, don't ship the whole roster to the client" — the status
// filter is the output of an evaluator, not a column, so it cannot be SQL. It
// is still applied here, before the payload is built.
lacks(
  "the client never re-filters — the rows it receives are the rows it shows",
  CLIENT,
  "matchesStatusFilter"
);
ok(
  "the roster query is bounded, and knows when it truncated",
  read(ACTION).includes("take: AVAILABILITY_BOARD_MAX_ROWS + 1") &&
    read(ACTION).includes("cleaners.length > AVAILABILITY_BOARD_MAX_ROWS") &&
    AVAILABILITY_BOARD_MAX_ROWS === 300
);
has("...and says so rather than truncating silently", CLIENT, "board.truncated");

/* 12.4 — read-only, with deep links to the profile editor. */
has(
  "every row links to the profile's availability tab",
  CLIENT,
  "`/admin/employees/${row.employeeId}?tab=availability`"
);
has("...and so does every name in the grid", GRID, "?tab=availability");
has("the page says it is read-only", CLIENT, "This view is read-only.");
// Decision D12: read-only v1. No write action is reachable from this surface.
lacks("no availability write action is imported", CLIENT, "setAvailability");
lacks("...nor an exception write", CLIENT, "availabilityExceptions");
lacks("...and the action writes nothing", ACTION, "db.user.update");
lacks("...nothing at all", ACTION, "db.employeeAvailability.upsert");

/* 12.5 — the booking flow links in. */
has("the advisory module owns the link", INDICATORS, "export function AvailabilityLink");
has(
  "...and builds it through the shared contract, never by hand",
  INDICATORS,
  "assignmentAvailabilityHref(date, startTime, endTime)"
);
lacks(
  "...so the path is never spelled out at the calling end",
  INDICATORS,
  '"/admin/availability'
);
has("the New Job form renders it", SELECTOR, "<AvailabilityLink");
has("...on the date the form is holding", SELECTOR, "date={formWindow.startDate}");
has("the Jobs/Calendar modal renders it too", JOB_MODAL, "<AvailabilityLink");
has("...on the date it is holding", JOB_MODAL, "date={watchedStartDate}");
// Above the panel, not inside it: the panel exists only when something is
// wrong, and the moment an admin needs to hunt for coverage is before anyone is
// picked — when the panel renders nothing at all.
ok(
  "the link sits ABOVE the warning panel in the New Job form",
  read(SELECTOR).indexOf("<AvailabilityLink") <
    read(SELECTOR).indexOf("<AssignmentWarningPanel")
);
ok(
  "...and above it in the modal",
  read(JOB_MODAL).indexOf("<AvailabilityLink") <
    read(JOB_MODAL).indexOf("<AssignmentWarningPanel")
);

/* 12.6 — one grid, not two. */
lacks(
  "the Employees page no longer renders its own availability grid",
  EMPLOYEES,
  "<AvailabilityOverview"
);
lacks(
  "...and no longer runs the two queries that fed it",
  EMPLOYEES,
  "db.employeeAvailability.findMany"
);
lacks("...nor the blocked-date one", EMPLOYEES, "db.availabilityException.findMany");
has("...it links to the central view instead", EMPLOYEES, "AVAILABILITY_VIEW_PATH");
// The Field Lead's group-scoped copy stays: it is the ONLY availability view a
// lead can open, and /admin/availability bounces them.
has("the Field Lead's group view still renders the card", MY_TEAM, "<AvailabilityOverview");
has("...with profile links off, because that page bounces a lead", MY_TEAM, "linkProfiles={false}");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
