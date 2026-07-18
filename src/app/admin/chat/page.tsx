import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import AdminChatClient from "./AdminChatClient";
import EmployeeChatClient from "./EmployeeChatClient";
import { getAdminChatList, getEmployeeChat } from "./actions";
import ChatTabs from "@/components/chat/ChatTabs";

export default async function ChatPage() {
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session) {
    redirect("/sign-in");
  }

  const role = (session.user as { role?: "OWNER" | "ADMIN" | "EMPLOYEE" }).role ?? "EMPLOYEE";

  if (role === "OWNER" || role === "ADMIN") {
    const list = await getAdminChatList();
    const initial = list.success ? list.data : [];
    return (
      <div className="h-full overflow-hidden flex flex-col">
        <ChatTabs variant="admin" />
        <div className="flex-1 overflow-hidden">
          <AdminChatClient initialList={initial} />
        </div>
      </div>
    );
  }

  const chat = await getEmployeeChat();
  const initial = chat.success
    ? chat.data
    : { conversationId: "", messages: [], otherOnline: false };
  return (
    <div className="h-full overflow-hidden flex flex-col">
      <ChatTabs variant="cleaner" />
      <div className="flex-1 overflow-hidden">
        <EmployeeChatClient initial={initial} userName={session.user.name ?? undefined} />
      </div>
    </div>
  );
}
