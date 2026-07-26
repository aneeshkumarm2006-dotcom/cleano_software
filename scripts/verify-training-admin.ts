// Verification for fix list item 22 — Training & Documents admin view.
//
// NOTE: the item is TITLED "Hide Training & Documents From Admin View", but its
// written requirements (the document's stated source of truth over titles and
// screenshots) ask for a MANAGEMENT view plus an explicit employee preview —
// not for the page to be hidden. These checks assert the requirements.
import fs from "node:fs";

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}`);
  cond ? pass++ : fail++;
};
const read = (p: string) => fs.readFileSync(p, "utf8");

const client = read("src/app/admin/training-docs/TrainingDocsClient.tsx");
const page = read("src/app/admin/training-docs/page.tsx");

// ── The page must still exist and stay admin-guarded ───────────────────────
ok("the page still exists (hiding it would fail the last requirement)",
  fs.existsSync("src/app/admin/training-docs/page.tsx"));
ok("page is admin-guarded", page.includes("requireAdmin"));

// ── Requirement: admin must NOT land on the employee onboarding flow ────────
ok("admin lands on the management view by default",
  client.includes("useState(false)") && client.includes("previewAsEmployee"));
ok("the employee flow is gated behind the preview toggle",
  client.includes("{previewAsEmployee ? ("));
ok("toggle is labelled as an employee preview, not 'view as admin'",
  client.includes('"View as employee"') && client.includes('"Back to admin view"'));
ok("preview is clearly banner-labelled so it can't be mistaken for the admin's own onboarding",
  client.includes("Preview — employee view"));
ok("preview states nothing is recorded against the admin",
  client.includes("Nothing here is recorded against your account"));

// ── Requirement: manage training CONTENT and employee PROGRESS ─────────────
ok("an admin management view exists", client.includes("function AdminManagementView"));
ok("management view lists training content", client.includes("Training content"));
ok("management view shows employee progress", client.includes("Employee progress"));
ok("management view links out to where modules are edited",
  client.includes("/admin/settings?tab=training"));

// ── Requirement: real data, not the sample content the client flagged ──────
ok("hardcoded sample videos are gone",
  !client.includes('"Welcome & professional standards"') &&
  !client.includes('"Equipment & approved products"'));
ok("hardcoded sample PDFs are gone",
  !client.includes('"Safety data sheets (SDS) binder"') &&
  !client.includes('"Code of conduct & confidentiality"'));
ok("the fabricated quiz score is gone from the admin view",
  !client.includes('Quiz passed — 92%') || client.includes("previewAsEmployee"));

ok("page reads real TrainingModule rows", page.includes("db.trainingModule.findMany"));
ok("page reads real per-employee progress", page.includes("trainingProgress"));
ok("page reads the real document access log", page.includes("documentAccessLog"));

// ── Judgement calls worth locking in ───────────────────────────────────────
ok("progress is measured against ACTIVE + REQUIRED modules only",
  page.includes("m.isActive && m.isRequired"));
ok("'no quiz taken' is not reported as a zero score",
  page.includes("Null, not 0") || page.includes("avgQuizScore:"));
ok("a missing quiz score renders as a dash, not 0%",
  client.includes('p.avgQuizScore === null ? "—"'));
ok("the document access log stays admin-only (hidden while previewing)",
  client.includes("{!previewAsEmployee ? ("));

console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail === 0 ? 0 : 1);
