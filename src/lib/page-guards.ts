import { redirect } from "next/navigation";
import { getCachedSession } from "@/lib/auth";
import {
  homeForRole,
  isAdminRole,
  isApplicantRole,
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

// OWNER/ADMIN only — the page equivalent of `requireOwnerAdmin` in
// `src/lib/action-guards.ts`. For pages OPS_MANAGER / FIELD_LEAD must not see
// (bulk card charging, the audit trail). `homeForRole` sends those two to
// /admin/dashboard and everyone else to their own area's home.
//
// A page using this must also carry `adminOnly: true` on its nav entry in
// `src/app/admin/Sidebar.tsx`, and its server actions need `requireOwnerAdmin`
// from `action-guards` — a page redirect alone leaves the actions callable.
export async function requireOwnerAdmin() {
  const session = await requireSession();
  const role = (session.user as { role?: string }).role;
  if (role !== "OWNER" && role !== "ADMIN") redirect(homeForRole(role));
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

// /applicant/* — restricted portal account (decision D4). Not staff, not the
// cleaner app: isCleanerRole/isAdminRole both exclude APPLICANT already, and
// this guard is the applicant-only mirror of requireCleaner/requireClient.
export async function requireApplicant() {
  const session = await requireSession();
  const role = (session.user as { role?: string }).role;
  if (!isApplicantRole(role)) redirect(homeForRole(role));
  return session;
}

// For pages accessible to BOTH admins and cleaners (e.g. /calendar, /training,
// /documents, /chat). Bounces CLIENT and APPLICANT users to their own home —
// an applicant's restricted portal must not reach these staff-only pages.
export async function requireStaff() {
  const session = await requireSession();
  const role = (session.user as { role?: string }).role;
  if (isClientRole(role) || isApplicantRole(role)) redirect(homeForRole(role));
  return session;
}
