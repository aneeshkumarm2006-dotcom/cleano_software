import Link from "next/link";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { db } from "@/lib/org-db";
import ConversationThread from "./ConversationThread";

export const dynamic = "force-dynamic";

export default async function ConversationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");
  const role = (session.user as { role?: string }).role;
  if (role !== "OWNER" && role !== "ADMIN") redirect("/admin/dashboard");

  const { id } = await params;
  const convo = await db.aiConversation.findUnique({
    where: { id },
    include: {
      messages: { orderBy: { createdAt: "asc" }, take: 500 },
    },
  });
  if (!convo) notFound();

  const client = convo.clientId
    ? await db.client.findUnique({
        where: { id: convo.clientId },
        select: { id: true, name: true },
      })
    : null;

  return (
    <div className="p-6 max-w-3xl">
      <Link
        href="/admin/conversations"
        className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 mb-4">
        <ArrowLeft size={15} /> All conversations
      </Link>
      <ConversationThread
        conversation={{
          id: convo.id,
          channel: convo.channel,
          customerAddress: convo.customerAddress,
          aiEnabled: convo.aiEnabled,
          needsHuman: convo.needsHuman,
          clientId: client?.id ?? null,
          clientName: client?.name ?? null,
        }}
        messages={convo.messages.map((m) => ({
          id: m.id,
          author: m.author,
          body: m.body,
          internalNote: m.internalNote,
          createdAt: m.createdAt.toISOString(),
        }))}
      />
    </div>
  );
}
