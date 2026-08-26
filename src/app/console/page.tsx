import Link from "next/link";

import {
  attentionQueue,
  listWorkspaces,
  overviewStats,
  recentAudit,
  WINDOW_DAYS,
} from "@/lib/console/queries";
import { PLANS } from "@/lib/plans";

import { StatusPill, TopBar, ago, fmtDate, fmtDateTime, fmtMoney } from "./ui";

export const metadata = { title: "Overview · Awer Console" };

/**
 * The page that decides whether the console is worth opening.
 *
 * Ordered by what an operator needs first: the money and the counts, then the
 * queue of things that need a person today, then everything else. Nothing here
 * is stored — the queue is derived from the same rows the workspace table
 * shows, so the two can never disagree.
 */
export default async function ConsoleOverview() {
  const rows = await listWorkspaces();
  const stats = overviewStats(rows);
  const queue = attentionQueue(rows);
  const audit = await recentAudit(6);

  const today = new Date().toLocaleDateString("en-CA", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });

  // Revenue split by plan, counting only what is actually being collected.
  const byPlan = (Object.keys(PLANS) as (keyof typeof PLANS)[]).map((p) => {
    const on = rows.filter(
      (w) => w.plan === p && (w.billing === "paying" || w.billing === "past_due"),
    );
    const price = PLANS[p].monthlyUsd;
    return {
      plan: p,
      label: PLANS[p].label,
      count: on.length,
      revenue: price == null ? null : on.length * price,
    };
  });

  const headline =
    queue.length === 0
      ? "Nothing needs a person today."
      : `${queue.length} thing${queue.length === 1 ? "" : "s"} need${queue.length === 1 ? "s" : ""} a person today.`;

  return (
    <>
      <TopBar crumbs={<b>Overview</b>} tag="Live" />

      <div className="page">
        <div className="pagehead">
          <div className="grow">
            <h1>{today}</h1>
            <p className="sub">{headline}</p>
          </div>
        </div>

        <div className="stats">
          <div className="stat">
            <h3>Monthly revenue</h3>
            <div className="stat-n">
              {fmtMoney(stats.mrr)}
              {stats.quoted > 0 && <em>+ {stats.quoted} quoted</em>}
            </div>
          </div>
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
          <div className={stats.pastDue + stats.suspended > 0 ? "stat flag" : "stat"}>
            <h3>Needs attention</h3>
            <div className="stat-n">{queue.length}</div>
          </div>
          <div className="stat">
            <h3>Cleaners on Awer</h3>
            <div className="stat-n">{stats.cleaners.toLocaleString()}</div>
          </div>
          <div className="stat">
            <h3>Jobs · {WINDOW_DAYS}d</h3>
            <div className="stat-n">{stats.jobs30d.toLocaleString()}</div>
          </div>
        </div>

        <div className="cols-2">
          <div className="stack">
            <div className="card">
              <header>
                <h2>Needs your attention</h2>
                <span className="right muted">
                  {queue.length} item{queue.length === 1 ? "" : "s"}
                </span>
              </header>
              {queue.length === 0 ? (
                <div className="body">
                  <p className="sub">
                    Every workspace is paying or trialing normally, inside its seat limit, and
                    has booked work in the last {WINDOW_DAYS} days.
                  </p>
                </div>
              ) : (
                <ul className="queue">
                  {queue.map((item, i) => (
                    <li key={`${item.slug}-${i}`}>
                      <span className={`sev ${item.severity}`} />
                      <div className="txt">
                        <b>{item.title}</b>
                        <p>{item.detail}</p>
                      </div>
                      <Link className="btn sm" href={`/console/workspaces/${item.slug}`}>
                        Open
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="card">
              <header>
                <h2>New this month</h2>
                <span className="right muted">
                  {stats.newThisMonth.length} signup{stats.newThisMonth.length === 1 ? "" : "s"}
                </span>
              </header>
              {stats.newThisMonth.length === 0 ? (
                <div className="body">
                  <p className="sub">No new workspaces yet this month.</p>
                </div>
              ) : (
                <div className="tablewrap flush">
                  <table className="mid">
                    <thead>
                      <tr>
                        <th>Workspace</th>
                        <th>Signed up</th>
                        <th>Plan</th>
                        <th className="r">Cleaners</th>
                        <th className="r">Jobs</th>
                        <th>State</th>
                      </tr>
                    </thead>
                    <tbody>
                      {stats.newThisMonth.map((w) => (
                        <tr key={w.id}>
                          <td>
                            <Link href={`/console/workspaces/${w.slug}`}>
                              <b>{w.name}</b>
                            </Link>
                          </td>
                          <td className="num">{fmtDate(w.createdAt)}</td>
                          <td>{PLANS[w.plan].label}</td>
                          <td className="num r">{w.cleaners}</td>
                          <td className="num r">{w.jobs30d}</td>
                          <td>
                            <StatusPill w={w} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>

          <div className="stack">
            <div className="card">
              <header>
                <h2>Revenue by plan</h2>
              </header>
              <div className="body">
                <dl className="kv">
                  {byPlan.map((p) => (
                    <div key={p.plan} style={{ display: "contents" }}>
                      <dt>
                        {p.label}
                        {PLANS[p.plan].monthlyUsd != null && ` · $${PLANS[p.plan].monthlyUsd}`}
                      </dt>
                      <dd className="mono">
                        {p.count} workspace{p.count === 1 ? "" : "s"}{" "}
                        <span className="muted">
                          {p.revenue == null ? "quoted per deal" : fmtMoney(p.revenue)}
                        </span>
                      </dd>
                    </div>
                  ))}
                  <dt>Annual run rate</dt>
                  <dd className="mono">{fmtMoney(stats.mrr * 12)}</dd>
                </dl>
                {stats.quoted > 0 && (
                  <p className="sub" style={{ marginTop: 12 }}>
                    {stats.quoted} workspace{stats.quoted === 1 ? " is" : "s are"} on a quoted
                    Organization deal. Those amounts live in Stripe, not here, so they are not
                    counted above.
                  </p>
                )}
              </div>
            </div>

            <div className="card">
              <header>
                <h2>Across every workspace</h2>
              </header>
              <div className="body">
                <dl className="kv">
                  <dt>Workspaces</dt>
                  <dd className="mono">{stats.total}</dd>
                  <dt>Cleaners</dt>
                  <dd className="mono">{stats.cleaners.toLocaleString()}</dd>
                  <dt>Customers on file</dt>
                  <dd className="mono">{stats.clients.toLocaleString()}</dd>
                  <dt>Jobs · {WINDOW_DAYS} days</dt>
                  <dd className="mono">{stats.jobs30d.toLocaleString()}</dd>
                  <dt>Suspended</dt>
                  <dd className={stats.suspended > 0 ? "mono due-txt" : "mono"}>
                    {stats.suspended}
                  </dd>
                </dl>
              </div>
            </div>

            <div className="card">
              <header>
                <h2>Staff activity</h2>
                <span className="right muted">
                  <Link href="/console/audit">Full log</Link>
                </span>
              </header>
              {audit.length === 0 ? (
                <div className="body">
                  <p className="sub">
                    Nothing recorded yet. Every action Awer staff take against a customer account
                    appears here.
                  </p>
                </div>
              ) : (
                <ul className="trail">
                  {audit.map((a) => (
                    <li key={a.id}>
                      <span
                        className={`tick ${
                          a.action.includes("suspend")
                            ? "alert"
                            : a.action.includes("reactivate")
                              ? "good"
                              : ""
                        }`}
                      />
                      <div>
                        <p>
                          {a.action}
                          {a.targetOrgSlug && (
                            <>
                              {" · "}
                              <b>{a.targetOrgSlug}</b>
                            </>
                          )}
                        </p>
                        <time>
                          {fmtDateTime(a.createdAt)} · {a.actorEmail}
                        </time>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="card">
              <header>
                <h2>Quietest workspaces</h2>
                <span className="right muted">by last sign-in</span>
              </header>
              <div className="tablewrap flush">
                <table>
                  <thead>
                    <tr>
                      <th>Workspace</th>
                      <th>Last active</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...rows]
                      .sort(
                        (a, b) =>
                          (a.lastActiveAt?.getTime() ?? 0) - (b.lastActiveAt?.getTime() ?? 0),
                      )
                      .slice(0, 5)
                      .map((w) => (
                        <tr key={w.id}>
                          <td>
                            <Link href={`/console/workspaces/${w.slug}`}>{w.name}</Link>
                          </td>
                          <td className="num muted">{ago(w.lastActiveAt)}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
