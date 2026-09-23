import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { db } from "@/lib/org-db";
import ConversationList, { type ThreadRow } from "./ConversationList";

export const dynamic = "force-dynamic";

/**
 * The inbox shell.
 *
 * The list used to be a page and reading a thread a different page, so
 * answering two customers meant two round trips through a route change — and
 * one conversation sat in a 990px card with the rest of the window empty.
 *
 * Making the list a LAYOUT is what fixes that: it renders once and stays put
 * while `children` swaps between the empty state and a thread. Deep links to
 * /admin/conversations/<id> keep working exactly as before, because the route
 * is unchanged; it simply now paints inside a shell that already has the list
 * in it.
 */
export default async function ConversationsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");
  const role = (session.user as { role?: string }).role;
  if (role !== "OWNER" && role !== "ADMIN") redirect("/admin/dashboard");

  const conversations = await db.aiConversation.findMany({
    // Anyone waiting on a person first, then most recent. The list view below
    // can filter to those, which is what the old page could only describe.
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

  const clientIds = [
    ...new Set(conversations.map((c) => c.clientId).filter((x): x is string => !!x)),
  ];
  const clients = clientIds.length
    ? await db.client.findMany({
        where: { id: { in: clientIds } },
        select: { id: true, name: true },
      })
    : [];
  const clientName = new Map(clients.map((c) => [c.id, c.name]));

  const rows: ThreadRow[] = conversations.map((c) => {
    const last = c.messages[0];
    return {
      id: c.id,
      channel: c.channel,
      who: (c.clientId ? clientName.get(c.clientId) : null) ?? c.customerAddress,
      isClient: Boolean(c.clientId),
      subject: c.subject,
      preview: last
        ? `${last.author === "CUSTOMER" ? "" : last.author === "ASSISTANT" ? "AI: " : "You: "}${last.body}`
        : null,
      lastMessageAt: c.lastMessageAt.toISOString(),
      needsHuman: c.needsHuman,
      aiEnabled: c.aiEnabled,
    };
  });

  return (
    <div className="cv-shell">
      <ConversationList rows={rows} />
      <div className="cv-pane">{children}</div>
    </div>
  );
}
