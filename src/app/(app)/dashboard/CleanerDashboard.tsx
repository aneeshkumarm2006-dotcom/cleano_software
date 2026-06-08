import Link from "next/link";
import { db } from "@/db";
import {
  MapPin, CheckCircle2, AlertTriangle, Package, DollarSign,
  Calendar, Briefcase, ShieldAlert,
} from "lucide-react";
import { getStrikeSummary, STRIKE_THRESHOLD } from "@/lib/strikes";

interface Props {
  userId: string;
  userName: string;
}

function fmtCountdown(ms: number): string {
  if (ms <= 0) return "Starts now";
  const totalMin = Math.floor(ms / 60000);
  const d = Math.floor(totalMin / (60 * 24));
  const h = Math.floor((totalMin % (60 * 24)) / 60);
  const m = totalMin % 60;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function greeting(name: string) {
  const h = new Date().getHours();
  const g = h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
  const firstName = name.split(" ")[0];
  return { g, firstName };
}

function jobTypeLabel(type: string | null) {
  if (!type) return null;
  const map: Record<string, string> = { R: "Residential", C: "Commercial", PC: "Post-Construction", F: "Follow-up" };
  return map[type] ?? type;
}

export default async function CleanerDashboard({ userId, userName }: Props) {
  const now = new Date();
  const startOfToday = new Date(now); startOfToday.setHours(0, 0, 0, 0);
  const startOfWeek = new Date(now); startOfWeek.setDate(now.getDate() - now.getDay()); startOfWeek.setHours(0, 0, 0, 0);
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  const [upcomingJobs, recentJobs, employeeProducts, ragWashes, ratings] = await Promise.all([
    // Next 6 upcoming jobs
    db.job.findMany({
      where: {
        OR: [{ employeeId: userId }, { cleaners: { some: { id: userId } } }],
        status: { in: ["CREATED", "SCHEDULED"] },
        startTime: { gte: now },
      },
      orderBy: { startTime: "asc" },
      take: 6,
    }),
    // Recent completed jobs
    db.job.findMany({
      where: {
        OR: [{ employeeId: userId }, { cleaners: { some: { id: userId } } }],
        status: { in: ["COMPLETED", "PAID"] },
      },
      orderBy: { jobDate: "desc" },
      take: 4,
    }),
    // Inventory
    db.employeeProduct.findMany({
      where: { employeeId: userId },
      include: { product: { include: { inventoryRule: true } } },
    }),
    // Rag washes
    db.ragWash.findMany({
      where: { employeeId: userId },
      orderBy: { washDate: "desc" },
      take: 1,
    }),
    // Employee ratings
    db.employeeRating.findMany({
      where: { employeeId: userId },
      orderBy: { createdAt: "desc" },
      take: 30,
    }).catch(() => []),
  ]);

  // Week/month earnings from completed jobs
  const [weekJobs, monthJobs] = await Promise.all([
    db.job.findMany({
      where: {
        employeeId: userId,
        status: { in: ["COMPLETED", "PAID"] },
        jobDate: { gte: startOfWeek },
      },
      select: { employeePay: true },
    }),
    db.job.findMany({
      where: {
        employeeId: userId,
        status: { in: ["COMPLETED", "PAID"] },
        jobDate: { gte: startOfMonth },
      },
      select: { employeePay: true },
    }),
  ]);

  const weekEarnings = weekJobs.reduce((s, j) => s + (Number(j.employeePay) || 0), 0);
  const monthEarnings = monthJobs.reduce((s, j) => s + (Number(j.employeePay) || 0), 0);
  const pendingJobs = upcomingJobs.filter((j) => j.employeeId === userId);
  const pendingPay = pendingJobs.reduce((s, j) => s + (Number(j.employeePay) || 0), 0);

  // Low inventory
  const lowItems = employeeProducts.filter((ep) => {
    const rule = ep.product.inventoryRule;
    if (!rule) return false;
    return ep.quantity <= rule.refillThreshold;
  });

  // Next job
  const nextJob = upcomingJobs[0] ?? null;
  const nextJobMs = nextJob?.startTime ? new Date(nextJob.startTime).getTime() - now.getTime() : null;

  // Today's jobs (multiple)
  const todayJobs = upcomingJobs.filter((j) => {
    if (!j.startTime) return false;
    const d = new Date(j.startTime);
    return d >= startOfToday && d < new Date(startOfToday.getTime() + 86400000);
  });

  // Rating
  const avgRating = ratings.length > 0
    ? ratings.reduce((s, r) => s + (r as any).rating, 0) / ratings.length
    : null;

  // Last rag wash
  const lastWash = ragWashes[0] ?? null;
  const daysSinceWash = lastWash
    ? Math.floor((now.getTime() - new Date((lastWash as any).washDate).getTime()) / 86400000)
    : null;

  const { g, firstName } = greeting(userName);
  const dateStr = now.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });

  // Accountability strikes (rolling 30-day window).
  const strikeSummary = await getStrikeSummary(userId);

  return (
    <div className="cl-dash-shell">
      {/* Greeting */}
      <div className="cl-dash-greet">
        <h1>{g}, <em>{firstName}.</em></h1>
        <p>{dateStr} &middot; {todayJobs.length === 0 ? "No jobs today — nice and easy." : `${todayJobs.length} ${todayJobs.length === 1 ? "job" : "jobs"} today.`}</p>
      </div>

      {/* Accountability strikes — only shown when the cleaner has any. */}
      {strikeSummary.activeCount > 0 && (
        <div
          style={{
            display: "flex", alignItems: "flex-start", gap: 10,
            padding: "12px 14px", borderRadius: 12, marginBottom: 16,
            fontSize: 13.5, lineHeight: 1.5,
            border: `1px solid ${strikeSummary.level === "REVIEW" ? "#fca5a5" : "#fcd34d"}`,
            background: strikeSummary.level === "REVIEW" ? "#fef2f2" : "#fffbeb",
            color: strikeSummary.level === "REVIEW" ? "#991b1b" : "#92400e",
          }}>
          <ShieldAlert size={16} style={{ flex: "0 0 auto", marginTop: 1 }} />
          <span>
            <strong>
              {strikeSummary.activeCount} of {STRIKE_THRESHOLD} active strike
              {strikeSummary.activeCount === 1 ? "" : "s"}.
            </strong>{" "}
            {strikeSummary.level === "REVIEW"
              ? "You've reached the limit — an admin will review your account."
              : `${STRIKE_THRESHOLD - strikeSummary.activeCount} more before admin review. Strikes roll off 30 days after they're applied.`}
          </span>
        </div>
      )}

      {/* Next job hero */}
      {nextJob ? (
        <div className="cl-dash-hero">
          <div className="cl-dash-hero-meta">
            <div className="cl-dash-hero-tag">
              <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
              Next job
            </div>
            <h2>{nextJob.clientName}</h2>
            <div className="cl-dash-hero-rows">
              {nextJob.jobDate && nextJob.startTime && (
                <span className="row">
                  <Calendar size={14} />
                  <span><strong>{new Date(nextJob.jobDate).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}</strong> &middot; {new Date(nextJob.startTime).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}</span>
                </span>
              )}
              {nextJob.location && (
                <span className="row">
                  <MapPin size={14} />
                  {nextJob.location}
                </span>
              )}
              {nextJob.jobType && (
                <span className="row">
                  <Briefcase size={14} />
                  <span><strong>{jobTypeLabel(nextJob.jobType)}</strong> cleaning</span>
                </span>
              )}
            </div>
          </div>
          <div className="cl-dash-hero-side">
            <div className="cl-dash-countdown">
              <div className="lbl">{nextJobMs !== null && nextJobMs <= 0 ? "Status" : "Starts in"}</div>
              <div className="val">{nextJobMs !== null ? fmtCountdown(nextJobMs) : "—"}</div>
            </div>
            <Link href={`/my-jobs/${nextJob.id}`} className="cl-dash-hero-cta">
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg>
              View job
            </Link>
          </div>
        </div>
      ) : (
        <div className="cl-dash-empty-hero">
          <div className="icon">
            <Calendar size={26} />
          </div>
          <h3>No upcoming jobs</h3>
          <p>Check the Available jobs board for open shifts.</p>
        </div>
      )}

      {/* Today strip (if multiple jobs today) */}
      {todayJobs.length > 1 && (
        <div>
          <p style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.1em", fontWeight: 700, color: "var(--primary-60)", marginBottom: 10 }}>Today&apos;s schedule</p>
          <div className="cl-dash-today">
            {todayJobs.map((j) => (
              <Link key={j.id} href={`/my-jobs/${j.id}`} className="cl-dash-today-card">
                {j.startTime && <div className="time">{new Date(j.startTime).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}</div>}
                <div className="name">{j.clientName}</div>
                {j.jobType && <div className="type">{jobTypeLabel(j.jobType)}</div>}
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Stats row */}
      <div className="cl-dash-stats">
        {/* Earnings card */}
        <div className="cl-dash-earnings">
          <div className="cl-dash-card-head">
            <h3>
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" style={{ color: "var(--primary)" }}><rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/></svg>
              Earnings
            </h3>
            <Link href="/my-pay" className="link">View My pay →</Link>
          </div>
          <div className="cl-dash-earn-grid">
            <div className="cl-dash-earn-tile featured">
              <div className="lbl">This week</div>
              <div className="val">${weekEarnings.toFixed(2)}</div>
              <div className="delta">{weekJobs.length} job{weekJobs.length === 1 ? "" : "s"}</div>
            </div>
            <div className="cl-dash-earn-tile">
              <div className="lbl">This month</div>
              <div className="val">${monthEarnings.toFixed(2)}</div>
            </div>
            <div className="cl-dash-earn-tile">
              <div className="lbl">Upcoming pay</div>
              <div className="val">${pendingPay.toFixed(2)}</div>
            </div>
          </div>
        </div>

        {/* Performance card */}
        <div className="cl-dash-perf">
          <div className="cl-dash-card-head">
            <h3>Performance</h3>
          </div>
          <div className="cl-dash-perf-stars">
            {[1,2,3,4,5].map((i) => (
              <svg key={i} xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill={avgRating && i <= Math.round(avgRating) ? "#facc15" : "none"} stroke="#facc15" strokeWidth="1.5" strokeLinejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
            ))}
          </div>
          <div className="cl-dash-perf-rating">
            {avgRating !== null ? avgRating.toFixed(1) : "—"}
            <span style={{ fontSize: 16, color: "rgba(255,255,255,0.6)", fontFamily: "var(--font)" }}> / 5</span>
          </div>
          <div className="cl-dash-perf-sub">{ratings.length > 0 ? `Based on ${ratings.length} review${ratings.length === 1 ? "" : "s"}` : "No reviews yet"}</div>
          <div className="cl-dash-perf-mini-row">
            <div className="cl-dash-perf-mini">
              <div className="lbl">Jobs done</div>
              <div className="val">{recentJobs.length}</div>
            </div>
            <div className="cl-dash-perf-mini">
              <div className="lbl">Upcoming</div>
              <div className="val">{upcomingJobs.length}</div>
            </div>
          </div>
        </div>
      </div>

      {/* Upcoming jobs + side stack */}
      <div className="cl-dash-row">
        {/* Upcoming jobs list */}
        <div className="cl-dash-card">
          <div className="cl-dash-card-head">
            <h3>
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" style={{ color: "var(--primary)" }}><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
              Upcoming jobs
            </h3>
            <Link href="/my-jobs" className="link">See all →</Link>
          </div>
          {upcomingJobs.slice(1, 6).length === 0 ? (
            <p style={{ fontSize: 13, color: "var(--primary-50)", fontStyle: "italic", margin: 0 }}>No other jobs lined up.</p>
          ) : upcomingJobs.slice(1, 6).map((j) => (
            <Link key={j.id} href={`/my-jobs/${j.id}`} className="cl-dash-upcoming-row">
              <div className="date-block">
                {j.jobDate ? (
                  <>
                    <span className="m">{new Date(j.jobDate).toLocaleDateString("en-US", { month: "short" }).toUpperCase()}</span>
                    <span className="d">{new Date(j.jobDate).getDate()}</span>
                  </>
                ) : <span className="m">—</span>}
              </div>
              <div className="meta">
                <div className="name">{j.clientName}</div>
                <div className="sub">
                  {j.startTime && new Date(j.startTime).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}
                  {j.location ? ` · ${j.location}` : ""}
                </div>
              </div>
              <span className={`cl-pill ${j.status.toLowerCase().replace(/_/g, "")}`}>{j.status.replace(/_/g, " ")}</span>
            </Link>
          ))}
        </div>

        {/* Side stack */}
        <div className="cl-dash-side-stack">
          {/* Inventory alert */}
          {lowItems.length > 0 && (
            <div className="cl-dash-alert">
              <span className="icon"><AlertTriangle size={20} /></span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <h4>Inventory running low</h4>
                <p>{lowItems.slice(0, 2).map((i) => i.product.name).join(", ")}{lowItems.length > 2 ? ` and ${lowItems.length - 2} other${lowItems.length > 3 ? "s" : ""}` : ""} {lowItems.length === 1 ? "is" : "are"} below threshold. Pick up replacements before your next job.</p>
                <Link href="/my-inventory" className="cl-dash-alert-btn">View inventory →</Link>
              </div>
            </div>
          )}

          {/* Rag wash reminder */}
          <div className="cl-dash-reminder">
            <div className="icon"><Package size={20} /></div>
            <div className="meta">
              <h4>Rag wash</h4>
              <p>{lastWash ? `Last washed ${daysSinceWash === 0 ? "today" : `${daysSinceWash}d ago`}` : "No wash logged yet."}</p>
            </div>
            <Link href="/my-inventory/rag-wash" className="cl-dash-reminder-btn">Log wash</Link>
          </div>
        </div>
      </div>

      {/* Recent activity + quick links */}
      <div className="cl-dash-row">
        {/* Recent activity */}
        <div className="cl-dash-card">
          <div className="cl-dash-card-head">
            <h3>
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" style={{ color: "var(--primary)" }}><polyline points="20 6 9 17 4 12"/></svg>
              Recent activity
            </h3>
            <Link href="/my-jobs" className="link">All jobs →</Link>
          </div>
          {recentJobs.length === 0 ? (
            <p style={{ fontSize: 13, color: "var(--primary-50)", fontStyle: "italic", margin: 0 }}>No completed jobs yet.</p>
          ) : recentJobs.map((j) => (
            <Link key={j.id} href={`/my-jobs/${j.id}`} className="cl-dash-activity-row">
              <div className="check"><CheckCircle2 size={16} /></div>
              <div>
                <div className="name">{j.clientName}</div>
                <div className="sub">
                  {j.jobDate ? new Date(j.jobDate).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : ""}
                  {j.location ? ` · ${j.location}` : ""}
                </div>
              </div>
              {j.employeePay != null && j.employeeId === userId && (
                <div className="amt">${Number(j.employeePay).toFixed(2)}</div>
              )}
            </Link>
          ))}
        </div>

        {/* Quick links */}
        <div className="cl-dash-card">
          <div className="cl-dash-card-head">
            <h3>Quick links</h3>
          </div>
          <div className="cl-dash-quick-grid">
            {[
              { href: "/my-pay",        icon: <DollarSign size={18} />, label: "My pay",       desc: "Earnings + withdraw" },
              { href: "/my-inventory",  icon: <Package size={18} />,    label: "My inventory", desc: "Kit + rag washes" },
              { href: "/available-jobs",icon: <Briefcase size={18} />,  label: "Available",    desc: "Open shifts near you" },
              { href: "/settings",      icon: <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>, label: "Settings", desc: "Profile + alerts" },
            ].map((q) => (
              <Link key={q.href} href={q.href} className="cl-dash-quick">
                <div className="icon-bubble">{q.icon}</div>
                <div className="lbl">{q.label}</div>
                <div className="desc">{q.desc}</div>
              </Link>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
