import Link from "next/link";

import { listAccessRequests, listWorkspaces } from "@/lib/console/queries";
import { getPlatformStaff } from "@/lib/platform-db";
import { slugify } from "@/lib/provisioning";

import { Pill, TopBar, fmtDate, fmtDateTime } from "../ui";
import RequestCard from "./RequestCard";

export const metadata = { title: "Access requests · Awer Console" };

/** How long a request has been sitting, which is the only urgency this page has. */
function waiting(since: Date): { text: string; late: boolean } {
  const days = Math.floor((Date.now() - since.getTime()) / 86_400_000);
  if (days < 1) return { text: "Today", late: false };
  if (days === 1) return { text: "1 day waiting", late: false };
  return { text: `${days} days waiting`, late: days >= 3 };
}

/**
 * Companies too large for self-serve signup.
 *
 * The whole point of this page is that nobody sits unanswered, so it is ordered
 * by how long each has waited and says so on every card.
 */
export default async function RequestsPage() {
  const [requests, staff, workspaces] = await Promise.all([
    listAccessRequests(),
    getPlatformStaff(),
    listWorkspaces(),
  ]);
  const canEdit = staff?.platformRole === "ADMIN" || staff?.platformRole === "OWNER";

  // The address an approval actually used, which the staff member may have
  // edited away from what was asked for. Linking to the requested slug instead
  // would send you to a 404 exactly when the request was interesting.
  const slugOf = new Map(workspaces.map((w) => [w.id, w.slug]));

  const pending = requests.filter((r) => r.status === "PENDING");
  const decided = requests.filter((r) => r.status !== "PENDING").reverse();
  const oldest = pending[0] ? waiting(pending[0].createdAt) : null;

  return (
    <>
      <TopBar crumbs={<b>Access requests</b>} />

      <div className="page">
        <div className="pagehead">
          <div className="grow">
            <h1>Access requests</h1>
            <p className="sub">
              Companies too large for self-serve signup. They filled in the Organization form and
              are waiting on you.
            </p>
          </div>
        </div>

        <div className="stats">
          <div className={pending.length > 0 ? "stat warn" : "stat"}>
            <h3>Waiting</h3>
            <div className="stat-n">{pending.length}</div>
          </div>
          <div className={oldest?.late ? "stat flag" : "stat"}>
            <h3>Longest wait</h3>
            <div className="stat-n">
              {oldest ? oldest.text.replace(" waiting", "") : "—"}
            </div>
          </div>
          <div className="stat good">
            <h3>Approved</h3>
            <div className="stat-n">
              {requests.filter((r) => r.status === "APPROVED").length}
            </div>
          </div>
          <div className="stat">
            <h3>Declined</h3>
            <div className="stat-n">
              {requests.filter((r) => r.status === "DECLINED").length}
            </div>
          </div>
        </div>

        {!canEdit && (
          <div className="notice" style={{ marginBottom: 16 }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="M12 9v4m0 4h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
            </svg>
            <div>Support can read these. Approving or declining needs an admin.</div>
          </div>
        )}

        {pending.length === 0 ? (
          <div className="card">
            <div className="body">
              <p className="sub">
                Nothing waiting. Requests arrive from the Organization form and appear here — no
                email to watch.
              </p>
            </div>
          </div>
        ) : (
          <div className="reqgrid">
            {pending.map((r) => {
              const w = waiting(r.createdAt);
              return (
                <div className="card req" key={r.id}>
                  <header>
                    <h2>{r.companyName}</h2>
                    <span className={w.late ? "right due-txt mono" : "right muted mono"}>
                      {w.text}
                    </span>
                  </header>
                  <div className="body stack" style={{ gap: 12 }}>
                    {(r.fleetSize || r.wantedSlug) && (
                      <div className="tags">
                        {r.fleetSize && <span className="tag">{r.fleetSize}</span>}
                        {r.wantedSlug && <span className="tag">wants {r.wantedSlug}</span>}
                      </div>
                    )}
                    <dl className="kv">
                      <dt>Contact</dt>
                      <dd>{r.contactName}</dd>
                      <dt>Email</dt>
                      <dd>
                        <a className="mono muted" href={`mailto:${r.email}`}>
                          {r.email}
                        </a>
                      </dd>
                      {r.phone && (
                        <>
                          <dt>Phone</dt>
                          <dd className="mono muted">{r.phone}</dd>
                        </>
                      )}
                      <dt>Submitted</dt>
                      <dd className="mono">{fmtDateTime(r.createdAt)}</dd>
                    </dl>
                    {r.message && <p className="quote">{r.message}</p>}
                  </div>
                  <RequestCard
                    id={r.id}
                    company={r.companyName}
                    suggestedSlug={slugify(r.wantedSlug || r.companyName)}
                    contact={r.contactName}
                    email={r.email}
                    canEdit={canEdit}
                  />
                </div>
              );
            })}
          </div>
        )}

        {decided.length > 0 && (
          <>
            <h2 className="sec">Already decided</h2>
            <div className="tablewrap">
              <table className="mid">
                <thead>
                  <tr>
                    <th>Company</th>
                    <th>Size</th>
                    <th>Submitted</th>
                    <th>Decision</th>
                    <th>Decided by</th>
                    <th>Outcome</th>
                  </tr>
                </thead>
                <tbody>
                  {decided.map((r) => (
                    <tr key={r.id}>
                      <td>
                        <div className="org">
                          <b>{r.companyName}</b>
                          <span className="slug">{r.email}</span>
                        </div>
                      </td>
                      <td className="muted">{r.fleetSize ?? "—"}</td>
                      <td className="num muted">{fmtDate(r.createdAt)}</td>
                      <td>
                        {r.status === "APPROVED" ? (
                          <Pill tone="ok">Approved</Pill>
                        ) : (
                          <Pill tone="off">Declined</Pill>
                        )}
                      </td>
                      <td className="muted">{r.decidedByEmail ?? "—"}</td>
                      <td className="muted">
                        {r.status === "APPROVED" && r.createdOrgId ? (
                          slugOf.has(r.createdOrgId) ? (
                            <Link href={`/console/workspaces/${slugOf.get(r.createdOrgId)}`}>
                              {slugOf.get(r.createdOrgId)}
                            </Link>
                          ) : (
                            <span className="muted">Workspace since removed</span>
                          )
                        ) : (
                          (r.decisionNote ?? "—")
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </>
  );
}
