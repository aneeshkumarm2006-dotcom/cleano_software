import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import GroupChatClient from "./GroupChatClient";
import ChatTabs from "@/components/chat/ChatTabs";
import {
  listGroupChannels,
  getGroupMessages,
  getTeamChatSettings,
  type GroupMessageDTO,
} from "./groupChat";

export default async function CleanerGroupChatPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    redirect("/cleanos/login");
  }

  const [list, settings] = await Promise.all([
    listGroupChannels(),
    getTeamChatSettings(),
  ]);
  const channels = list.success ? list.data : [];
  const initialChannelId = channels[0]?.id ?? null;

  let initialMessages: GroupMessageDTO[] = [];
  if (initialChannelId) {
    const msgs = await getGroupMessages(initialChannelId);
    if (msgs.success) initialMessages = msgs.data;
  }

  return (
    <div className="h-full overflow-hidden flex flex-col">
      <ChatTabs variant="cleaner" />
      <div className="flex-1 overflow-hidden">
        <GroupChatClient
          initialChannels={channels}
          initialChannelId={initialChannelId}
          initialMessages={initialMessages}
          currentUserId={session.user.id}
          userName={session.user.name ?? undefined}
          dmEnabled={settings.success ? settings.data.dmEnabled : true}
        />
      </div>
    </div>
  );
}
