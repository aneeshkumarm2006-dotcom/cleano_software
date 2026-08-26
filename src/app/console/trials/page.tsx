import Link from "next/link";

import { listWorkspaces, setupSteps, getWorkspaceDetail } from "@/lib/console/queries";
import { PLANS, TRIAL_DAYS } from "@/lib/plans";

import { Pill, SeatMeter, TopBar, ago, daysUntil, fmtDate } from "../ui";

export const metadata = { title: "Trials · Awer Console" };

/**
 * Who is trying Awer, and whether they are actually using it.
 *
 * The interesting column is not the end date, it is whether they have booked a
 * job: a trial with real work in it converts, a trial with an empty calendar
 * does not, and only one of those is worth a phone call.
 */
export default async function TrialsPage() {
  const rows = await listWorkspaces();
  const trials = rows
    .filter((w) => w.subscription?.status === "TRIALING")
    .sort((a, b) => {
      const at = a.subscription?.trialEndsAt?.getTime() ?? Infinity;
      const bt = b.subscription?.trialEndsAt?.getTime() ?? Infinity;
      return at - bt;
    });

  // Setup detail per trial. Only trials, so this stays a short list.
  const details = await Promise.all(
    trials.map(async (w) => ({ w, d: await getWorkspaceDetail(w.id) })),
  );

  const endingSoon = trials.filter((w) => {
    const t = w.subscription?.trialEndsAt;
    return t != null && daysUntil(t) <= 7;
  });
  const noCard = trials.filter((w) => !w.subscription?.stripeCustomerId);
  const noJobs = details.filter(({ d }) => d.jobsAllTime === 0);

  // Converted = anyone paying today. Every paying customer started on a trial.
  const converted = rows.filter((w) => w.subscription?.status === "ACTIVE");

  return (
    <>
      <TopBar crumbs={<b>Trials</b>} />

      <div className="page">
        <div className="pagehead">
          <div className="grow">
            <h1>Trials</h1>
            <p className="sub">
              {TRIAL_DAYS} days, no card required. Who is actually using the product, and who
              signed up and walked away.
            </p>
          </div>
        </div>

        <div className="stats">
          <div className="stat">
            <h3>Open trials</h3>
            <div className="stat-n">{trials.length}</div>
          </div>
          <div className={endingSoon.length > 0 ? "stat warn" : "stat"}>
            <h3>Ending this week</h3>
            <div className="stat-n">{endingSoon.length}</div>
          </div>
          <div className={noCard.length > 0 ? "stat flag" : "stat"}>
            <h3>No card on file</h3>
            <div className="stat-n">{noCard.length}</div>
          </div>
          <div className={noJobs.length > 0 ? "stat warn" : "stat"}>
            <h3>No job booked yet</h3>
            <div className="stat-n">{noJobs.length}</div>
          </div>
          <div className="stat good">
            <h3>Paying today</h3>
            <div className="stat-n">{converted.length}</div>
          </div>
        </div>

        <div className="cols-2">
          <div className="stack">
            <div className="card">
              <header>
                <h2>Open trials</h2>
                <span className="right muted">soonest to end first</span>
              </header>
              {details.length === 0 ? (
                <div className="body">
                  <p className="sub">Nobody is on a trial right now.</p>
                </div>
              ) : (
                <div className="tablewrap flush">
                  <table className="mid">
                    <thead>
                      <tr>
                        <th>Workspace</th>
                        <th>Plan</th>
                        <th>Ends</th>
                        <th className="r">Cleaners</th>
                        <th className="r">Jobs</th>
                        <th>Card</th>
                        <th>Setup</th>
                      </tr>
                    </thead>
                    <tbody>
                      {details.map(({ w, d }) => {
                        const ends = w.subscription?.trialEndsAt ?? null;
                        const left = ends ? daysUntil(ends) : null;
                        const steps = setupSteps(w, d);
                        const done = steps.filter((s) => s.done).length;
                        return (
                          <tr key={w.id} className="click">
                            <td>
                              <Link href={`/console/workspaces/${w.slug}`}>
                                <div className="org">
                                  <b>{w.name}</b>
                                  <span className="slug">{w.slug}.useawer.com</span>
                                </div>
                              </Link>
                            </td>
                            <td>{PLANS[w.plan].label}</td>
                            <td
                              className={
                                left == null
                                  ? "num muted"
                                  : left < 0
                                    ? "num due-txt"
                                    : left <= 7
                                      ? "num warn-txt"
                                      : "num"
                              }
                            >
                              {ends ? `${fmtDate(ends)}${left != null ? ` · ${left}d` : ""}` : "—"}
                            </td>
                            <td className="num r">{w.cleaners}</td>
                            <td className={d.jobsAllTime ? "num r" : "num r muted"}>
                              {d.jobsAllTime}
                            </td>
                            <td>
                              {w.subscription?.stripeCustomerId ? (
                                <Pill tone="ok">On file</Pill>
                              ) : (
                                <Pill tone="due">Missing</Pill>
                              )}
                            </td>
                            <td>
                              <SeatMeter used={done} limit={steps.length} />
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div className="card">
              <header>
                <h2>Paying customers</h2>
                <span className="right muted">every one started on a trial</span>
              </header>
              {converted.length === 0 ? (
                <div className="body">
                  <p className="sub">No trial has converted yet.</p>
                </div>
              ) : (
                <div className="tablewrap flush">
                  <table className="mid">
                    <thead>
                      <tr>
                        <th>Workspace</th>
                        <th>Plan</th>
                        <th>Signed up</th>
                        <th className="r">Cleaners</th>
                        <th className="r">Jobs 30d</th>
                        <th>Last active</th>
                      </tr>
                    </thead>
                    <tbody>
                      {converted.map((w) => (
                        <tr key={w.id}>
                          <td>
                            <Link href={`/console/workspaces/${w.slug}`}>
                              <b>{w.name}</b>
                            </Link>
                          </td>
                          <td>{PLANS[w.plan].label}</td>
                          <td className="num muted">{fmtDate(w.createdAt)}</td>
                          <td className="num r">{w.cleaners}</td>
                          <td className="num r">{w.jobs30d}</td>
                          <td className="num muted">{ago(w.lastActiveAt)}</td>
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
                <h2>Trials that need a call</h2>
              </header>
              <div className="body">
                {details.filter(({ w, d }) => !w.subscription?.stripeCustomerId || d.jobsAllTime === 0)
                  .length === 0 ? (
                  <p className="sub">Every open trial has a card on file and real work in it.</p>
                ) : (
                  <ul className="check">
                    {details
                      .filter(({ w, d }) => !w.subscription?.stripeCustomerId || d.jobsAllTime === 0)
                      .map(({ w, d }) => (
                        <li key={w.id} className="bad">
                          <span className="box">!</span>
                          <span>
                            <Link href={`/console/workspaces/${w.slug}`}>
                              <b>{w.name}</b>
                            </Link>
                            {" — "}
                            {d.jobsAllTime === 0
                              ? "has never booked a job"
                              : "has no card on file"}
                          </span>
                        </li>
                      ))}
                  </ul>
                )}
              </div>
            </div>

            <div className="card">
              <header>
                <h2>What a trial includes</h2>
              </header>
              <div className="body">
                <dl className="kv">
                  <dt>Length</dt>
                  <dd className="mono">{TRIAL_DAYS} days</dd>
                  <dt>Card required</dt>
                  <dd>No — they can start with nothing</dd>
                  <dt>Feature limits</dt>
                  <dd>Whatever their chosen plan allows, including the cleaner cap</dd>
                  <dt>When it ends</dt>
                  <dd>
                    Nothing is deleted. Without a card they stop at the door until they add one.
                  </dd>
                </dl>
                <p className="sub" style={{ marginTop: 12 }}>
                  A trial can be extended or restarted from the workspace&apos;s own page. Both are
                  recorded against your name.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
