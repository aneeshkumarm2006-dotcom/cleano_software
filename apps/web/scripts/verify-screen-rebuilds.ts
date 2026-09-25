/**
 * The four screens rebuilt from the 23 Sept design review.
 *
 * Each was driven in a browser before and after. The measurements that matter,
 * taken live at 1440:
 *   jobs table  1126px table in a 1126px container — 0 overflow (was 233)
 *   next job    hero at 437px, not repeated in the list, CTA 45px tall
 *   booking     rail + "what happens next" replacing 60% dead space
 */
import { readFileSync } from "node:fs";

let passed = 0;
const failures: string[] = [];
const check = (name: string, ok: boolean) => {
  if (ok) passed++;
  else failures.push(name);
};
const read = (p: string) => readFileSync(p, "utf8");

/* ---- 01 Jobs: 13 columns to 8 ----------------------------------------- */
{
  const v = read("src/app/admin/jobs/JobsView.tsx");
  check("crew and pay are one column", v.includes("<th>Crew &amp; pay</th>"));
  check("Cleaners is no longer its own column", !v.includes("<th>Cleaners</th>"));
  check("Time is no longer its own column", !v.includes('<th className="num">Time</th>'));
  check("Pay type is no longer its own column", !v.includes("<th>Pay type</th>"));
  check("Discount is no longer its own column", !v.includes('<th className="num">Discount</th>'));
  check("Profit is named Margin", v.includes('<th className="num">Margin</th>'));
  check("the discount is the struck-through original", v.includes("textDecoration: 'line-through'"));
  check("an empty crew says so in words", v.includes(">Unassigned<"));
  check("a missing pay type renders nothing, not a dash", v.includes("label !== '—'"));

  const p = read("src/app/admin/jobs/page.tsx");
  // A scheduled job with no crew is not a 100% margin — the cost has not
  // happened yet. Seen on screen as two rows reading 100%.
  check("an unstarted job with no crew has an unknown margin", p.includes("!hasCrew && settled"));
  check("settled means completed, paid or cancelled",
    p.includes('job.status === "COMPLETED"') && p.includes('job.status === "CANCELLED"'));
  check("zero collected is named, not called total revenue", v.includes('label="Collected"'));
  check("pending payment says what it means", v.includes('label="Awaiting payment"'));
}

/* ---- 02 Clocks: the queue moves to the page it belongs on -------------- */
{
  const tt = read("src/app/admin/time-tracking/page.tsx");
  check("time tracking owns the queue", tt.includes("<StaleClocksPanel rows={staleClocks} />"));
  const n = read("src/app/admin/notifications/page.tsx");
  check("notifications keeps a pointer, not a second editor", n.includes("compact"));
  const panel = read("src/app/admin/notifications/StaleClocksPanel.tsx");
  check("the compact form links to time tracking", panel.includes('href="/admin/time-tracking"'));
  check("and states the cost, not just the count", panel.includes("counts as that much work"));
}

/* ---- 03 The cleaner's next job ---------------------------------------- */
{
  const card = read("src/app/cleaners/my-jobs/NextJobCard.tsx");
  check("when comes before who", card.indexOf("cl-next-when") < card.indexOf("cl-next-who"));
  check("it names the job's timezone", card.includes("storeTzLabel"));
  check("it says how soon in words", card.includes("untilText"));

  const page = read("src/app/cleaners/my-jobs/page.tsx");
  check("the hero only appears on the default view", page.includes("isDefaultView && nextJob"));
  check("a filtered view promotes nothing", page.includes('status === "upcoming"'));
  check("the hero is removed from the list below it",
    page.includes("filteredJobs.filter((job) => job.id !== nextJob?.id)"));
  // "No upcoming jobs" under a job card would be a lie.
  check("the empty state still counts every job",
    page.includes("{filteredJobs.length === 0 ? ("));

  const css = read("src/app/globals.css");
  check("the CTA meets the 44px touch target", css.includes("min-height: 44px"));
  check("its press feedback respects reduced motion", (() => {
    const i = css.indexOf(".cl-next-btn:active");
    return css.slice(i, i + 260).includes("prefers-reduced-motion");
  })());
}

/* ---- 04 Booking step 1 ------------------------------------------------- */
{
  const page = read("src/app/(book)/book/page.tsx");
  check("a progress rail exists", page.includes("cl-book-rail"));
  check("it names the step and the total", page.includes("Step {step + 1} of {STEP_LABELS.length}"));

  const step = read("src/app/(book)/book/steps/Step1PostalCode.tsx");
  check("the dead space says what happens next", step.includes("What happens next"));
  check("it states the deposit, not the full price", step.includes("STANDARD_BOOKING_DEPOSIT_USD"));
  // Demo scaffolding that shipped to customers — and Montreal codes at that,
  // so a Calgary customer was told to try another province.
  // Comments are allowed to name what was removed; rendered markup is not.
  const stepCode = step
    .split("\n")
    .filter((l) => !/^\s*(\/\/|\*|\{?\/\*)/.test(l))
    .join("\n");
  check(
    "the sample postal codes no longer render",
    !stepCode.includes("H2X 1Y4") && !stepCode.includes("K1A 0B1") && !stepCode.includes("H1V 1A1"),
  );

  const css = read("src/app/customer.css");
  check("the rail is phone-only", css.includes(".cl-book-rail { display: none; }"));
  check("the step's own eyebrow does not repeat the rail",
    css.includes(".cl-book-body .cl-eyebrow { display: none; }"));
}

if (failures.length) {
  console.error(`✘ ${passed} passed, ${failures.length} failed`);
  for (const f of failures) console.error(`   - ${f}`);
  process.exit(1);
}
console.log(`✔ ${passed} passed, 0 failed`);
