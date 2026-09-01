// Pure-math verification for fix list items 3 + 4. No DB access.
//
// Covers the exact figures the client quoted, plus the guard that stops an
// admin auto-stamped onto Job.employeeId from being paid.
import {
  computeJobPayShares,
  jobParticipantIds,
  type JobPayInput,
} from "../src/lib/cleaner-earnings";
import { resolveJobLead } from "../src/lib/job-assignments";
import { fallbackRateInput, type CleanerRateInput } from "../src/lib/pay-tiers";

let pass = 0;
let fail = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
  if (!ok) console.log(`        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  ok ? pass++ : fail++;
}

const rate = (
  id: string,
  opts: Partial<CleanerRateInput> = {}
): [string, CleanerRateInput] => [id, { ...fallbackRateInput(id), ...opts }];

// A 5-star cleaner past the 5-rating gate. 1.25 is what the DEFAULT multiplier
// map prices a 5.0 average at, so their rate is 40% x 1.25 = 50%.
//
// This used to be 45%, from the hardcoded standardRateForRating ladder. That
// ladder was retired by awerfixes.pdf item 1 / Decision 1 (2026-08-06) — the
// rate is now `tier base x the admin-configured multiplier`. The dollar figures
// the client quoted in the previous round ($50.40 / $99.00) were computed at
// 45% and necessarily move; what those assertions actually protect — no halved
// pool, no dilution by teammates, admins never paid — is unchanged and still
// asserted below.
const FIVE_STAR = { avgRating: 5.0, ratingCount: 12, multiplier: 1.25 };

const RATES = new Map<string, CleanerRateInput>([
  rate("admin", { role: "ADMIN" }),
  rate("owner", { role: "OWNER" }),
  rate("tanya", { role: "EMPLOYEE", ...FIVE_STAR }),
  rate("asia", { role: "EMPLOYEE", ...FIVE_STAR }),
  rate("bob", { role: "EMPLOYEE" }), // no ratings -> 40% floor
]);

function job(over: Partial<JobPayInput>): JobPayInput {
  return {
    id: "j", employeeId: null, cleaners: [], price: null, employeePay: null,
    payType: "PERCENTAGE", hourlyRate: null, payRateMultiplier: 1, totalTip: null,
    jobDate: null, startTime: null, endTime: null, clockInTime: null,
    clockOutTime: null, assignments: [], ...over,
  };
}
const paid = (j: JobPayInput, id: string) =>
  computeJobPayShares(j, RATES).get(id)?.total ?? 0;

// ── The bug the client reported ────────────────────────────────────────────
// Admin stamped on employeeId + one real cleaner. Used to pay $29.65.
const bugged = job({
  employeeId: "admin", price: 112,
  cleaners: [{ id: "asia" }], assignments: [{ cleanerId: "asia", payAmount: null }],
});
check("admin on employeeId is not a participant", jobParticipantIds(bugged, RATES), ["asia"]);
check("$112 solo at 50% (40% x 1.25) -> $56.00", paid(bugged, "asia"), 56);
check("admin is paid nothing", paid(bugged, "admin"), 0);

// Their other quoted figures, at the post-Decision-1 rate.
check("$220 at Tanya's 50% -> $110.00",
  paid(job({ employeeId: "admin", price: 220, cleaners: [{ id: "tanya" }] }), "tanya"), 110);
check("$112 at the 40% base (no ratings, no multiplier) -> $44.80",
  paid(job({ employeeId: "admin", price: 112, cleaners: [{ id: "bob" }] }), "bob"), 44.8);

// A job with NO cleaner must pay nobody (this was paying the admin $88/$141.20).
const unassigned = job({ employeeId: "admin", price: 220 });
check("unassigned job pays nobody", jobParticipantIds(unassigned, RATES), []);
check("unassigned job produces no shares", computeJobPayShares(unassigned, RATES).size, 0);

// ── The guard must not over-reach ──────────────────────────────────────────
// A real employee lead with no cleaners row (legacy job) is still paid.
check("legacy employee lead still paid",
  paid(job({ employeeId: "tanya", price: 220 }), "tanya"), 110);
// An owner who is genuinely assigned IS paid.
check("assigned owner is still a participant",
  jobParticipantIds(job({ employeeId: "owner", cleaners: [{ id: "owner" }] }), RATES), ["owner"]);
// The guard only applies to admin/owner roles.
check("employee lead not in cleaners is kept",
  jobParticipantIds(job({ employeeId: "bob", cleaners: [{ id: "asia" }] }), RATES).sort(),
  ["asia", "bob"]);
// ── The pay model (Aug 31 list item 9, 2026-09-01) ─────────────────────────
// REVERSED from awer_fixes.pdf item 3, which these very assertions used to
// pin. The rate is now averaged across the crew, applied to the price ONCE and
// split evenly, so a paired job costs half what it did. $55.00 below is the
// exact figure the client rejected by name in the earlier round and has now
// asked for; it is left spelled out so the reversal is impossible to miss.
const paired = job({
  employeeId: "admin", price: 220,
  cleaners: [{ id: "asia" }, { id: "tanya" }],
});
check("paired job: pool is 220 x 50% applied once, halved -> $55.00", paid(paired, "asia"), 55);
check("paired job: the other cleaner gets the same $55.00", paid(paired, "tanya"), 55);
check("paired job: crew costs 220 x 50% in total, not twice that",
  paid(paired, "asia") + paid(paired, "tanya"), 110);

// A mixed-rate pair pools the AVERAGE rate and then splits evenly, so each
// cleaner's share now depends on who they are working with.
const mixed = job({ price: 220, cleaners: [{ id: "asia" }, { id: "bob" }] });
check("mixed pair: pool = 220 x mean(50%, 40%) = $99.00 total",
  paid(mixed, "asia") + paid(mixed, "bob"), 99);
check("mixed pair: split evenly regardless of tier", paid(mixed, "asia"), paid(mixed, "bob"));

// Adding a cleaner now DOES dilute the others — that is the change, not a bug.
const trio = job({ price: 220, cleaners: [{ id: "asia" }, { id: "bob" }, { id: "tanya" }] });
check("adding a cleaner dilutes the others (deliberate)",
  paid(trio, "asia") < paid(paired, "asia"), true);
check("trio: shares still reconcile to the pool within a cent",
  Math.abs(paid(trio, "asia") + paid(trio, "bob") + paid(trio, "tanya") - 102.67) < 0.02, true);

// ── Lead resolution ────────────────────────────────────────────────────────
check("lead: existing lead still on team is kept", resolveJobLead("tanya", ["asia", "tanya"]), "tanya");
check("lead: stale admin lead is replaced", resolveJobLead("admin", ["asia"]), "asia");
check("lead: empty team clears the lead", resolveJobLead("asia", []), null);
check("lead: no previous lead takes the first cleaner", resolveJobLead(null, ["asia", "tanya"]), "asia");

// ── Item 11: a fixed/custom TOTAL still splits evenly, overrides still win ──
const flat = job({
  price: 0, employeePay: 100, payType: "FLAT",
  cleaners: [{ id: "asia" }, { id: "bob" }],
});
check("FLAT total splits evenly between the pair", paid(flat, "asia"), 50);
check("FLAT total splits evenly (other cleaner)", paid(flat, "bob"), 50);

const overridden = job({
  price: 0, employeePay: 100, payType: "FLAT",
  cleaners: [{ id: "asia" }, { id: "bob" }],
  assignments: [
    { cleanerId: "asia", payAmount: 70 },
    { cleanerId: "bob", payAmount: null },
  ],
});
check("manual override wins for that cleaner", paid(overridden, "asia"), 70);
check("the rest splits the remainder (70/30)", paid(overridden, "bob"), 30);

// An override must beat the percentage model too (free/courtesy jobs).
check("override beats the percentage calc",
  paid(job({
    price: 220, cleaners: [{ id: "asia" }],
    assignments: [{ cleanerId: "asia", payAmount: 25 }],
  }), "asia"), 25);

console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail === 0 ? 0 : 1);
