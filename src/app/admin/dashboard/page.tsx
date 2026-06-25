import { getCachedSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import { db } from "@/db";
import Link from "next/link";
import {
  CreditCard,
  Briefcase,
  Users,
  Package,
  CalendarDays,
  Clock,
  AlertTriangle,
  MapPin,
  Plus,
  ChevronRight,
  type LucideIcon,
} from "lucide-react";
import { isAdminRole } from "@/lib/role-routing";
import CleanerDashboard from "./CleanerDashboard";

export const dynamic = "force-dynamic";

// ── helpers ───────────────────────────────────────────────
function initials(name: string): string {
  return (name || "?").split(/\s+/).map((w) => w[0] || "").join("").slice(0, 2).toUpperCase();
}
function avatarBg(name: string): string {
  const palette = ["#2c6e75","#1a5c63","#3d7f87","#0e4a52","#4f9097","#246a72","#538c94","#1c6068"];
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) & 0x7fffffff;
  return palette[h % palette.length];
}
function money(n: number): string {
  return `$${Math.round(n).toLocaleString("en-US")}`;
}
function fmtDate(d: Date): string {
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}
function fmtTime(d: Date): string {
  return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

const STATUS_PILL: Record<string, { label: string; bg: string; color: string; dot: string }> = {
  CREATED: { label: "Created", bg: "#f3f4f6", color: "#374151", dot: "#9ca3af" },
  SCHEDULED: { label: "Scheduled", bg: "#dbeafe", color: "#1e40af", dot: "#3b82f6" },
  IN_PROGRESS: { label: "In Progress", bg: "#fef3c7", color: "#92400e", dot: "#f59e0b" },
  COMPLETED: { label: "Completed", bg: "#d1fae5", color: "#065f46", dot: "#10b981" },
  PAID: { label: "Paid", bg: "#d1fae5", color: "#065f46", dot: "#059669" },
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

type JobRow = {
  id: string;
  clientName: string;
  jobDate: Date | null;
  startTime: Date;
  price: number | null;
  discountAmount: number | null;
  status: string;
};

function ListCard({
  title, viewAllHref, empty, rows,
}: {
  title: string; viewAllHref: string; empty: string; rows: JobRow[];
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
                <div className="avatar" style={{ background: avatarBg(j.clientName), width: 36, height: 36 }}>
                  {initials(j.clientName)}
                </div>
                <div className="dash-listrow-meta">
                  <div className="dash-listrow-name">{j.clientName || "Unknown client"}</div>
                  <div className="dash-listrow-sub">{fmtDate(when)} · {fmtTime(when)}</div>
                </div>
                <div className="dash-listrow-right">
                  <div className="dash-listrow-price">{money((j.price || 0) - (j.discountAmount || 0))}</div>
                  <StatusPill status={j.status} />
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

  const now = new Date();
  const startOfToday = new Date(new Date().setHours(0, 0, 0, 0));
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  const [
    totalJobs, completedJobs, inProgressJobs, pendingPaymentJobs, todaysJobs, upcomingJobs, recentJobs,
  ] = await Promise.all([
    db.job.count(),
    db.job.count({ where: { status: "COMPLETED" } }),
    db.job.count({ where: { status: "IN_PROGRESS" } }),
    db.job.count({ where: { status: "COMPLETED", paymentReceived: false } }),
    db.job.count({
      where: { jobDate: { gte: startOfToday, lt: new Date(startOfToday.getTime() + 86400000) } },
    }),
    db.job.findMany({
      where: { jobDate: { gte: new Date() }, status: { in: ["CREATED", "SCHEDULED"] } },
      orderBy: { jobDate: "asc" },
      take: 5,
      select: { id: true, clientName: true, jobDate: true, startTime: true, price: true, discountAmount: true, status: true },
    }),
    db.job.findMany({
      where: { status: "COMPLETED" },
      orderBy: { updatedAt: "desc" },
      take: 5,
      select: { id: true, clientName: true, jobDate: true, startTime: true, price: true, discountAmount: true, status: true },
    }),
  ]);

  const [revenueData, monthlyRevenueData, employeeCount, activeEmployees, products] = await Promise.all([
    db.job.aggregate({ where: { status: { in: ["COMPLETED", "PAID"] } }, _sum: { price: true } }),
    db.job.aggregate({
      where: { status: { in: ["COMPLETED", "PAID"] }, createdAt: { gte: thirtyDaysAgo } },
      _sum: { price: true },
    }),
    db.user.count(),
    db.user.count({ where: { cleaningJobs: { some: { status: "IN_PROGRESS" } } } }),
    db.product.findMany(),
  ]);

  const totalRevenue = revenueData._sum.price || 0;
  const monthlyRevenue = monthlyRevenueData._sum.price || 0;
  const totalProducts = products.length;
  const lowStockProducts = products.filter((p) => p.stockLevel <= p.minStock).sort((a, b) => a.stockLevel - b.stockLevel).slice(0, 8);
  const totalInventoryValue = products.reduce((s, p) => s + p.stockLevel * p.costPerUnit, 0);

  // Refill alerts (employee inventory below threshold)
  const [inventoryRules, employeesWithProducts] = await Promise.all([
    db.inventoryRule.findMany(),
    db.employeeProduct.findMany({ select: { productId: true, quantity: true } }),
  ]);
  let refillAlertCount = 0;
  for (const ep of employeesWithProducts) {
    const rule = inventoryRules.find((r) => r.productId === ep.productId);
    if (rule && ep.quantity <= rule.refillThreshold) refillAlertCount++;
  }

  const hours = now.getHours();
  const greeting = hours < 12 ? "Good morning" : hours < 18 ? "Good afternoon" : "Good evening";
  const dateLabel = now.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
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
      <div className="astat-grid" style={{ marginBottom: 18 }}>
        <Stat icon={CreditCard} label="Total revenue" value={money(totalRevenue)} delta={money(monthlyRevenue)} deltaUp hint="this month" />
        <Stat icon={Briefcase} label="Total jobs" value={totalJobs} delta={String(completedJobs)} hint="completed" />
        <Stat icon={Users} label="Employees" value={employeeCount} delta={String(activeEmployees)} deltaUp hint="active now" />
        <Stat icon={Package} label="Products" value={totalProducts} delta={money(totalInventoryValue)} hint="inventory value" />
      </div>

      {/* Secondary + conditional alerts */}
      <div className="dash-secondary" style={{ marginBottom: 32 }}>
        <Stat icon={CalendarDays} label="Today's jobs" value={todaysJobs} hint="scheduled today" />
        <Stat icon={Clock} label="In progress" value={inProgressJobs} hint="cleaners on site" />
        {pendingPaymentJobs > 0 && (
          <AlertTile icon={AlertTriangle} label="Pending payment" value={pendingPaymentJobs} hint="jobs awaiting payment" href="/admin/jobs?payment=pending" />
        )}
        {lowStockProducts.length > 0 && (
          <AlertTile icon={Package} label="Low stock" value={lowStockProducts.length} hint={lowStockProducts.length === 1 ? "1 product" : `${lowStockProducts.length} products`} href="/admin/inventory?status=low" />
        )}
        {refillAlertCount > 0 && (
          <AlertTile icon={MapPin} label="Refill alerts" value={refillAlertCount} hint="cleaners low on supplies" href="/admin/inventory" />
        )}
      </div>

      {/* Two-column lists */}
      <div className="tab-panel" style={{ marginBottom: lowStockProducts.length ? 18 : 32 }}>
        <ListCard title="Upcoming jobs" viewAllHref="/admin/jobs?subTab=upcoming" empty="No upcoming jobs scheduled." rows={upcomingJobs} />
        <ListCard title="Recently completed" viewAllHref="/admin/jobs?subTab=completed" empty="No completed jobs yet." rows={recentJobs} />
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
            { Icon: Users, label: "Employees", sub: `${employeeCount} on the team`, href: "/admin/employees" },
            { Icon: Package, label: "Inventory", sub: `${totalProducts} products`, href: "/admin/inventory" },
            { Icon: Briefcase, label: "All jobs", sub: `${totalJobs} total`, href: "/admin/jobs" },
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
