// Who may do what on the manager side of Bookmops Pro, in one place.
//
// Bookmops Pro is one app for every staff role; the signed-in role decides
// what it shows. This file is the permission matrix for the manager screens,
// written as a pure function so the SERVER (each v1Route's `access`) and the
// APP (which tabs and rows to show) read the same rule and cannot drift. The
// app's copy is presentation only: the server applies this function to every
// manager request and answers 403 for a capability the role doesn't have.
//
// Every rule is the web's, with where it comes from (apps/web/src/…):
//
//   capability        OWNER ADMIN OPS_MGR FIELD_LEAD  web source
//   TEAM_VIEW           ✓     ✓     ✓      group      app/admin/dashboard/page.tsx (today's and in-progress
//                                                      work, company-wide, for every admin role);
//                                                      app/admin/actions/_calendarScope.ts (a FIELD_LEAD sees
//                                                      their group only, never money)
//   JOB_CONTACT         ✓     ✓     ✓       —         app/admin/actions/getJobSummary.ts (OWNER, ADMIN,
//                                                      OPS_MANAGER); a lead sees what My Team shows:
//                                                      client first name and area, never the street
//                                                      (app/admin/actions/getMyTeam.types.ts)
//   JOB_RECORDS         ✓     ✓     —       —         app/admin/jobs/[id]/page.tsx and getClockActivity.ts,
//                                                      getJobPhotos.ts, getJobChecklist.ts, jobIssues.ts
//                                                      (OWNER, ADMIN): clock events, photos, checklist, issues
//   CREW_SET            ✓     ✓     —       —         app/admin/actions/assignCleaners.ts: assign, unassign,
//                                                      reassign (OWNER, ADMIN)
//   CREW_ADD            ✓     ✓     ✓       —         app/admin/actions/bulkAssignCleaner.ts: add one cleaner,
//                                                      never a trainee (OWNER, ADMIN, OPS_MANAGER);
//                                                      checkAvailability.ts: "a lead coordinates a crew, they
//                                                      do not assign it"
//   TIME_APPROVE        ✓     ✓     ✓       ✓         app/admin/actions/decideTimeLogChange.ts and
//                                                      updateClockTimes.ts (isAdminRole: all four, company-wide)
//   WITHDRAWALS         ✓     ✓     —       —         app/admin/actions/processWithdrawal.ts
//   KIT_REQUESTS        ✓     ✓     —       —         app/admin/actions/resolveInventoryRequest.ts
//   ALERTS              ✓     ✓     ✓       ✓         app/admin/notifications/page.tsx (requireAdmin)
//   ISSUES              ✓     ✓     —       —         app/admin/actions/jobIssues.ts (requireOwnerAdmin)
//   OFFICE_INBOX        ✓     ✓     —       —         app/admin/chat/page.tsx (OWNER and ADMIN get the
//                                                      inbox; the Sidebar's Messages entry is adminOnly)
//   TEAM_MODERATE       ✓     ✓     ✓       —         app/cleaners/group-chat/groupChat.ts isAdminRole
//                                                      (OWNER, ADMIN, OPS_MANAGER): every channel, and
//                                                      deleting anyone's message
//
// Not on the phone at all, whatever the role: publishing announcements
// (OWNER, ADMIN, OPS_MANAGER on the web's /admin/announcements), channel
// management, pay periods, invoices, prices. Those stay in the web console.
//
// Which side of the app a role gets (apps/web/src/lib/role-routing.ts):
//   EMPLOYEE              the cleaner app.
//   FIELD_LEAD            the cleaner app, plus the manager screens the table
//                         above gives them (docs/architecture/API_V1.md §12,
//                         decision 3: "both, according to the permissions").
//   OPS_MANAGER, ADMIN,
//   OWNER                 the manager app.
//   CLIENT, APPLICANT,
//   anything else         nothing: the app signs them out and says why.
import type { ROLES } from "./enums";

export type Role = (typeof ROLES)[number];

export const MANAGER_CAPABILITIES = [
  "TEAM_VIEW",
  "JOB_CONTACT",
  "JOB_RECORDS",
  "CREW_SET",
  "CREW_ADD",
  "TIME_APPROVE",
  "WITHDRAWALS",
  "KIT_REQUESTS",
  "ALERTS",
  "ISSUES",
  "OFFICE_INBOX",
  "TEAM_MODERATE",
] as const;
export type ManagerCapability = (typeof MANAGER_CAPABILITIES)[number];

const OWNER_ADMIN: readonly ManagerCapability[] = MANAGER_CAPABILITIES;

const BY_ROLE: Partial<Record<Role, readonly ManagerCapability[]>> = {
  OWNER: OWNER_ADMIN,
  ADMIN: OWNER_ADMIN,
  OPS_MANAGER: ["TEAM_VIEW", "JOB_CONTACT", "CREW_ADD", "TIME_APPROVE", "ALERTS", "TEAM_MODERATE"],
  FIELD_LEAD: ["TEAM_VIEW", "TIME_APPROVE", "ALERTS"],
};

/** What a role may do on the manager screens. An unknown or missing role may do nothing. */
export function capabilitiesFor(role: string | null | undefined): readonly ManagerCapability[] {
  return (role && BY_ROLE[role as Role]) || [];
}

export function can(role: string | null | undefined, capability: ManagerCapability): boolean {
  return capabilitiesFor(role).includes(capability);
}

/**
 * Whose work a role sees on TEAM_VIEW screens. GROUP is the caller's Field
 * Lead group (`User.fieldLeadId`, resolved server-side by fieldLeadGroupIds in
 * apps/web/src/lib/field-lead-group.server.ts; the request never names one).
 */
export type TeamScope = "COMPANY" | "GROUP";

export function teamScopeFor(role: string | null | undefined): TeamScope | null {
  if (role === "OWNER" || role === "ADMIN" || role === "OPS_MANAGER") return "COMPANY";
  if (role === "FIELD_LEAD") return "GROUP";
  return null;
}

/** The roles the cleaner endpoints (v1Route `access: "staff"`) admit. */
export const CREW_ROLES = ["EMPLOYEE", "FIELD_LEAD"] as const satisfies readonly Role[];
/** The roles that get the manager app instead of the cleaner app. */
export const OFFICE_ROLES = ["OWNER", "ADMIN", "OPS_MANAGER"] as const satisfies readonly Role[];

/** Which app a role gets, or null for a role Bookmops Pro doesn't serve. */
export function appSideFor(role: string | null | undefined): "crew" | "office" | null {
  if ((CREW_ROLES as readonly string[]).includes(role ?? "")) return "crew";
  if ((OFFICE_ROLES as readonly string[]).includes(role ?? "")) return "office";
  return null;
}

// ---- Rules every manager endpoint follows ------------------------------------
//
// These hold for every route under /api/v1/manager, whether or not its own
// comment repeats them (see also API_V1.md §4, "Rules every service follows"):
//
//  1. ACCESS. v1Route `access: { capability: X }`: the role must have X under
//     capabilitiesFor, read from the session (never the request); otherwise
//     403 `FORBIDDEN`. The allow-list is this file; a role added later gets
//     nothing until it is added here.
//  2. COMPANY. Every id (job, person, request, withdrawal, conversation,
//     message) is looked up with the session's organizationId in the query.
//     Another company's id answers 404, exactly like one that doesn't exist.
//  3. FIELD_LEAD SCOPE. Where TEAM_VIEW is the capability, a FIELD_LEAD sees
//     jobs matching fieldLeadScopedJobsWhere(fieldLeadGroupIds(caller)) and
//     people in that group only; anything outside it answers 404. An empty
//     group fails closed (the lead's own jobs only), as on the web.
//  4. NO MONEY. No manager response carries a price, a client charge, a
//     payment state, a cleaner's pay or tier percentage, whatever the role.
//     The web shows OWNER and ADMIN those; the phone doesn't need them. The
//     one exception is a withdrawal's amount, which is what is being decided.
//  5. IDEMPOTENCY. Every mutation carries `clientEventId`, also sent as the
//     Idempotency-Key, and goes through IdempotencyRecord (§6): a replay
//     returns the stored answer and fires no email, push or log line again;
//     the same key with a different body answers 422.
//  6. AUDIT. Every mutation records who did it and when, the way the web
//     action it mirrors does (JobLog for jobs, logActivity for decisions),
//     with the before and after values, and says "from the app" in the
//     line so the office can tell the two front doors apart.
//  7. RATE LIMITS, per person, answering 429 (a replayed key isn't counted):
//       crew change (PUT crew, POST cleaners)   60 an hour  emails the client and invites cleaners
//       office chat reply                        10 a minute emails the cleaner when they're away
//       withdrawal decision                      60 an hour  "Mark paid" emails the cleaner
//       everything else                          gate 11's per-user limit
//  8. EFFECTS. Emails, push alerts and invites are returned by the service and
//     flushed with after(), never awaited inside the transaction (§5).
