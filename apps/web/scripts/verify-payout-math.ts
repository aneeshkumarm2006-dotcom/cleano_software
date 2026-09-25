// Pure-math verification for fix list item 1. No DB access.
import { computePayoutTotals, summarisePayouts } from "../src/lib/payout-math";

let pass = 0;
let fail = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
  if (!ok) console.log(`        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  ok ? pass++ : fail++;
}

const P = (b: number, a: number, d: number, r: number) => ({
  baseAmount: b, adjustments: a, deductions: d, reimbursements: r,
});

// The exact row the client reported: base 0, deduction 20 -> was -20.
check("client's reported row (0, 0, 20, 0)",
  computePayoutTotals(P(0, 0, 20, 0)), { raw: -20, final: 0, shortfall: 20 });

// The period they saw as -$40.00 is two of those rows.
check("period rollup of the two -$20 rows",
  summarisePayouts([P(0, 0, 20, 0), P(0, 0, 20, 0)]),
  { totalFinal: 0, totalShortfall: 40, shortfallCount: 2 });

// Normal payouts must be completely unchanged.
check("normal payout untouched",
  computePayoutTotals(P(480, 0, 0, 0)), { raw: 480, final: 480, shortfall: 0 });
check("payout with a coverable deduction",
  computePayoutTotals(P(480, 25, 20, 15)), { raw: 500, final: 500, shortfall: 0 });

// Exactly zero is not a shortfall.
check("deduction exactly equals earnings",
  computePayoutTotals(P(100, 0, 100, 0)), { raw: 0, final: 0, shortfall: 0 });

// One bad row must not drag a whole period negative.
check("one floored row does not reduce the period total",
  summarisePayouts([P(300, 0, 0, 0), P(0, 0, 45, 0)]),
  { totalFinal: 300, totalShortfall: 45, shortfallCount: 1 });

// Float noise must not leak into stored money.
check("float noise is rounded to cents",
  computePayoutTotals(P(0.1, 0.2, 0, 0)), { raw: 0.3, final: 0.3, shortfall: 0 });

// Defensive: non-finite input must not produce NaN money.
check("NaN input treated as zero",
  computePayoutTotals(P(NaN, 0, 20, 0)), { raw: -20, final: 0, shortfall: 20 });

console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail === 0 ? 0 : 1);
