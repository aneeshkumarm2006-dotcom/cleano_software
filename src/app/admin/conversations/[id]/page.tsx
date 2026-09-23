import { notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";

import { db } from "@/lib/org-db";
import { getTaxRates } from "@/lib/tax.server";
import ConversationThread from "./ConversationThread";
import ContextRail from "./ContextRail";

export const dynamic = "force-dynamic";

/**
 * One thread, plus who it is with.
 *
 * The guard lives in the layout, which also renders the list beside this — so
 * there is no "All conversations" link any more. The list never left.
 */
export default async function ConversationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const convo = await db.aiConversation.findUnique({
    where: { id },
    include: { messages: { orderBy: { createdAt: "asc" }, take: 500 } },
  });
  if (!convo) notFound();

  const client = convo.clientId
    ? await db.client.findUnique({
        where: { id: convo.clientId },
        select: { id: true, name: true, phone: true },
      })
    : null;

  // Who can own this, and who is looking at it. Fetched here rather than
  // drilled down from the layout: the list does not need it and the thread
  // always does.
  const [session, staff] = await Promise.all([
    auth.api.getSession({ headers: await headers() }),
    db.user.findMany({
      where: {
        role: { in: ["OWNER", "ADMIN", "OPS_MANAGER", "FIELD_LEAD"] },
        deletedAt: null,
      },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
  ]);

  // What this contact is worth, and what a quote typed into the reply box
  // should carry. Both are cheap and both change the answer.
  const [history, rates] = await Promise.all([
    convo.clientId
      ? db.job.aggregate({
          where: { clientId: convo.clientId, deletedAt: null },
          _count: { _all: true },
          _sum: { price: true },
        })
      : null,
    getTaxRates(),
  ]);

  return (
    <div className="cv-convo">
      <ConversationThread
        conversation={{
          id: convo.id,
          channel: convo.channel,
          customerAddress: convo.customerAddress,
          aiEnabled: convo.aiEnabled,
          needsHuman: convo.needsHuman,
          subject: convo.subject,
          clientId: client?.id ?? null,
          clientName: client?.name ?? null,
          assignedToId: convo.assignedToId,
          status: convo.status,
        }}
        staff={staff}
        meId={session?.user.id ?? ""}
        messages={convo.messages.map((m) => ({
          id: m.id,
          author: m.author,
          body: m.body,
          internalNote: m.internalNote,
          createdAt: m.createdAt.toISOString(),
        }))}
      />
      <ContextRail
        data={{
          address: convo.customerAddress,
          channel: convo.channel,
          subject: convo.subject,
          clientId: client?.id ?? null,
          clientName: client?.name ?? null,
          clientPhone: client?.phone ?? null,
          startedAt: convo.createdAt.toISOString(),
          messageCount: convo.messages.length,
          assistantCount: convo.messages.filter((m) => m.author === "ASSISTANT").length,
          jobCount: history?._count._all ?? 0,
          lifetimeValue: history?._sum.price ?? 0,
          gstRate: rates.gstRate,
          qstRate: rates.qstRate,
        }}
      />
    </div>
  );
}
