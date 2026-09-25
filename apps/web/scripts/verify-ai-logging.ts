/**
 * Prove the AI assistant's failures reach the admin Logs page.
 *
 * Before this, they went only to console.error — visible to a developer in
 * Vercel, invisible to the admin whose customers were being ignored. This
 * drives the real code path with no model key configured (the exact shape of
 * "the AI service is down") and asserts a row an admin can see comes out.
 *
 *   DATABASE_URL=<staging app role> PLATFORM_DATABASE_URL=<staging elevated> \
 *   npx tsx scripts/verify-ai-logging.ts
 */
import { PrismaClient } from "@prisma/client";

import { db } from "../src/lib/org-db";
import { runAsOrg } from "../src/lib/org-context";
import { handleInboundAiMessage } from "../src/lib/ai-assistant/conversation";
import { runLeadFollowUps } from "../src/lib/ai-assistant/follow-up";

const ADDR = "+15559990777";
let pass = 0;
let fail = 0;
const check = (name: string, ok: boolean, extra = "") => {
  if (ok) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name} ${extra}`); }
};

async function main() {
  const platform = new PrismaClient({
    datasources: { db: { url: process.env.PLATFORM_DATABASE_URL! } },
  });
  const org = await platform.organization.findFirst({
    where: { slug: "teamcleano-demo" },
    select: { id: true, slug: true, name: true, timezone: true },
  });
  if (!org) throw new Error("demo org not found on staging");

  await runAsOrg(org, async () => {
    const started = new Date();
    await db.aiConversation.deleteMany({ where: { customerAddress: ADDR } });

    console.log("\n— an inbound message the assistant cannot answer —");
    await handleInboundAiMessage({
      channel: "SMS",
      address: ADDR,
      clientId: null,
      clientName: null,
      text: "Do you clean offices?",
      dailyMessageCap: 200,
      deliver: async () => true,
    });

    const rows = await db.activityLog.findMany({
      where: { category: "AI", createdAt: { gte: started } },
      orderBy: { createdAt: "asc" },
      select: { action: true, status: true, message: true, error: true, targetType: true },
    });
    check("AI rows were written", rows.length > 0, `got ${rows.length}`);
    const failed = rows.find((r) => r.action === "ai.failed");
    check("a FAILED row exists", failed?.status === "FAILED");
    check("it explains itself in plain English",
      !!failed?.message && !/undefined|null|\[object/.test(failed.message), failed?.message ?? "");
    check("it carries the underlying cause", !!failed?.error, failed?.error ?? "");
    check("it points at the conversation", failed?.targetType === "aiConversation");
    const handoff = rows.find((r) => r.action === "ai.handoff");
    check("the handoff is recorded too", !!handoff, JSON.stringify(rows.map(r => r.action)));
    for (const r of rows) console.log(`     [${r.status}] ${r.action}: ${r.message}`);

    console.log("\n— a follow-up run —");
    const before = new Date();
    await runLeadFollowUps();
    const runRows = await db.activityLog.count({
      where: { category: "AI", action: "ai.follow_ups", createdAt: { gte: before } },
    });
    // Follow-ups are off by default on this workspace, so silence is correct:
    // a daily "0 of 0" from every workspace would bury the rows that matter.
    check("a disabled sequence logs nothing", runRows === 0, `got ${runRows}`);

    await db.aiConversation.deleteMany({ where: { customerAddress: ADDR } });
    await db.activityLog.deleteMany({ where: { category: "AI", createdAt: { gte: started } } });
    await db.lead.deleteMany({ where: { phone: ADDR } });
    check("cleanup complete", true);
  });

  await platform.$disconnect();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
