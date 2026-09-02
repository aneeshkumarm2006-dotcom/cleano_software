import Link from "next/link";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { Bot, Mail, MessageSquare } from "lucide-react";
import { db } from "@/lib/org-db";

export const dynamic = "force-dynamic";

/**
 * Every conversation the AI assistant has had (or handed off), newest first,
 * with the ones waiting on a human pinned to the top. This is the page the
 * handoff email links to.
 */
export default async function ConversationsPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");
  const role = (session.user as { role?: string }).role;
  if (role !== "OWNER" && role !== "ADMIN") redirect("/admin/dashboard");

  const conversations = await db.aiConversation.findMany({
    orderBy: [{ needsHuman: "desc" }, { lastMessageAt: "desc" }],
    take: 200,
    include: {
      messages: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { body: true, author: true },
      },
    },
  });

  // Names for matched clients, one query for the page.
  const clientIds = [...new Set(conversations.map((c) => c.clientId).filter((x): x is string => !!x))];
  const clients = clientIds.length
    ? await db.client.findMany({
        where: { id: { in: clientIds } },
        select: { id: true, name: true },
      })
    : [];
  const clientName = new Map(clients.map((c) => [c.id, c.name]));

  const fmt = new Intl.DateTimeFormat("en-CA", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

  return (
    <div className="p-6 max-w-4xl">
      <div className="flex items-center gap-3 mb-1">
        <Bot size={22} className="text-[#008C9C]" />
        <h1 className="text-xl font-semibold text-gray-900">AI Conversations</h1>
      </div>
      <p className="text-sm text-gray-500 mb-6">
        Customer texts and emails the AI assistant answered. Conversations that
        need a person are listed first — open one to reply yourself.
      </p>

      {conversations.length === 0 ? (
        <div className="bg-white border border-gray-200 rounded-xl p-10 text-center text-sm text-gray-500">
          No conversations yet. When the AI assistant is on (Settings → AI
          Assistant), texts from prospects and customers will appear here.
        </div>
      ) : (
        <ul className="space-y-2">
          {conversations.map((c) => {
            const last = c.messages[0];
            const who =
              (c.clientId ? clientName.get(c.clientId) : null) ?? c.customerAddress;
            return (
              <li key={c.id}>
                <Link
                  href={`/admin/conversations/${c.id}`}
                  className="block bg-white border border-gray-200 rounded-xl px-4 py-3 hover:border-[#008C9C] transition-colors">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2 min-w-0">
                      {c.channel === "SMS" ? (
                        <MessageSquare size={15} className="text-gray-400 shrink-0" />
                      ) : (
                        <Mail size={15} className="text-gray-400 shrink-0" />
                      )}
                      <span className="text-sm font-medium text-gray-900 truncate">{who}</span>
                      {c.needsHuman && (
                        <span className="text-[11px] font-semibold text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-2 py-0.5 shrink-0">
                          Needs a human
                        </span>
                      )}
                      {!c.aiEnabled && (
                        <span className="text-[11px] font-medium text-gray-500 bg-gray-100 rounded-full px-2 py-0.5 shrink-0">
                          AI muted
                        </span>
                      )}
                    </div>
                    <span className="text-xs text-gray-400 shrink-0">
                      {fmt.format(c.lastMessageAt)}
                    </span>
                  </div>
                  {last && (
                    <p className="text-sm text-gray-500 truncate mt-1">
                      {last.author === "CUSTOMER" ? "" : last.author === "ASSISTANT" ? "AI: " : "You: "}
                      {last.body}
                    </p>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
