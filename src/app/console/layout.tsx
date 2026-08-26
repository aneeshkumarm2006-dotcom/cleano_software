import { redirect } from "next/navigation";
import { IBM_Plex_Mono } from "next/font/google";

import { getCachedSession } from "@/lib/auth";
import { getPlatformStaff } from "@/lib/platform-db";
import { listStaff, listWorkspaces } from "@/lib/console/queries";

import ConsoleRail from "./ConsoleRail";
import "./console.css";

/**
 * Awer's own console: every customer's workspace, in one place.
 *
 * Reachable at platform.useawer.com, which is a reserved slug precisely so no
 * customer can ever claim it. The gate here is the outer one; every action
 * re-checks for itself, because a page guard protects a page and an action can
 * be called directly.
 */

// Never prerendered or cached: this reads live customer state and who is asking.
export const dynamic = "force-dynamic";

const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-plex-mono",
  display: "swap",
});

export default async function ConsoleLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const staff = await getPlatformStaff();
  if (!staff) {
    // Two different situations, and sending both to the sign-in form would make
    // an already-signed-in person retype a password that was never the problem.
    // Neither branch says the console exists.
    const session = await getCachedSession();
    redirect(session ? "/api/post-signin" : "/sign-in?callbackUrl=/console");
  }

  const [rows, staffList] = await Promise.all([listWorkspaces(), listStaff()]);

  return (
    <div className={`awer-console ${plexMono.variable}`}>
      <div className="shell">
        <ConsoleRail
          staffName={staff.name}
          staffRole={staff.platformRole}
          workspaces={rows.length}
          trials={rows.filter((w) => w.subscription?.status === "TRIALING").length}
          needsBilling={
            rows.filter((w) => w.subscription?.status === "PAST_DUE").length
          }
          staffCount={staffList.length}
        />
        <main>{children}</main>
      </div>
    </div>
  );
}
