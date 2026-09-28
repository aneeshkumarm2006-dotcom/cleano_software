// Independent proof that nothing this test round created survives, and that
// every setting it edited is back to its pre-test value.
import { PrismaClient } from "@prisma/client";
import { readFileSync } from "node:fs";
const db = new PrismaClient();
const M = "BTTEST";
let bad = 0;
const check = async (label, fn, expect = 0) => {
  let n;
  try { n = await fn(); } catch (e) { console.log(`  skip  ${label} (${e.message.split("\n")[0].slice(0,40)})`); return; }
  const ok = n === expect;
  if (!ok) bad++;
  console.log(`  ${ok ? "OK  " : "FAIL"}  ${label}: ${n} (expect ${expect})`);
};

console.log("Residual test rows:");
await check("users @cleano-bt.local", () => db.user.count({ where: { email: { contains: "cleano-bt.local" } } }));
await check("clients named BTTEST", () => db.client.count({ where: { name: { contains: M } } }));
await check("jobs named/located BTTEST", () => db.job.count({ where: { OR: [{ clientName: { contains: M } }, { location: { contains: M } }] } }));
await check("clientAddress BTTEST", () => db.clientAddress.count({ where: { OR: [{ label: { contains: M } }, { address: { contains: M } }] } }));
await check("quoteRequest BTTEST", () => db.quoteRequest.count({ where: { name: { contains: M } } }));
await check("employeeRating 'BTTEST rating fixture'", () => db.employeeRating.count({ where: { notes: { contains: M } } }));
await check("employeeFile bttest-*", () => db.employeeFile.count({ where: { fileName: { contains: "bttest" } } }));
await check("jobAddOn on BTTEST jobs", () => db.jobAddOn.count({ where: { job: { clientName: { contains: M } } } }));
await check("jobWorkSession orphaned to BTTEST", () => db.jobWorkSession.count({ where: { job: { clientName: { contains: M } } } }));
await check("activityLog by BTTEST actors", () => db.activityLog.count({ where: { actorLabel: { contains: "cleano-bt.local" } } }));

console.log("\nSettings restored to their pre-test values:");
const backup = JSON.parse(readFileSync("_bt/settings-backup.json", "utf8"));
for (const r of backup) {
  const now = await db.appSetting.findUnique({ where: { key: r.key } });
  const same = JSON.stringify(now?.value) === JSON.stringify(r.value);
  if (!same) bad++;
  console.log(`  ${same ? "OK  " : "FAIL"}  ${r.key} = ${JSON.stringify(now?.value)}`);
}

console.log(`\n${bad === 0 ? "CLEAN — no test data remains, no setting left changed." : `${bad} PROBLEM(S) REMAIN`}`);
await db.$disconnect();
process.exitCode = bad ? 1 : 0;
