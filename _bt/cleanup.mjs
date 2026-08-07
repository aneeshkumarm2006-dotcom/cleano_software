// Removes every row the browser tests created, from the LIVE database.
//
// Dry-run by default; pass --commit to actually delete. That is the same
// house rule the repo's own destructive scripts follow, and it exists so the
// deletion list can be read by a human before anything is destroyed.
//
// Two passes, deliberately:
//   1. MANIFEST — exact ids we recorded. Authoritative.
//   2. SWEEP    — anything still carrying MARKER. Catches rows whose manifest
//                 line was lost to a crash. Scoped to fields we control, and
//                 it reports separately so a surprise hit is visible, never
//                 silently folded into the expected count.
import { PrismaClient } from "@prisma/client";
import { readManifest, MARKER } from "./lib/manifest.mjs";

const COMMIT = process.argv.includes("--commit");
const db = new PrismaClient();
const log = [];
function note(s) { log.push(s); console.log(s); }

/** Child rows are removed before their parent: not every relation cascades,
 *  and a failed parent delete would otherwise leave the whole graph behind. */
const JOB_CHILDREN = [
  "jobWorkSession", "jobBreak", "jobChecklist", "jobAddOn",
  "jobPhoto", "jobLog", "jobAssignmentInvite", "jobAssignment", "jobProductUsage",
  "jobMessage", "jobRatingToken", "rating", "invoiceLineItem", "payment",
  // Written by the notification path on clock-out. Not a cascade, so without
  // this the job delete either fails or strands a log row pointing at nothing.
  "emailLog", "employeeRating", "inventoryChange",
];
// JobChecklistItem hangs off the checklist, not the job, so it has no jobId to
// filter on. Its FK is onDelete: Cascade, so deleting jobChecklist takes the
// items with it — it is deliberately absent from the list above, not forgotten.

async function tryDelete(model, where, label) {
  const delegate = db[model];
  if (!delegate?.deleteMany) return 0;                 // model not in this schema — skip quietly
  try {
    if (!COMMIT) {
      const n = await delegate.count({ where });
      if (n) note(`  would delete ${n.toString().padStart(4)} ${label ?? model}`);
      return n;
    }
    const { count } = await delegate.deleteMany({ where });
    if (count) note(`  deleted ${count.toString().padStart(4)} ${label ?? model}`);
    return count;
  } catch (e) {
    note(`  !! ${label ?? model}: ${e.message.split("\n")[0].slice(0, 160)}`);
    return 0;
  }
}

async function main() {
  const man = readManifest();
  const byModel = {};
  for (const r of man) (byModel[r.model] ??= []).push(r.id);

  note(`Manifest: ${man.length} rows — ${Object.entries(byModel).map(([m, v]) => `${m}:${v.length}`).join(", ") || "(empty)"}`);
  note(COMMIT ? "\nMODE: COMMIT (deleting)\n" : "\nMODE: DRY RUN (nothing will be deleted; pass --commit)\n");

  let total = 0;

  // ---- Pass 1: manifest ----------------------------------------------------
  const jobIds = byModel.Job ?? [];
  if (jobIds.length) {
    note("Job graph:");
    for (const child of JOB_CHILDREN) total += await tryDelete(child, { jobId: { in: jobIds } });
    total += await tryDelete("invoice", { jobId: { in: jobIds } });
    total += await tryDelete("job", { id: { in: jobIds } });
  }

  const clientIds = byModel.Client ?? [];
  const userIds = byModel.User ?? [];

  note("Other recorded rows:");
  if (byModel.QuoteRequest?.length) total += await tryDelete("quoteRequest", { id: { in: byModel.QuoteRequest } });
  if (byModel.ClientAddress?.length) total += await tryDelete("clientAddress", { id: { in: byModel.ClientAddress } });
  if (clientIds.length) {
    total += await tryDelete("clientAddress", { clientId: { in: clientIds } }, "clientAddress (by client)");
    total += await tryDelete("client", { id: { in: clientIds } });
  }
  if (userIds.length) {
    // Explicit before the cascade: an EmployeeRating whose job is already gone
    // has jobId NULL (ON DELETE SET NULL), so the job pass cannot reach it, and
    // a rating left behind would keep moving that cleaner's pay tier.
    // Audit rows ABOUT the test accounts (sign-ins, the void-cheque view).
    // Removed because they describe users that will not exist a moment later —
    // leaving them would put phantom actors in the client's real activity log.
    total += await tryDelete("activityLog", { actorId: { in: userIds } });
    total += await tryDelete("employeeRating", { employeeId: { in: userIds } });
    total += await tryDelete("employeeAvailability", { employeeId: { in: userIds } });
    total += await tryDelete("employeeFile", { employeeId: { in: userIds } });
    total += await tryDelete("session", { userId: { in: userIds } });
    total += await tryDelete("account", { userId: { in: userIds } });
    total += await tryDelete("user", { id: { in: userIds } });
  }

  // ---- Pass 2: marker sweep ------------------------------------------------
  // In DRY RUN this necessarily re-reports the same rows as pass 1: nothing was
  // actually deleted, so the marker rows are all still there. Only the COMMIT
  // run's sweep count is meaningful, and there it must be 0.
  note(COMMIT
    ? "\nMarker sweep (should be 0 — anything here escaped the manifest):"
    : "\nMarker sweep (dry run re-counts pass-1 rows; only COMMIT's count is meaningful):");
  let swept = 0;
  swept += await tryDelete("jobAddOn", { job: { clientName: { contains: MARKER } } }, "jobAddOn (marker)");
  swept += await tryDelete("job", { OR: [{ clientName: { contains: MARKER } }, { location: { contains: MARKER } }] }, "job (marker)");
  swept += await tryDelete("clientAddress", { OR: [{ label: { contains: MARKER } }, { address: { contains: MARKER } }] }, "clientAddress (marker)");
  swept += await tryDelete("client", { name: { contains: MARKER } }, "client (marker)");
  swept += await tryDelete("quoteRequest", { name: { contains: MARKER } }, "quoteRequest (marker)");
  swept += await tryDelete("user", { email: { contains: "cleano-bt.local" } }, "user (marker)");
  if (!swept) note("  clean — nothing escaped the manifest");

  note(`\nTotal rows ${COMMIT ? "deleted" : "that would be deleted"}: ${total + swept}`);
  if (!COMMIT) note("Re-run with --commit to apply.");
}

main()
  .catch((e) => { console.error("CLEANUP FAILED:", e); process.exitCode = 1; })
  .finally(() => db.$disconnect());
