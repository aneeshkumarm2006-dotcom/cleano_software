/**
 * Assignment and an Open/Closed lifecycle for AI conversations.
 *
 * The two gaps that stopped the inbox being a queue:
 *
 *   `needsHuman` said a person was needed and nothing said WHICH, so two
 *   admins could answer the same customer or both assume the other had.
 *
 *   A conversation that had been dealt with looked identical to a live one
 *   forever, so the inbox could be read but never cleared.
 *
 * The migration is additive: status defaults to OPEN, which is how every
 * existing row already behaves, and assignedToId starts NULL, which is today's
 * "nobody owns anything".
 */
import { readFileSync } from "node:fs";

let passed = 0;
const failures: string[] = [];
const check = (name: string, ok: boolean) => {
  if (ok) passed++;
  else failures.push(name);
};
const read = (p: string) => readFileSync(p, "utf8");

/* ---- the schema and its migration -------------------------------------- */
{
  const schema = read("prisma/schema.prisma");
  check("there is a status enum", schema.includes("enum AiConversationStatus"));
  check("it is only OPEN and CLOSED", (() => {
    const i = schema.indexOf("enum AiConversationStatus");
    const block = schema.slice(i, i + 120);
    return block.includes("OPEN") && block.includes("CLOSED") && !block.includes("PENDING");
  })());
  check("conversations carry an owner", schema.includes("assignedToId String?"));
  check("and default to open", schema.includes("status   AiConversationStatus @default(OPEN)"));
  check("closing is timestamped", schema.includes("closedAt DateTime?"));
  check("the two views people live in are indexed",
    schema.includes("@@index([assignedToId])") &&
    schema.includes("@@index([organizationId, status])"));

  const sql = read("prisma/migrations/20260923120000_conversation_assignment_and_status/migration.sql");
  check("the migration adds the type", sql.includes('CREATE TYPE "AiConversationStatus"'));
  // Additive only: an existing row must not change behaviour on apply.
  check("status defaults to OPEN in SQL", sql.includes(`DEFAULT 'OPEN'`));
  check("nothing is backfilled", !/UPDATE\s+"AiConversation"/i.test(sql));
  check("nothing is dropped", !/DROP\s+(TABLE|COLUMN)/i.test(sql));
  // AiConversation already has its tenant policy; columns do not change it.
  check("it explains why no RLS work is needed", sql.includes("No RLS work is needed"));
}

/* ---- the actions -------------------------------------------------------- */
{
  const a = read("src/app/admin/actions/aiConversations.ts");
  check("assigning is an action", a.includes("export async function assignAiConversation"));
  check("closing is an action", a.includes("export async function setAiConversationStatus"));
  check("both are owner/admin only",
    (a.match(/await requireOwnerAdmin\(\)/g) ?? []).length >= 6);
  // An id from another workspace must be refused, not stored. `db` is
  // org-scoped, so the lookup finding nothing IS the check.
  check("an unknown assignee is refused", a.includes("That person is not on your team."));
  check("a deleted staff member is refused", a.includes("staff.deletedAt"));
  // Closing clears the assistant's flag; leaving both set is how a cleared
  // inbox fills straight back up.
  check("closing clears needsHuman", a.includes("closedAt: new Date(), needsHuman: false"));
  // Reopening must NOT re-raise it: that flag belongs to the assistant.
  check("reopening does not re-raise needsHuman", a.includes("{ status, closedAt: null }"));
}

/* ---- the list: five views, not eight ------------------------------------ */
{
  const l = read("src/app/admin/conversations/ConversationList.tsx");
  for (const v of ['"mine"', '"unassigned"', '"needs"', '"open"', '"closed"']) {
    check(`the ${v} view exists`, l.includes(v));
  }
  // Spam, Trash and Sent are concepts a cleaning office does not have.
  check("no spam or trash views", !l.includes('"spam"') && !l.includes('"trash"'));
  check("closed threads stay out of every open view", l.includes('if (r.status === "CLOSED") return false;'));
  check("the owner shows on the row", l.includes("r.assignedToName"));
  check("and says You when it is yours", l.includes('r.assignedToId === meId ? "You"'));
  check("unowned open threads say so", l.includes(">Unassigned<"));
  // Landing on an empty tab hides every conversation behind a click.
  check("it lands on a view with something in it", l.includes("counts[view] > 0"));
}

/* ---- the thread header -------------------------------------------------- */
{
  const t = read("src/app/admin/conversations/[id]/ConversationThread.tsx");
  check("there is an owner picker", t.includes("cv-assign"));
  check("it can be handed back", t.includes('<option value="">Unassigned</option>'));
  check("there is a one-click Take it", t.includes("Take it"));
  check("close and reopen are the same control", t.includes('conversation.status === "CLOSED" ? "OPEN" : "CLOSED"'));
  check("the picker is labelled for screen readers", t.includes("Assign this conversation"));

  const detail = read("src/app/admin/conversations/[id]/page.tsx");
  check("staff come from this workspace only", detail.includes('role: { in: ["OWNER", "ADMIN", "OPS_MANAGER", "FIELD_LEAD"] }'));
  check("deleted staff are not offered", detail.includes("deletedAt: null"));
}

if (failures.length) {
  console.error(`✘ ${passed} passed, ${failures.length} failed`);
  for (const f of failures) console.error(`   - ${f}`);
  process.exit(1);
}
console.log(`✔ ${passed} passed, 0 failed`);
