// Stage 14.2 — one command for the whole regression sweep.
//
// `npm run verify` runs every scripts/verify-*.ts and prints one table. It
// exists because the sweep had drifted into tribal knowledge: which scripts are
// current, which need a flag to run at all, and which failures are "known".
// None of that survives a release cycle in someone's head.
//
// The flag that mattered: verify-cleaner-pay.ts reaches @/lib/job-assignments,
// which pulls in modules that `import "server-only"`. Next aliases that package
// away at build time, but plain tsx resolves the real one, whose main export
// throws by design ("cannot be imported from a Client Component"). Its package
// exports map a `react-server` condition to an empty module — which is exactly
// what a server-side script is — so running under that condition is the fix,
// not deleting the import. Passing it for every script keeps one code path.
//
// Scripts with a --db mode are run WITHOUT it on purpose: the default sweep
// stays code-only so it needs no database, matching how each script is written.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const SCRIPTS_DIR = path.join(process.cwd(), "scripts");

const files = fs
  .readdirSync(SCRIPTS_DIR)
  .filter((f) => f.startsWith("verify-") && f.endsWith(".ts"))
  .sort();

if (files.length === 0) {
  console.error("No scripts/verify-*.ts found — is the cwd the app root?");
  process.exit(1);
}

const only = process.argv.slice(2).filter((a) => !a.startsWith("-"));
const targets = only.length
  ? files.filter((f) => only.some((o) => f.includes(o)))
  : files;

if (targets.length === 0) {
  console.error(`No verify script matched ${only.join(", ")}`);
  process.exit(1);
}

type Result = { file: string; code: number; tally: string };
const results: Result[] = [];

for (const file of targets) {
  process.stdout.write(`\n\x1b[1m── ${file} ${"─".repeat(Math.max(0, 60 - file.length))}\x1b[0m\n`);
  const run = spawnSync(
    process.execPath,
    [
      path.join("node_modules", "tsx", "dist", "cli.mjs"),
      "--conditions=react-server",
      path.join("scripts", file),
    ],
    { encoding: "utf8", cwd: process.cwd() },
  );

  const out = `${run.stdout ?? ""}${run.stderr ?? ""}`;
  const code = run.status ?? 1;

  // Each script prints its own tally; the shapes differ ("80/80 passed" vs
  // "167 passed, 0 failed"), so accept both rather than making them uniform.
  const tally =
    out.match(/\d+\s*\/\s*\d+ passed/g)?.pop() ??
    out.match(/\d+ passed, \d+ failed/g)?.pop() ??
    (code === 0 ? "passed" : "DID NOT RUN");

  // Full output only when something is wrong — a green sweep is ~2000 PASS
  // lines and nobody reads those.
  if (code === 0) {
    const skips = out.match(/^SKIP .*$/gm) ?? [];
    console.log(`   \x1b[32m✔\x1b[0m ${tally}`);
    for (const s of skips) console.log(`   \x1b[33m${s}\x1b[0m`);
  } else {
    console.log(out.trimEnd());
    console.log(`   \x1b[31m✘ ${tally}\x1b[0m`);
  }

  results.push({ file, code, tally });
}

const failed = results.filter((r) => r.code !== 0);
const width = Math.max(...results.map((r) => r.file.length));

console.log(`\n${"═".repeat(width + 26)}`);
for (const r of results) {
  const mark = r.code === 0 ? "\x1b[32m✔\x1b[0m" : "\x1b[31m✘\x1b[0m";
  console.log(`${mark} ${r.file.padEnd(width)}  ${r.tally}`);
}
console.log("═".repeat(width + 26));
console.log(
  failed.length === 0
    ? `\x1b[32m${results.length}/${results.length} verify scripts green\x1b[0m`
    : `\x1b[31m${failed.length} of ${results.length} FAILED: ${failed.map((f) => f.file).join(", ")}\x1b[0m`,
);

process.exit(failed.length === 0 ? 0 : 1);
