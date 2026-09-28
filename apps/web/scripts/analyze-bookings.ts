/**
 * Pure (no-DB) analysis of a BookingKoala export — same parser/mapper the
 * importer uses. Usage: npx tsx scripts/analyze-bookings.ts --file=/abs/path.csv
 */
import fs from "node:fs";
import {
  parseAndNormalize,
  aggregateCustomers,
  collectCleaners,
} from "../src/lib/bookingkoala/core";

const fileArg = process.argv.find((a) => a.startsWith("--file="))?.slice("--file=".length);
if (!fileArg) {
  console.error("Pass --file=/abs/path.csv");
  process.exit(1);
}
const text = fs.readFileSync(fileArg, "utf8");
const parsed = parseAndNormalize(text);
const rows = parsed.rows;

const tally = (arr: string[]) => {
  const m: Record<string, number> = {};
  for (const k of arr) m[k] = (m[k] || 0) + 1;
  return Object.entries(m).sort((a, b) => b[1] - a[1]);
};

const customers = aggregateCustomers(rows);
const cleaners = collectCleaners(rows);

const statuses = rows.map((r) => r.job.status);
const types = rows.map((r) => r.job.jobType);
const pays = rows.map((r) => r.job.paymentType);
const assigned = rows.filter((r) => r.providers.length > 0).length;
const unassigned = rows.length - assigned;

// dedup on BookingKoala booking id (true duplicates only)
const seen = new Set<string>();
let dupes = 0;
for (const r of rows) {
  const k = r.job.bookingId
    ? `bk:${r.job.bookingId}`
    : `${r.customerKey}|${r.job.startTime.toISOString()}`;
  if (seen.has(k)) dupes++;
  else seen.add(k);
}

const dates = rows.map((r) => r.job.startTime.getTime()).sort((a, b) => a - b);
const fmt = (t: number) => new Date(t).toISOString().slice(0, 10);
const revenue = rows.reduce((s, r) => s + (r.job.price || 0), 0);
const noEmail = customers.filter((c) => !c.email).length;
const totalAddrs = customers.reduce((s, c) => s + c.addresses.length, 0);

const line = (s = "") => console.log(s);
line("\n" + "=".repeat(60));
line("BOOKINGKOALA SHEET ANALYSIS (no DB — pure parse/map)");
line("=".repeat(60));
line(`Parsed rows:        ${parsed.parsedCount}`);
line(`In range (Jun1-Aug1): ${rows.length}`);
line(`Dropped out-of-range: ${parsed.droppedCount}`);
line(`Mojibake fixed:     ${parsed.mojibakeCount}`);
line(`Date span:          ${rows.length ? fmt(dates[0]) + " → " + fmt(dates[dates.length - 1]) : "—"}`);
line(`Duplicate rows (same customer+time): ${dupes}`);

line("\n— CLEANERS —");
line(`Unique cleaners: ${cleaners.length}`);
line(`  with email: ${cleaners.filter((c) => c.email).length} · no email (can't create login): ${cleaners.filter((c) => !c.email).length}`);

line("\n— CUSTOMERS —");
line(`Unique customers: ${customers.length}  (no email → matched by name+phone: ${noEmail})`);
line(`Distinct addresses to store: ${totalAddrs}`);

line("\n— JOBS —");
line(`Total: ${rows.length}  ·  assigned: ${assigned}  ·  unassigned: ${unassigned}`);
line(`Status (→ calendar): ${JSON.stringify(Object.fromEntries(tally(statuses)))}`);
line("  PAID=green · SCHEDULED=blue/pink · CREATED=on-hold ($0)");
line(`Payment type: ${JSON.stringify(Object.fromEntries(tally(pays)))}`);
line(`Service / job type:`);
for (const [t, n] of tally(types)) line(`    ${n.toString().padStart(4)}  ${t}`);
line(`\nGross service total across in-range jobs: $${revenue.toFixed(2)}`);
line("=".repeat(60) + "\n");
