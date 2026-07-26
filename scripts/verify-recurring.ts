// Verification for fix list item 9 — recurring jobs with editable instances.
import fs from "node:fs";
import { nextOccurrence, recurrenceCount } from "../src/lib/booking-pricing";
import { FREQ_DISCOUNT_KEYS } from "../src/lib/service-pricing";
import { SERIES_PROPAGATED_FIELDS, seriesRootId } from "../src/lib/job-series";

let pass = 0, fail = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const okv = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${okv ? "PASS" : "FAIL"}  ${name}`);
  if (!okv) console.log(`        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  okv ? pass++ : fail++;
}
const ok = (n: string, c: boolean) => check(n, c, true);
const iso = (d: Date) => d.toISOString().slice(0, 10);

// ── The four required cadences ─────────────────────────────────────────────
const base = new Date("2026-03-10T14:00:00Z");
check("daily advances 1 day", iso(nextOccurrence(base, "DAILY")), "2026-03-11");
check("weekly advances 7 days", iso(nextOccurrence(base, "WEEKLY")), "2026-03-17");
check("biweekly advances 14 days", iso(nextOccurrence(base, "BIWEEKLY")), "2026-03-24");
check("monthly advances 1 month", iso(nextOccurrence(base, "MONTHLY")), "2026-04-10");

// Time of day must survive the roll-forward — a recurring 2pm job stays 2pm.
check("daily keeps the time of day",
  nextOccurrence(base, "DAILY").toISOString().slice(11, 16), "14:00");
check("monthly keeps the time of day",
  nextOccurrence(base, "MONTHLY").toISOString().slice(11, 16), "14:00");

// Month-end rollover must not silently skip a month. Plain setMonth() turns
// Jan 31 into March 3, dropping February's visit entirely.
check("Jan 31 + 1 month clamps to Feb 28, it does NOT skip February",
  iso(nextOccurrence(new Date("2026-01-31T14:00:00Z"), "MONTHLY")), "2026-02-28");
check("leap year gets Feb 29",
  iso(nextOccurrence(new Date("2028-01-31T14:00:00Z"), "MONTHLY")), "2028-02-29");
check("Mar 31 + 1 month clamps to Apr 30",
  iso(nextOccurrence(new Date("2026-03-31T14:00:00Z"), "MONTHLY")), "2026-04-30");
check("a mid-month date is unaffected by clamping",
  iso(nextOccurrence(new Date("2026-01-15T14:00:00Z"), "MONTHLY")), "2026-02-15");
check("quarterly clamps too",
  iso(nextOccurrence(new Date("2026-01-31T14:00:00Z"), "QUARTERLY")), "2026-04-30");

// ── How many occurrences get created ───────────────────────────────────────
ok("daily creates more occurrences than weekly for the same horizon",
  recurrenceCount("DAILY", 3) > recurrenceCount("WEEKLY", 3));
check("daily uses the same look-ahead window as weekly", recurrenceCount("DAILY", 3), 21);
check("weekly honours the configured horizon", recurrenceCount("WEEKLY", 3), 3);
check("monthly creates 2 more", recurrenceCount("MONTHLY", 3), 2);
check("one-time creates none", recurrenceCount("ONE_TIME", 3), 0);

// ── Discount grid knows the new cadence ────────────────────────────────────
ok("DAILY is a configurable discount column",
  (FREQ_DISCOUNT_KEYS as readonly string[]).includes("DAILY"));
ok("MONTHLY is a configurable discount column",
  (FREQ_DISCOUNT_KEYS as readonly string[]).includes("MONTHLY"));

// ── Series edit scope ──────────────────────────────────────────────────────
check("a child's series root is its parent",
  seriesRootId({ id: "child", parentJobId: "root" }), "root");
check("a parent is its own series root",
  seriesRootId({ id: "root", parentJobId: null }), "root");

const fields = SERIES_PROPAGATED_FIELDS as readonly string[];
ok("series edit propagates price", fields.includes("price"));
ok("series edit propagates the service type", fields.includes("jobType"));
ok("series edit propagates the address", fields.includes("location"));
ok("series edit propagates the tax exemption", fields.includes("taxExempt"));
// The whole point of a series is that each occurrence has its own slot.
ok("series edit NEVER propagates startTime", !fields.includes("startTime"));
ok("series edit NEVER propagates jobDate", !fields.includes("jobDate"));
ok("series edit NEVER propagates endTime", !fields.includes("endTime"));
ok("series edit NEVER propagates status", !fields.includes("status"));
ok("series edit NEVER propagates paymentReceived", !fields.includes("paymentReceived"));
ok("series edit NEVER propagates discountAmount (carries recurring component)",
  !fields.includes("discountAmount"));

// ── Source sweep ───────────────────────────────────────────────────────────
const read = (p: string) => fs.readFileSync(p, "utf8");

const saveJob = read("src/app/admin/actions/saveJob.ts");
ok("admin offers all four cadences",
  saveJob.includes('["DAILY", "WEEKLY", "BIWEEKLY", "MONTHLY"]'));
ok("series edit is opt-in, not automatic",
  saveJob.includes('formData.get("applyToSeries") === "on"'));
ok("series result is reported back", saveJob.includes("seriesUpdated"));

const series = read("src/lib/job-series.ts");
ok("completed/paid/cancelled occurrences are protected",
  series.includes('IMMUTABLE_STATUSES') &&
  series.includes('"COMPLETED", "PAID", "CANCELLED"'));
ok("skipped occurrences are counted and returned", series.includes("skipped"));

const modal = read("src/app/admin/jobs/JobModal.tsx");
ok("modal offers Daily and Monthly",
  modal.includes('label: "Daily"') && modal.includes('label: "Monthly"'));
ok("modal shows the series control only when editing a series",
  modal.includes('mode === "edit" && seriesInfo?.isSeries'));
ok("modal defaults the series option OFF", modal.includes("setApplyToSeries(false)"));
ok("modal states what a series edit will touch",
  modal.includes("Each keeps its own date and time"));

console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail === 0 ? 0 : 1);
