import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { isAdminRole, homeForRole } from "@/lib/role-routing";
import AdminGroupChatClient from "./AdminGroupChatClient";
import ChatTabs from "@/components/chat/ChatTabs";
import {
  listGroupChannels,
  getGroupMessages,
  type GroupMessageDTO,
} from "@/app/cleaners/group-chat/groupChat";

export default async function AdminGroupChatPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    redirect("/sign-in");
  }

  const role = (session.user as { role?: string }).role;
  if (!isAdminRole(role)) {
    redirect(homeForRole(role));
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
    <div className="h-full overflow-hidden flex flex-col">
      <ChatTabs variant="admin" />
      <div className="flex-1 overflow-hidden">
        <AdminGroupChatClient
          initialChannels={channels}
          initialChannelId={initialChannelId}
          initialMessages={initialMessages}
          currentUserId={session.user.id}
        />
      </div>
    </div>
  );
}
