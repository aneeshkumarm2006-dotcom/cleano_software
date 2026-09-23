/**
 * Fixes from the browser review of 2026-09-23, driven through Playwright
 * against the zztestqa workspace.
 *
 * Each one is here because it was seen on screen, not inferred from source.
 */
import { readFileSync } from "node:fs";

let passed = 0;
const failures: string[] = [];
const check = (name: string, ok: boolean) => {
  if (ok) passed++;
  else failures.push(name);
};
const read = (p: string) => readFileSync(p, "utf8");

/* 1. The install card blocked the cleaner's primary button ---------------- */
// Playwright could not click "Complete job": eight retries, every one
// reporting `<button class="cl-install-btn"> intercepts pointer events`.
{
  const c = read("src/components/InstallPrompt.tsx");
  check("the card announces itself to the page", c.includes('root.dataset.installPrompt = "1"'));
  check("and stops announcing when hidden", c.includes("delete root.dataset.installPrompt"));
  const css = read("src/app/globals.css");
  check(
    "the list reserves room for it",
    css.includes('[data-install-prompt="1"] .cl-app-main'),
  );
}

/* 2. The cleaner saw the wrong job number -------------------------------- */
{
  const p = read("src/app/cleaners/my-jobs/[jobId]/page.tsx");
  check("the job pill uses jobNumber", p.includes("JOB #{job.jobNumber}"));
  check(
    "it no longer prints the internal id",
    !p.includes("job.id.slice(-6).toUpperCase()"),
  );
  // Identity before navigation: the <h1> must come before the map links.
  check(
    "the client name renders before the map links",
    p.indexOf("<h1>{job.clientName}</h1>") < p.indexOf("<MapLinks"),
  );
}

/* 3. Two product names in one app ---------------------------------------- */
{
  const layout = read("src/app/layout.tsx");
  check("the tab title is per workspace", layout.includes("generateMetadata"));
  check("and uses a title template", layout.includes("template: `%s ·"));
  check("no page hardcodes a product suffix in its title", (() => {
    const { execSync } = require("node:child_process");
    const out = execSync(
      `grep -rl 'title: "[^"]* · \\(Cleano\\|Bookmops\\)"' src/app || true`,
      { encoding: "utf8" },
    );
    return out.trim() === "";
  })());
  const ws = read("src/lib/workspace-name.ts");
  check("the fallback is the platform, never a tenant", ws.includes('PLATFORM_NAME = "Bookmops"'));
}

/* 4. One company's marketing on every tenant's pages --------------------- */
{
  const shell = read("src/components/customer/SplitShell.tsx");
  check(
    "the invented review count is gone",
    !shell.includes('footNote = "Loved by 2,400+'),
  );
  check("and the default is nothing", shell.includes("footNote = null,"));
  const form = read("src/app/(auth)/sign-in/SignInForm.tsx");
  check(
    "the workspace sign-in no longer opts into it",
    !form.includes("footNote={isPlatform ? null : undefined}"),
  );
}

/* 5. Missing payroll shown as a perfect margin --------------------------- */
{
  const page = read("src/app/admin/jobs/page.tsx");
  check("the page decides whether profit is known", page.includes("profitKnown"));
  check(
    "a job with crew and no pay is not known",
    page.includes("const payRecorded = (job.employeePay ?? 0) > 0;"),
  );
  const view = read("src/app/admin/jobs/JobsView.tsx");
  check("the cell honours it", view.includes("job.profitKnown !== false"));
  check(
    "and says why it is blank",
    view.includes("no pay recorded yet, so the margin isn't known"),
  );
}

/* 6. "All 40" beside "Cancelled 31" -------------------------------------- */
{
  const view = read("src/app/admin/jobs/JobsView.tsx");
  check("the tab is named for what it holds", view.includes("label: 'Active'"));
  check("it is no longer called All", !view.includes("{ id: 'all',        label: 'All' }"));
  check("cross-cutting filters are marked", view.includes("aspect: true"));
  check("and divided off", view.includes("atab-divider"));
}

/* 7. The cleaner's filters came before the work -------------------------- */
{
  const f = read("src/app/cleaners/my-jobs/JobsFilters.tsx");
  check("the toolbar collapses", f.includes("cl-filters-toggle"));
  check("per-page is desktop only", f.includes("cl-desktop-only"));
  const css = read("src/app/globals.css");
  // The first attempt lost to a LATER `display: grid` rule, so the collapse
  // must come after it in the file.
  check(
    "the collapse rule wins over the phone grid",
    css.lastIndexOf(".cl-toolbar:not(.is-open)") > css.lastIndexOf("grid-template-columns: 1fr 1fr;"),
  );
}

/* 8. No company name on the booking page ---------------------------------- */
{
  const cfg = read("src/app/(book)/actions/getBookingConfig.ts");
  check("the booking config sends the business name", cfg.includes("businessName: string;"));
  const page = read("src/app/(book)/book/page.tsx");
  check("the page renders it", page.includes("cl-book-brandline"));
  const css = read("src/app/customer.css");
  check("and only where the brand panel is hidden", css.includes(".cl-book-brandline { display: none; }"));
}

if (failures.length) {
  console.error(`✘ ${passed} passed, ${failures.length} failed`);
  for (const f of failures) console.error(`   - ${f}`);
  process.exit(1);
}
console.log(`✔ ${passed} passed, 0 failed`);
