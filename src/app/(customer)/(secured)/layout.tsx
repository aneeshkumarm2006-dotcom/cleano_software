import { redirect } from "next/navigation";
import { headers, cookies } from "next/headers";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { getSetting } from "@/lib/settings";
import { homeForRole } from "@/lib/role-routing";
import signOut from "../actions/portalSignOut";
import PortalShell from "@/components/customer/PortalShell";
import RatingPopup from "../RatingPopup";
import { getPendingClientRating } from "../actions/ratingActions";

export const metadata = {
  title: "My Cleano",
};

export default async function PortalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth.api.getSession({ headers: await headers() });

  if (!session) {
    // The homescreen app's start URL is "/", so staff/cleaners with an
    // expired session land here too — the door cookie (set at sign-in)
    // routes each audience back to its own login page (item 14).
    const door = (await cookies()).get("cleano_door")?.value;
    if (door === "cleaner") redirect("/cleanos/login");
    if (door === "staff") redirect("/sign-in");
    redirect("/login");
  }

  const role = (session.user as { role?: string }).role;
  if (role && role !== "CLIENT") {
    redirect(homeForRole(role));
  }

  // Forced first-login reset: temp-password (imported) accounts must set their
  // own password before reaching any portal page. /change-password lives
  // outside this secured layout, so this redirect can't loop.
  const account = await db.user.findUnique({
    where: { id: session.user.id },
    select: { mustChangePassword: true },
  });
  if (account?.mustChangePassword) {
    redirect("/change-password");
  }

  // Resolve display name + email — prefer Client record, fall back to User.
  const email = session.user.email?.toLowerCase() ?? "";
  const client = email
    ? await db.client.findFirst({
        where: { email },
        select: { name: true, email: true, isActive: true },
      })
    : null;

  // Deactivated customers see a configurable notice instead of the portal.
  if (client && client.isActive === false) {
    const message = await getSetting("customer.blockedMessage");
    return (
      <div
        style={{
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 24,
          background: "#f7faf9",
        }}>
        <div
          style={{
            maxWidth: 440,
            textAlign: "center",
            background: "#fff",
            border: "1px solid #e5e7eb",
            borderRadius: 16,
            padding: 32,
          }}>
          <h1
            style={{
              fontSize: 20,
              fontWeight: 700,
              color: "#0a1f24",
              marginBottom: 12,
            }}>
            Account unavailable
          </h1>
          <p
            style={{
              fontSize: 14,
              color: "#3a5a62",
              lineHeight: 1.6,
              marginBottom: 20,
            }}>
            {message}
          </p>
          <form action={signOut}>
            <button
              type="submit"
              style={{
                background: "#008C9C",
                color: "#fff",
                border: "none",
                borderRadius: 10,
                padding: "10px 20px",
                fontSize: 14,
                fontWeight: 600,
                cursor: "pointer",
              }}>
              Sign out
            </button>
          </form>
        </div>
      </div>
    );
  }

  const name = client?.name ?? session.user.name ?? "Customer";
  const pendingRating = await getPendingClientRating();

  return (
    <PortalShell user={{ name, email }} signOutAction={signOut}>
      {pendingRating && <RatingPopup pending={pendingRating} />}
      {children}
    </PortalShell>
  );
}
