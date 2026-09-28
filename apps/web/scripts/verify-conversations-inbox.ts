/**
 * AI Conversations, rebuilt as a three-pane inbox.
 *
 * Before: the list was one page and a thread was another, so one conversation
 * sat in a ~990px card inside a 3420px window and answering two customers meant
 * two route changes. Measured live at 1440 after the rebuild:
 *
 *   thread pane with lead details open   558px
 *   with them closed                     870px   (+312, exactly the rail)
 *   page scrolls sideways                no
 *
 * Verified against a temporary conversation in zztestqa, since the only real
 * one belongs to cleanocalgary. Seeded, checked, deleted: 3 -> 0 conversations,
 * 0 messages left, cleanocalgary untouched at 1 and 1.
 */
import { readFileSync } from "node:fs";

let passed = 0;
const failures: string[] = [];
const check = (name: string, ok: boolean) => {
  if (ok) passed++;
  else failures.push(name);
};
const read = (p: string) => readFileSync(p, "utf8");

/* ---- the shell: one list, many threads -------------------------------- */
{
  const layout = read("src/app/admin/conversations/layout.tsx");
  check("the list is a layout, so it survives navigation", layout.includes("ConversationsLayout"));
  check("the guard moved with it", layout.includes('role !== "OWNER"'));
  check("it renders the list beside its children", layout.includes("<ConversationList rows={rows}"));

  const page = read("src/app/admin/conversations/page.tsx");
  // The query and guard live in the layout now; this file only fills the pane.
  check("the index page is just the empty pane", !page.includes("findMany"));
  check("and says what to do", page.includes("Pick a conversation"));
}

/* ---- the list: a filter, not a sentence ------------------------------- */
{
  const list = read("src/app/admin/conversations/ConversationList.tsx");
  // The old page said "Conversations that need a person are listed first" in
  // prose. Sorting is not a control.
  check("needs-a-person is a view with a count", list.includes('"Needs a person"'));
  // "AI handling" was replaced by the queue views in verify-conversation-queue:
  // who owns it matters more than whether the assistant is talking.
  check("so is All open", list.includes('"All open"'));
  check("the open thread comes from the route, not state", list.includes("useSelectedLayoutSegment"));
  check("the active row is marked for assistive tech", list.includes('aria-current={activeId === r.id ? "page" : undefined}'));
  check("search covers name, subject and body", list.includes("r.preview ?? \"\""));
  // Opening on an empty tab would hide every conversation behind a click.
  check("it lands on a view with something in it", list.includes("counts[view] > 0"));
}

/* ---- the messages: one card, not three materials ---------------------- */
{
  const thread = read("src/app/admin/conversations/[id]/ConversationThread.tsx");
  check("no teal fill on staff messages", !thread.includes('bg-[#008C9C] text-white'));
  // Scoped to the message block: the AI toggle legitimately tints on hover.
  const msgBlock = thread.slice(thread.indexOf("cv-msgs"), thread.indexOf("cv-composer"));
  check("no tinted fill on assistant messages", !msgBlock.includes("bg-[#008C9C]"));
  check("no grey fill on customer messages", !thread.includes('bg-gray-100 text-gray-900'));
  check("an assistant reply is labelled, not coloured", thread.includes("AI replied"));

  const css = read("src/app/globals.css");
  const bub = css.slice(css.indexOf(".cv-bub {"), css.indexOf(".cv-bub {") + 400);
  check("every bubble is the same card", bub.includes("background: #fff") && bub.includes("border: 1px solid"));
  check("the customer's words carry the only emphasis", css.includes(".cv-m.in .cv-bub { border-color: #cbd9dd; }"));
}

/* ---- lead details: closable, and the thread actually gains the room ---- */
{
  const rail = read("src/app/admin/conversations/[id]/ContextRail.tsx");
  check("the rail closes", rail.includes('aria-label="Hide lead details"'));
  check("and can be brought back", rail.includes("cv-ctx-reopen"));
  check("it says when an address is nobody on file", rail.includes("matches nobody on file"));
  // Whoever answers may be quoting. Assuming Quebec is the exact bug that had
  // Calgary billing QST.
  check("it carries this workspace's tax", rail.includes("Tax on a quote here"));
  check("and reads the real rates", rail.includes("data.gstRate") && rail.includes("data.qstRate"));

  const css = read("src/app/globals.css");
  // The reopen button kept a grid column at first, so the thread grew by the
  // button's width instead of the rail's: 722px where 1034 was free.
  check(
    "closing gives the thread the whole rail's width",
    css.includes(".cv-convo:has(.cv-ctx-reopen) { grid-template-columns: minmax(0, 1fr); }"),
  );
  check("the reopen button floats over the thread", css.includes("position: absolute; top: 12px; right: 16px"));
}

/* ---- deep links still work -------------------------------------------- */
{
  const detail = read("src/app/admin/conversations/[id]/page.tsx");
  check("the thread route is unchanged", detail.includes("params: Promise<{ id: string }>"));
  // The list never leaves, so there is nothing to go "back" to.
  // Comments may name what was removed; markup may not.
  const detailCode = detail
    .split("\n")
    .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
    .join("\n");
  check("the back link is gone", !detailCode.includes("All conversations"));
  check("lifetime value comes from real jobs", detail.includes("db.job.aggregate"));
}

if (failures.length) {
  console.error(`✘ ${passed} passed, ${failures.length} failed`);
  for (const f of failures) console.error(`   - ${f}`);
  process.exit(1);
}
console.log(`✔ ${passed} passed, 0 failed`);
