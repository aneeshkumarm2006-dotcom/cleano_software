// Who may call a v1 endpoint (API_V1.md §4, gate 10). Pure, so it can be
// verified without a server.
import { can, CREW_ROLES, OFFICE_ROLES, type ManagerCapability } from "@bookmops/api/v1";

/**
 * Who may call an endpoint. Every form is an allow-list: a missing or unknown
 * role is refused. The role lists and the capability matrix are imported from
 * the contract (packages/api/src/v1/manager-access.ts), the same place the app
 * reads them, so the server and the app can't drift.
 *
 *   "staff"                 the cleaner screens: CREW_ROLES (EMPLOYEE, FIELD_LEAD).
 *   "anyStaff"              every staff role, crew and office (OWNER, ADMIN,
 *                           OPS_MANAGER too): /me, change-password, devices,
 *                           and later team chat and announcements. The app
 *                           picks its side from the role; CLIENT, APPLICANT
 *                           and anything unknown get 403 ROLE_NOT_ALLOWED and
 *                           are signed out with that reason.
 *   { capability: X }       the manager screens: the role must have X under
 *                           capabilitiesFor(role); otherwise 403 FORBIDDEN.
 *   "public"                no session at all: platform endpoints.
 */
export type Access = "staff" | "anyStaff" | { capability: ManagerCapability } | "public";

const ANY_STAFF: readonly string[] = [...CREW_ROLES, ...OFFICE_ROLES];

/** Whether a role passes an access rule. */
export function roleAllowed(access: Exclude<Access, "public">, role: string | null | undefined): boolean {
  if (!role) return false;
  if (access === "staff") return (CREW_ROLES as readonly string[]).includes(role);
  if (access === "anyStaff") return ANY_STAFF.includes(role);
  return can(role, access.capability);
}

