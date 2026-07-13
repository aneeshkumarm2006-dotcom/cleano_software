import Link from "next/link";
import { db } from "@/db";
import { requireCleaner } from "@/lib/page-guards";
import { ShieldAlert, ShieldCheck } from "lucide-react";
import { fmtDate } from "@/lib/time";
import {
  getStrikeSummary,
  STRIKE_THRESHOLD,
  STRIKE_WINDOW_DAYS,
} from "@/lib/strikes";

export const metadata = {
  title: "My strikes · Cleano",
};

const STATUS_PILL: Record<string, { cls: string; label: string }> = {
  ACTIVE: { cls: "low", label: "Active" },
  EXPIRED: { cls: "created", label: "Rolled off" },
  EXCUSED: { cls: "ok", label: "Excused" },
  REMOVED: { cls: "ok", label: "Removed" },
};

/**
 * Cleaner-facing strike history. The dashboard banner links here so "2 of 3
 * active strikes" has a reason, a date, and a next step attached to it.
 *
 * Authorization: cleaner-only page, and every row is scoped to the session
 * user's own cleanerId — there is no id in the URL to tamper with.
 */
export default async function CleanerStrikesPage() {
  const session = await requireCleaner();
  const cleanerId = session.user.id;

  const now = new Date();

  const [summary, strikes] = await Promise.all([
    getStrikeSummary(cleanerId),
    db.cleanerStrike.findMany({
      where: { cleanerId },
      orderBy: { createdAt: "desc" },
      take: 100,
      select: {
        id: true,
        reason: true,
        status: true,
        createdAt: true,
        expiresAt: true,
        jobId: true,
        job: { select: { jobNumber: true, clientName: true } },
      },
    }),
  ]);

  const isActive = (s: (typeof strikes)[number]) =>
    s.status === "ACTIVE" && s.expiresAt.getTime() > now.getTime();

  const remaining = Math.max(0, STRIKE_THRESHOLD - summary.activeCount);

  return (
    <div className="cl-page-wrap">
      <div className="cl-page-head">
        <div>
          <h1 className="cl-page-title">
            <span className="cl-page-title-icon">
              <ShieldAlert size={22} />
            </span>
            My strikes
          </h1>
          <p className="cl-page-sub">
            Strikes are how we track reliability. They roll off automatically —
            here&apos;s exactly where you stand.
          </p>
        </div>
      </div>

      {/* Standing */}
      <div
        style={{
          display: "flex", alignItems: "flex-start", gap: 12,
          padding: "14px 16px", borderRadius: 14, marginBottom: 18,
          fontSize: 13.5, lineHeight: 1.55,
          border: `1px solid ${
            summary.level === "REVIEW"
              ? "#fdba74"
              : summary.level === "WARNING"
                ? "#fcd34d"
                : "var(--primary-15)"
          }`,
          background:
            summary.level === "REVIEW"
              ? "#fff7ed"
              : summary.level === "WARNING"
                ? "#fffbeb"
                : "#fff",
          color:
            summary.level === "REVIEW"
              ? "#9a3412"
              : summary.level === "WARNING"
                ? "#92400e"
                : "var(--primary-70)",
        }}>
        {summary.level === "OK" ? (
          <ShieldCheck size={18} style={{ flex: "0 0 auto", marginTop: 1, color: "var(--primary)" }} />
        ) : (
          <ShieldAlert size={18} style={{ flex: "0 0 auto", marginTop: 1 }} />
        )}
        <div>
          <strong>
            {summary.activeCount} of {STRIKE_THRESHOLD} active strike
            {summary.activeCount === 1 ? "" : "s"}.
          </strong>{" "}
          {summary.level === "REVIEW"
            ? "You've reached the limit, so an admin will review your account. Your existing schedule doesn't change while that review happens — they'll contact you."
            : summary.activeCount === 0
              ? "Nothing active. Keep it that way and there's nothing to do here."
              : `${remaining} more would trigger an admin review.`}
        </div>
      </div>

      {/* What happens next */}
      <div className="cl-table-wrap" style={{ marginBottom: 18, padding: "16px 18px" }}>
        <h2 style={{ fontSize: 13, fontWeight: 700, color: "var(--ink)", margin: "0 0 8px" }}>
          How strikes work
        </h2>
        <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, lineHeight: 1.7, color: "var(--primary-70)" }}>
          <li>
            A strike stays active for <strong>{STRIKE_WINDOW_DAYS} days</strong>, then rolls
            off on its own. Nothing to apply for.
          </li>
          <li>
            At <strong>{STRIKE_THRESHOLD} active strikes</strong> an admin reviews your
            account. That&apos;s a conversation, not an automatic removal.
          </li>
          <li>
            Think a strike is wrong — running late for a reason you told us about, for
            example? Message dispatch in{" "}
            <Link href="/cleaners/chat" style={{ color: "var(--primary)", fontWeight: 600 }}>
              Messages
            </Link>{" "}
            and an admin can excuse it.
          </li>
        </ul>
      </div>

      {/* History */}
      {strikes.length === 0 ? (
        <div className="cl-empty-block">
          <div className="icon-bubble">
            <ShieldCheck size={28} />
          </div>
          <div>
            <p style={{ fontWeight: 600, color: "var(--ink)", marginBottom: 4 }}>
              No strikes on your record.
            </p>
            <p style={{ margin: 0, fontSize: 13 }}>
              Show up on time and finish your checklists and it stays that way.
            </p>
          </div>
        </div>
      ) : (
        <div className="cl-table-wrap">
          <div className="cl-table-scroll">
            <table className="cl-table">
              <thead>
                <tr>
                  <th>Reason</th>
                  <th>Job</th>
                  <th>Applied</th>
                  <th>Status</th>
                  <th>Rolls off</th>
                </tr>
              </thead>
              <tbody>
                {strikes.map((s) => {
                  const active = isActive(s);
                  // An ACTIVE row past its expiry is just waiting on the sweep.
                  const key = active ? "ACTIVE" : s.status === "ACTIVE" ? "EXPIRED" : s.status;
                  const pill = STATUS_PILL[key] ?? STATUS_PILL.EXPIRED;
                  return (
                    <tr key={s.id}>
                      <td style={{ whiteSpace: "normal", minWidth: 240, color: "var(--ink)" }}>
                        {s.reason}
                      </td>
                      <td>
                        {s.jobId && s.job ? (
                          <Link
                            href={`/cleaners/my-jobs/${s.jobId}`}
                            className="cl-action-btn">
                            #{s.job.jobNumber} · {s.job.clientName}
                          </Link>
                        ) : (
                          <span style={{ color: "var(--primary-40)" }}>—</span>
                        )}
                      </td>
                      <td>{fmtDate(s.createdAt, { month: "short", day: "numeric", year: "numeric" })}</td>
                      <td>
                        <span className={`cl-pill ${pill.cls}`}>{pill.label}</span>
                      </td>
                      <td style={{ color: "var(--primary-60)" }}>
                        {active
                          ? fmtDate(s.expiresAt, { month: "short", day: "numeric", year: "numeric" })
                          : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
