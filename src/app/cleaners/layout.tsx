import { getCachedSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import { db } from "@/lib/org-db";
import { getSetting } from "@/lib/settings";
import { isCleanerRole, homeForRole } from "@/lib/role-routing";
import signOut from "@/app/admin/actions/signOut";
import AccountDeactivated from "./AccountDeactivated";
import CleanerSidebar from "./CleanerSidebar";
import ScrollReset from "@/components/ScrollReset";
import PullToRefresh from "@/components/PullToRefresh";
import InstallPrompt from "@/components/InstallPrompt";
import { InstallProvider } from "@/components/InstallContext";
import PresenceHeartbeat from "@/components/PresenceHeartbeat";
import CrewDoorMarker from "./CrewDoorMarker";

// Installing to the home screen from inside the crew app must use the CREW
// manifest, whose start_url is /cleaners/my-jobs. The root manifest starts at
// "/" (the customer portal), which is why an expired crew session used to open
// on the customer login with no way to change the shortcut.
export const metadata = {
  manifest: "/api/cleaner-manifest",
};

// /cleaners/* — field crew (EMPLOYEE role). Admins and customers are bounced
// to their own area's home.
export default async function CleanerLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getCachedSession();

  if (!session) {
    redirect("/cleanos/login");
  }

  const { user } = session;
  const userWithRole = user as typeof user & { role: string };

  if (!isCleanerRole(userWithRole.role)) {
    redirect(homeForRole(userWithRole.role));
  }

  // Deactivated cleaners see a configurable notice instead of the app.
  const dbUser = await db.user.findUnique({
    where: { id: userWithRole.id },
    select: { isActive: true, mustChangePassword: true },
  });
  if (dbUser && dbUser.isActive === false) {
    const message = await getSetting("provider.deactivatedMessage");
    return <AccountDeactivated message={message} signOutAction={signOut} />;
  }
  // Imported cleaners on a temp password must set their own before the app.
  if (dbUser?.mustChangePassword) {
    redirect("/change-password");
  }

  return (
    <InstallProvider>
      <div className="cl-app-shell">
        <CleanerSidebar user={userWithRole} signOutAction={signOut} />
        <main className="cl-app-main" data-scroll-reset>
          <ScrollReset />
          <PullToRefresh />
          <div className="cl-app-main-inner">{children}</div>
        </main>
        <InstallPrompt />
        <PresenceHeartbeat />
        {/* Remembers this device as a crew device so an expired session on an
            already-installed "/" shortcut still lands on the crew login. */}
        <CrewDoorMarker />
      </div>
    </InstallProvider>
  );
}
