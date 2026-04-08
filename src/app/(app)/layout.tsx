import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import Link from "next/link";
import signOut from "./actions/signOut";
import NavLink from "./NavLink";
import Image from "next/image";
import UserActions from "./UserActions";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session) {
    redirect("/sign-in");
  }

  const { user } = session;
  const userWithRole = user as typeof user & {
    role: "OWNER" | "ADMIN" | "EMPLOYEE";
  };
  const isAdmin =
    userWithRole.role === "OWNER" || userWithRole.role === "ADMIN";

  return (
    <div className="min-h-screen bg-white flex">
      {/* Floating Island Sidebar */}
      <aside className="w-[5.5rem] fixed left-0 top-0 bottom-0 p-3 z-40">
        <div className="w-full h-full bg-white/70 backdrop-blur-md shadow-lg rounded-2xl flex flex-col">
          {/* Logo */}
          <div className="h-16 flex items-center justify-center">
            <Link href="/dashboard" className="flex items-center">
              <div className="w-10 h-10 rounded-xl bg-[#005F6A] flex items-center justify-center">
                <span className="text-white text-lg">C</span>
              </div>
            </Link>
          </div>

          {/* Navigation */}
          <nav className="flex-1 py-4 space-y-2 overflow-y-auto flex flex-col items-center">
            <NavLink href="/dashboard" icon="dashboard" iconOnly>
              Dashboard
            </NavLink>
            {isAdmin && (
              <>
                <NavLink href="/analytics" icon="analytics" iconOnly>
                  Analytics
                </NavLink>
                <NavLink href="/employees" icon="employees" iconOnly>
                  Employees
                </NavLink>
                <NavLink href="/inventory" icon="inventory" iconOnly>
                  Inventory
                </NavLink>
                <NavLink href="/jobs" icon="jobs" iconOnly>
                  Jobs
                </NavLink>
              </>
            )}
            <NavLink href="/my-jobs" icon="my-jobs" iconOnly>
              My Jobs
            </NavLink>
            <NavLink href="/calendar" icon="calendar" iconOnly>
              Calendar
            </NavLink>
          </nav>

          {/* User Section */}
          <div className="pb-4 flex justify-center">
            <UserActions user={userWithRole} signOutAction={signOut} />
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <div className="flex-1 ml-[5.5rem] h-screen overflow-hidden overflow-y-auto">
        <main className="h-full bg-white">{children}</main>
      </div>
    </div>
  );
}
