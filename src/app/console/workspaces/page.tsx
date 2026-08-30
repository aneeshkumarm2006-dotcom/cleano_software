import { listWorkspaces, overviewStats, WINDOW_DAYS } from "@/lib/console/queries";
import { getPlatformStaff } from "@/lib/platform-db";
import { PLANS } from "@/lib/plans";

import { TopBar, ago, fmtMoney, renewalCell, workspaceState } from "../ui";
import NewWorkspace from "./NewWorkspace";
import WorkspaceTable, { type Row } from "./WorkspaceTable";

export const metadata = { title: "Workspaces · Awer Console" };

/**
 * Every cleaning company on Awer.
 *
 * The presentational decisions — which pill, which wording, which tone — are
 * made here on the server and handed down as strings, so the client table has
 * no second copy of those rules.
 */
export default async function WorkspacesPage() {
  const [rows, staff] = await Promise.all([listWorkspaces(), getPlatformStaff()]);
  const stats = overviewStats(rows);

  // Creating a workspace is an ADMIN action, and the server action checks it
  // again regardless. This only decides whether the button looks available.
  const canEdit = staff?.platformRole === "ADMIN" || staff?.platformRole === "OWNER";

  const seatsSold = rows.reduce((n, w) => n + (w.seatLimit ?? w.cleaners), 0);

  const table: Row[] = rows.map((w) => {
    const state = workspaceState(w);
    const renew = renewalCell(w);

    const bucket: Row["bucket"] =
      w.status === "SUSPENDED" || w.status === "CANCELLED"
        ? "suspended"
        : w.subscription?.status === "PAST_DUE"
          ? "past_due"
          : w.subscription?.status === "TRIALING"
            ? "trialing"
            : w.subscription?.status === "ACTIVE"
              ? "active"
              : "other";

    return {
      id: w.id,
      slug: w.slug,
      name: w.name,
      planLabel: PLANS[w.plan].label,
      tone: state.tone,
      stateLabel: state.label,
      bucket,
      cleaners: w.cleaners,
      seatLimit: w.seatLimit,
      jobs30d: w.jobs30d,
      money:
        w.billing === "paying" || w.billing === "past_due"
          ? w.monthlyUsd == null
            ? "Quoted"
            : fmtMoney(w.monthlyUsd)
          : "—",
      renewText: renew.text,
      renewTone: renew.tone,
      ownerName: w.owner?.name ?? "No owner",
      ownerEmail: w.owner?.email ?? "—",
      lastActive: ago(w.lastActiveAt),
    };
  });

  return (
    <>
      <TopBar crumbs={<b>Workspaces</b>} />

      <div className="page">
        <div className="pagehead">
          <div className="grow">
            <h1>Workspaces</h1>
            <p className="sub">
              Every cleaning company on Awer, what they use, and what each one is worth.
            </p>
          </div>
          <NewWorkspace canEdit={canEdit} />
        </div>

        <div className="stats">
          <div className="stat good">
            <h3>Paying</h3>
            <div className="stat-n">
              {stats.paying} <em>of {stats.total}</em>
            </div>
          </div>
          <div className="stat warn">
            <h3>On trial</h3>
            <div className="stat-n">{stats.trialing}</div>
          </div>
          <div className={stats.pastDue > 0 ? "stat flag" : "stat"}>
            <h3>Payment failed</h3>
            <div className="stat-n">{stats.pastDue}</div>
          </div>
          <div className="stat">
            <h3>Suspended</h3>
            <div className="stat-n">{stats.suspended}</div>
          </div>
          <div className="stat">
            <h3>Cleaner seats</h3>
            <div className="stat-n">
              {stats.cleaners.toLocaleString()} <em>of {seatsSold.toLocaleString()}</em>
            </div>
          </div>
          <div className="stat">
            <h3>Jobs · {WINDOW_DAYS}d</h3>
            <div className="stat-n">{stats.jobs30d.toLocaleString()}</div>
          </div>
        </div>

        <WorkspaceTable rows={table} />
      </div>
    </>
  );
}
