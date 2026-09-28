// The withdrawal fee comes off the balance too. Pure math: no database.
//
//   npx tsx --conditions react-server scripts/verify-withdrawal-fee.ts
//
// A withdrawal is stored at the NET (`amount`) with the fee beside it
// (`feeAmount`); the balance reserves both for every non-REJECTED row, so the
// balance loses exactly what was asked for and the fee can't be withdrawn
// again. This walks the same rules the server runs (lib/withdrawal-rules.ts,
// the math inside server/pay/balance.ts and server/pay/withdraw.ts). The
// phone's copy of the fee (apps/staff features/pay/words.ts) isn't imported:
// its React Native types would leak into this app's type check.
import {
  RESERVING_WITHDRAWAL_STATUSES,
  WITHDRAWAL_FEE_BASIS_POINTS,
  WITHDRAWAL_MINIMUM_CENTS,
  reservedCentsOf,
  withdrawalFeeCents,
} from "../src/lib/withdrawal-rules";

let pass = 0;
let fail = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
  if (!ok) console.log(`        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  if (ok) pass++;
  else fail++;
}

type Status = "PENDING" | "APPROVED" | "REJECTED" | "COMPLETED";
interface Row {
  amount: number;
  feeAmount: number;
  status: Status;
}

/** readBalance's rawCents, with the paid side given. */
function balance(paidCents: number, rows: Row[]): number {
  const reserving = new Set<string>(RESERVING_WITHDRAWAL_STATUSES);
  return paidCents - rows.filter((r) => reserving.has(r.status)).reduce((s, r) => s + reservedCentsOf(r), 0);
}

/** requestWithdrawalService's checks and insert, minus the database. */
function request(paidCents: number, rows: Row[], amountCents: number, bps = WITHDRAWAL_FEE_BASIS_POINTS) {
  if (!Number.isSafeInteger(amountCents) || amountCents < WITHDRAWAL_MINIMUM_CENTS) return "AMOUNT_TOO_SMALL";
  const fee = withdrawalFeeCents(amountCents, bps);
  const net = amountCents - fee;
  if (net < 1) return "AMOUNT_TOO_SMALL";
  const raw = balance(paidCents, rows);
  if (amountCents > raw) return "INSUFFICIENT_BALANCE";
  const row: Row = { amount: net / 100, feeAmount: fee / 100, status: "PENDING" };
  rows.push(row);
  return { row, fee, net, availableCents: Math.max(0, raw - amountCents) };
}

// ── $100, withdraw $100 → 0 ───────────────────────────────────────────────
{
  const rows: Row[] = [];
  const r = request(10_000, rows, 10_000);
  check("$100 → withdraw $100: fee $5, net $95", typeof r === "object" ? [r.fee, r.net] : r, [500, 9500]);
  check("$100 → withdraw $100: the answer's balance left is 0", typeof r === "object" ? r.availableCents : r, 0);
  check("$100 → withdraw $100: the balance read back is 0, not the $5 fee", balance(10_000, rows), 0);
  check("...so the fee can't be withdrawn again", request(10_000, rows, 500), "INSUFFICIENT_BALANCE");
  check("...not even one cent's worth", request(10_000, rows, 2), "INSUFFICIENT_BALANCE");
}

// ── $50 at 5% → balance down exactly $50 ──────────────────────────────────
{
  const rows: Row[] = [];
  const r = request(10_000, rows, 5_000);
  check("$50 at 5%: fee $2.50, net $47.50 stored", typeof r === "object" ? [r.fee, r.row.amount, r.row.feeAmount] : r, [250, 47.5, 2.5]);
  check("$50 at 5%: balance $100 → $50 exactly", balance(10_000, rows), 5_000);
  check("$50 at 5%: the answer agrees", typeof r === "object" ? r.availableCents : r, 5_000);
  check("then the remaining $50 fits exactly", typeof request(10_000, rows, 5_000) === "object" && balance(10_000, rows), 0);
}

// ── Integer cents across many odd amounts: no float drift ─────────────────
{
  const rows: Row[] = [];
  for (let i = 0; i < 37; i++) request(1_000_000, rows, 1_999);
  check("37 × $19.99: balance down exactly 37 × 1999 cents", balance(1_000_000, rows), 1_000_000 - 37 * 1_999);
}

// ── The 1-cent fee floor ──────────────────────────────────────────────────
check("fee on 9¢ at 5% is 1¢ (round would give 0)", withdrawalFeeCents(9, 500), 1);
check("fee on 1¢ at 5% is 1¢", withdrawalFeeCents(1, 500), 1);
check("fee on 10¢ at 5% is 1¢ (0.5 rounds up)", withdrawalFeeCents(10, 500), 1);
check("fee on $20 at 5% is $1", withdrawalFeeCents(2_000, 500), 100);
check("no fee when the rate is 0", withdrawalFeeCents(5_000, 0), 0);
check("no fee on nothing", withdrawalFeeCents(0, 500), 0);
check("a 1¢ request at 5% is too small (net 0)", request(10_000, [], 1), "AMOUNT_TOO_SMALL");
{
  const rows: Row[] = [];
  const r = request(10_000, rows, 9);
  check("a 9¢ request pays a 1¢ fee and reserves all 9¢", typeof r === "object" ? [r.fee, r.net, balance(10_000, rows)] : r, [1, 8, 9_991]);
}
check("a 1¢ request at 0% goes through fee-free", typeof request(10_000, [], 1, 0), "object");

// ── A rejected withdrawal releases net AND fee ────────────────────────────
{
  const rows: Row[] = [];
  const r = request(10_000, rows, 4_000);
  check("before: $40 asked takes $40 off", balance(10_000, rows), 6_000);
  if (typeof r === "object") r.row.status = "REJECTED";
  check("rejected: the whole $40 (net + fee) is back", balance(10_000, rows), 10_000);
  for (const s of ["APPROVED", "COMPLETED"] as const) {
    if (typeof r === "object") r.row.status = s;
    check(`${s}: still holds net + fee`, balance(10_000, rows), 6_000);
  }
}

// ── Legacy rows: fee 0, net only ──────────────────────────────────────────
check("a legacy row (feeAmount 0) holds only its net", balance(10_000, [{ amount: 57, feeAmount: 0, status: "COMPLETED" }]), 4_300);
check("reservedCentsOf treats a missing fee as 0", reservedCentsOf({ amount: 19, feeAmount: null }), 1_900);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
