import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/page-guards";
import { getMyTeam, listFieldLeads } from "../actions/getMyTeam";
import MyTeamClient from "./MyTeamClient";

type SearchParams = Promise<{ [key: string]: string | string[] | undefined }>;

/**
 * /admin/my-team — the Field Lead's group schedule & availability view
 * (cleano_inventory_operations_fixes PDF #7, p.6).
 *
 * A Field Lead lands in the admin app (`isAdminRole` includes FIELD_LEAD) but
 * until now had no group-scoped view of anything: `/admin/calendar` and
 * `/admin/jobs` narrowed to their OWN jobs, and every availability action gated
 * on OWNER/ADMIN. This page is their whole coordination surface.
 *
 * READ-ONLY. No write action is reachable from here — PDF #7 asks for
 * visibility, not new permissions.
 *
 * Money is not withheld by this page; it is withheld by
 * `getMyTeam`'s select and by `getMyTeam.types.ts`, which documents every
 * omission as a contract. The page could not render a price if it wanted to.
 */
export default async function MyTeamPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const session = await requireAdmin();
  const role = (session.user as { role?: string }).role;

  // FIELD_LEAD sees their own group; OWNER/ADMIN may inspect a specific lead for
  // support and debugging. OPS_MANAGER is bounced: they already have the full
  // Employees list, and this is not their view.
  const isOwnerAdmin = role === "OWNER" || role === "ADMIN";
  if (role !== "FIELD_LEAD" && !isOwnerAdmin) {
    redirect("/admin/dashboard");
  }

  const params = await searchParams;
  const requestedLeadId =
    typeof params.leadId === "string" ? params.leadId : undefined;

  // An admin with no lead chosen gets a picker rather than an error — there is
  // no such thing as "the admin's own group".
  if (isOwnerAdmin && !requestedLeadId) {
    const leads = await listFieldLeads();
    return (
      <div className="admin-font h-full overflow-hidden overflow-y-auto p-8 stack-24">
        <header className="stack-8">
          <p className="eyebrow">Staff</p>
          <h1 className="display">
            My Team <em>groups.</em>
          </h1>
          <p className="subtitle">
            Every Field Lead with cleaners assigned to them. Open one to see the
            view that lead gets.
          </p>
        </header>
        {leads.length === 0 ? (
          <div className="dcard" style={{ padding: 20 }}>
            <p className="text-sm text-gray-600">
              No groups yet. Assign cleaners to a Field Lead from{" "}
              <Link href="/admin/employees" className="link">
                Employees
              </Link>{" "}
              — open a cleaner and set their Field Lead, or use the bulk action.
            </p>
          </div>
        ) : (
          <>
            <div className="dcard" style={{ padding: 8 }}>
              {leads.map((lead) => (
                <Link
                  key={lead.id}
                  href={`/admin/my-team?leadId=${encodeURIComponent(lead.id)}`}
                  className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2.5 rounded-xl hover:bg-black/[0.03]">
                  <span className="text-sm font-[500] text-gray-800">
                    {lead.name}
                  </span>
                  {/* A group whose lead's app ROLE isn't FIELD_LEAD exists and
                      works, but that lead lands in the cleaner app and cannot
                      open this page for themselves. Saying so here is the only
                      place an admin would ever find out. */}
                  {!lead.canOpenOwnView && (
                    <span className="inline-flex items-center gap-1 rounded-md bg-amber-50 px-2 py-0.5 text-xxs text-amber-800">
                      role is {lead.role} — this lead can&apos;t open My Team
                    </span>
                  )}
                  <span className="ml-auto text-xs text-gray-500">
                    {lead.memberCount}{" "}
                    {lead.memberCount === 1 ? "cleaner" : "cleaners"} →
                  </span>
                </Link>
              ))}
            </div>
            {leads.some((l) => !l.canOpenOwnView) && (
              <p className="text-xs text-gray-600">
                &ldquo;Field Lead&rdquo; is two independent columns: the{" "}
                <strong>tier</strong> (set on the employee&apos;s profile) is what
                makes someone pickable as a group&apos;s lead, while the{" "}
                <strong>role</strong> is what decides which app they land in. A
                lead flagged above has the tier but not the role, so they use the
                cleaner app and never reach /admin/my-team. Change their role to
                Field Lead on their profile to give them this view — note that
                doing so moves them out of the cleaner app.
              </p>
            )}
          </>
        )}
      </div>
    );
  }

  const result = await getMyTeam(requestedLeadId);

  if (!result.success) {
    return (
      <div className="admin-font h-full overflow-hidden overflow-y-auto p-8 stack-24">
        <header className="stack-8">
          <p className="eyebrow">Staff</p>
          <h1 className="display">My Team</h1>
        </header>
        <div className="dcard" style={{ padding: 20 }}>
          <p className="text-sm text-red-600">{result.error}</p>
        </div>
      </div>
    );
  }

  return <MyTeamClient team={result.team} />;
}
