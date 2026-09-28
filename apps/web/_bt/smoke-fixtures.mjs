// Proves the fixture builders write real, readable rows before agents rely on them.
import { createJob, assignCleaner, createAddress, db, done } from "./lib/fixtures.mjs";
import { readManifest } from "./lib/manifest.mjs";
import { accounts } from "./lib/browser.mjs";
import { checker } from "./lib/browser.mjs";

const c = checker();
const acct = accounts();

const jobId = await createJob({
  clientId: acct.accounts.customer.clientId,
  addOns: [{ name: "Inside Fridge", price: 25, quantity: 2 }],
});
const job = await db.job.findUnique({ where: { id: jobId }, include: { addOns: true } });
c.check("createJob writes a job", Boolean(job), jobId);
c.check("add-on carries quantity 2 (migration live)", job?.addOns?.[0]?.quantity === 2, `quantity=${job?.addOns?.[0]?.quantity}`);

await assignCleaner(jobId, acct.accounts.cleaner.userId);
const assigned = await db.job.findUnique({ where: { id: jobId }, select: { employeeId: true, assignments: { select: { id: true } } } });
c.check("assignCleaner links employee", assigned?.employeeId === acct.accounts.cleaner.userId);
c.check("assignCleaner writes assignment row", (assigned?.assignments?.length ?? 0) === 1);

const addrId = await createAddress(acct.accounts.customer.clientId, { accessNotes: "Gate code 1234" });
const addr = await db.clientAddress.findUnique({ where: { id: addrId } });
c.check("createAddress writes new columns (migration live)", addr?.city === "Montreal" && addr?.accessNotes === "Gate code 1234");

const man = readManifest();
c.check("manifest recorded every row", man.length >= 5, `${man.length} rows: ${[...new Set(man.map((m) => m.model))].join(", ")}`);

await done();
console.log(`\n${c.passed.length} passed, ${c.failed.length} failed`);
process.exitCode = c.failed.length ? 1 : 0;
