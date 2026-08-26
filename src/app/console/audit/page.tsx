import Link from "next/link";

import { recentAudit } from "@/lib/console/queries";

import { Pill, TopBar, fmtDateTime } from "../ui";

export const metadata = { title: "Audit log · Awer Console" };

/**
 * Every action Awer staff have taken against a customer's account.
 *
 * Filtering is by link rather than by client-side state on purpose: an audit
 * view someone is reading should be a URL they can send to someone else.
 */

const FILTERS = [
  { key: "", label: "All actions" },
  { key: "org.suspend", label: "Suspensions" },
  { key: "org.reactivate", label: "Reactivations" },
  { key: "plan.", label: "Plan and seats" },
  { key: "trial.", label: "Trials" },
  { key: "request.", label: "Access requests" },
  { key: "staff.", label: "Staff access" },
];

/** Plain English for the action codes stored on each row. */
const WORDS: Record<string, { label: string; tone: "ok" | "trial" | "due" | "off" | "plain" }> = {
  "org.suspend": { label: "Suspended", tone: "due" },
  "org.reactivate": { label: "Reactivated", tone: "ok" },
  "plan.change": { label: "Plan changed", tone: "plain" },
  "plan.seats": { label: "Seats changed", tone: "plain" },
  "trial.extend": { label: "Trial extended", tone: "trial" },
  "trial.restart": { label: "Trial restarted", tone: "trial" },
  "staff.role": { label: "Staff role changed", tone: "plain" },
  "staff.revoke": { label: "Staff access removed", tone: "off" },
  "request.approve": { label: "Request approved", tone: "ok" },
  "request.decline": { label: "Request declined", tone: "off" },
};

function describe(detail: unknown): string {
  if (!detail || typeof detail !== "object") return "—";
  const d = detail as Record<string, unknown>;
  const bits: string[] = [];
  if (d.from != null || d.to != null) {
    bits.push(`${d.from ?? "—"} → ${d.to ?? "—"}`);
  }
  if (typeof d.days === "number") bits.push(`+${d.days} days`);
  if (typeof d.reason === "string") bits.push(d.reason);
  if (typeof d.email === "string") bits.push(d.email);
  return bits.length > 0 ? bits.join(" · ") : "—";
}

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<{ action?: string }>;
}) {
  const { action } = await searchParams;
  const active = action ?? "";
  const entries = await recentAudit(200, active || undefined);

  return (
    <>
      <TopBar crumbs={<b>Audit log</b>} />

      <div className="page">
        <div className="pagehead">
          <div className="grow">
            <h1>Audit log</h1>
            <p className="sub">
              Every action Awer staff have taken against a customer&apos;s account. Entries are
              written once and can never be edited or deleted — including by you.
            </p>
          </div>
        </div>

        <div className="filters" role="group" aria-label="Filter the audit log">
          {FILTERS.map((f) => (
            <Link
              key={f.key || "all"}
              className="chip"
              aria-pressed={active === f.key}
              href={f.key ? `/console/audit?action=${encodeURIComponent(f.key)}` : "/console/audit"}
            >
              {f.label}
            </Link>
          ))}
          <span className="spacer" />
          <span className="muted">
            {entries.length === 200 ? "latest 200 entries" : `${entries.length} entries`}
          </span>
        </div>

        <div className="tablewrap">
          <table className="wide">
            <thead>
              <tr>
                <th>When</th>
                <th>Who</th>
                <th>Action</th>
                <th>Workspace</th>
                <th>Detail</th>
              </tr>
            </thead>
            <tbody>
              {entries.length === 0 ? (
                <tr>
                  <td colSpan={5} className="empty">
                    Nothing recorded yet. The first plan change, suspension or trial extension will
                    appear here.
                  </td>
                </tr>
              ) : (
                entries.map((a) => {
                  const w = WORDS[a.action];
                  return (
                    <tr key={a.id}>
                      <td className="num">{fmtDateTime(a.createdAt)}</td>
                      <td>{a.actorEmail}</td>
                      <td>
                        {w ? <Pill tone={w.tone}>{w.label}</Pill> : <span>{a.action}</span>}
                      </td>
                      <td className="mono">
                        {a.targetOrgSlug ? (
                          <Link href={`/console/workspaces/${a.targetOrgSlug}`}>
                            {a.targetOrgSlug}
                          </Link>
                        ) : (
                          <span className="muted">—</span>
                        )}
                      </td>
                      <td className="muted">{describe(a.detail)}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
