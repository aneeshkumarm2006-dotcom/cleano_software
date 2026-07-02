import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import GroupChatClient from "./GroupChatClient";
import {
  listGroupChannels,
  getGroupMessages,
  type GroupMessageDTO,
} from "./groupChat";

export default async function CleanerGroupChatPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    redirect("/sign-in");
  }

  const list = await listGroupChannels();
  const channels = list.success ? list.data : [];
  const initialChannelId = channels[0]?.id ?? null;

  let initialMessages: GroupMessageDTO[] = [];
  if (initialChannelId) {
    const msgs = await getGroupMessages(initialChannelId);
    if (msgs.success) initialMessages = msgs.data;
  }

  return (
    <div className="h-full overflow-hidden">
      <GroupChatClient
        initialChannels={channels}
        initialChannelId={initialChannelId}
        initialMessages={initialMessages}
        currentUserId={session.user.id}
        userName={session.user.name ?? undefined}
      />
    </div>
  );
}
