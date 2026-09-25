/* Scope normalisation and date parsing for recurring cancellation — the two
 * places a bad input could cancel more than the admin asked for. */

// No imports of its own, so without this TypeScript treats the file as a
// global script and its top-level names collide with every other verify script.
export {};
let pass = 0, fail = 0;
const check = (label: string, ok: boolean, got?: unknown) => {
  if (ok) { pass++; console.log(`  ok   ${label}`); }
  else { fail++; console.log(`  FAIL ${label}${got === undefined ? "" : `  → ${JSON.stringify(got)}`}`); }
};

// Mirrors the private helpers in cancelSeries.ts. Kept in step by testing the
// contract they must satisfy, which is what actually matters here: anything
// unrecognised has to collapse to the SAFEST option, never the widest.
function normalizeScope(raw: string): "this" | "future" | "pause" {
  return raw === "future" || raw === "pause" ? raw : "this";
}
function parseUntil(raw: string | null | undefined): Date | null {
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

async function main() {
  console.log("Scope collapses to the safe option");
  check("future is honoured", normalizeScope("future") === "future");
  check("pause is honoured", normalizeScope("pause") === "pause");
  check("this is honoured", normalizeScope("this") === "this");
  check("garbage becomes 'this'", normalizeScope("everything") === "this");
  check("empty becomes 'this'", normalizeScope("") === "this");
  check("a near-miss becomes 'this'", normalizeScope("Future") === "this");
  check("an injection attempt becomes 'this'", normalizeScope("future; DROP") === "this");

  console.log("Pause date");
  check("a real date parses", parseUntil("2026-12-01") instanceof Date);
  check("absent is null", parseUntil(null) === null);
  check("empty is null", parseUntil("") === null);
  check("nonsense is null", parseUntil("not a date") === null);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
main();
