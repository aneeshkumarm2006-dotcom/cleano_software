import { getCachedSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import { db } from "@/lib/org-db";
import { isApplicantRole, homeForRole } from "@/lib/role-routing";
import signOut from "@/app/admin/actions/signOut";
import AccountDeactivated from "@/app/cleaners/AccountDeactivated";
import ApplicantShell from "./ApplicantShell";

// /applicant/* — restricted job-applicant portal account (decision D4).
// Everyone else is bounced to their own area's home. Mirrors the guard shape
// in src/app/cleaners/layout.tsx and src/app/admin/layout.tsx.
export default async function ApplicantLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getCachedSession();

  if (!session) {
    redirect("/applicant-login");
  }

  const { user } = session;
  const userWithRole = user as typeof user & { role: string };

  if (!isApplicantRole(userWithRole.role)) {
    redirect(homeForRole(userWithRole.role));
  }

  // Rejected/archived applicants (decision D4): isActive=false, login blocked
  // with a friendly message rather than a bare redirect or error.
  const dbUser = await db.user.findUnique({
    where: { id: userWithRole.id },
    select: { isActive: true },
  });
  if (dbUser && dbUser.isActive === false) {
    return (
      <AccountDeactivated
        message="Your application is no longer active. If you have questions, please reach out to us."
        signOutAction={signOut}
      />
    );
  }

  return (
    <ApplicantShell
      user={{ name: userWithRole.name ?? "there", email: userWithRole.email ?? "" }}
      signOutAction={signOut}>
      {children}
    </ApplicantShell>
  );
}
