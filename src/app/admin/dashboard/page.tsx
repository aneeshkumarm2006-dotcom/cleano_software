import { getCachedSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import { db } from "@/lib/org-db";
import Link from "next/link";
import {
  CreditCard,
  Briefcase,
  Users,
  Package,
  Wallet,
  CalendarDays,
  Clock,
  AlertTriangle,
  MapPin,
  PauseCircle,
  XCircle,
  Plus,
  ChevronRight,
  type LucideIcon,
} from "lucide-react";
import { isAdminRole } from "@/lib/role-routing";
import { fmtDate, fmtTime } from "@/lib/time";
import { getStoreHour, storeDayRange } from "@/lib/timezone";
import {
  getTotalRevenue,
  getScheduledValue,
  getCompletedJobCount,
  getEmployeeCounts,
  getActiveJobCount,
  activeJobsWhere,
  jobStatusWhere,
  productWhere,
  simpleJobStatus,
  ACTIVE_VALUE_SELECT,
} from "@/lib/metrics";
import { HOLD_LABEL } from "@/lib/job-hold";
import { activeSubtotal, type ActiveValueJob } from "@/lib/job-money";
import { isCleanerLow } from "@/lib/inventory-thresholds";
import { loadCleanerThresholdDefault } from "@/lib/inventory-thresholds.server";
import { avatarColor, initials } from "@/lib/avatar";
import CleanerDashboard from "./CleanerDashboard";

export const dynamic = "force-dynamic";

// ── helpers ───────────────────────────────────────────────
function money(n: number): string {
  return `$${Math.round(n).toLocaleString("en-US")}`;
}
/**
 * Exact-to-the-cent money, for the two tiles that must reconcile with the Jobs
 * page card of the same name. Rounding to whole dollars here is what let the
 * dashboard and /admin/jobs quote visibly different figures for the same
 * definition (client feedback items 10 + 27).
 */
function money2(n: number): string {
  return `$${n.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

// Derived-status pill map (matches the Jobs table — spec's three operational
// statuses, with Paid visually distinct).
const STATUS_PILL: Record<string, { label: string; bg: string; color: string; dot: string }> = {
  // Fix 6 — the one label, amber because a hold is something to act on.
  ON_HOLD: { label: HOLD_LABEL, bg: "#fef3c7", color: "#92400e", dot: "#d97706" },
  SCHEDULED: { label: "Scheduled", bg: "#dbeafe", color: "#1e40af", dot: "#3b82f6" },
  IN_PROGRESS: { label: "In Progress", bg: "#fef3c7", color: "#92400e", dot: "#f59e0b" },
  COMPLETED: { label: "Completed", bg: "#d1fae5", color: "#065f46", dot: "#10b981" },
  PAID: { label: "Paid", bg: "#059669", color: "#ffffff", dot: "#a7f3d0" },
  CANCELLED: { label: "Cancelled", bg: "#fee2e2", color: "#991b1b", dot: "#ef4444" },
};
function StatusPill({ status }: { status: string }) {
  const c = STATUS_PILL[status] || { label: status, bg: "#f3f4f6", color: "#374151", dot: "#9ca3af" };
  return (
    <span className="pill" style={{ background: c.bg, color: c.color }}>
      <span className="pill-dot" style={{ background: c.dot }} />
      {c.label}
    </span>
  );
}

function Stat({
  icon: Icon, label, value, delta, deltaUp, hint,
}: {
  icon: LucideIcon; label: string; value: string | number;
  delta?: string; deltaUp?: boolean; hint?: string;
}) {
  return (
    <div className="astat">
      <div className="astat-head">
        <span>{label}</span>
        <div className="astat-icon"><Icon size={15} /></div>
      </div>
      <div className="astat-value">{value}</div>
      {(delta || hint) && (
        <div className="astat-delta">
          {delta && (
            <strong style={deltaUp ? { color: "var(--emerald-600)" } : undefined}>{delta}</strong>
          )}
          {delta && hint ? " · " : ""}
          {hint}
        </div>
      )}
    </div>
  );
}

function AlertTile({
  icon: Icon, label, value, hint, href,
}: {
  icon: LucideIcon; label: string; value: string | number; hint?: string; href: string;
}) {
  return (
    <Link href={href} className="astat dash-alert">
      <div className="astat-head" style={{ color: "var(--amber-800)" }}>
        <span>{label}</span>
        <span className="astat-icon" style={{ background: "var(--amber-100)", color: "var(--amber-700)" }}>
          <Icon size={16} />
        </span>
      </div>
      <div className="astat-value" style={{ color: "var(--amber-800)" }}>{value}</div>
      {hint && <div className="astat-delta" style={{ color: "var(--amber-700)" }}>{hint}</div>}
    </Link>
  );
}

// Extends ActiveValueJob (fix 3) so these two lists price a job the same way
// the job page, the invoice and the revenue tiles do — base + add-ons, or the
// override total. `price − discount` printed $128 for the $186 grout job.
type JobRow = ActiveValueJob & {
  id: string;
  clientName: string;
  jobDate: Date | null;
  startTime: Date;
  status: string;
  /** Round 4, fix 1 — `simpleJobStatus` reads it to tell a job that was
   *  genuinely worked from one merely stamped done ahead of its date. */
  clockOutTime: Date | null;
};

function ListCard({
  title, viewAllHref, empty, rows, showMoney,
}: {
  title: string; viewAllHref: string; empty: string; rows: JobRow[];
  /** False for OPS_MANAGER / FIELD_LEAD — see `canSeeMoney` in DashboardPage. */
  showMoney: boolean;
}) {
  return (
    <div className="dcard" style={{ gap: 4, padding: 0 }}>
      <div className="dash-listcard-head">
        <h3 style={{ margin: 0, fontSize: 15, fontWeight: 600, color: "var(--ink)" }}>{title}</h3>
        <Link href={viewAllHref} className="link" style={{ fontSize: 13, fontWeight: 500 }}>
          View all →
        </Link>
      </div>
      {rows.length === 0 ? (
        <div className="dash-list-empty">{empty}</div>
      ) : (
        <div className="dash-list">
          {rows.map((j) => {
            const when = j.jobDate ?? j.startTime;
            return (
              <Link key={j.id} href={`/admin/jobs/${j.id}`} className="dash-listrow">
                <div className="avatar" style={{ background: avatarColor(j.clientName), width: 36, height: 36 }}>
                  {initials(j.clientName)}
                </div>
                <div className="dash-listrow-meta">
                  <div className="dash-listrow-name">{j.clientName || "Unknown client"}</div>
                  <div className="dash-listrow-sub">{fmtDate(when, { weekday: "short", month: "short", day: "numeric" })} · {fmtTime(when)}</div>
                </div>
                <div className="dash-listrow-right">
                  {showMoney && (
                    <div className="dash-listrow-price">{money(activeSubtotal(j))}</div>
                  )}
                  <StatusPill status={simpleJobStatus(j)} />
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default async function DashboardPage() {
  const session = await getCachedSession();
  if (!session) redirect("/sign-in");
  const role = (session.user as { role?: string }).role;

  if (!isAdminRole(role)) {
    return <CleanerDashboard userId={session.user.id} userName={session.user.name ?? ""} />;
  }

  /**
   * May this viewer read money on the dashboard? (Stage 7.6 audit.)
   *
   * `isAdminRole` above admits OPS_MANAGER and FIELD_LEAD, and `homeForRole`
   * sends both of them HERE after sign-in — so this page was the first thing a
   * Field Lead saw and it opened with total revenue collected, scheduled value,
   * inventory value and a price on every job in both lists. Stage 7's whole
   * premise is that a Field Lead coordinates a crew without seeing the books, and
   * a My Team page that withholds prices means nothing while the landing page
   * prints the company total.
   *
   * Redacted, not blocked: the operational half of this dashboard (today's jobs,
   * in progress, low stock, refill alerts, upcoming/completed lists, quick
   * actions) is exactly what an ops manager or field lead needs, so the money
   * tiles drop out and everything else stays. The queries behind them are skipped
   * rather than computed-and-hidden.
   */
  const canSeeMoney = role === "OWNER" || role === "ADMIN";

  const now = new Date();
  // Store-timezone day boundary — setHours() would be the server's midnight
  // (UTC on Vercel), shifting the "Today's jobs" tile by 4-5 hours. Half-open
  // [start, end) and derived per civil day, so DST days (23h/25h) still bucket
  // exactly one day's jobs.
  const { start: startOfToday, end: endOfToday } = storeDayRange(now);
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  const [
    totalJobs, onHoldJobs, cancelledJobs, completedJobs, inProgressJobs, pendingPaymentJobs, todaysJobs, upcomingJobs, recentJobs,
  ] = await Promise.all([
    // Round 4, fix 3 — this was `count({ where: { deletedAt: null } })`: every
    // row in the table. So cancelling a job left "Total jobs" exactly where it
    // was, and the figure could only ever climb. It now counts ACTIVE work —
    // not cancelled, not on hold — through the one helper Analytics also uses,
    // and the two counts it excludes are printed right beside it (and again as
    // their own tiles) so nothing disappears from the record.
    getActiveJobCount(),
    // Fix 6 — "the dashboard should separate on-hold jobs from active ones."
    db.job.count({ where: jobStatusWhere("onhold", now) }),
    db.job.count({ where: jobStatusWhere("cancelled", now) }),
    // COMPLETED ∪ PAID, via the canonical bucket the Jobs page's Completed tab
    // uses. Counting bare status:"COMPLETED" here is what made the dashboard
    // read 62 while /admin/jobs read 84 (item 27): the 62 were simply the
    // completed-but-unpaid ones — the same number as the Pending payment tile
    // two rows down, which is what gave the bug away.
    getCompletedJobCount(now),
    db.job.count({ where: { deletedAt: null, status: "IN_PROGRESS" } }),
    // Round 4, fix 1 — "pending payment" is unpaid work we have DONE. The bare
    // status test counted a job dated next week that some writer had stamped
    // COMPLETED, which is the same mis-stamping the Completed tile shows. The
    // canonical `overdue` bucket carries the date guard.
    db.job.count({ where: { ...jobStatusWhere("overdue", now), paymentReceived: false } }),
    // Round 4, fix 3 — same defect as Total jobs, one tile over: the hint under
    // this number says "scheduled today", and a cancelled booking is not
    // scheduled. Cancelling the only job on a quiet day used to leave the tile
    // reading 1.
    db.job.count({
      where: { ...activeJobsWhere(), jobDate: { gte: startOfToday, lt: endOfToday } },
    }),
    db.job.findMany({
      // Fix 6 — CREATED dropped out of this list: an on-hold job is not
      // upcoming work (PDF p5), and it has its own tile below that links
      // straight to the queue where it can be released.
      where: { deletedAt: null, jobDate: { gte: new Date() }, status: "SCHEDULED" },
      orderBy: { jobDate: "asc" },
      take: 5,
      select: { ...ACTIVE_VALUE_SELECT, id: true, clientName: true, jobDate: true, startTime: true, status: true, clockOutTime: true },
    }),
    db.job.findMany({
      // Round 4, fix 1 — the "Recently completed" list is a Completed surface
      // like the tab and the tile, so it takes the same date guard. Kept to
      // status COMPLETED (not the COMPLETED ∪ PAID bucket) so the list keeps
      // meaning what it always did; only the future rows drop out.
      where: { deletedAt: null, status: "COMPLETED", NOT: { startTime: { gt: now }, clockOutTime: null } },
      orderBy: { updatedAt: "desc" },
      take: 5,
      select: { ...ACTIVE_VALUE_SELECT, id: true, clientName: true, jobDate: true, startTime: true, status: true, clockOutTime: true },
    }),
  ]);

  const [totalRevenue, monthlyRevenue, scheduledValue, employeeCounts, onSiteEmployees, products] = await Promise.all([
    // Canonical realized revenue (completed+paid, discount/refund applied, tax
    // excluded, startTime basis) — shared with Analytics/Clients/Employees.
    // Skipped entirely for viewers who may not see it: three aggregate queries
    // whose only consumer is a tile that will not render.
    canSeeMoney ? getTotalRevenue() : Promise.resolve(0),
    // Trailing-30-day slice of the same canonical rule (startTime basis) so a
    // bulk import doesn't dump all revenue into the current month.
    canSeeMoney ? getTotalRevenue({ from: thirtyDaysAgo }) : Promise.resolve(0),
    // Booked but not yet collected — the SQL twin of the predicate the Jobs page
    // applies to its filtered list, so the two cards agree to the cent (item 10).
    canSeeMoney ? getScheduledValue() : Promise.resolve(0),
    getEmployeeCounts(),
    db.user.count({ where: { cleaningJobs: { some: { status: "IN_PROGRESS" } } } }),
    // Same active-record rule as the Inventory page — soft-deleted products
    // must not inflate the Products/low-stock/inventory-value tiles.
    db.product.findMany({ where: productWhere() }),
  ]);

  const employeeCount = employeeCounts.active;
  const totalProducts = products.length;
  const lowStockProducts = products.filter((p) => p.stockLevel <= p.minStock).sort((a, b) => a.stockLevel - b.stockLevel).slice(0, 8);
  const totalInventoryValue = products.reduce((s, p) => s + p.stockLevel * p.costPerUnit, 0);

  // Refill alerts (employee inventory below threshold) — tracked per cleaner
  // so the tile can deep-link to /admin/employees/{id}.
  const [employeesWithProducts, kitThresholdDefault] = await Promise.all([
    db.employeeProduct.findMany({
      select: {
        productId: true,
        quantity: true,
        product: {
          select: { cleanerRestockThreshold: true, itemType: true },
        },
        employee: { select: { id: true, name: true } },
      },
    }),
    // Passed through so this tile counts the same rows the cleaner's own app
    // calls low. Omitting it fell back to 1 and undercounted (PDF #4).
    loadCleanerThresholdDefault(),
  ]);
  let refillAlertCount = 0;
  const refillCleanerMap = new Map<string, { id: string; name: string; lowCount: number }>();
  for (const ep of employeesWithProducts) {
    // The CLEANER restock threshold, which every product has (fix list item
    // 14). This once required an InventoryRule row to exist, so products
    // without one could never raise a refill alert at all.
    //
    // `itemType` makes this a REFILL alert in fact as well as in name: a
    // reusable tool is never low, so it can never land in this count.
    if (
      isCleanerLow(ep.quantity, {
        cleanerRestockThreshold: ep.product.cleanerRestockThreshold,
        defaultThreshold: kitThresholdDefault,
        itemType: ep.product.itemType,
      })
    ) {
      refillAlertCount++;
      const entry = refillCleanerMap.get(ep.employee.id);
      if (entry) entry.lowCount++;
      else refillCleanerMap.set(ep.employee.id, { id: ep.employee.id, name: ep.employee.name, lowCount: 1 });
    }
  }
  const refillCleaners = [...refillCleanerMap.values()].sort((a, b) => b.lowCount - a.lowCount);

  // "completed · 3 on hold · 12 cancelled" — only naming what actually exists,
  // so a clean business doesn't read a dashboard full of zeroes (fix 3 + 6).
  const excludedHint = [
    "completed",
    onHoldJobs > 0 ? `${onHoldJobs} on hold` : null,
    cancelledJobs > 0 ? `${cancelledJobs} cancelled` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  // Store-timezone hour, not the server's. This page renders on the host (UTC),
  const hours = getStoreHour(now);
  const greeting = hours < 12 ? "Good morning" : hours < 18 ? "Good afternoon" : "Good evening";
  const dateLabel = fmtDate(now, { weekday: "long", month: "long", day: "numeric" });
  const firstName = (session.user.name ?? "there").split(/\s+/)[0];

  return (
    <div className="p-8" style={{ maxWidth: 1280, margin: "0 auto" }}>
      <header style={{ marginBottom: 32 }}>
        <p className="eyebrow">{dateLabel}</p>
        <h1 className="display" style={{ fontSize: "clamp(34px, 4.4vw, 50px)", marginTop: 6 }}>
          {greeting}, <em>{firstName}.</em>
        </h1>
        <p className="subtitle" style={{ marginTop: 12, fontSize: 16 }}>
          Here&apos;s what&apos;s happening with your business today.
        </p>
      </header>

      {/* Primary metrics */}
      {/*
        The Products tile that used to close this row moved out (item 10) — the
        client asked for the two money figures he works from on the Jobs page to
        lead the dashboard instead. Product count and inventory value stay one
        click away: the Inventory quick action below carries the count, and the
        low-stock tiles surface anything that needs attention.
      */}
      <div className="astat-grid" style={{ marginBottom: 18 }}>
        {canSeeMoney && (
          <>
            <Stat icon={CreditCard} label="Total revenue collected" value={money2(totalRevenue)} delta={money(monthlyRevenue)} deltaUp hint="this month" />
            <Stat icon={Wallet} label="Scheduled value" value={money2(scheduledValue)} hint="booked · not yet earned" />
          </>
        )}
        {/* Fix 3 + 6: the number is ACTIVE jobs, and the two kinds of job it
            leaves out are named in the hint right underneath it. That pairing
            is the point — a total that quietly shed rows would be a second bug
            rather than a fix, and the PDF asks for the cancelled records to
            stay visible. Each excluded count is also a tile of its own below. */}
        <Stat icon={Briefcase} label="Total jobs" value={totalJobs} delta={String(completedJobs)} hint={excludedHint} />
        <Stat icon={Users} label="Employees" value={employeeCount} delta={String(onSiteEmployees)} deltaUp hint={employeeCounts.inactive > 0 ? `active now · ${employeeCounts.inactive} inactive` : "active now"} />
      </div>

      {/* Secondary + conditional alerts */}
      <div className="dash-secondary" style={{ marginBottom: 32 }}>
        <Stat icon={CalendarDays} label="Today's jobs" value={todaysJobs} hint="scheduled today" />
        <Stat icon={Clock} label="In progress" value={inProgressJobs} hint="cleaners on site" />
        {/* Fix 6. An alert tile, not a plain stat: a hold is work that is
            waiting on somebody in this office, and the link lands on the Jobs
            page's On-hold tab where each row carries a Release button and the
            reason it was held. Hidden at zero, like the alerts beside it. */}
        {onHoldJobs > 0 && (
          <AlertTile icon={PauseCircle} label={HOLD_LABEL} value={onHoldJobs} hint="waiting on a decision" href="/admin/jobs?subTab=onhold" />
        )}
        {/* Fix 3 — the records the total no longer counts, still one click
            away. A plain stat: nothing here needs acting on. */}
        {cancelledJobs > 0 && (
          <Stat icon={XCircle} label="Cancelled" value={cancelledJobs} hint="not counted in total jobs" />
        )}
        {/* A collections queue, not an operational one — money-gated with the
            tiles above rather than left as the one payment figure on the page. */}
        {canSeeMoney && pendingPaymentJobs > 0 && (
          <AlertTile icon={AlertTriangle} label="Pending payment" value={pendingPaymentJobs} hint="jobs awaiting payment" href="/admin/jobs?payment=pending" />
        )}
        {lowStockProducts.length > 0 && (
          <AlertTile icon={Package} label="Low stock" value={lowStockProducts.length} hint={lowStockProducts.length === 1 ? "1 product" : `${lowStockProducts.length} products`} href="/admin/inventory?status=low-stock" />
        )}
        {refillAlertCount > 0 && (
          <AlertTile icon={MapPin} label="Refill alerts" value={refillAlertCount} hint="cleaners low on supplies" href="/admin/inventory" />
        )}
      </div>

      {/* Per-cleaner refill detail — deep-links to each cleaner's inventory */}
      {refillCleaners.length > 0 && (
        <div className="dcard" style={{ marginBottom: 32, marginTop: -14, padding: "14px 18px", display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px 14px" }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: "var(--amber-800)" }}>Low on supplies:</span>
          {refillCleaners.map((c) => (
            <Link
              key={c.id}
              href={`/admin/employees/${c.id}?tab=products`}
              className="link"
              style={{ fontSize: 13, fontWeight: 500 }}>
              {c.name} ({c.lowCount} {c.lowCount === 1 ? "item" : "items"}) →
            </Link>
          ))}
        </div>
      )}

      {/* Two-column lists */}
      <div className="tab-panel" style={{ marginBottom: lowStockProducts.length ? 18 : 32 }}>
        <ListCard title="Upcoming jobs" viewAllHref="/admin/jobs?subTab=upcoming" empty="No upcoming jobs scheduled." rows={upcomingJobs} showMoney={canSeeMoney} />
        <ListCard title="Recently completed" viewAllHref="/admin/jobs?subTab=completed" empty="No completed jobs yet." rows={recentJobs} showMoney={canSeeMoney} />
      </div>

      {/* Low stock alert */}
      {lowStockProducts.length > 0 && (
        <div className="dash-lowstock" style={{ marginBottom: 32 }}>
          <div className="dash-lowstock-head">
            <div className="row" style={{ gap: 10 }}>
              <span className="dash-lowstock-icon"><AlertTriangle size={16} /></span>
              <div>
                <h3 style={{ margin: 0, fontSize: 15, fontWeight: 600, color: "var(--amber-800)" }}>Low stock alert</h3>
                <p style={{ margin: "2px 0 0", fontSize: 13, color: "var(--amber-700)" }}>
                  {lowStockProducts.length} {lowStockProducts.length === 1 ? "product is" : "products are"} at or below the refill threshold.
                </p>
              </div>
            </div>
            <Link href="/admin/inventory" className="link" style={{ color: "var(--amber-800)", fontWeight: 600, fontSize: 13 }}>
              Manage inventory →
            </Link>
          </div>
          <div className="dash-lowstock-grid">
            {lowStockProducts.map((p) => (
              <div key={p.id} className="dash-lowstock-item">
                <div className="dash-lowstock-name">{p.name}</div>
                <div className="dash-lowstock-qty">
                  <strong>{p.stockLevel}</strong> / {p.minStock} {p.unit}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Quick actions */}
      <div>
        <p className="eyebrow" style={{ marginBottom: 14 }}>Quick actions</p>
        <div className="dash-qa-grid">
          {[
            { Icon: Plus, label: "New job", sub: "Schedule a cleaning", href: "/admin/jobs/new" },
            // /admin/employees is OWNER/ADMIN-only, so a Field Lead's version of
            // this tile points at their own group instead of at a page that
            // bounces them.
            role === "FIELD_LEAD"
              ? { Icon: Users, label: "My Team", sub: "Group schedule & availability", href: "/admin/my-team" }
              : { Icon: Users, label: "Employees", sub: `${employeeCount} on the team`, href: "/admin/employees" },
            // Carries what the retired Products tile used to say, so the count
            // and inventory value stay on the dashboard without a tile. The value
            // is a money figure, so it drops for viewers who may not see money —
            // the product count, which is operational, stays.
            {
              Icon: Package,
              label: "Inventory",
              sub: canSeeMoney
                ? `${totalProducts} products · ${money(totalInventoryValue)}`
                : `${totalProducts} products`,
              href: "/admin/inventory",
            },
            // "active", not "total": this is the same number as the tile above,
            // and the tile no longer counts cancelled or on-hold work (fix 3).
            // Calling it "total" here would put two different meanings of the
            // word on one page.
            { Icon: Briefcase, label: "All jobs", sub: `${totalJobs} active`, href: "/admin/jobs" },
          ].map((q) => (
            <Link key={q.label} href={q.href} className="dash-qa">
              <span className="dash-qa-icon"><q.Icon size={20} /></span>
              <span className="dash-qa-text">
                <span className="dash-qa-label">{q.label}</span>
                <span className="dash-qa-sub">{q.sub}</span>
              </span>
              <span className="dash-qa-arrow"><ChevronRight size={16} /></span>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
