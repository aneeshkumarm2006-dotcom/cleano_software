/* The Jobs list ordering, including the yesterday boundary that is easy to
 * get wrong by a day. */
import { compareOperational, startOfYesterday, jobInstant } from "../src/lib/job-order";

let pass = 0, fail = 0;
const check = (label: string, ok: boolean, got?: unknown) => {
  if (ok) { pass++; console.log(`  ok   ${label}`); }
  else { fail++; console.log(`  FAIL ${label}${got === undefined ? "" : `  → ${JSON.stringify(got)}`}`); }
};

const at = (iso: string) => ({ jobDate: new Date(iso), startTime: new Date(iso) });

async function main() {
  // A Tuesday lunchtime.
  const now = new Date("2026-09-08T12:00:00").getTime();
  const cutoff = startOfYesterday(now);

  console.log("The yesterday boundary");
  check("yesterday 00:00 is still current", jobInstant(at("2026-09-07T00:00:00")) >= cutoff);
  check("the moment before yesterday is past", jobInstant(at("2026-09-06T23:59:59")) < cutoff);
  check("today is current", jobInstant(at("2026-09-08T09:00:00")) >= cutoff);

  console.log("Ordering");
  const jobs = [
    at("2026-12-25T09:00:00"), // 0 far future
    at("2026-09-07T08:00:00"), // 1 yesterday
    at("2026-08-01T09:00:00"), // 2 old
    at("2026-09-08T14:00:00"), // 3 today, later
    at("2026-09-08T07:00:00"), // 4 today, early
    at("2026-07-01T09:00:00"), // 5 older
  ];
  const order = [...jobs].sort((a, b) => compareOperational(a, b, cutoff));
  const idx = order.map((j) => jobs.indexOf(j));
  check("yesterday first, then today ascending, then future", idx.slice(0, 4).join(",") === "1,4,3,0", idx);
  check("past follows, most recent first", idx.slice(4).join(",") === "2,5", idx);
  check("the furthest-future job is NOT first", idx[0] !== 0);

  console.log("Edges");
  const undated = { jobDate: null, startTime: "" as unknown as string };
  const withDate = at("2026-09-08T09:00:00");
  check("an undated job never outranks a dated one",
    compareOperational(undated, withDate, cutoff) > 0);
  check("jobDate wins over startTime when both exist",
    jobInstant({ jobDate: new Date("2026-09-08T00:00:00"), startTime: new Date("2020-01-01T00:00:00") })
      === new Date("2026-09-08T00:00:00").getTime());
  check("sorting is stable for equal instants",
    compareOperational(at("2026-09-08T09:00:00"), at("2026-09-08T09:00:00"), cutoff) === 0);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
main();
