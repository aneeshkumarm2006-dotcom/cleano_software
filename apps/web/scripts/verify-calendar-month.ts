// Verification for fix list item 28 — calendar month view job details.
import fs from "node:fs";
import { avatarColor, initials, shortName } from "../src/lib/avatar";

let pass = 0, fail = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const okv = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${okv ? "PASS" : "FAIL"}  ${name}`);
  if (!okv) console.log(`        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  okv ? pass++ : fail++;
}
const ok = (n: string, c: boolean) => check(n, c, true);

// ── Client name shortening ─────────────────────────────────────────────────
// The old card did name.split(" ")[0], throwing the surname away — two clients
// called "David" were indistinguishable.
check("keeps the surname initial", shortName("Premsai Kilaru"), "Premsai K.");
check("distinguishes two clients sharing a first name",
  [shortName("David Brown"), shortName("David Chen")], ["David B.", "David C."]);
check("single-word names pass through", shortName("Cher"), "Cher");
check("middle names collapse to the LAST initial",
  shortName("Anna Maria Lopez"), "Anna L.");
check("extra whitespace is handled", shortName("  Jane   Doe  "), "Jane D.");
check("empty is safe", shortName(""), "");
ok("the old first-word-only behaviour is genuinely different",
  shortName("David Brown") !== "David Brown".split(" ")[0]);

// ── Cleaner colour identity ────────────────────────────────────────────────
ok("the same cleaner always gets the same colour",
  avatarColor("Asia Smellie") === avatarColor("Asia Smellie"));
ok("different cleaners get different colours",
  avatarColor("Asia Smellie") !== avatarColor("Tanya Mastrangelo"));
check("initials render as a compact badge", initials("Asia Smellie"), "AS");

// ── Source sweep ───────────────────────────────────────────────────────────
const view = fs.readFileSync("src/components/calendar/MonthView.tsx", "utf8");

ok("month cells render job cards, not just a count",
  view.includes("cal-chip") && view.includes("openEventDetailsModal"));
ok("card shows the shortened client name", view.includes("shortName(event.title"));
ok("the old first-word-only truncation is gone",
  !view.includes('(event.title || "").split(" ")[0]'));
ok("dot is coloured by the assigned CLEANER, not job status",
  view.includes("avatarColor(assignee)"));
ok("cleaner initials appear on the card", view.includes("initials(assignee)"));
ok("unassigned jobs stay visually distinct rather than borrowing a colour",
  view.includes("dashed"));
ok("assignee falls back from cleaners to the lead employee",
  view.includes("event.metadata?.cleaners?.[0]?.name") &&
  view.includes("event.metadata?.employeeName"));
ok("'Unassigned' is not treated as a person's name",
  view.includes('lead !== "Unassigned"'));
ok("tooltip names the assignee for scanning",
  /title=\{`/.test(view) && view.includes("` · ${assignee}`") &&
  view.includes('" · Unassigned"'));
ok("more than two cards per day are shown", view.includes("MONTH_CARDS_PER_DAY = 3"));

const css = fs.readFileSync("src/app/globals.css", "utf8");
// The calendar CSS used to be duplicated across two stylesheets, so this pair
// of checks pinned literal declarations to keep the copies in step. It lives in
// one block in globals.css now (customer.css carries no `.cal-*` rule at all),
// so what's worth asserting is that the class MonthView renders is actually
// styled — not how many times.
ok("the initials badge MonthView renders is styled, not an orphan class",
  view.includes('className="cal-chip-who"') && /^\.cal-chip-who \{/m.test(css));
ok("...and it is pushed right so the client name keeps the space",
  /\.cal-chip-who \{[^}]*margin-left: auto/.test(css));
ok("client name flexes so the badge can't squeeze it out",
  css.includes(".cal-chip-n { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; flex: 1 1 auto; min-width: 0; }"));
// Was `minmax(138px, 1fr)` + `min-height: 122px`. Both literals are gone: the
// grid rows are uniform (`grid-auto-rows: 1fr`) and the cell was raised to
// 148px, because a chip carrying a corner badge is 22px rather than 20px and
// the "+N more" row renders at 19px. globals.css does that arithmetic in a
// comment beside the rule and lands on 141px as the floor, so assert the floor
// rather than the exact number — raising it further must not fail this.
const cellMinHeight = Number(
  (css.match(/\.cal-mcell \{[^}]*min-height: (\d+)px/) || [])[1] ?? 0);
ok("day cells have room for every card plus the '+N more' row",
  cellMinHeight >= 141);
ok("...and every week row is sized the same, so no row clips earlier than another",
  /\.cal-month-grid \{[^}]*grid-auto-rows: 1fr/.test(css));

console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail === 0 ? 0 : 1);
