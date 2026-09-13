import { db } from "@/lib/org-db";
import { requireOwnerAdmin } from "@/lib/page-guards";
import { listJobIssues } from "@/app/admin/actions/jobIssues";

import IssuesClient from "./IssuesClient";

export const metadata = { title: "Issues · Awer" };

/**
 * What cleaners have reported from the field.
 *
 * OWNER/ADMIN, matching `listJobIssues` and `setJobIssueStatus` — both go
 * through `requireOwnerAdmin` in action-guards, so a page guard that admitted
 * OPS_MANAGER / FIELD_LEAD would render an empty list they could not act on.
 * The nav entry carries `adminOnly: true` for the same reason.
 *
 * Loaded unfiltered and filtered in the browser: the tabs are four views of one
 * short list, and an admin flipping between Open and Resolved shouldn't pay a
 * round trip for each.
 */
export default async function AdminIssuesPage() {
  await requireOwnerAdmin();

  const result = await listJobIssues({ limit: 200 });
  const issues = result.ok ? result.issues : [];

  // `JobIssueDTO.resolvedById` is an id — the resolver's NAME is not part of the
  // action's contract, so it is looked up here rather than by widening it.
  const resolverIds = Array.from(
    new Set(issues.map((i) => i.resolvedById).filter((id): id is string => !!id)),
  );
  const resolverNames: Record<string, string> = {};
  if (resolverIds.length > 0) {
    const users = await db.user.findMany({
      where: { id: { in: resolverIds } },
      select: { id: true, name: true },
    });
    for (const u of users) resolverNames[u.id] = u.name;
  }

  return (
    <div className="h-full overflow-hidden overflow-y-auto p-8">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-gray-900">Issues</h1>
        <p className="mt-1 text-sm text-gray-500">
          Problems cleaners hit on site. Acknowledge one to say the office has it;
          resolve it when it&apos;s dealt with.
        </p>
      </div>
      <IssuesClient
        initial={issues}
        resolverNames={resolverNames}
        loadError={result.ok ? null : result.message}
      />
    </div>
  );
}
