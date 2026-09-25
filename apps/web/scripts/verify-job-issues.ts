/* The parsers behind a cleaner's issue report.
 *
 *   npx tsx --conditions=react-server scripts/verify-job-issues.ts
 *
 * Nothing in the database validates category, urgency or status — they are TEXT
 * columns mirroring TS unions in src/lib/job-issues.ts — so these three parse
 * functions ARE the validation. Every one of them has to fold an unrecognised
 * value to a safe default rather than throw, because the alternative is losing
 * a cleaner's report to a select that arrived empty.
 *
 * No database needed: the file under test is pure by design.
 */
import {
  isOpenIssueStatus,
  JOB_ISSUE_CATEGORIES,
  JOB_ISSUE_CATEGORY_HINT,
  JOB_ISSUE_CATEGORY_LABEL,
  JOB_ISSUE_STATUSES,
  JOB_ISSUE_STATUS_LABEL,
  MAX_ISSUE_DESCRIPTION,
  parseJobIssueCategory,
  parseJobIssueStatus,
  parseJobIssueUrgency,
  type JobIssueCategory,
} from "../src/lib/job-issues";

// Keeps `pass`, `fail` and `check` off the global scope, where they would
// collide with every other verify script.
export {};
let pass = 0, fail = 0;
const check = (label: string, ok: boolean, got?: unknown) => {
  if (ok) { pass++; console.log(`  ok   ${label}`); }
  else { fail++; console.log(`  FAIL ${label}${got === undefined ? "" : `  → ${JSON.stringify(got)}`}`); }
};

const GARBAGE = ["", "   ", "nonsense", "ACCESS; DROP TABLE \"JobIssue\"", "<script>", "0", "null"];

async function main() {
  console.log("Every category survives a round trip");
  check("seven categories, no more and no fewer", JOB_ISSUE_CATEGORIES.length === 7, JOB_ISSUE_CATEGORIES.length);
  for (const c of JOB_ISSUE_CATEGORIES) {
    check(`${c} parses to itself`, parseJobIssueCategory(c) === c, parseJobIssueCategory(c));
    check(`${c} survives lower case`, parseJobIssueCategory(c.toLowerCase()) === c);
    check(`${c} survives stray whitespace`, parseJobIssueCategory(`  ${c} `) === c);
  }

  console.log("Anything unrecognised becomes OTHER");
  for (const g of GARBAGE) {
    check(`${JSON.stringify(g)} → OTHER`, parseJobIssueCategory(g) === "OTHER", parseJobIssueCategory(g));
  }
  check("undefined → OTHER", parseJobIssueCategory(undefined) === "OTHER");
  check("null → OTHER", parseJobIssueCategory(null) === "OTHER");
  check("a number → OTHER", parseJobIssueCategory(3) === "OTHER");
  check("an object → OTHER", parseJobIssueCategory({ category: "SAFETY" }) === "OTHER");

  console.log("Urgency never escalates itself");
  check("URGENT is honoured", parseJobIssueUrgency("URGENT") === "URGENT");
  check("urgent lower case is honoured", parseJobIssueUrgency("urgent") === "URGENT");
  check("NORMAL is honoured", parseJobIssueUrgency("NORMAL") === "NORMAL");
  for (const g of GARBAGE) {
    check(`${JSON.stringify(g)} → NORMAL`, parseJobIssueUrgency(g) === "NORMAL", parseJobIssueUrgency(g));
  }
  check("undefined → NORMAL", parseJobIssueUrgency(undefined) === "NORMAL");
  check("a near-miss does not escalate", parseJobIssueUrgency("URGENT!") === "NORMAL");

  console.log("Status falls back to the state that keeps it on the list");
  for (const s of JOB_ISSUE_STATUSES) {
    check(`${s} parses to itself`, parseJobIssueStatus(s) === s, parseJobIssueStatus(s));
  }
  check("lower case resolved is honoured", parseJobIssueStatus("resolved") === "RESOLVED");
  for (const g of GARBAGE) {
    check(`${JSON.stringify(g)} → OPEN`, parseJobIssueStatus(g) === "OPEN", parseJobIssueStatus(g));
  }
  check("undefined → OPEN", parseJobIssueStatus(undefined) === "OPEN");

  console.log("Open means 'still needs somebody'");
  check("OPEN is open", isOpenIssueStatus("OPEN") === true);
  check("ACKNOWLEDGED is still open", isOpenIssueStatus("ACKNOWLEDGED") === true);
  check("RESOLVED is not open", isOpenIssueStatus("RESOLVED") === false);
  check("garbage counts as open, not closed", isOpenIssueStatus("nonsense") === true);
  check("undefined counts as open", isOpenIssueStatus(undefined) === true);

  console.log("Every union member has a label, and no map has a stray key");
  for (const c of JOB_ISSUE_CATEGORIES) {
    check(`${c} has a label`, typeof JOB_ISSUE_CATEGORY_LABEL[c] === "string" && JOB_ISSUE_CATEGORY_LABEL[c].length > 0);
    check(`${c} has a hint`, typeof JOB_ISSUE_CATEGORY_HINT[c] === "string" && JOB_ISSUE_CATEGORY_HINT[c].length > 0);
  }
  check(
    "the label map has exactly the seven categories",
    Object.keys(JOB_ISSUE_CATEGORY_LABEL).length === JOB_ISSUE_CATEGORIES.length &&
      Object.keys(JOB_ISSUE_CATEGORY_LABEL).every((k) => JOB_ISSUE_CATEGORIES.includes(k as JobIssueCategory)),
    Object.keys(JOB_ISSUE_CATEGORY_LABEL),
  );
  check(
    "the hint map has exactly the seven categories",
    Object.keys(JOB_ISSUE_CATEGORY_HINT).length === JOB_ISSUE_CATEGORIES.length &&
      Object.keys(JOB_ISSUE_CATEGORY_HINT).every((k) => JOB_ISSUE_CATEGORIES.includes(k as JobIssueCategory)),
    Object.keys(JOB_ISSUE_CATEGORY_HINT),
  );
  for (const s of JOB_ISSUE_STATUSES) {
    check(`${s} has a label`, typeof JOB_ISSUE_STATUS_LABEL[s] === "string" && JOB_ISSUE_STATUS_LABEL[s].length > 0);
  }
  check(
    "the status label map has exactly the three statuses",
    Object.keys(JOB_ISSUE_STATUS_LABEL).length === JOB_ISSUE_STATUSES.length,
    Object.keys(JOB_ISSUE_STATUS_LABEL),
  );
  check(
    "no two categories share a label",
    new Set(Object.values(JOB_ISSUE_CATEGORY_LABEL)).size === JOB_ISSUE_CATEGORIES.length,
  );

  console.log("The description cap is one number");
  check("the cap is 2000", MAX_ISSUE_DESCRIPTION === 2000, MAX_ISSUE_DESCRIPTION);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
main();
