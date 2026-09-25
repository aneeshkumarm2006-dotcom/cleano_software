// Centralized role → routing helpers. Used by sign-in redirect, page guards,
// and layout-level access checks. Keep this in sync with the Roles enum in
// prisma/schema.prisma.

export type AppRole =
  | "OWNER"
  | "ADMIN"
  | "OPS_MANAGER"
  | "FIELD_LEAD"
  | "EMPLOYEE"
  | "CLIENT"
  | "APPLICANT";

// Roles that get the admin app (sidebar + dashboard + ops pages).
const ADMIN_ROLES: AppRole[] = ["OWNER", "ADMIN", "OPS_MANAGER", "FIELD_LEAD"];

export function isAdminRole(role: string | null | undefined): boolean {
  return !!role && ADMIN_ROLES.includes(role as AppRole);
}

// Everyone who works for the company, as opposed to its customers (CLIENT) and
// people who have only applied (APPLICANT). An allow-list on purpose: the
// checks it replaces said "anyone who is not a CLIENT", which let an APPLICANT
// claim real jobs and read their client addresses, and would have let in any
// role added later. A missing or unknown role is not staff.
const STAFF_ROLES: AppRole[] = ["OWNER", "ADMIN", "OPS_MANAGER", "FIELD_LEAD", "EMPLOYEE"];

export function isStaffRole(role: string | null | undefined): boolean {
  return !!role && STAFF_ROLES.includes(role as AppRole);
}

export function isCleanerRole(role: string | null | undefined): boolean {
  return role === "EMPLOYEE";
}

export function isClientRole(role: string | null | undefined): boolean {
  return role === "CLIENT";
}

// Restricted job-applicant portal account (decision D4) — never the cleaner
// app (isCleanerRole stays EMPLOYEE-only) and never staff.
export function isApplicantRole(role: string | null | undefined): boolean {
  return role === "APPLICANT";
}

// Where each role should land after sign-in, and where to redirect users who
// hit a page they don't have access to.
export function homeForRole(role: string | null | undefined): string {
  if (isClientRole(role)) return "/";
  if (isCleanerRole(role)) return "/cleaners/my-jobs";
  if (isApplicantRole(role)) return "/applicant";
  if (isAdminRole(role)) return "/admin/dashboard";
  // Unknown / missing role → bounce to sign-in.
  return "/sign-in";
}
