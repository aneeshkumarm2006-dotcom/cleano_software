import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import AdminChatClient from "./AdminChatClient";
import EmployeeChatClient from "./EmployeeChatClient";
import { getAdminChatList, getEmployeeChat } from "./actions";

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
      <div className="h-full overflow-hidden">
        <AdminChatClient initialList={initial} />
      </div>
    );
  }

  const chat = await getEmployeeChat();
  const initial = chat.success
    ? chat.data
    : { conversationId: "", messages: [], otherOnline: false };
  return (
    <div className="h-full overflow-hidden">
      <EmployeeChatClient initial={initial} userName={session.user.name ?? undefined} />
    </div>
  );
}
