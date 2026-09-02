/**
 * Exercise the AI SMS flow on STAGING, end to end minus the model itself
 * (no ANTHROPIC_API_KEY yet — the silent-handoff fallback is the path under
 * test, plus threading, muting, the cap, and the knowledge builder).
 */
import { PrismaClient } from "@prisma/client";
import { db } from "../src/lib/org-db";
import { runAsOrg } from "../src/lib/org-context";
import { handleInboundAiMessage } from "../src/lib/ai-assistant/conversation";
import { buildWorkspaceKnowledge } from "../src/lib/ai-assistant/knowledge";

const TEST_ADDR = "+15559990001";
const TEST_ADDR2 = "+15559990002";

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, extra = "") {
  if (ok) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.log(`  ✗ ${name} ${extra}`);
  }
}

async function main() {
  const platform = new PrismaClient({
    datasources: { db: { url: process.env.PLATFORM_DATABASE_URL! } },
  });
  const org = await platform.organization.findFirst({
    where: { slug: "teamcleano-demo" },
    select: { id: true, slug: true, name: true, timezone: true },
  });
  if (!org) throw new Error("demo org not found on staging");
  console.log(`Org: ${org.slug} (${org.id})`);

  await runAsOrg(org, async () => {
    // clean slate
    await db.aiConversation.deleteMany({
      where: { customerAddress: { in: [TEST_ADDR, TEST_ADDR2] } },
    });

    // 0. knowledge builder produces real sections
    const k = await buildWorkspaceKnowledge();
    console.log("\n— knowledge —");
    check("business name present", k.businessName.length > 0, k.businessName);
    check("booking url built", /^https?:\/\/.+\/book$/.test(k.bookingUrl), k.bookingUrl);
    check("facts mention services", /Services offered/.test(k.facts));
    check("facts mention policies", /Booking policies/.test(k.facts));
    console.log(`  (facts: ${k.facts.length} chars)`);

    // 1. first inbound from a stranger — no API key → silent handoff
    console.log("\n— first inbound (no model key → silent handoff) —");
    let delivered = 0;
    const res1 = await handleInboundAiMessage({
      channel: "SMS",
      address: TEST_ADDR,
      clientId: null,
      clientName: null,
      text: "Hi! Do you clean offices in NDG?",
      dailyMessageCap: 200,
      deliver: async () => {
        delivered++;
        return true;
      },
    });
    check("returned a result", !!res1);
    check("did not reply", res1?.replied === false);
    check("nothing delivered", delivered === 0);
    const convo1 = await db.aiConversation.findFirst({
      where: { customerAddress: TEST_ADDR },
      include: { messages: true },
    });
    check("conversation created", !!convo1);
    check("inbound recorded", convo1?.messages.length === 1 && convo1.messages[0].author === "CUSTOMER");
    check("needsHuman set", convo1?.needsHuman === true);

    // 2. second inbound threads onto the same conversation, no re-escalation
    console.log("\n— second inbound (threading) —");
    await handleInboundAiMessage({
      channel: "SMS",
      address: TEST_ADDR,
      clientId: null,
      clientName: null,
      text: "Anyone there?",
      dailyMessageCap: 200,
      deliver: async () => true,
    });
    const convos = await db.aiConversation.findMany({
      where: { customerAddress: TEST_ADDR },
      include: { messages: true },
    });
    check("still one conversation", convos.length === 1, `got ${convos.length}`);
    check("two messages on it", convos[0]?.messages.length === 2);

    // 3. staff takeover: aiEnabled=false — inbound recorded, assistant quiet
    console.log("\n— muted thread —");
    await db.aiConversation.update({
      where: { id: convos[0].id },
      data: { aiEnabled: false, needsHuman: false },
    });
    const res3 = await handleInboundAiMessage({
      channel: "SMS",
      address: TEST_ADDR,
      clientId: null,
      clientName: null,
      text: "Following up again",
      dailyMessageCap: 200,
      deliver: async () => true,
    });
    const muted = await db.aiConversation.findFirst({
      where: { id: convos[0].id },
      include: { messages: true },
    });
    check("inbound still recorded", muted?.messages.length === 3);
    check("no reply while muted", res3?.replied === false);
    check("re-surfaced for staff", muted?.needsHuman === true);

    // 4. daily cap zero — assistant declines before the model
    console.log("\n— daily cap —");
    const res4 = await handleInboundAiMessage({
      channel: "SMS",
      address: TEST_ADDR2,
      clientId: null,
      clientName: null,
      text: "How much for a deep clean?",
      dailyMessageCap: 0,
      deliver: async () => true,
    });
    const convo2 = await db.aiConversation.findFirst({
      where: { customerAddress: TEST_ADDR2 },
    });
    check("capped: no reply", res4?.replied === false);
    check("capped: needsHuman", convo2?.needsHuman === true);

    // cleanup
    await db.aiConversation.deleteMany({
      where: { customerAddress: { in: [TEST_ADDR, TEST_ADDR2] } },
    });
    const left = await db.aiConversation.count({
      where: { customerAddress: { in: [TEST_ADDR, TEST_ADDR2] } },
    });
    check("\ncleanup complete", left === 0);
  });

  await platform.$disconnect();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
