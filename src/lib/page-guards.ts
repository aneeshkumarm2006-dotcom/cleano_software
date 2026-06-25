import { redirect } from "next/navigation";
import { getCachedSession } from "@/lib/auth";
import {
  homeForRole,
  isAdminRole,
  isCleanerRole,
  isClientRole,
} from "@/lib/role-routing";

// Server Component / page guard helpers. Use at the top of a page.tsx:
//
//   const session = await requireAdmin();
//
// On failure, they redirect — execution does not continue past the call.

export async function requireSession() {
  const session = await getCachedSession();
  if (!session) redirect("/sign-in");
  return session;
}

export async function requireAdmin() {
  const session = await requireSession();
  const role = (session.user as { role?: string }).role;
  if (!isAdminRole(role)) redirect(homeForRole(role));
  return session;
}

export async function requireCleaner() {
  const session = await requireSession();
  const role = (session.user as { role?: string }).role;
  if (!isCleanerRole(role)) redirect(homeForRole(role));
  return session;
}

export async function requireClient() {
  const session = await requireSession();
  const role = (session.user as { role?: string }).role;
  if (!isClientRole(role)) redirect(homeForRole(role));
  return session;
}

// For pages accessible to BOTH admins and cleaners (e.g. /calendar, /training,
// /documents, /chat). Still bounces CLIENT users to the customer home.
export async function requireStaff() {
  const session = await requireSession();
  const role = (session.user as { role?: string }).role;
  if (isClientRole(role)) redirect("/");
  return session;
}
