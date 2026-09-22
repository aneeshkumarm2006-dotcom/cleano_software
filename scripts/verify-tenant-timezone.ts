// Sept 10 fix list, item 6 part 2: does a tenant get its OWN clock?
//
// This is the piece with real cross-tenant risk, so it is exercised rather than
// asserted against source. Every check below runs the real helpers inside a
// real organization context and looks at what comes out.
import { runAsOrg } from "../src/lib/org-context";
import { STORE_TZ, storeTz, storeDateKey, storeTimeKey } from "../src/lib/timezone";

let pass = 0,
  fail = 0;

function check(name: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
  if (!ok) {
    console.log(`        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    fail++;
  } else pass++;
}

const montreal = { id: "1", slug: "cleano", name: "Cleano", timezone: "America/Montreal" };
const calgary = { id: "2", slug: "cleanocalgary", name: "CleanoCalgary", timezone: "America/Edmonton" };

/** 10:30 PM on Sep 10 in Montreal. 8:30 PM the same evening in Calgary. */
const evening = new Date("2026-09-11T02:30:00.000Z");

async function main() {
  check("with no organization announced, nothing changes", storeTz(), STORE_TZ);

  await runAsOrg(montreal, async () => {
    check("Montreal gets Montreal", storeTz(), "America/Montreal");
    check("...and its own date", storeDateKey(evening), "2026-09-10");
    check("...and its own clock", storeTimeKey(evening), "22:30");
  });

  await runAsOrg(calgary, async () => {
    check("Calgary gets Calgary", storeTz(), "America/Edmonton");
    check("...the same instant, its own date", storeDateKey(evening), "2026-09-10");
    check("...two hours earlier on the clock", storeTimeKey(evening), "20:30");
  });

  // The failure that would matter most: one tenant's zone surviving into the
  // next iteration of a loop over organizations.
  const seen: string[] = [];
  for (const org of [montreal, calgary, montreal]) {
    await runAsOrg(org, async () => {
      seen.push(storeTimeKey(evening));
    });
  }
  check("a loop over tenants does not leak the previous one", seen, ["22:30", "20:30", "22:30"]);

  check("and the context is gone again afterwards", storeTz(), STORE_TZ);

  // Concurrency is the other way it would leak: two tenants in flight at once.
  const [a, b] = await Promise.all([
    runAsOrg(montreal, async () => {
      await new Promise((r) => setTimeout(r, 10));
      return storeTimeKey(evening);
    }),
    runAsOrg(calgary, async () => storeTimeKey(evening)),
  ]);
  check("two tenants at once keep their own clocks", [a, b], ["22:30", "20:30"]);

  // A date near midnight is where a wrong zone changes the DAY, not just the
  // hour — which is what puts a job on the wrong day of a schedule.
  const lateNight = new Date("2026-09-11T04:30:00.000Z"); // 00:30 Montreal, 22:30 Calgary
  await runAsOrg(montreal, async () => {
    check("past midnight in Montreal it is the 11th", storeDateKey(lateNight), "2026-09-11");
  });
  await runAsOrg(calgary, async () => {
    check("...while in Calgary it is still the 10th", storeDateKey(lateNight), "2026-09-10");
  });

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

void main();
