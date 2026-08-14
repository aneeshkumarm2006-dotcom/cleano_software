/**
 * Stage 7 — post-deploy verification and the one-week watch
 * (`../_ai_context/TODO.md`, third list, items 7.1 and 7.5).
 *
 *   npx tsx scripts/post-deploy-check.ts            # default window: 7 days
 *   npx tsx scripts/post-deploy-check.ts --days=1   # the daily watch run
 *
 * Two jobs in one script, because they are asked the same day and answered by
 * the same connection:
 *
 *   7.1  Did the four migrations land, and did they stamp what their headers
 *        said they would? Each of the three hand-authored migrations ends with
 *        a read-only `GROUP BY` to run "straight after `prisma migrate deploy`"
 *        — Prisma's engine discards Postgres notices, so the counts could not
 *        be logged from inside the migration itself. Those queries live here
 *        rather than in a paste buffer, so the answer is reproducible and the
 *        expected value is written down beside the measured one.
 *
 *   7.5  Has any clock-out failed since the deploy? Until fix 6 shipped there
 *        was no answer to that question at all — every failure died in a
 *        `console.error`. `CLOCK_OUT_FAILED` JobLog rows are the first direct
 *        measurement of the clock-out failure rate this project has ever had,
 *        and this is the query that reads them, grouped by the error code the
 *        action stamps into `field`.
 *
 * ## What this script deliberately does NOT do
 *
 * 7.5 also asks for a week of Vercel function logs on `/admin/settings`. Those
 * are not reachable from here — it needs either the Vercel connector (not
 * authorized in this project) or `vercel logs` run by the account owner. What
 * IS measurable without Vercel is the thing those logs would be watched FOR:
 * the page runs 15 reads against a pooler that measures seconds per query,
 * inside `export const maxDuration = 60`. So the last section times the four
 * heaviest of those reads and prints the growth counters behind them. A page
 * that is drifting toward its own timeout shows up here first.
 *
 * ## Read-only
 *
 * Every statement is a `SELECT`. Nothing here writes and nothing that writes
 * may be added — `verify-pricing-fixes.ts` holds this file to that
 * mechanically, the same way it holds `probe-pricing-fixes.ts`.
 *
 * ## Exit code
 *
 *   0  everything applied, nothing stamped wrong, no failed clock-outs.
 *   1  something wants a human: a migration missing, a sanity count off, or a
 *      `CLOCK_OUT_FAILED` row inside the window. Run before the deploy it will
 *      exit 1 reporting four unapplied migrations — that is the correct answer,
 *      not a bug in the script.
 */
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

const DAYS = (() => {
  const arg = process.argv.find((a) => a.startsWith("--days="));
  const n = arg ? Number(arg.slice("--days=".length)) : 7;
  return Number.isFinite(n) && n > 0 ? n : 7;
})();

let problems = 0;
const pad = (label: string, width = 52) => label.padEnd(width, ".");

function verdict(name: string, okv: boolean, detail: string) {
  console.log(`  ${okv ? "OK  " : "WANT"}  ${pad(name)} ${detail}`);
  if (!okv) problems++;
}

/** Does this column exist yet? Asked before every query that reads it, so an
 *  unapplied migration reports as "not applied" instead of a Postgres error. */
async function columnExists(table: string, column: string): Promise<boolean> {
  const rows = await db.$queryRaw<{ n: bigint }[]>`
    SELECT count(*) AS n FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = ${table} AND column_name = ${column}
  `;
  return Number(rows[0]?.n ?? 0) > 0;
}

/** Is this value present on this Postgres enum type yet? */
async function enumHasValue(type: string, value: string): Promise<boolean> {
  const rows = await db.$queryRaw<{ n: bigint }[]>`
    SELECT count(*) AS n FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = ${type} AND e.enumlabel = ${value}
  `;
  return Number(rows[0]?.n ?? 0) > 0;
}

// ── 7.1 · did the four migrations land ─────────────────────────────────────

/** The four this round adds, in the order `migrate deploy` must run them. */
const MIGRATIONS = [
  "20260814000000_job_pricing_mode",
  "20260814010000_job_employee_pay_is_manual",
  "20260814020000_job_log_clock_out_failed",
  "20260814030000_applicant_access_model",
];

async function checkMigrations(): Promise<Set<string>> {
  console.log("\n═══ 7.1 · migration state ═══\n");

  const rows = await db.$queryRaw<
    { migration_name: string; finished_at: Date | null; rolled_back_at: Date | null }[]
  >`
    SELECT migration_name, finished_at, rolled_back_at
    FROM "_prisma_migrations"
    WHERE migration_name = ANY(${MIGRATIONS})
  `;

  const applied = new Set<string>();
  for (const name of MIGRATIONS) {
    const row = rows.find((r) => r.migration_name === name);
    const landed = !!row?.finished_at && !row.rolled_back_at;
    if (landed) applied.add(name);
    verdict(
      name,
      landed,
      row
        ? row.rolled_back_at
          ? `ROLLED BACK ${row.rolled_back_at.toISOString()}`
          : row.finished_at
            ? `applied ${row.finished_at.toISOString()}`
            : "started but never finished — inspect before re-running"
        : "not applied — run `npx prisma migrate deploy`"
    );
  }
  return applied;
}

// ── 7.1 · row-count sanity, one per migration header ───────────────────────

async function sanityPricingMode() {
  console.log("\n═══ 7.1 · pricingMode distribution ═══\n");
  if (!(await columnExists("Job", "pricingMode"))) {
    verdict("Job.pricingMode exists", false, "column absent — migration not applied");
    return;
  }
  const rows = await db.$queryRaw<{ mode: string; n: bigint }[]>`
    SELECT COALESCE("pricingMode"::text, 'NULL — unstamped') AS mode, count(*) AS n
    FROM "Job" GROUP BY 1 ORDER BY 2 DESC
  `;
  for (const r of rows) console.log(`  ${pad(r.mode)} ${String(r.n).padStart(6)}`);

  // The backfill stamps EVERY row — it is the addOnMoneyBasis truth table in
  // SQL, so a job left NULL means the UPDATE did not reach it.
  const unstamped = Number(
    rows.find((r) => r.mode.startsWith("NULL"))?.n ?? 0
  );
  verdict(
    "every job carries a mode",
    unstamped === 0,
    unstamped === 0 ? "0 unstamped" : `${unstamped} rows still NULL`
  );
}

async function sanityEmployeePayIsManual() {
  console.log("\n═══ 7.1 · employeePayIsManual distribution ═══\n");
  if (!(await columnExists("Job", "employeePayIsManual"))) {
    verdict(
      "Job.employeePayIsManual exists",
      false,
      "column absent — migration not applied"
    );
    return;
  }
  const rows = await db.$queryRaw<{ manual: boolean; n: bigint }[]>`
    SELECT "employeePayIsManual" AS manual, count(*) AS n
    FROM "Job" GROUP BY 1 ORDER BY 2 DESC
  `;
  for (const r of rows) {
    console.log(`  ${pad(r.manual ? "manual (honoured as team total)" : "automatic")} ${String(r.n).padStart(6)}`);
  }

  // D2 is opt-in per job: the backfill only flags BookingKoala imports that
  // carry a team payment, and on this database `bookingSource` is NULL
  // everywhere, so a true count of 0 immediately after deploy is EXPECTED and
  // is not a problem. It is printed rather than asserted for that reason —
  // what would be wrong is the column missing, which is checked above.
  const manual = Number(rows.find((r) => r.manual)?.n ?? 0);
  console.log(
    `\n  Note: ${manual} job(s) currently honour a manual team total. D2 is opt-in\n` +
      "  per job — an admin marking a stored figure Manual on the job page is what\n" +
      "  moves this number, not the migration."
  );
}

async function sanityApplicant() {
  console.log("\n═══ 7.1 · applicant access model ═══\n");

  const roleAdded = await enumHasValue("Roles", "APPLICANT");
  verdict("Roles.APPLICANT exists", roleAdded, roleAdded ? "present" : "absent");

  const logAction = await enumHasValue("JobLogAction", "CLOCK_OUT_FAILED");
  verdict(
    "JobLogAction.CLOCK_OUT_FAILED exists",
    logAction,
    logAction ? "present" : "absent — fix 6 cannot log a failure without it"
  );

  if (!(await columnExists("JobApplication", "userId"))) {
    verdict(
      "JobApplication.userId exists",
      false,
      "column absent — migration not applied"
    );
    return;
  }
  const [link] = await db.$queryRaw<{ linked: bigint; unlinked: bigint }[]>`
    SELECT count(*) FILTER (WHERE "userId" IS NOT NULL) AS linked,
           count(*) FILTER (WHERE "userId" IS NULL)     AS unlinked
    FROM "JobApplication"
  `;
  console.log(
    `  ${pad("applications with a portal account")} ${String(link?.linked ?? 0).padStart(6)}`
  );
  console.log(
    `  ${pad("applications with no invite (unchanged)")} ${String(link?.unlinked ?? 0).padStart(6)}`
  );

  // The tables the invite flow writes to. Empty right after deploy is correct;
  // what matters is that they exist, because "Invite to portal" fails without.
  for (const t of ["ApplicantInviteToken", "ApplicantMessage"]) {
    const [row] = await db.$queryRaw<{ n: bigint }[]>`
      SELECT count(*) AS n FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = ${t}
    `;
    verdict(`${t} table exists`, Number(row?.n ?? 0) > 0, "");
  }

  if (roleAdded) {
    const [u] = await db.$queryRaw<{ n: bigint }[]>`
      SELECT count(*) AS n FROM "User" WHERE role::text = 'APPLICANT'
    `;
    console.log(
      `  ${pad("live APPLICANT accounts")} ${String(u?.n ?? 0).padStart(6)}`
    );
  }
}

// ── 7.5 · the clock-out watch ──────────────────────────────────────────────

async function watchClockOutFailures() {
  console.log(`\n═══ 7.5 · CLOCK_OUT_FAILED — last ${DAYS} day(s) ═══\n`);

  if (!(await enumHasValue("JobLogAction", "CLOCK_OUT_FAILED"))) {
    verdict(
      "clock-out failures are recorded",
      false,
      "enum value absent — failures are still invisible"
    );
    return;
  }

  const since = new Date(Date.now() - DAYS * 24 * 60 * 60 * 1000);
  const rows = await db.$queryRaw<
    { code: string | null; n: bigint; last: Date }[]
  >`
    SELECT "field" AS code, count(*) AS n, max("createdAt") AS last
    FROM "JobLog"
    WHERE action::text = 'CLOCK_OUT_FAILED' AND "createdAt" >= ${since}
    GROUP BY 1 ORDER BY 2 DESC
  `;

  if (rows.length === 0) {
    console.log("  none — no cleaner failed to clock out in the window.");
    return;
  }

  for (const r of rows) {
    console.log(
      `  ${pad(r.code ?? "(no code)")} ${String(r.n).padStart(4)}   last ${r.last.toISOString()}`
    );
  }

  // Every row here is a cleaner who could not finish their day. Naming the job
  // and the person is the whole point of fix 6 — an admin should not have to
  // write SQL to find out who to call back.
  const detail = await db.$queryRaw<
    { jobNumber: number; code: string | null; description: string; createdAt: Date; name: string | null }[]
  >`
    SELECT j."jobNumber", l."field" AS code, l."description", l."createdAt", u."name"
    FROM "JobLog" l
    JOIN "Job" j ON j.id = l."jobId"
    LEFT JOIN "User" u ON u.id = l."userId"
    WHERE l.action::text = 'CLOCK_OUT_FAILED' AND l."createdAt" >= ${since}
    ORDER BY l."createdAt" DESC
    LIMIT 25
  `;
  console.log("\n  Most recent (up to 25):\n");
  for (const d of detail) {
    console.log(
      `    #${d.jobNumber}  ${d.createdAt.toISOString()}  ${d.name ?? "unknown cleaner"}\n      ${d.description}`
    );
  }

  const total = rows.reduce((s, r) => s + Number(r.n), 0);
  verdict(
    "no failed clock-outs in the window",
    false,
    `${total} failure(s) across ${rows.length} error code(s) — read the codes above`
  );
  console.log(
    "\n  Reading the codes: a run of DB_TIMEOUT points at the pooler (the\n" +
      "  transaction is sized in TODO.md § 0.3); INVALID_USAGE or\n" +
      "  PRODUCT_NOT_IN_KIT points at the kit data or the modal, and each of\n" +
      "  those names the exact product in its description."
  );
}

// ── 7.5 · the half of the settings watch that does not need Vercel ─────────

async function watchSettingsPage() {
  console.log("\n═══ 7.5 · /admin/settings — latency and growth ═══\n");

  const heaviest: [string, () => Promise<unknown>][] = [
    ["trainingModule.findMany +quizzes +progress", () =>
      db.trainingModule.findMany({ include: { quizzes: true, progress: true } })],
    ["notificationSetting.findMany", () => db.notificationSetting.findMany()],
    ["checklistTemplate.findMany +items", () =>
      db.checklistTemplate.findMany({ include: { items: true } })],
    ["appSetting.findMany", () => db.appSetting.findMany()],
  ];

  let slowest = 0;
  let serial = 0;
  for (const [label, fn] of heaviest) {
    const t0 = Date.now();
    let rows = 0;
    try {
      const out = await fn();
      rows = Array.isArray(out) ? out.length : 1;
    } catch (e) {
      console.log(`  ${pad(label)} FAILED — ${e instanceof Error ? e.message : String(e)}`);
      problems++;
      continue;
    }
    const ms = Date.now() - t0;
    serial += ms;
    slowest = Math.max(slowest, ms);
    console.log(`  ${pad(label)} ${String(ms).padStart(6)} ms  ${String(rows).padStart(5)} rows`);
  }

  // The page runs its reads inside one `Promise.all`, so wall-clock is the
  // slowest read, not the sum — but the sum is the pooler time the request
  // costs, and `maxDuration = 60` is the budget it has to fit inside.
  console.log(
    `\n  slowest single read ${slowest} ms · pooler time for these four ${serial} ms · page budget 60000 ms`
  );
  verdict(
    "settings reads are comfortably inside maxDuration",
    slowest < 20_000,
    `slowest ${slowest} ms`
  );

  // 1.5 bounded the transaction read to 12 months / 2000 rows. This is the
  // number that bound exists to hold down — worth a weekly glance.
  const since = new Date();
  since.setMonth(since.getMonth() - 12);
  const [tx] = await db.$queryRaw<{ n: bigint }[]>`
    SELECT count(*) AS n FROM "Transaction" WHERE "createdAt" >= ${since}
  `;
  const bounded = Number(tx?.n ?? 0);
  console.log(
    `  ${pad("Transaction rows in the bounded 12-month window")} ${String(bounded).padStart(6)} (cap 2000)`
  );
  if (bounded > 2000) {
    console.log(
      "    ↳ the Budgets tab is now truncating. Not an error — but the tab shows\n" +
        "      the newest 2000 rows, so say so before somebody reconciles against it."
    );
  }
}

async function main() {
  console.log("Cleano — Stage 7 post-deploy check (read-only)");
  console.log(`run at ${new Date().toISOString()} · window ${DAYS} day(s)`);

  const applied = await checkMigrations();
  await sanityPricingMode();
  await sanityEmployeePayIsManual();
  await sanityApplicant();
  await watchClockOutFailures();
  await watchSettingsPage();

  console.log("\n── Summary ──\n");
  console.log(`  migrations applied ......... ${applied.size} of ${MIGRATIONS.length}`);
  console.log(`  items wanting attention .... ${problems}`);
  if (problems === 0) {
    console.log(
      "\n  Clean. Re-run daily for the first week (`--days=1`) — 7.5 asks for a\n" +
        "  week of watching, and this is the half of it that does not need Vercel."
    );
  }
  process.exit(problems === 0 ? 0 : 1);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
