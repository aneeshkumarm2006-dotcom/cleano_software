// Centralized role → routing helpers. Used by sign-in redirect, page guards,
// and layout-level access checks. Keep this in sync with the Roles enum in
// prisma/schema.prisma.

export type AppRole =
  | "OWNER"
  | "ADMIN"
  | "OPS_MANAGER"
  | "FIELD_LEAD"
  | "EMPLOYEE"
  | "CLIENT";

// Roles that get the admin app (sidebar + dashboard + ops pages).
const ADMIN_ROLES: AppRole[] = ["OWNER", "ADMIN", "OPS_MANAGER", "FIELD_LEAD"];

export function isAdminRole(role: string | null | undefined): boolean {
  return !!role && ADMIN_ROLES.includes(role as AppRole);
}

export function isCleanerRole(role: string | null | undefined): boolean {
  return role === "EMPLOYEE";
}

export function isClientRole(role: string | null | undefined): boolean {
  return role === "CLIENT";
}

// Where each role should land after sign-in, and where to redirect users who
// hit a page they don't have access to.
export function homeForRole(role: string | null | undefined): string {
  if (isClientRole(role)) return "/";
  if (isCleanerRole(role)) return "/cleaners/my-jobs";
  if (isAdminRole(role)) return "/admin/dashboard";
  // Unknown / missing role → bounce to sign-in.
  return "/sign-in";
}
