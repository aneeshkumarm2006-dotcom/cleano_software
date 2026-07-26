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
import type { CleanerRateInput } from "../src/lib/pay-tiers";

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
): [string, CleanerRateInput] => [
  id,
  { id, tier: "STANDARD", avgRating: null, ratingCount: 0, ...opts },
];

// A 45% cleaner: STANDARD, 5-star, past the 5-rating lock.
const FIVE_STAR = { avgRating: 5.0, ratingCount: 12 };

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
check("$112 solo at 45% -> $50.40", paid(bugged, "asia"), 50.4);
check("admin is paid nothing", paid(bugged, "admin"), 0);

// Their other quoted figures.
check("$220 at Tanya's 45% -> $99.00",
  paid(job({ employeeId: "admin", price: 220, cleaners: [{ id: "tanya" }] }), "tanya"), 99);
check("$112 at the 40% default -> $44.80",
  paid(job({ employeeId: "admin", price: 112, cleaners: [{ id: "bob" }] }), "bob"), 44.8);

// A job with NO cleaner must pay nobody (this was paying the admin $88/$141.20).
const unassigned = job({ employeeId: "admin", price: 220 });
check("unassigned job pays nobody", jobParticipantIds(unassigned, RATES), []);
check("unassigned job produces no shares", computeJobPayShares(unassigned, RATES).size, 0);

// ── The guard must not over-reach ──────────────────────────────────────────
// A real employee lead with no cleaners row (legacy job) is still paid.
check("legacy employee lead still paid",
  paid(job({ employeeId: "tanya", price: 220 }), "tanya"), 99);
// An owner who is genuinely assigned IS paid.
check("assigned owner is still a participant",
  jobParticipantIds(job({ employeeId: "owner", cleaners: [{ id: "owner" }] }), RATES), ["owner"]);
// The guard only applies to admin/owner roles.
check("employee lead not in cleaners is kept",
  jobParticipantIds(job({ employeeId: "bob", cleaners: [{ id: "asia" }] }), RATES).sort(),
  ["asia", "bob"]);
// ── The settled pay model (awer_fixes.pdf items 3 + 11) ────────────────────
// A paired job pays each cleaner their OWN rate on the full price. $55.00 was
// the old half-pool share the client rejected by name.
const paired = job({
  employeeId: "admin", price: 220,
  cleaners: [{ id: "asia" }, { id: "tanya" }],
});
check("paired job: 45% cleaner gets the full $99.00, not $55.00", paid(paired, "asia"), 99);
check("paired job: the other 45% cleaner also gets $99.00", paid(paired, "tanya"), 99);

// A mixed-rate pair: each is independent of the other's rate.
const mixed = job({ price: 220, cleaners: [{ id: "asia" }, { id: "bob" }] });
check("mixed pair: 45% cleaner unaffected by partner's rate", paid(mixed, "asia"), 99);
check("mixed pair: 40% cleaner gets 40% of the full price", paid(mixed, "bob"), 88);

// Adding a third cleaner must not reduce anyone's pay.
check("adding a cleaner does not dilute the others",
  paid(job({ price: 220, cleaners: [{ id: "asia" }, { id: "bob" }, { id: "tanya" }] }), "asia"), 99);

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
