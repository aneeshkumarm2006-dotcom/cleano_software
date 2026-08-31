import Link from "next/link";
import { notFound } from "next/navigation";

import type { OrgPlan } from "@prisma/client";

import {
  auditForOrg,
  getWorkspace,
  getWorkspaceDetail,
  setupSteps,
  WINDOW_DAYS,
} from "@/lib/console/queries";
import { getPlatformStaff } from "@/lib/platform-db";
import { PLANS } from "@/lib/plans";

import {
  Pill,
  SeatMeter,
  StatusPill,
  TopBar,
  WarnIcon,
  ago,
  fmtDate,
  fmtDateTime,
  fmtMoney,
  initialsOf,
} from "../../ui";
import { AccessPanel, CredentialsPanel, PlanPanel, TrialPanel } from "./Panels";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return { title: `${slug} · Awer Console` };
}

/**
 * One customer, in full.
 *
 * Three columns so the whole account fits without scrolling past what matters:
 * money and access on the left, how well they are set up in the middle, what has
 * happened to them on the right.
 */
export default async function WorkspacePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  const [w, staff] = await Promise.all([getWorkspace(slug), getPlatformStaff()]);
  if (!w) notFound();

  const [detail, audit] = await Promise.all([
    getWorkspaceDetail(w.id),
    auditForOrg(w.id),
  ]);

  // SUPPORT can read everything and change nothing. The actions check this again
  // for themselves; disabling the controls is a courtesy, not the guard.
  const canEdit = staff?.platformRole === "ADMIN" || staff?.platformRole === "OWNER";

  const sub = w.subscription;
  const steps = setupSteps(w, detail);
  const doneCount = steps.filter((s) => s.done).length;

  const planOptions = (Object.keys(PLANS) as OrgPlan[]).map((key) => ({
    key,
    label: PLANS[key].label,
    price: PLANS[key].monthlyUsd == null ? "Quoted" : `$${PLANS[key].monthlyUsd}`,
    cap:
      PLANS[key].maxCleaners == null
        ? "unlimited cleaners"
        : `up to ${PLANS[key].maxCleaners} cleaners`,
    capNumber: PLANS[key].maxCleaners,
  }));

  return (
    <>
      <TopBar
        crumbs={
          <>
            <Link href="/console/workspaces">Workspaces</Link> / <b>{w.name}</b>
          </>
        }
      />

      <div className="page">
        <Link className="backlink" href="/console/workspaces">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="m15 18-6-6 6-6" />
          </svg>
          All workspaces
        </Link>

        <div className="idhead">
          <div className="mark">{initialsOf(w.name)}</div>
          <div>
            <h1>{w.name}</h1>
            <div className="idmeta">
              <span className="slug mono">{w.slug}.useawer.com</span>
              <StatusPill w={w} />
              <span className="muted">{w.timezone}</span>
            </div>
          </div>
        </div>

        {w.status === "SUSPENDED" && (
          <div className="notice bad" style={{ marginBottom: 16 }}>
            <WarnIcon />
            <div>
              <b>This workspace is locked.</b> Everyone at {w.name} sees a billing notice instead
              of their work. Their {w.clients.toLocaleString()} customer records and{" "}
              {detail.jobsAllTime.toLocaleString()} jobs are untouched and come straight back when
              you reactivate.
            </div>
          </div>
        )}

        {sub?.status === "PAST_DUE" && w.status === "ACTIVE" && (
          <div className="notice bad" style={{ marginBottom: 16 }}>
            <WarnIcon />
            <div>
              <b>Payment has failed.</b> They still have full access during the grace window. Reach
              the owner before this becomes a suspension — {w.cleaners} cleaners would lose the app
              mid-shift.
            </div>
          </div>
        )}

        {sub?.status === "TRIALING" && !sub.stripeCustomerId && (
          <div className="notice" style={{ marginBottom: 16 }}>
            <WarnIcon />
            <div>
              <b>On trial with no card on file.</b> This will not convert on its own, however well
              it is going.
            </div>
          </div>
        )}

        <div className="cols-3">
          {/* Money and access */}
          <div className="stack">
            <div className="card">
              <header>
                <h2>Subscription</h2>
                {sub?.stripeCustomerId && (
                  <span className="right muted mono">{sub.stripeCustomerId}</span>
                )}
              </header>
              <div className="body">
                <dl className="kv">
                  <dt>Plan</dt>
                  <dd>
                    <b>{PLANS[w.plan].label}</b>
                    {PLANS[w.plan].monthlyUsd != null
                      ? ` · $${PLANS[w.plan].monthlyUsd}/mo`
                      : " · quoted per deal"}
                  </dd>

                  <dt>Billing state</dt>
                  <dd>
                    {sub ? (
                      <Pill
                        tone={
                          sub.status === "ACTIVE"
                            ? "ok"
                            : sub.status === "TRIALING"
                              ? "trial"
                              : sub.status === "PAST_DUE"
                                ? "due"
                                : "off"
                        }
                      >
                        {sub.status === "PAST_DUE"
                          ? "Past due"
                          : sub.status.charAt(0) + sub.status.slice(1).toLowerCase()}
                      </Pill>
                    ) : (
                      <span className="muted">No subscription record</span>
                    )}
                  </dd>

                  {sub?.status === "TRIALING" && (
                    <>
                      <dt>Trial ends</dt>
                      <dd className="mono warn-txt">{fmtDate(sub.trialEndsAt)}</dd>
                    </>
                  )}
                  {sub?.currentPeriodEnd && (
                    <>
                      <dt>Next invoice</dt>
                      <dd className="mono">{fmtDate(sub.currentPeriodEnd)}</dd>
                    </>
                  )}

                  <dt>Card on file</dt>
                  <dd className={sub?.stripeCustomerId ? "muted" : "due-txt"}>
                    {sub?.stripeCustomerId
                      ? "Yes — held by Stripe"
                      : "None — nothing can be collected"}
                  </dd>

                  <dt>Customer since</dt>
                  <dd className="mono">{fmtDate(w.createdAt)}</dd>

                  <dt>Seat limit in force</dt>
                  <dd className="mono">
                    {w.seatLimit ?? "Unlimited"}
                    {sub?.seats != null && <span className="muted"> · sold, not plan default</span>}
                  </dd>
                </dl>
              </div>
            </div>

            <div className="card">
              <header>
                <h2>Plan and seats</h2>
                {!canEdit && <span className="right muted">read-only for support</span>}
              </header>
              <PlanPanel
                orgId={w.id}
                plans={planOptions}
                current={w.plan}
                cleaners={w.cleaners}
                seats={sub?.seats ?? null}
                seatLimit={w.seatLimit}
                canEdit={canEdit}
              />
            </div>

            <div className="card">
              <header>
                <h2>Trial</h2>
              </header>
              <TrialPanel orgId={w.id} trialing={sub?.status === "TRIALING"} canEdit={canEdit} />
            </div>

            <div className="card danger-zone">
              <header>
                <h2>Danger zone</h2>
                {!canEdit && <span className="right muted">admin only</span>}
              </header>
              <AccessPanel
                orgId={w.id}
                name={w.name}
                suspended={w.status !== "ACTIVE"}
                cleaners={w.cleaners}
                clients={w.clients}
                canEdit={canEdit}
              />
            </div>
          </div>

          {/* How well they are set up */}
          <div className="stack">
            <div className="card">
              <header>
                <h2>Setup progress</h2>
                <span className="right muted mono">{doneCount} of {steps.length}</span>
              </header>
              <div className="body">
                <ul className="check">
                  {steps.map((s) => (
                    <li key={s.label} className={s.done ? "done" : ""}>
                      <span className="box">{s.done ? "✓" : ""}</span>
                      {s.label}
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            <div className="card">
              <header>
                <h2>Usage</h2>
                <span className="right muted">last {WINDOW_DAYS} days</span>
              </header>
              <div className="body">
                <dl className="kv">
                  <dt>Cleaners</dt>
                  <dd>
                    <div style={{ maxWidth: 240 }}>
                      <SeatMeter used={w.cleaners} limit={w.seatLimit} />
                    </div>
                  </dd>
                  <dt>Jobs booked</dt>
                  <dd className="mono">{w.jobs30d.toLocaleString()}</dd>
                  <dt>Jobs finished</dt>
                  <dd className="mono">{detail.jobsCompleted30d.toLocaleString()}</dd>
                  <dt>Their revenue</dt>
                  <dd className="mono">{fmtMoney(Math.round(detail.revenue30d))}</dd>
                  <dt>Jobs all time</dt>
                  <dd className="mono">{detail.jobsAllTime.toLocaleString()}</dd>
                  <dt>Customers on file</dt>
                  <dd className="mono">{w.clients.toLocaleString()}</dd>
                  <dt>First job</dt>
                  <dd className="mono muted">{fmtDate(detail.firstJobAt)}</dd>
                  <dt>Latest job</dt>
                  <dd className="mono muted">{fmtDate(detail.lastJobAt)}</dd>
                </dl>
              </div>
            </div>

            <div className="card">
              <header>
                <h2>People</h2>
              </header>
              <div className="body">
                <dl className="kv">
                  <dt>Owner</dt>
                  <dd>
                    {w.owner ? (
                      <>
                        {w.owner.name}
                        <br />
                        <a className="muted mono" href={`mailto:${w.owner.email}`}>
                          {w.owner.email}
                        </a>
                      </>
                    ) : (
                      <span className="due-txt">No owner account</span>
                    )}
                  </dd>
                  <dt>Admins and managers</dt>
                  <dd className="mono">{detail.admins}</dd>
                  <dt>Cleaners</dt>
                  <dd className="mono">{w.cleaners}</dd>
                  <dt>Last sign-in</dt>
                  <dd className="mono muted">{ago(w.lastActiveAt)}</dd>
                </dl>
              </div>
            </div>

            <div className="card">
              <header>
                <h2>Feature access</h2>
                <span className="right muted">{PLANS[w.plan].label}</span>
              </header>
              <div className="body">
                <ul className="check">
                  {PLANS[w.plan].highlights.map((h) => (
                    <li key={h} className="done">
                      <span className="box">✓</span>
                      {h}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>

          {/* What has happened to them */}
          <div className="stack">
            <div className="card">
              <header>
                <h2>Staff actions on this account</h2>
              </header>
              {audit.length === 0 ? (
                <div className="body">
                  <p className="sub">
                    No Awer staff member has changed anything on this account. Every plan change,
                    suspension and trial extension is recorded here permanently.
                  </p>
                </div>
              ) : (
                <ul className="trail">
                  {audit.map((a) => {
                    const d = (a.detail ?? {}) as Record<string, unknown>;
                    const reason = typeof d.reason === "string" ? d.reason : null;
                    const from = d.from == null ? null : String(d.from);
                    const to = d.to == null ? null : String(d.to);
                    return (
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
                            {from && to && (
                              <span className="actor">
                                {" "}
                                {from} → {to}
                              </span>
                            )}
                            {reason && <span className="actor"> · {reason}</span>}
                          </p>
                          <time>
                            {fmtDateTime(a.createdAt)} · {a.actorEmail}
                          </time>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            <div className="card">
              <header>
                <h2>Identifiers</h2>
              </header>
              <div className="body">
                <dl className="kv">
                  <dt>Workspace id</dt>
                  <dd className="mono muted" style={{ wordBreak: "break-all" }}>
                    {w.id}
                  </dd>
                  <dt>Address</dt>
                  <dd className="mono">{w.slug}.useawer.com</dd>
                  <dt>Time zone</dt>
                  <dd className="mono">{w.timezone}</dd>
                  <dt>Stripe customer</dt>
                  <dd className="mono muted" style={{ wordBreak: "break-all" }}>
                    {sub?.stripeCustomerId ?? "—"}
                  </dd>
                  <dt>Stripe subscription</dt>
                  <dd className="mono muted" style={{ wordBreak: "break-all" }}>
                    {sub?.stripeSubscriptionId ?? "—"}
                  </dd>
                </dl>
              </div>
            </div>

            <div className="card">
              <header>
                <h2>Sign-in details</h2>
              </header>
              <CredentialsPanel
                orgId={w.id}
                ownerEmail={w.owner?.email ?? null}
                canEdit={canEdit}
              />
            </div>

            <div className="card">
              <header>
                <h2>Signing in as this customer</h2>
              </header>
              <div className="body">
                <p className="sub">
                  Not built yet, and deliberately last. Opening someone else&apos;s live customer
                  list is the most sensitive thing this console will ever do, so it gets its own
                  pass: a single-use link, a short expiry, a banner the customer can see, and a
                  record at both ends.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
