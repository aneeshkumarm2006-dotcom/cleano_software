import { isolationChecks, listWorkspaces, overviewStats } from "@/lib/console/queries";
import { RESERVED_SLUGS, DEFAULT_ORG_SLUG, PLATFORM_ORG_SLUG } from "@/lib/tenant";

import { TopBar, WarnIcon } from "../ui";

export const metadata = { title: "System health · Awer Console" };

/**
 * The guarantees that hold the whole product up, read back from the database
 * rather than asserted.
 *
 * Every line on the isolation card is a live catalog query. A panel that claims
 * row-level security is on because someone typed that into a template is worse
 * than having no panel at all.
 */
export default async function HealthPage() {
  const [checks, rows] = await Promise.all([isolationChecks(), listWorkspaces()]);
  const stats = overviewStats(rows);
  const failing = checks.filter((c) => !c.ok);

  return (
    <>
      <TopBar
        crumbs={<b>System health</b>}
        tag={failing.length === 0 ? "All green" : undefined}
      />

      <div className="page">
        <div className="pagehead">
          <div className="grow">
            <h1>System health</h1>
            <p className="sub">
              The parts shared by every workspace, and the checks that keep one company from ever
              seeing another&apos;s data.
            </p>
          </div>
        </div>

        {failing.length > 0 && (
          <div className="notice bad" style={{ marginBottom: 18 }}>
            <WarnIcon />
            <div>
              <b>
                {failing.length} isolation check{failing.length === 1 ? "" : "s"} did not pass.
              </b>{" "}
              Treat this as urgent: these are the rules that stop one cleaning company reading
              another&apos;s customers, revenue and payroll.
            </div>
          </div>
        )}

        <div className="stats">
          <div className="stat">
            <h3>Workspaces served</h3>
            <div className="stat-n">{stats.total}</div>
          </div>
          <div className="stat">
            <h3>Cleaner accounts</h3>
            <div className="stat-n">{stats.cleaners.toLocaleString()}</div>
          </div>
          <div className="stat">
            <h3>Customer records</h3>
            <div className="stat-n">{stats.clients.toLocaleString()}</div>
          </div>
          <div className="stat">
            <h3>Jobs · 30d</h3>
            <div className="stat-n">{stats.jobs30d.toLocaleString()}</div>
          </div>
          <div className={failing.length === 0 ? "stat good" : "stat flag"}>
            <h3>Isolation checks</h3>
            <div className="stat-n">
              {checks.length - failing.length} <em>of {checks.length}</em>
            </div>
          </div>
        </div>

        <div className="cols-2">
          <div className="stack">
            <div className="card">
              <header>
                <h2>Tenant isolation</h2>
                <span className="right muted">read live from the database</span>
              </header>
              <div className="body">
                <ul className="check">
                  {checks.map((c) => (
                    <li key={c.label} className={c.ok ? "done" : "bad"}>
                      <span className="box">{c.ok ? "✓" : "!"}</span>
                      <span>
                        {c.label} <span className="muted">— {c.detail}</span>
                      </span>
                    </li>
                  ))}
                </ul>
                <p className="sub" style={{ marginTop: 12 }}>
                  Row-level security is the backstop, not the only defence. Application code goes
                  through a client that cannot leave its organization, and every customer table
                  refuses a row that cannot name one. This card confirms the database half is
                  still switched on.
                </p>
              </div>
            </div>

            <div className="card">
              <header>
                <h2>Addresses</h2>
              </header>
              <div className="body">
                <dl className="kv">
                  <dt>Workspace addresses</dt>
                  <dd className="mono">{stats.total} subdomains of useawer.com</dd>
                  <dt>Awer&apos;s own</dt>
                  <dd className="mono">{PLATFORM_ORG_SLUG}.useawer.com</dd>
                  <dt>Serves the bare domain</dt>
                  <dd className="mono">{DEFAULT_ORG_SLUG}</dd>
                  <dt>Names no customer can claim</dt>
                  <dd className="mono">{RESERVED_SLUGS.size}</dd>
                </dl>
                <p className="sub" style={{ marginTop: 12 }}>
                  A host that is not a known workspace falls back to the default rather than
                  failing, which is what keeps the bare domain behaving exactly as it does today.
                </p>
              </div>
            </div>
          </div>

          <div className="stack">
            <div className="card">
              <header>
                <h2>Where a workspace can be</h2>
              </header>
              <div className="body">
                <dl className="kv">
                  <dt>Active</dt>
                  <dd className="mono">
                    {rows.filter((w) => w.status === "ACTIVE").length}{" "}
                    <span className="muted">working normally</span>
                  </dd>
                  <dt>Suspended</dt>
                  <dd className="mono">
                    {rows.filter((w) => w.status === "SUSPENDED").length}{" "}
                    <span className="muted">locked out, data kept</span>
                  </dd>
                  <dt>Not set up</dt>
                  <dd className="mono">
                    {rows.filter((w) => w.status === "PENDING").length}{" "}
                    <span className="muted">signed up, not provisioned</span>
                  </dd>
                  <dt>Cancelled</dt>
                  <dd className="mono">
                    {rows.filter((w) => w.status === "CANCELLED").length}
                  </dd>
                </dl>
                <p className="sub" style={{ marginTop: 12 }}>
                  Anything other than active is refused at the data layer, not just hidden by a
                  page. A locked workspace cannot serve its own customer list even inside a
                  redirect.
                </p>
              </div>
            </div>

            <div className="card">
              <header>
                <h2>Not measured here yet</h2>
              </header>
              <div className="body">
                <p className="sub">
                  Uptime, response times, error rates, scheduled-job runs and the health of Stripe,
                  Twilio, Resend and Cloudinary are not shown, because Awer does not record them
                  yet. They will appear once there is a real number behind each one — an invented
                  green tick is worse than a blank space.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
