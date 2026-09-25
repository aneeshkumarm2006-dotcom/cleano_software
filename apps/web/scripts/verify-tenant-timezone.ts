// Sept 10 fix list, item 6 part 2: does a tenant get its OWN clock?
//
// This is the piece with real cross-tenant risk, so it is exercised rather than
// asserted against source. Every check below runs the real helpers inside a
// real organization context and looks at what comes out.
import { runAsOrg } from "../src/lib/org-context";
import { STORE_TZ, storeTz, storeDateKey, storeTimeKey } from "../src/lib/timezone";
import {
  currentRequestTz,
  pageStoreTz,
  rememberRequestTz,
} from "../src/lib/store-tz.server";

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

  // ── The request half (item 6 part 2, second pass) ────────────────────────
  //
  // A browser request cannot announce anything, so the answer is remembered by
  // getCurrentOrg() into a React per-request cache. Outside a request there is
  // no cache to remember into, and the important property is that this FAILS
  // CLOSED rather than remembering globally: a module-level variable here
  // would be shared by every request the server is handling at once, which is
  // a cross-tenant leak that only shows up under load.
  rememberRequestTz("America/Edmonton");
  check(
    "a zone remembered outside a request does not stick anywhere",
    currentRequestTz(),
    undefined,
  );
  check("...so nothing moves", storeTz(), STORE_TZ);

  // An announcement still outranks the request, because a platform admin
  // acting on another workspace is looking at THAT workspace's times.
  await runAsOrg(calgary, async () => {
    check("an announcement outranks the request", pageStoreTz(), "America/Edmonton");
  });
  check("and without one there is nothing to stamp", pageStoreTz(), undefined);

  // ── The browser half ─────────────────────────────────────────────────────
  //
  // The server stamps the zone on the page so a client component formats in
  // the same one as the server-rendered half of that page. Simulated here by
  // giving the module the `window` it looks for.
  const g = globalThis as { window?: { __cleanoTz?: unknown } };
  try {
    g.window = { __cleanoTz: "America/Edmonton" };
    check("a browser reads the zone stamped on the page", storeTz(), "America/Edmonton");
    check("...and dates come out in it", storeTimeKey(evening), "20:30");

    // A garbage zone would otherwise make every Intl.DateTimeFormat on the
    // page throw, and `Organization.timezone` is an editable text column. One
    // bad save must print the wrong hour at worst, never a blank workspace.
    g.window = { __cleanoTz: "Mars/Olympus_Mons" };
    check("an unusable zone falls back instead of throwing", storeTz(), STORE_TZ);
    check("...and dates still format", storeTimeKey(evening) !== "", true);

    g.window = { __cleanoTz: 42 };
    check("a non-string is ignored", storeTz(), STORE_TZ);
  } finally {
    delete g.window;
  }
  check("and the browser value is gone again afterwards", storeTz(), STORE_TZ);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

void main();
