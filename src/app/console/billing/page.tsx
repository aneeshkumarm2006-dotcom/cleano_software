import Link from "next/link";

import { listWorkspaces, overviewStats } from "@/lib/console/queries";
import { PLANS } from "@/lib/plans";

import { Pill, TopBar, WarnIcon, fmtDate, fmtMoney } from "../ui";

export const metadata = { title: "Billing · Awer Console" };

/**
 * The money side of every account.
 *
 * Everything here comes from the subscription records Awer holds. Invoice
 * history and card details live in Stripe and are deliberately not copied: two
 * systems holding the same numbers is how a console starts lying.
 */
export default async function BillingPage() {
  const rows = await listWorkspaces();
  const stats = overviewStats(rows);

  const pastDue = rows.filter((w) => w.subscription?.status === "PAST_DUE");
  const noCard = rows.filter(
    (w) => w.subscription != null && w.subscription.stripeCustomerId == null,
  );

  const in30 = new Date();
  in30.setDate(in30.getDate() + 30);
  const renewing = rows
    .filter(
      (w) =>
        w.subscription?.status === "ACTIVE" &&
        w.subscription.currentPeriodEnd != null &&
        w.subscription.currentPeriodEnd <= in30,
    )
    .sort(
      (a, b) =>
        a.subscription!.currentPeriodEnd!.getTime() -
        b.subscription!.currentPeriodEnd!.getTime(),
    );

  const renewingValue = renewing.reduce((n, w) => n + (w.monthlyUsd ?? 0), 0);

  const byPlan = (Object.keys(PLANS) as (keyof typeof PLANS)[]).map((p) => {
    const on = rows.filter((w) => w.plan === p);
    const paying = on.filter((w) => w.billing === "paying" || w.billing === "past_due");
    const price = PLANS[p].monthlyUsd;
    return {
      plan: p,
      label: PLANS[p].label,
      total: on.length,
      paying: paying.length,
      revenue: price == null ? null : paying.length * price,
    };
  });

  return (
    <>
      <TopBar crumbs={<b>Billing</b>} />

      <div className="page">
        <div className="pagehead">
          <div className="grow">
            <h1>Billing</h1>
            <p className="sub">
              What every workspace is on, what it renews for, and anything that could not be
              collected.
            </p>
          </div>
        </div>

        <div className="stats">
          <div className="stat">
            <h3>Monthly revenue</h3>
            <div className="stat-n">{fmtMoney(stats.mrr)}</div>
          </div>
          <div className="stat">
            <h3>Annual run rate</h3>
            <div className="stat-n">{fmtMoney(stats.mrr * 12)}</div>
          </div>
          <div className="stat">
            <h3>Average per account</h3>
            <div className="stat-n">
              {fmtMoney(stats.paying > 0 ? Math.round(stats.mrr / stats.paying) : 0)}
            </div>
          </div>
          <div className={pastDue.length > 0 ? "stat flag" : "stat"}>
            <h3>Payment failed</h3>
            <div className="stat-n">{pastDue.length}</div>
          </div>
          <div className="stat">
            <h3>Renewing in 30 days</h3>
            <div className="stat-n">
              {renewing.length} <em>{fmtMoney(renewingValue)}</em>
            </div>
          </div>
          <div className={noCard.length > 0 ? "stat warn" : "stat"}>
            <h3>No card on file</h3>
            <div className="stat-n">{noCard.length}</div>
          </div>
        </div>

        {pastDue.length > 0 && (
          <div className="notice bad" style={{ marginBottom: 18 }}>
            <WarnIcon />
            <div>
              <b>
                {pastDue.length} workspace{pastDue.length === 1 ? "" : "s"} could not be charged.
              </b>{" "}
              They still have full access during the grace window. Reach the owner before this
              becomes a suspension — a lockout stops cleaners mid-shift.
            </div>
          </div>
        )}

        <div className="cols-2">
          <div className="stack">
            <div className="card">
              <header>
                <h2>Every subscription</h2>
                <span className="right muted">{rows.length} workspaces</span>
              </header>
              <div className="tablewrap flush">
                <table className="mid">
                  <thead>
                    <tr>
                      <th>Workspace</th>
                      <th>Plan</th>
                      <th>State</th>
                      <th className="r">Monthly</th>
                      <th>Renews / ends</th>
                      <th>Card</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((w) => {
                      const s = w.subscription;
                      return (
                        <tr key={w.id}>
                          <td>
                            <Link href={`/console/workspaces/${w.slug}`}>
                              <div className="org">
                                <b>{w.name}</b>
                                <span className="slug">{w.slug}</span>
                              </div>
                            </Link>
                          </td>
                          <td>{PLANS[w.plan].label}</td>
                          <td>
                            {!s ? (
                              <Pill tone="plain">None</Pill>
                            ) : s.status === "ACTIVE" ? (
                              <Pill tone="ok">Active</Pill>
                            ) : s.status === "TRIALING" ? (
                              <Pill tone="trial">Trialing</Pill>
                            ) : s.status === "PAST_DUE" ? (
                              <Pill tone="due">Past due</Pill>
                            ) : (
                              <Pill tone="off">Cancelled</Pill>
                            )}
                          </td>
                          <td className="num r">
                            {w.billing === "paying" || w.billing === "past_due"
                              ? w.monthlyUsd == null
                                ? "Quoted"
                                : fmtMoney(w.monthlyUsd)
                              : "—"}
                          </td>
                          <td className="num muted">
                            {s?.status === "TRIALING"
                              ? `Ends ${fmtDate(s.trialEndsAt)}`
                              : s?.currentPeriodEnd
                                ? fmtDate(s.currentPeriodEnd)
                                : "—"}
                          </td>
                          <td className={s?.stripeCustomerId ? "muted" : "due-txt"}>
                            {s?.stripeCustomerId ? "On file" : "Missing"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="card">
              <header>
                <h2>Renewing in the next 30 days</h2>
                <span className="right muted">{fmtMoney(renewingValue)}</span>
              </header>
              {renewing.length === 0 ? (
                <div className="body">
                  <p className="sub">
                    Nothing renews in the next 30 days. Renewal dates arrive from Stripe once
                    billing is connected.
                  </p>
                </div>
              ) : (
                <div className="tablewrap flush">
                  <table>
                    <thead>
                      <tr>
                        <th>Workspace</th>
                        <th>Renews</th>
                        <th>Plan</th>
                        <th className="r">Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {renewing.map((w) => (
                        <tr key={w.id}>
                          <td>
                            <Link href={`/console/workspaces/${w.slug}`}>
                              <b>{w.name}</b>
                            </Link>
                          </td>
                          <td className="num">{fmtDate(w.subscription!.currentPeriodEnd)}</td>
                          <td>{PLANS[w.plan].label}</td>
                          <td className="num r">{fmtMoney(w.monthlyUsd)}</td>
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
                <h2>Plans in use</h2>
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
                        {p.total} on plan{" "}
                        <span className="muted">
                          {p.revenue == null
                            ? `${p.paying} billed, quoted per deal`
                            : `${fmtMoney(p.revenue)} collected`}
                        </span>
                      </dd>
                    </div>
                  ))}
                </dl>
                {stats.quoted > 0 && (
                  <p className="sub" style={{ marginTop: 12 }}>
                    Organization deals are quoted per customer, so their amounts live in Stripe
                    rather than here and are not counted in the revenue figures above.
                  </p>
                )}
              </div>
            </div>

            <div className="card">
              <header>
                <h2>What happens when a card fails</h2>
              </header>
              <div className="body">
                <ul className="check">
                  <li className="done">
                    <span className="box">1</span>Stripe retries and emails the owner
                  </li>
                  <li className="done">
                    <span className="box">2</span>The workspace shows a billing banner to admins
                  </li>
                  <li className="done">
                    <span className="box">3</span>Access stays on through the grace window
                  </li>
                  <li className="done">
                    <span className="box">4</span>After the final retry it is suspended by hand
                    from here
                  </li>
                </ul>
                <p className="sub" style={{ marginTop: 12 }}>
                  Suspending never deletes anything, and access returns the moment a payment clears.
                  The automatic half of this arrives with the Stripe work in step 7 — today the
                  last step is a person clicking Suspend.
                </p>
              </div>
            </div>

            {noCard.length > 0 && (
              <div className="card">
                <header>
                  <h2>No card on file</h2>
                  <span className="right muted">{noCard.length}</span>
                </header>
                <div className="body">
                  <ul className="check">
                    {noCard.map((w) => (
                      <li key={w.id} className="bad">
                        <span className="box">!</span>
                        <span>
                          <Link href={`/console/workspaces/${w.slug}`}>
                            <b>{w.name}</b>
                          </Link>{" "}
                          <span className="muted">
                            — {w.subscription?.status === "TRIALING" ? "on trial" : "billable"},
                            nothing can be collected
                          </span>
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
