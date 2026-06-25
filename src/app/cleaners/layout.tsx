import { getCachedSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { getSetting } from "@/lib/settings";
import { isCleanerRole, homeForRole } from "@/lib/role-routing";
import signOut from "@/app/admin/actions/signOut";
import AccountDeactivated from "./AccountDeactivated";
import CleanerSidebar from "./CleanerSidebar";
import InstallPrompt from "@/components/InstallPrompt";
import { InstallProvider } from "@/components/InstallContext";
import PresenceHeartbeat from "@/components/PresenceHeartbeat";

// /cleaners/* — field crew (EMPLOYEE role). Admins and customers are bounced
// to their own area's home.
export default async function CleanerLayout({
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

  if (!isCleanerRole(userWithRole.role)) {
    redirect(homeForRole(userWithRole.role));
  }

  // Deactivated cleaners see a configurable notice instead of the app.
  const dbUser = await db.user.findUnique({
    where: { id: userWithRole.id },
    select: { isActive: true },
  });
  if (dbUser && dbUser.isActive === false) {
    const message = await getSetting("provider.deactivatedMessage");
    return <AccountDeactivated message={message} signOutAction={signOut} />;
  }

  return (
    <InstallProvider>
      <div className="cl-app-shell">
        <CleanerSidebar user={userWithRole} signOutAction={signOut} />
        <main className="cl-app-main">
          <div className="cl-app-main-inner">{children}</div>
        </main>
        <InstallPrompt />
        <PresenceHeartbeat />
      </div>
    </InstallProvider>
  );
}
