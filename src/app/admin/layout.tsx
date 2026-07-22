import { getCachedSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import { isAdminRole, homeForRole } from "@/lib/role-routing";
import signOut from "./actions/signOut";
import Sidebar from "./Sidebar";
import PresenceHeartbeat from "@/components/PresenceHeartbeat";
import { InstallProvider } from "@/components/InstallContext";

// /admin/* — owners, admins, ops managers, and field leads. Cleaners and
// customers are bounced to their own area's home.
export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getCachedSession();

  if (!session) {
    redirect("/sign-in");
  }

  const { user } = session;
  const userWithRole = user as typeof user & { role: string };

  if (!isAdminRole(userWithRole.role)) {
    redirect(homeForRole(userWithRole.role));
  }

  return (
    // InstallProvider so the Settings "Install app" card can capture
    // beforeinstallprompt here too (the crew app has its own provider).
    <InstallProvider>
      <Sidebar user={userWithRole} isAdmin signOutAction={signOut}>
        <PresenceHeartbeat />
        {/* Mobile: clear the fixed hamburger (Sidebar renders it top-4 left-4,
            md:hidden) so page headers aren't rendered underneath it. */}
        <div className="h-full pt-16 md:pt-0 print:pt-0">{children}</div>
      </Sidebar>
    </InstallProvider>
  );
}
