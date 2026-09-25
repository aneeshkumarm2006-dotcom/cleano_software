// Verification for STAGE 13 of `_ai_context/TODO.md` — the cleaner's calendar
// view for available jobs (cleano_inventory_operations_fixes.pdf #13, p.8–9).
//
// Run: npx tsx scripts/verify-stage13-available-jobs-calendar.ts
//
// Five parts, the shape every other verify-* script in this repo uses:
//   1. The PURE grid maths — the only new rules this stage adds — exercised
//      directly over month, year, leap and DST boundaries.
//   2. The AGREEMENT with @/lib/tz-calendar. This stage's standing risk is a
//      second reader of "which day is this job on": the grid keys cells with
//      civilKey and jobs with tzDateKey, and a drift between the two would put a
//      dot one day away from the job it stands for.
//   3. The VIEW CONTRACT — the remembered List | Calendar choice, and what
//      happens to junk in localStorage.
//   4. A SOURCE SWEEP: one card definition rendered by both views, the filters
//      honoured in both, the existing preview/claim flow untouched, and the
//      privacy guard of step 13.5 — the calendar receives *counts*, not jobs.
//   5. CONTRAST + TAP TARGETS (step 13.6), measured rather than eyeballed, with
//      the same self-checking WCAG engine Stage 6 introduced.
//
// The database is never touched — this stage adds no migration, no column and
// no server round-trip.

import fs from "node:fs";
import {
  AVAILABLE_JOBS_VIEWS,
  AVAILABLE_JOBS_VIEW_KEY,
  DAY_DOT_CAP,
  DEFAULT_AVAILABLE_JOBS_VIEW,
  addMonths,
  civilDateFromKey,
  clampMonth,
  countJobsByDay,
  dayDotPlan,
  dayLabel,
  monthGridCells,
  monthKey,
  monthLabel,
  monthNavBounds,
  nextDayKeyWithJobs,
  parseAvailableJobsView,
  sameMonth,
  startOfMonth,
} from "../src/lib/available-jobs-calendar";
import { civilKey, tzDateKey, tzToday } from "../src/lib/tz-calendar";

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

// Absence has to be asserted against CODE, not against the file. This stage's
// components explain in their headers exactly which things they refuse to
// import — so a plain string search would fail on the documentation of the very
// property it is testing. Same helper shape as verify-stage7-field-lead.ts.
const stripComments = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const codeOf = (p: string) => stripComments(read(p));
const lacksInCode = (name: string, path: string, needle: string) =>
  ok(name, !codeOf(path).includes(needle));

const LIB = "src/lib/available-jobs-calendar.ts";
const CLIENT = "src/app/cleaners/available-jobs/AvailableJobsClient.tsx";
const GRID = "src/app/cleaners/available-jobs/AvailableJobsCalendar.tsx";
const PAGE = "src/app/cleaners/available-jobs/page.tsx";
const PREVIEW = "src/app/cleaners/available-jobs/JobPreviewModal.tsx";
const CSS = "src/app/globals.css";

const section = (n: number, title: string) =>
  console.log(`\n═══ ${n}. ${title} ═══\n`);

/* ═══════════════ 1. THE GRID MATHS ════════════════════════════════════════ */

section(1, "Grid maths (steps 13.2, 13.4)");

const keys = (cells: Date[]) => cells.map(civilKey);

// August 2026 is the reference screenshot's month (p.9): the 1st is a Saturday,
// so the grid runs 26 July → 5 September — six full weeks.
const aug = monthGridCells(new Date(2026, 7, 1));
check("August 2026 is six weeks", aug.length, 42);
check("...starting on the Sunday before the 1st", civilKey(aug[0]), "2026-07-26");
check("...and ending on the Saturday after the 31st", civilKey(aug[41]), "2026-09-05");
ok("...every cell is a Sunday-first week", aug.every((d, i) => d.getDay() === i % 7));
ok(
  "...consecutive, with no gap or repeat",
  aug.every((d, i) => i === 0 || +d - +aug[i - 1] > 0)
);

// The row count is derived, not fixed at six. February 2026 starts on a Sunday
// and is exactly four weeks long; a fixed 42 would hand a phone two entire rows
// of dimmed, dot-less March.
const feb = monthGridCells(new Date(2026, 1, 10));
check("February 2026 is four weeks, not six", feb.length, 28);
check("...with no leading days", civilKey(feb[0]), "2026-02-01");
check("...and no trailing ones", civilKey(feb[27]), "2026-02-28");

// Leap years, and the year boundary in both directions.
check("February 2024 covers the 29th", keys(monthGridCells(new Date(2024, 1, 1))).includes("2024-02-29"), true);
check("December 2026 reaches into January", civilKey(monthGridCells(new Date(2026, 11, 1)).at(-1)!), "2027-01-02");
check("January 2027 reaches back into December", civilKey(monthGridCells(new Date(2027, 0, 1))[0]), "2026-12-27");

// DST. Cells are civil dates built field-by-field, so a 23- or 25-hour day is
// simply a day — adding 86_400_000 ms is what would skip or repeat one.
for (const [label, month, boundary] of [
  ["spring forward", 2, "2026-03-08"],
  ["fall back", 10, "2026-11-01"],
] as const) {
  const cells = monthGridCells(new Date(2026, month, 1));
  const k = keys(cells);
  ok(`${label}: the transition day appears exactly once`, k.filter((x) => x === boundary).length === 1);
  ok(`${label}: every day of the month is present`, new Set(k).size === k.length);
}

check("startOfMonth normalises the day", civilKey(startOfMonth(new Date(2026, 7, 18))), "2026-08-01");
// The reason addMonths normalises: setMonth() on a 31st lands on 3 March, so a
// "next month" button that kept the day number would skip February entirely.
check("addMonths(31 Jan, +1) is 1 Feb, not 3 March", civilKey(addMonths(new Date(2026, 0, 31), 1)), "2026-02-01");
check("addMonths crosses the year forward", civilKey(addMonths(new Date(2026, 11, 15), 1)), "2027-01-01");
check("addMonths crosses the year backward", civilKey(addMonths(new Date(2027, 0, 15), -1)), "2026-12-01");
check("monthKey buckets a civil date", monthKey(new Date(2026, 7, 18)), "2026-08");
ok("sameMonth ignores the day", sameMonth(new Date(2026, 7, 1), new Date(2026, 7, 31)));
ok("...but not the year", !sameMonth(new Date(2026, 7, 1), new Date(2027, 7, 1)));

// civilDateFromKey validates by round-trip, which is what rejects a date that
// exists as a string but not on the calendar.
check("a real key parses", civilKey(civilDateFromKey("2026-08-18")!), "2026-08-18");
check("30 February is refused", civilDateFromKey("2026-02-30"), null);
check("...and 29 February in a non-leap year", civilDateFromKey("2026-02-29"), null);
check("...but not in a leap year", civilKey(civilDateFromKey("2024-02-29")!), "2024-02-29");
for (const junk of ["", "2026-8-18", "18/08/2026", "2026-13-01", "not-a-date", "2026-08-18T09:00"]) {
  check(`junk key ${JSON.stringify(junk)} → null`, civilDateFromKey(junk), null);
}

/* ── Dots ── */

check("the dot row holds three marks", DAY_DOT_CAP, 3);
check("no jobs, no dots", dayDotPlan(0), { dots: 0, extra: 0 });
check("one job, one dot", dayDotPlan(1), { dots: 1, extra: 0 });
check("three jobs fill the row", dayDotPlan(3), { dots: 3, extra: 0 });
// Past the cap the LAST MARK becomes the count — three dots plus a badge is
// wider than a day cell on a 320px phone, and spilled onto the next day.
check("a fourth job turns the last mark into a badge", dayDotPlan(4), { dots: 2, extra: 2 });
check("...and a twelfth", dayDotPlan(12), { dots: 2, extra: 10 });
// Whichever branch runs, the drawing adds up to the day's real job count.
for (const n of [0, 1, 2, 3, 4, 7, 12, 118]) {
  const { dots, extra } = dayDotPlan(n);
  check(`${n} jobs: dots + badge = ${n}`, dots + extra, n);
  ok(`${n} jobs: never more than ${DAY_DOT_CAP} marks`, dots + (extra > 0 ? 1 : 0) <= DAY_DOT_CAP);
}
// A count can only arrive from countJobsByDay, but a plan that throws on junk
// would take the whole grid down with it.
check("a negative count draws nothing", dayDotPlan(-2), { dots: 0, extra: 0 });
check("NaN draws nothing", dayDotPlan(Number.NaN), { dots: 0, extra: 0 });

const counts = countJobsByDay([
  "2026-08-18",
  "2026-08-18",
  "2026-08-18",
  "2026-08-19",
  "2026-08-23",
  "2026-08-23",
]);
check("three jobs on the 18th", counts.get("2026-08-18"), 3);
check("one on the 19th", counts.get("2026-08-19"), 1);
check("two on the 23rd", counts.get("2026-08-23"), 2);
check("a day with none is absent, not zero", counts.get("2026-08-20"), undefined);
check("...so the dots on it come out empty", dayDotPlan(counts.get("2026-08-20") ?? 0), { dots: 0, extra: 0 });
check("an empty board has no days", countJobsByDay([]).size, 0);

/* ── Next open day ── */

const open = ["2026-08-18", "2026-08-19", "2026-08-23", "2026-09-02"];
check("the jump finds the next dot", nextDayKeyWithJobs("2026-08-20", open), "2026-08-23");
check("...and lands on the day itself when it has jobs", nextDayKeyWithJobs("2026-08-19", open), "2026-08-19");
check("...crossing the month boundary", nextDayKeyWithJobs("2026-08-24", open), "2026-09-02");
check("...and the year boundary is just a string compare", nextDayKeyWithJobs("2026-12-31", ["2027-01-04"]), "2027-01-04");
check("nothing ahead → null", nextDayKeyWithJobs("2026-09-03", open), null);
check("an empty board → null", nextDayKeyWithJobs("2026-08-01", []), null);
// Order-independence: the smallest key wins however the map iterates.
check("the EARLIEST match wins, whatever the order", nextDayKeyWithJobs("2026-08-01", [...open].reverse()), "2026-08-18");

/* ── Navigation bounds ── */

const today2608 = new Date(2026, 7, 16);
const bounds = monthNavBounds(open, today2608);
check("the arrows start at this month", civilKey(bounds.min), "2026-08-01");
check("...and stop at the last month with work", civilKey(bounds.max), "2026-09-01");
check(
  "an empty board leaves the cleaner on this month",
  [civilKey(monthNavBounds([], today2608).min), civilKey(monthNavBounds([], today2608).max)],
  ["2026-08-01", "2026-08-01"]
);
// Claimable jobs are always ahead of `now`, so `min` is normally this month —
// but a job that slips into the current hour must still be reachable rather
// than stranded behind a disabled arrow.
check(
  "a job before this month widens the range rather than hiding",
  civilKey(monthNavBounds(["2026-06-04"], today2608).min),
  "2026-06-01"
);
check("junk keys are ignored, not fatal", civilKey(monthNavBounds(["nope", "2026-10-01"], today2608).max), "2026-10-01");

check("clampMonth pulls a month back into range", civilKey(clampMonth(new Date(2026, 11, 3), bounds.min, bounds.max)), "2026-09-01");
check("...and forward", civilKey(clampMonth(new Date(2026, 4, 3), bounds.min, bounds.max)), "2026-08-01");
check("...leaving one already inside alone (normalised)", civilKey(clampMonth(new Date(2026, 8, 20), bounds.min, bounds.max)), "2026-09-01");

/* ── Labels ── */

check("the heading names the month", monthLabel(new Date(2026, 7, 1)), "August 2026");
check("a day's accessible name is the full date", dayLabel(new Date(2026, 7, 18)), "Tuesday, August 18, 2026");

/* ═══════════════ 2. AGREEMENT WITH tz-calendar ════════════════════════════ */

section(2, "Cells and jobs agree about which day it is");

// The whole risk of this stage: a dot one day away from the job it stands for.
// A cell is keyed with civilKey, a job with tzDateKey — so the two must land on
// the same string for the same wall-clock day.
//
// 18 Aug 2026, 09:00 in Montréal is 13:00 UTC.
const nineAmMontreal = new Date("2026-08-18T13:00:00.000Z");
check("a 9 AM job keys to its business day", tzDateKey(nineAmMontreal), "2026-08-18");
check("...which is the key of the cell that draws it", civilKey(new Date(2026, 7, 18)), tzDateKey(nineAmMontreal));

// The case a browser-local `getDate()` gets wrong: 8 PM Montréal is already
// tomorrow in UTC. The cleaner's dot must stay on the 18th.
const eightPmMontreal = new Date("2026-08-19T00:00:00.000Z");
check("an evening job stays on the business day, not the UTC one", tzDateKey(eightPmMontreal), "2026-08-18");
ok("...and the naive UTC reading would have moved it", eightPmMontreal.toISOString().slice(0, 10) === "2026-08-19");

// …and the mirror case: 00:30 Montréal is still the same UTC day, but a
// business-timezone reader must call it the 19th.
const halfPastMidnight = new Date("2026-08-19T04:30:00.000Z");
check("an early-morning job belongs to its own business day", tzDateKey(halfPastMidnight), "2026-08-19");

// Every cell of the reference month round-trips through the key format the jobs
// use, so a cell can never be un-matchable.
ok(
  "every August cell parses back to itself",
  aug.every((d) => {
    const parsed = civilDateFromKey(civilKey(d));
    return parsed !== null && civilKey(parsed) === civilKey(d);
  })
);

// tzToday() is what seeds the selected day and the visible month; it must be a
// civil date the grid can find.
const todayCell = tzToday();
ok("today is a cell the grid contains", keys(monthGridCells(todayCell)).includes(civilKey(todayCell)));
check("...and its month key matches the day key's prefix", monthKey(todayCell), civilKey(todayCell).slice(0, 7));

/* ═══════════════ 3. THE VIEW CONTRACT (step 13.1) ═════════════════════════ */

section(3, "The remembered List | Calendar choice");

check("there are exactly two views", [...AVAILABLE_JOBS_VIEWS], ["list", "calendar"]);
check("list is the default", DEFAULT_AVAILABLE_JOBS_VIEW, "list");
check("both views survive a round-trip", AVAILABLE_JOBS_VIEWS.map(parseAvailableJobsView), ["list", "calendar"]);
// A hand-edited or future-version preference must cost nobody the page.
for (const junk of [null, undefined, "", "grid", "LIST", "Calendar", 3, {}, []]) {
  check(`junk preference ${JSON.stringify(junk) ?? "undefined"} → list`, parseAvailableJobsView(junk), "list");
}
ok("the storage key is namespaced", AVAILABLE_JOBS_VIEW_KEY.startsWith("cleano."));

/* ═══════════════ 4. SOURCE SWEEP ══════════════════════════════════════════ */

section(4, "Wiring (steps 13.1, 13.3, 13.4, 13.5)");

const clientSrc = read(CLIENT);
const gridSrc = read(GRID);

// 13.1 — the toggle, and the preference behind it.
has("the board has a List | Calendar toggle", CLIENT, 'className="cl-viewtoggle"');
has("...with List", CLIENT, 'onClick={() => changeView("list")}');
has("...and Calendar", CLIENT, 'onClick={() => changeView("calendar")}');
has("...each exposing its state, not just drawing it", CLIENT, "aria-pressed={calendar}");
has("the choice is written to localStorage", CLIENT, "window.localStorage.setItem(AVAILABLE_JOBS_VIEW_KEY, view)");
has("...and read back through the parser", CLIENT, "parseAvailableJobsView(");
// Restoring in a passive effect is what QA measured never committing on the
// admin sidebar; the same layout-effect shape is used here.
has("the restore runs before paint", CLIENT, "useIsomorphicLayoutEffect");
has("...and is the established helper, not a new one", CLIENT,
  'typeof window !== "undefined" ? useLayoutEffect : useEffect');
// Both the read and the write are guarded: private mode throws on access.
check(
  "both localStorage calls are wrapped in try/catch",
  [...clientSrc.matchAll(/try\s*\{[\s\S]{0,220}?window\.localStorage/g)].length,
  2
);
// A lazy useState initialiser reading localStorage renders different markup
// than the server did. The default must be what the first render uses.
lacks("the initial state does not read storage", CLIENT, "useState(readStoredView");

// 13.2 — the grid is the new, self-contained component, not the admin stack.
has("the calendar is mounted", CLIENT, "<AvailableJobsCalendar");
has("the grid is its own component", GRID, "export default function AvailableJobsCalendar");
lacksInCode("...and does NOT drag in CalendarContext", GRID, "CalendarContext");
lacksInCode("...nor the admin month view", GRID, "components/calendar");
has("dots are capped and counted", GRID, "dayDotPlan(count)");
has("...drawn one per job", GRID, 'className="cl-avc-dot"');
has("...with the remainder as a badge", GRID, "{extra > 0 &&");
has("today is marked", GRID, 'isToday ? "today" : ""');
has("...and the selected day", GRID, 'isSelected ? "sel" : ""');
has("days outside the month are dimmed", GRID, 'inMonth ? "" : "out"');
has("prev/next move a month", GRID, "onAnchorChange(addMonths(anchor, -1))");
has("...and stop at the ends of the range", GRID, "disabled={atStart}");

// 13.3 — ONE card, rendered by both views. Two copies of a job card is how the
// two views start telling a cleaner different things about the same job.
check(
  "the card is defined exactly once",
  [...clientSrc.matchAll(/function renderCard\(/g)].length,
  1
);
check(
  "...and rendered by both views",
  [...clientSrc.matchAll(/\.map\(renderCard\)/g)].length,
  2
);
// The existing preview → claim flow is reached from the day list unchanged.
// These three needles are also what `verify-awer-fixes-3.ts` §13 pins.
has("the card still offers Preview", CLIENT, 'className="cl-preview-btn"');
has("...beside Claim", CLIENT, 'className="cl-claim-btn"');
has("the preview modal is still mounted once", CLIENT, "<JobPreviewModal");
check(
  "...exactly once, shared by both views",
  [...clientSrc.matchAll(/<JobPreviewModal/g)].length,
  1
);
has("claiming still goes through the atomic action", CLIENT, "const res = await claimJob(jobId);");
has("the day list shows the selected day's jobs", CLIENT, "k.dayKey === selectedKey");

// 13.4 — the dots reflect the filtered set; the navigation does not.
has("dots are counted from the FILTERED jobs", CLIENT, "countJobsByDay(keyed.map((k) => k.dayKey))");
has("...where `keyed` is built from `visible`", CLIENT, "visible.map((job) => ({ job, dayKey:");
has("area still filters in both views", CLIENT, "if (area !== ALL && j.area !== area) return false;");
has("...and job type", CLIENT, "if (type !== ALL && j.jobType !== type) return false;");
// Bounds come from `unclaimed`, so picking an area can't lock the arrows.
has("month bounds ignore the filters", CLIENT, "unclaimed.map((j) => tzDateKey(new Date(j.startTime)))");
has("an empty day says so", CLIENT, "No available jobs this day.");
has("...and points at the next one", CLIENT, "Next open day");

// 13.5 — the privacy guard. The calendar is handed COUNTS, not jobs: there is
// no payload here to leak, and no new server round-trip to leak it through.
has("the grid takes a count map", GRID, "countsByDay: Map<string, number>");
for (const needle of ["estPay", "estHourly", "price", "clientName", "location", "notes", "jobNumber"]) {
  lacksInCode(`the grid never sees ${needle}`, GRID, needle);
}
lacksInCode("the grid fetches nothing", GRID, "fetch(");
lacksInCode("...imports no server action", GRID, "claimJob");
// The "use client" directive is a string literal, so stripping comments leaves
// it — and would leave a "use server" one too.
lacks("...and is not one", GRID, '"use server"');
// The board's own payload is unchanged: `price` is fetched to compute estPay and
// never serialised. Asserted over the DTO the client actually declares.
{
  const dto = clientSrc.slice(
    clientSrc.indexOf("interface AvailableJob {"),
    clientSrc.indexOf("function fmtDate(")
  );
  ok("the DTO exists", dto.length > 0);
  ok("...and still carries no client price", !/\bprice\b/.test(dto));
  ok("...only this cleaner's estimate", dto.includes("estPay: number | null;"));
}
// No new query, no widened select: page.tsx is untouched by this stage.
has("the board still scopes to claimable jobs", PAGE, "claimableJobsWhere(cleanerId, now)");
has("...with the widened take the category filter needs", PAGE, "take: 300");
has("...and the estimate still comes from the real split math", PAGE, "computeJobPayout(j.price, [rateFor(cleanerId)])");
has("the preview modal is untouched", PREVIEW, '"Set by dispatch"');

/* ═══════════════ 5. MOBILE: TAP TARGETS + CONTRAST (step 13.6) ════════════ */

section(5, "Mobile-first (step 13.6)");

const css = read(CSS);

/** The rule body for a selector, or "" if the selector isn't there. */
function rule(selector: string): string {
  const at = css.indexOf(`\n${selector} {`);
  if (at < 0) return "";
  const open = css.indexOf("{", at);
  const close = css.indexOf("}", open);
  return css.slice(open + 1, close);
}

// ≥ 44px on the short axis, everywhere a thumb lands.
ok("day cells are 52px tall", /min-height:\s*52px/.test(rule(".cl-avc-day")));
ok("month arrows are 44 × 44", /width:\s*44px/.test(rule(".cl-avc-navbtn")) && /height:\s*44px/.test(rule(".cl-avc-navbtn")));
ok("the view toggle is 44px tall", /min-height:\s*44px/.test(rule(".cl-viewtoggle-btn")));
// Seven columns have to fit a 360px phone; the grid is fractional, never fixed.
ok("the grid is seven fluid columns", /repeat\(7,\s*minmax\(0,\s*1fr\)\)/.test(rule(".cl-avc-grid")));
ok("...and so is the weekday row", /repeat\(7,\s*minmax\(0,\s*1fr\)\)/.test(rule(".cl-avc-dow")));
// Measured: with the crew shell's 18px page padding, the default 8px card
// padding leaves 43.7px cells at 360px — just under the floor. The tighter
// branch buys it back (44.3px, confirmed in a browser at 360/375/390).
has("narrow phones get the horizontal room back", CSS, "@media (max-width: 400px)");
ok("...by tightening the card, not the cell", /padding:\s*12px 3px 14px/.test(css));
has("the toggle goes full width on a phone", CSS, ".cl-viewtoggle-btn { flex: 1 1 0; }");
// Dots occupy their height whether or not they are drawn, so a row of days
// can't jump 8px the moment one of them gains a job.
ok("the dot row reserves its height", /height:\s*8px/.test(rule(".cl-avc-dots")));
// Measured, not assumed: a busy day's badge used to spill onto the day beside
// it at 320px. The cap rule keeps it narrow; this keeps it contained regardless.
ok("a cell can never paint over its neighbour", /overflow:\s*hidden/.test(rule(".cl-avc-day")));

/* ── WCAG 2.1 contrast, computed rather than eyeballed ── */

type RGB = [number, number, number];
const hex = (h: string): RGB => [
  parseInt(h.slice(1, 3), 16),
  parseInt(h.slice(3, 5), 16),
  parseInt(h.slice(5, 7), 16),
];
/** `fg` at `alpha` composited over `bg`. */
const over = (fg: RGB, alpha: number, bg: RGB): RGB =>
  [0, 1, 2].map((i) => fg[i] * alpha + bg[i] * (1 - alpha)) as RGB;
function luminance([r, g, b]: RGB): number {
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}
function contrast(a: RGB, b: RGB): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100;
}

const WHITE: RGB = [255, 255, 255];
const CREAM = hex("#f3f6f9");
const INK = hex("#0e1a1c");
const PRIMARY = hex("#008C9C");
const PRIMARY_HOVER = hex("#00707d");
const PRIMARY_800 = hex("#005a63");

// The engine checks itself first, against the two pairs everyone knows.
check("the contrast engine agrees black/white is 21:1", contrast([0, 0, 0], WHITE), 21);
check("...and that #767676 on white is the AA borderline", contrast(hex("#767676"), WHITE), 4.54);
// …and against the ratios globals.css already documents for these tokens.
check("--primary-800 on white is the documented 7.95:1", contrast(PRIMARY_800, WHITE), 7.95);
check("--ink-soft on white is the documented 5.52:1", contrast(over(INK, 0.65, WHITE), WHITE), 5.52);

const AA = 4.5;
const UI = 3; // WCAG 1.4.11, non-text indicators

// Text.
ok(`day numbers, --ink on white (${contrast(INK, WHITE)}:1)`, contrast(INK, WHITE) >= AA);
ok(`...and on the hover tint (${contrast(INK, CREAM)}:1)`, contrast(INK, CREAM) >= AA);
ok(`neighbouring months, --ink-soft on white (${contrast(over(INK, 0.65, WHITE), WHITE)}:1)`, contrast(over(INK, 0.65, WHITE), WHITE) >= AA);
ok(`...still readable on hover (${contrast(over(INK, 0.65, CREAM), CREAM)}:1)`, contrast(over(INK, 0.65, CREAM), CREAM) >= AA);
ok(`weekday headings, --primary-800 on white (${contrast(PRIMARY_800, WHITE)}:1)`, contrast(PRIMARY_800, WHITE) >= AA);
ok(`the toggle's resting label on --cream (${contrast(PRIMARY_800, CREAM)}:1)`, contrast(PRIMARY_800, CREAM) >= AA);
ok(`today's number, --primary-800 on white (${contrast(PRIMARY_800, WHITE)}:1)`, contrast(PRIMARY_800, WHITE) >= AA);

// THE finding this stage inherited from Stage 6, restated as a test: white on
// the brand teal is 4.01:1 — below AA for label-sized text. Both places where
// white sits on teal therefore use --primary-hover instead.
ok(`white on --primary would have FAILED AA (${contrast(WHITE, PRIMARY)}:1)`, contrast(WHITE, PRIMARY) < AA);
ok(`white on --primary-hover passes (${contrast(WHITE, PRIMARY_HOVER)}:1)`, contrast(WHITE, PRIMARY_HOVER) >= AA);
ok("the selected day uses it", /background:\s*var\(--primary-hover\)/.test(rule(".cl-avc-day.sel")));
ok("the active toggle uses it", /background:\s*var\(--primary-hover\)/.test(rule(".cl-viewtoggle-btn.active")));
ok("...and both paint their label white", /color:\s*#fff/.test(rule(".cl-viewtoggle-btn.active")));

// Non-text indicators — the dots and today's ring carry meaning on their own.
ok(`dots, --primary on white (${contrast(PRIMARY, WHITE)}:1)`, contrast(PRIMARY, WHITE) >= UI);
ok(`...and white dots on the selected fill (${contrast(WHITE, PRIMARY_HOVER)}:1)`, contrast(WHITE, PRIMARY_HOVER) >= UI);
// The tint that was tried first and measured 1.59:1 — kept as a test so nobody
// reaches for it again.
ok(`the --primary-30 ring would have FAILED (${contrast(over(PRIMARY, 0.3, WHITE), WHITE)}:1)`, contrast(over(PRIMARY, 0.3, WHITE), WHITE) < UI);
ok("today's ring is the solid teal", /inset 0 0 0 2px var\(--primary\)/.test(rule(".cl-avc-day.today")));

/* ── Accessibility wiring ── */

has("every day cell names its date and its count", GRID, "aria-label={`${dayLabel(cell)} — ${");
has("...and today says so", GRID, 'isToday ? " (today)" : ""');
has("the selected day is exposed, not just drawn", GRID, "aria-pressed={isSelected}");
has("the month heading is announced on change", GRID, 'aria-live="polite"');
has("the arrows are labelled", GRID, 'aria-label="Previous month"');
has("...both of them", GRID, 'aria-label="Next month"');
// Weekday headings are decoration: the cells already carry the full date.
has("the weekday row is hidden from screen readers", GRID, 'className="cl-avc-dow" aria-hidden="true"');
has("dots are decoration too", GRID, 'className="cl-avc-dots" aria-hidden="true"');
has("the toggle is a labelled group", CLIENT, 'aria-label="Choose how to browse available jobs"');
// Inside a form-ish toolbar an unset `type` submits.
check(
  "every new button declares type=\"button\"",
  [...gridSrc.matchAll(/<button\b/g)].length,
  [...gridSrc.matchAll(/type="button"/g)].length
);

/* ═══════════════ RESULT ═══════════════════════════════════════════════════ */

console.log(`\n${"═".repeat(60)}`);
console.log(`${pass} passed, ${fail} failed  (${pass + fail} checks)`);
console.log("═".repeat(60));
process.exit(fail === 0 ? 0 : 1);
