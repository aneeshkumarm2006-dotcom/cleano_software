"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  CalendarClock,
  Check,
  CheckCircle,
  ChevronLeft,
  ChevronRight,
  Send,
  Sparkles,
  X,
  XCircle,
} from "lucide-react";
import { retryEmail } from "../actions/retryEmail";

export interface LogRow {
  id: string;
  source: "email" | "activity";
  createdAt: string;
  category: string;
  action: string; // raw internal code (technical)
  kind: string | null; // EmailKind (technical)
  notificationKey: string | null; // catalog key (technical)
  status: string; // SUCCESS | FAILED | PENDING | SKIPPED
  title: string; // plain-English headline
  detail: string | null; // plain-English secondary line
  recipient: string | null;
  subject: string | null;
  actorLabel: string | null;
  targetType: string | null;
  targetId: string | null;
  targetLabel: string | null; // plain-English target ("Job #123 — Jane")
  amount: number | null;
  error: string | null;
  providerId: string | null;
  retryable: boolean;
}

interface Counts {
  emailsSent: number;
  emailsFailed: number;
  emailsPending: number;
  activityOk: number;
  activityFailed: number;
}

// ─── Category + status meta ───
const CATEGORY_META: Record<string, { color: string; label: string }> = {
  EMAIL: { color: "#0284c7", label: "Email" },
  SMS: { color: "#7c3aed", label: "SMS" },
  PAYMENT: { color: "#059669", label: "Payment" },
  REFUND: { color: "#d97706", label: "Refund" },
  DEPOSIT: { color: "#0d9488", label: "Deposit" },
  WEBHOOK: { color: "#6366f1", label: "Webhook" },
  AUTH: { color: "#be185d", label: "Auth" },
  BOOKING: { color: "#008C9C", label: "Booking" },
  ADMIN: { color: "#64748b", label: "Admin" },
  CRON: { color: "#9333ea", label: "Cron" },
  SYSTEM: { color: "#475569", label: "System" },
};
const CATEGORY_ORDER = [
  "EMAIL", "SMS", "PAYMENT", "REFUND", "DEPOSIT", "WEBHOOK",
  "AUTH", "BOOKING", "ADMIN", "CRON", "SYSTEM",
];

const STATUS_META: Record<
  string,
  { bg: string; fg: string; dot: string; label: string }
> = {
  SUCCESS: { bg: "var(--emerald-100)", fg: "var(--emerald-800)", dot: "#059669", label: "Success" },
  FAILED: { bg: "var(--error-bg)", fg: "var(--error-text)", dot: "#dc2626", label: "Failed" },
  PENDING: { bg: "var(--amber-50)", fg: "var(--amber-800)", dot: "#d97706", label: "Pending" },
  SKIPPED: { bg: "var(--slate-100)", fg: "var(--slate-700)", dot: "#94a3b8", label: "Skipped" },
};

function StatusBadge({ status }: { status: string }) {
  const m = STATUS_META[status] || STATUS_META.SKIPPED;
  return (
    <span className="pill" style={{ background: m.bg, color: m.fg }}>
      <span className="pill-dot" style={{ background: m.dot }} />
      {m.label}
    </span>
  );
}

// ─── Formatters ───
function money(n: number) {
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function dateStr(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
function timeStr(iso: string) {
  return new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

// ─── Date helpers ───
function startOfDay(d: Date) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
function endOfDay(d: Date) { const x = new Date(d); x.setHours(23, 59, 59, 999); return x; }
function sameDay(a: Date | null, b: Date | null) {
  return !!a && !!b && startOfDay(a).getTime() === startOfDay(b).getTime();
}
function fmtDay(d: Date) { return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric" }); }

const PRESETS = [
  { id: "all", label: "All time" },
  { id: "today", label: "Today" },
  { id: "7d", label: "Last 7 days" },
  { id: "30d", label: "Last 30 days" },
];
function presetRange(id: string): [Date | null, Date | null] {
  const end = endOfDay(new Date());
  const s = startOfDay(new Date());
  if (id === "today") return [s, end];
  if (id === "7d") { s.setDate(s.getDate() - 6); return [s, end]; }
  if (id === "30d") { s.setDate(s.getDate() - 29); return [s, end]; }
  return [null, null];
}

interface RangeValue { preset: string; from: Date | null; to: Date | null; }

// ─── Date-range picker (presets + calendar) ───
function DateRange({ value, onChange }: { value: RangeValue; onChange: (v: RangeValue) => void }) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState(() => new Date());
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open]);

  const label = value.preset === "custom" && value.from
    ? `${fmtDay(value.from)} – ${value.to ? fmtDay(value.to) : "…"}`
    : (PRESETS.find((p) => p.id === value.preset) || PRESETS[0]).label;

  function pickPreset(id: string) { onChange({ preset: id, from: null, to: null }); setOpen(false); }
  function pickDay(day: Date) {
    if (value.preset !== "custom" || !value.from || (value.from && value.to)) {
      onChange({ preset: "custom", from: day, to: null });
    } else if (day < value.from) {
      onChange({ preset: "custom", from: day, to: value.from });
    } else {
      onChange({ preset: "custom", from: value.from, to: day });
    }
  }

  const first = new Date(view.getFullYear(), view.getMonth(), 1);
  const startDow = first.getDay();
  const dim = new Date(view.getFullYear(), view.getMonth() + 1, 0).getDate();
  const cells: (Date | null)[] = [];
  for (let i = 0; i < startDow; i++) cells.push(null);
  for (let d = 1; d <= dim; d++) cells.push(new Date(view.getFullYear(), view.getMonth(), d));
  const inRange = (d: Date) =>
    !!value.from && !!value.to && d > startOfDay(value.from) && d < startOfDay(value.to);

  return (
    <div className="act-pop-wrap" ref={ref}>
      <button className={`act-control ${open ? "open" : ""}`} onClick={() => setOpen((o) => !o)}>
        <CalendarClock size={15} />
        <span>{label}</span>
        <ChevronRight size={14} style={{ transform: "rotate(90deg)", opacity: 0.5 }} />
      </button>
      {open ? (
        <div className="act-pop act-pop-date">
          <div className="act-presets">
            {PRESETS.map((p) => (
              <button key={p.id} className={`act-preset ${value.preset === p.id ? "active" : ""}`} onClick={() => pickPreset(p.id)}>{p.label}</button>
            ))}
            <div className="act-preset-note">Or pick a custom range →</div>
          </div>
          <div className="act-cal">
            <div className="act-cal-head">
              <button className="icon-btn" style={{ width: 28, height: 28 }} onClick={() => setView(new Date(view.getFullYear(), view.getMonth() - 1, 1))}><ChevronLeft size={15} /></button>
              <strong>{view.toLocaleDateString("en-US", { month: "long", year: "numeric" })}</strong>
              <button className="icon-btn" style={{ width: 28, height: 28 }} onClick={() => setView(new Date(view.getFullYear(), view.getMonth() + 1, 1))}><ChevronRight size={15} /></button>
            </div>
            <div className="act-cal-grid act-cal-dow">{["S", "M", "T", "W", "T", "F", "S"].map((d, i) => <span key={i}>{d}</span>)}</div>
            <div className="act-cal-grid">
              {cells.map((d, i) => d ? (
                <button
                  key={i}
                  className={`act-day ${sameDay(d, value.from) ? "edge" : ""} ${sameDay(d, value.to) ? "edge" : ""} ${inRange(d) ? "in" : ""}`}
                  onClick={() => pickDay(d)}
                >{d.getDate()}</button>
              ) : <span key={i} />)}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

// ─── Category multi-select ───
function CategoryDropdown({
  selected, onChange, counts,
}: {
  selected: Set<string>;
  onChange: (s: Set<string>) => void;
  counts: Record<string, number>;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open]);
  function toggle(c: string) {
    const next = new Set(selected);
    if (next.has(c)) next.delete(c); else next.add(c);
    onChange(next);
  }
  const label = selected.size === 0
    ? "All categories"
    : `${selected.size} categor${selected.size === 1 ? "y" : "ies"}`;
  return (
    <div className="act-pop-wrap" ref={ref}>
      <button className={`act-control ${open ? "open" : ""} ${selected.size ? "has" : ""}`} onClick={() => setOpen((o) => !o)}>
        <span>{label}</span>
        {selected.size ? <span className="act-control-badge">{selected.size}</span> : null}
        <ChevronRight size={14} style={{ transform: "rotate(90deg)", opacity: 0.5 }} />
      </button>
      {open ? (
        <div className="act-pop act-pop-cat">
          <div className="act-pop-cat-head">
            <span>Filter categories</span>
            {selected.size ? <button className="link" style={{ background: "none", border: 0, cursor: "pointer", fontSize: 12 }} onClick={() => onChange(new Set())}>Clear</button> : null}
          </div>
          {CATEGORY_ORDER.map((c) => {
            const meta = CATEGORY_META[c];
            const n = counts[c] || 0;
            const dead = n === 0;
            return (
              <button key={c} className={`act-cat-row ${selected.has(c) ? "on" : ""} ${dead ? "dead" : ""}`} disabled={dead} onClick={() => !dead && toggle(c)}>
                <span className="act-check">{selected.has(c) ? <Check size={12} /> : null}</span>
                <span className="act-cat-dot" style={{ background: meta.color }} />
                <span className="act-cat-name">{meta.label}</span>
                <span className="act-cat-count">{dead ? "no events" : n}</span>
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

// ─── Plain dropdown (matches the date/category controls) ───
function Dropdown({
  value, options, onChange, icon, align = "left",
}: {
  value: string;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
  icon?: React.ReactNode;
  align?: "left" | "right";
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open]);
  const current = options.find((o) => o.value === value);
  return (
    <div className="act-pop-wrap" ref={ref}>
      <button className={`act-control ${open ? "open" : ""}`} onClick={() => setOpen((o) => !o)}>
        {icon}
        <span>{current?.label ?? value}</span>
        <ChevronRight size={14} style={{ transform: "rotate(90deg)", opacity: 0.5 }} />
      </button>
      {open ? (
        <div className="act-pop act-pop-menu" style={align === "right" ? { left: "auto", right: 0 } : undefined}>
          {options.map((o) => (
            <button key={o.value} className={`act-menu-item ${o.value === value ? "on" : ""}`} onClick={() => { onChange(o.value); setOpen(false); }}>
              <span className="act-menu-check">{o.value === value ? <Check size={12} /> : null}</span>
              {o.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

// ─── Detail drawer ───
function Drawer({
  entry, onClose, onRetry, retrying,
}: {
  entry: LogRow | null;
  onClose: () => void;
  onRetry: (id: string) => void;
  retrying: boolean;
}) {
  const [showTech, setShowTech] = useState(false);
  if (!entry) return null;
  const meta = CATEGORY_META[entry.category] || { color: "#475569", label: entry.category };

  const isUuid = (s: string) =>
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
  function providerLink() {
    const pid = entry!.providerId;
    if (!pid) return null;
    if (pid.startsWith("re_") || (entry!.category === "EMAIL" && isUuid(pid)))
      return { label: "Open in Resend", href: "https://resend.com/emails" };
    if (pid.startsWith("pi_")) return { label: "Open in Stripe", href: "https://dashboard.stripe.com" };
    if (pid.startsWith("evt_")) return { label: "Open event in Stripe", href: "https://dashboard.stripe.com/events" };
    if (pid.startsWith("SM")) return { label: "Open in Twilio", href: "https://console.twilio.com" };
    return null;
  }
  const link = providerLink();

  // Plain-English rows only — no codes or database ids here.
  const rows: [string, React.ReactNode][] = [
    ["Type", (
      <span key="cat" style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
        <span className="act-cat-dot" style={{ background: meta.color }} />
        {meta.label}
      </span>
    )],
    ["When", new Date(entry.createdAt).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })],
  ];
  if (entry.recipient) rows.push(["Sent to", entry.recipient]);
  if (entry.actorLabel) rows.push(["By", entry.actorLabel]);
  if (entry.targetLabel) rows.push(["About", entry.targetLabel]);
  if (entry.detail && entry.detail !== entry.title) rows.push(["Subject", entry.detail]);
  if (entry.amount != null) rows.push(["Amount", money(entry.amount)]);

  // Technical fields, hidden behind a toggle for the devs who need them.
  const tech: [string, React.ReactNode][] = [];
  tech.push(["Event code", <code key="ev">{entry.action}</code>]);
  if (entry.kind) tech.push(["Email type", <code key="kd">{entry.kind}</code>]);
  if (entry.notificationKey) tech.push(["Notification key", <code key="nk">{entry.notificationKey}</code>]);
  if (entry.targetType || entry.targetId) tech.push(["Raw target", <code key="tg">{`${entry.targetType || ""}${entry.targetId ? " · " + entry.targetId : ""}`}</code>]);
  if (entry.providerId) tech.push(["Provider ID", <code key="pid">{entry.providerId}</code>]);
  tech.push(["Log ID", <code key="lid">{entry.id}</code>]);

  return (
    <div className="act-drawer-overlay" onClick={onClose}>
      <aside className="act-drawer" onClick={(e) => e.stopPropagation()}>
        <div className="act-drawer-head">
          <StatusBadge status={entry.status} />
          <button className="icon-btn" style={{ width: 32, height: 32 }} onClick={onClose}><X size={16} /></button>
        </div>
        <h3 className="act-drawer-title">{entry.title}</h3>
        <div className="act-drawer-rows">
          {rows.map(([k, v], i) => (
            <div className="act-drawer-row" key={i}>
              <span className="act-drawer-k">{k}</span>
              <span className="act-drawer-v">{v}</span>
            </div>
          ))}
        </div>
        {entry.error ? (
          <div className="act-error">
            <AlertCircle size={14} />
            <span>{entry.error}</span>
          </div>
        ) : null}

        <button className="act-tech-toggle" onClick={() => setShowTech((s) => !s)}>
          <ChevronRight size={13} style={{ transform: showTech ? "rotate(90deg)" : "none", transition: "transform .15s" }} />
          Technical details
        </button>
        {showTech ? (
          <div className="act-drawer-rows act-tech">
            {tech.map(([k, v], i) => (
              <div className="act-drawer-row" key={i}>
                <span className="act-drawer-k">{k}</span>
                <span className="act-drawer-v">{v}</span>
              </div>
            ))}
          </div>
        ) : null}

        <div className="act-drawer-foot">
          {link ? <a className="btn btn-secondary btn-sm" href={link.href} target="_blank" rel="noopener noreferrer">{link.label} ↗</a> : null}
          {entry.retryable && entry.status === "FAILED" ? (
            <button className="btn btn-primary btn-sm" disabled={retrying} onClick={() => onRetry(entry.id)}>{retrying ? "Retrying…" : "Retry"}</button>
          ) : null}
        </div>
      </aside>
    </div>
  );
}

// ─── Pagination window ───
function pageWindow(page: number, count: number): (number | "…")[] {
  if (count <= 7) return Array.from({ length: count }, (_, i) => i + 1);
  const out: (number | "…")[] = [1];
  const s = Math.max(2, page - 1), e = Math.min(count - 1, page + 1);
  if (s > 2) out.push("…");
  for (let i = s; i <= e; i++) out.push(i);
  if (e < count - 1) out.push("…");
  out.push(count);
  return out;
}

type Override = { status: string; error: string | null; retryable: boolean };

export default function LogsClient({ rows, counts }: { rows: LogRow[]; counts: Counts }) {
  const router = useRouter();
  const [range, setRange] = useState<RangeValue>({ preset: "all", from: null, to: null });
  const [cats, setCats] = useState<Set<string>>(new Set());
  const [status, setStatus] = useState("all");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState("new");
  const [perPage, setPerPage] = useState(25);
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<LogRow | null>(null);
  const [overrides, setOverrides] = useState<Record<string, Override>>({});
  const [, startTransition] = useTransition();
  const [retryingId, setRetryingId] = useState<string | null>(null);

  const all = useMemo(
    () => rows.map((r) => (overrides[r.id] ? { ...r, ...overrides[r.id] } : r)),
    [rows, overrides],
  );

  async function onRetry(id: string) {
    setRetryingId(id);
    setOverrides((o) => ({ ...o, [id]: { status: "PENDING", error: null, retryable: false } }));
    const res = await retryEmail(id);
    if (res.success) {
      setOverrides((o) => ({ ...o, [id]: { status: "SUCCESS", error: null, retryable: false } }));
      startTransition(() => router.refresh());
    } else {
      setOverrides((o) => ({ ...o, [id]: { status: "FAILED", error: res.error ?? "Retry failed", retryable: true } }));
    }
    setRetryingId(null);
  }

  const categoryCounts = useMemo(() => {
    const m: Record<string, number> = {};
    CATEGORY_ORDER.forEach((c) => { m[c] = 0; });
    all.forEach((e) => { m[e.category] = (m[e.category] || 0) + 1; });
    return m;
  }, [all]);

  const [from, to]: [Date | null, Date | null] = range.preset === "custom"
    ? [range.from ? startOfDay(range.from) : null, range.to ? endOfDay(range.to) : (range.from ? endOfDay(range.from) : null)]
    : presetRange(range.preset);

  // date + cat + search (no status) → drives the status segment counts
  const preStatus = useMemo(() => {
    const q = search.trim().toLowerCase();
    return all.filter((e) => {
      const t = new Date(e.createdAt);
      if (from && t < from) return false;
      if (to && t > to) return false;
      if (cats.size && !cats.has(e.category)) return false;
      if (q) {
        const hay = [e.title, e.detail, e.recipient, e.subject, e.error, e.actorLabel, e.targetLabel, e.targetId, e.providerId]
          .filter(Boolean).join(" ").toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [all, from, to, cats, search]);

  const statusCounts = useMemo(() => {
    const m: Record<string, number> = { all: preStatus.length, SUCCESS: 0, FAILED: 0, PENDING: 0, SKIPPED: 0 };
    preStatus.forEach((e) => { m[e.status] = (m[e.status] || 0) + 1; });
    return m;
  }, [preStatus]);

  const filtered = useMemo(() => {
    const list = status === "all" ? preStatus : preStatus.filter((e) => e.status === status);
    return [...list].sort((a, b) =>
      sort === "new"
        ? +new Date(b.createdAt) - +new Date(a.createdAt)
        : +new Date(a.createdAt) - +new Date(b.createdAt));
  }, [preStatus, status, sort]);

  const total = filtered.length;
  const pageCount = Math.max(1, Math.ceil(total / perPage));
  const safePage = Math.min(page, pageCount);
  const paged = filtered.slice((safePage - 1) * perPage, safePage * perPage);
  useEffect(() => { setPage(1); }, [range, cats, status, search, perPage, sort]);

  const activeFilters = range.preset !== "all" || cats.size > 0 || status !== "all" || !!search.trim();
  function clearAll() { setRange({ preset: "all", from: null, to: null }); setCats(new Set()); setStatus("all"); setSearch(""); }

  const HEALTH = [
    { label: "Emails sent", value: counts.emailsSent, Icon: Send, tone: "ok" },
    { label: "Emails failed", value: counts.emailsFailed, Icon: AlertCircle, tone: counts.emailsFailed ? "bad" : "mute" },
    { label: "Emails pending", value: counts.emailsPending, Icon: CalendarClock, tone: counts.emailsPending ? "warn" : "mute" },
    { label: "Activity OK", value: counts.activityOk, Icon: CheckCircle, tone: "ok" },
    { label: "Activity failed", value: counts.activityFailed, Icon: XCircle, tone: counts.activityFailed ? "bad" : "mute" },
  ];
  const STATUS_TABS = [
    { id: "all", label: "All", n: statusCounts.all },
    { id: "SUCCESS", label: "Success", n: statusCounts.SUCCESS },
    { id: "FAILED", label: "Failed", n: statusCounts.FAILED },
    { id: "PENDING", label: "Pending", n: statusCounts.PENDING },
    { id: "SKIPPED", label: "Skipped", n: statusCounts.SKIPPED },
  ];

  return (
    <div style={{ maxWidth: 1200, margin: "0 auto" }}>
      <ActivityStyles />

      <header style={{ marginBottom: 22 }}>
        <p className="eyebrow">System</p>
        <h1 className="display" style={{ fontSize: "clamp(32px, 4.2vw, 46px)", marginTop: 6 }}>Activity <em>log.</em></h1>
        <p className="subtitle" style={{ marginTop: 10, fontSize: 15.5 }}>Every email, payment, webhook and system event — merged, searchable, and auditable.</p>
      </header>

      {/* Health strip */}
      <div className="act-health">
        {HEALTH.map((h, i) => {
          const Icon = h.Icon;
          return (
            <div key={i} className={`act-health-card ${h.tone}`}>
              <div className="act-health-top"><span>{h.label}</span><Icon size={15} /></div>
              <div className="act-health-val">{h.value.toLocaleString()}</div>
            </div>
          );
        })}
      </div>

      {/* Filter bar */}
      <div className="act-filterbar">
        <div className="act-search">
          <span className="act-search-ic"><Sparkles size={15} /></span>
          <input className="input" type="search" placeholder="Search message, recipient, actor, target, provider ID…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <DateRange value={range} onChange={setRange} />
        <CategoryDropdown selected={cats} onChange={setCats} counts={categoryCounts} />
        <Dropdown
          value={sort}
          onChange={setSort}
          options={[
            { value: "new", label: "Newest first" },
            { value: "old", label: "Oldest first" },
          ]}
        />
        <Dropdown
          value={String(perPage)}
          onChange={(v) => setPerPage(+v)}
          align="right"
          options={[
            { value: "25", label: "25 / page" },
            { value: "50", label: "50 / page" },
            { value: "100", label: "100 / page" },
            { value: "200", label: "200 / page" },
          ]}
        />
        {activeFilters ? <button className="act-clear" onClick={clearAll}><X size={13} /> Clear</button> : null}
      </div>

      {/* Status segmented */}
      <div className="act-statusseg">
        {STATUS_TABS.map((t) => (
          <button key={t.id} className={`act-seg ${status === t.id ? "active" : ""} ${t.id.toLowerCase()}`} onClick={() => setStatus(t.id)}>
            {t.id !== "all" ? <span className="act-seg-dot" style={{ background: STATUS_META[t.id].dot }} /> : null}
            {t.label}<span className="act-seg-n">{t.n}</span>
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="atable-wrap">
        <div className="atable-scroll">
          <table className="atable act-table">
            <thead><tr><th>Time</th><th>Category</th><th>Event</th><th>Who / target</th><th>Status</th><th className="col-actions"></th></tr></thead>
            <tbody>
              {paged.length === 0 ? (
                <tr><td colSpan={6} style={{ textAlign: "center", padding: 64, color: "var(--primary-50)" }}>No log entries match these filters.</td></tr>
              ) : paged.map((e) => {
                const meta = CATEGORY_META[e.category] || { color: "#475569", label: e.category };
                return (
                  <tr key={`${e.source}-${e.id}`} onClick={() => setSelected(e)}>
                    <td className="col-date" style={{ whiteSpace: "nowrap" }}>
                      <div className="date-line">{dateStr(e.createdAt)}</div>
                      <div className="time-line">{timeStr(e.createdAt)}</div>
                    </td>
                    <td><span className="act-cat-cell"><span className="act-cat-dot" style={{ background: meta.color }} />{meta.label}</span></td>
                    <td style={{ maxWidth: 420, whiteSpace: "normal" }}>
                      <div className="act-title">{e.title}</div>
                      {e.detail && e.detail !== e.title ? <div className="act-msg">{e.detail}</div> : null}
                    </td>
                    <td style={{ maxWidth: 220, whiteSpace: "normal" }}>
                      <div className="act-who">{e.recipient || e.actorLabel || "—"}</div>
                      {e.targetLabel ? <div className="act-target">{e.targetLabel}</div> : null}
                    </td>
                    <td><StatusBadge status={e.status} /></td>
                    <td className="col-actions" onClick={(ev) => ev.stopPropagation()}>
                      {e.retryable && e.status === "FAILED"
                        ? <button className="btn btn-secondary btn-sm" disabled={retryingId === e.id} onClick={() => onRetry(e.id)}>{retryingId === e.id ? "…" : "Retry"}</button>
                        : <button className="icon-btn" style={{ width: 30, height: 30 }} onClick={() => setSelected(e)}><ChevronRight size={14} /></button>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="apager">
          <span>{total === 0 ? "0" : `${(safePage - 1) * perPage + 1}–${Math.min(safePage * perPage, total)}`} of {total}</span>
          <div className="apager-controls">
            <button className="apager-btn" disabled={safePage === 1} onClick={() => setPage(safePage - 1)}><ChevronLeft size={16} /></button>
            {pageWindow(safePage, pageCount).map((p, i) => p === "…"
              ? <span key={i} style={{ padding: "0 6px", color: "var(--primary-40)" }}>…</span>
              : <button key={i} className={`apager-btn ${p === safePage ? "active" : ""}`} onClick={() => setPage(p)}>{p}</button>)}
            <button className="apager-btn" disabled={safePage === pageCount} onClick={() => setPage(safePage + 1)}><ChevronRight size={16} /></button>
          </div>
        </div>
      </div>

      <p style={{ fontSize: 12, color: "var(--primary-50)", marginTop: 14, textAlign: "center" }}>
        Showing the {all.length} most recent entries across email + activity logs. Narrow with filters to surface older events.
      </p>

      <Drawer
        entry={selected ? (all.find((r) => r.id === selected.id) ?? selected) : null}
        onClose={() => setSelected(null)}
        onRetry={(id) => { onRetry(id); }}
        retrying={!!selected && retryingId === selected.id}
      />
    </div>
  );
}

const ActivityStyles = () => (
  <style>{`
    .act-health { display: grid; grid-template-columns: repeat(5, 1fr); gap: 14px; margin-bottom: 24px; }
    @media (max-width: 900px) { .act-health { grid-template-columns: repeat(2, 1fr); } }
    .act-health-card { background: #fff; border-radius: 14px; padding: 16px 18px; box-shadow: var(--shadow-soft); }
    .act-health-top { display: flex; align-items: center; justify-content: space-between; font-size: 11px; text-transform: uppercase; letter-spacing: 0.07em; color: var(--primary-60); font-weight: 600; }
    .act-health-val { font-family: var(--font-serif); font-size: 28px; color: var(--ink); margin-top: 8px; line-height: 1; }
    .act-health-card.ok .act-health-top { color: var(--emerald-600); }
    .act-health-card.bad .act-health-val { color: var(--error); } .act-health-card.bad .act-health-top { color: var(--error); }
    .act-health-card.warn .act-health-val { color: var(--amber-700); } .act-health-card.warn .act-health-top { color: var(--amber-700); }

    .act-filterbar { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; margin-bottom: 14px; }
    .act-search { position: relative; flex: 1; min-width: 240px; }
    .act-search .input { height: 42px; padding-left: 40px; }
    .act-search-ic { position: absolute; left: 13px; top: 50%; transform: translateY(-50%); color: var(--primary-50); pointer-events: none; }
    .act-filterbar .aselect { height: 42px; }

    .act-control { height: 42px; padding: 0 14px; border-radius: 10px; border: 1px solid rgba(0,140,156,0.14); background: #fff; color: var(--primary); font-family: inherit; font-size: 13.5px; font-weight: 500; cursor: pointer; display: inline-flex; align-items: center; gap: 8px; transition: border-color .12s; }
    .act-control:hover { border-color: rgba(0,140,156,0.3); }
    .act-control.open, .act-control.has { border-color: var(--primary); }
    .act-control-badge { background: var(--primary); color: #fff; font-size: 11px; font-weight: 700; padding: 1px 7px; border-radius: 999px; }
    .act-pop-wrap { position: relative; }
    .act-pop { position: absolute; top: calc(100% + 8px); left: 0; z-index: 60; background: #fff; border-radius: 14px; box-shadow: var(--shadow-pop); border: 1px solid var(--primary-10); padding: 12px; animation: filterDown .18s ease-out; }

    .act-pop-date { display: flex; gap: 14px; width: 460px; }
    @media (max-width: 600px){ .act-pop-date { flex-direction: column; width: 300px; } }
    .act-presets { display: flex; flex-direction: column; gap: 4px; padding-right: 12px; border-right: 1px solid var(--primary-10); min-width: 130px; }
    .act-preset { text-align: left; background: none; border: 0; font-family: inherit; font-size: 13px; color: var(--primary-70); padding: 8px 10px; border-radius: 8px; cursor: pointer; }
    .act-preset:hover { background: var(--cream); color: var(--primary); }
    .act-preset.active { background: var(--primary); color: #fff; }
    .act-preset-note { font-size: 11px; color: var(--primary-40); margin-top: auto; padding: 8px 10px; }
    .act-cal { flex: 1; }
    .act-cal-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; font-size: 14px; color: var(--ink); }
    .act-cal-grid { display: grid; grid-template-columns: repeat(7, 1fr); gap: 2px; }
    .act-cal-dow span { text-align: center; font-size: 10px; color: var(--primary-40); font-weight: 600; padding: 4px 0; }
    .act-day { aspect-ratio: 1; border: 0; background: none; font-family: inherit; font-size: 12.5px; color: var(--ink-soft); border-radius: 8px; cursor: pointer; }
    .act-day:hover { background: var(--cream); }
    .act-day.in { background: var(--primary-5); border-radius: 0; }
    .act-day.edge { background: var(--primary); color: #fff; }

    .act-pop-menu { min-width: 170px; display: flex; flex-direction: column; gap: 2px; }
    .act-menu-item { width: 100%; display: flex; align-items: center; gap: 9px; padding: 8px 9px; border: 0; background: none; font-family: inherit; font-size: 13.5px; color: var(--ink); border-radius: 9px; cursor: pointer; text-align: left; }
    .act-menu-item:hover { background: var(--cream); }
    .act-menu-item.on { background: var(--primary-5); }
    .act-menu-check { width: 16px; height: 16px; display: inline-flex; align-items: center; justify-content: center; color: var(--primary); flex: 0 0 auto; }

    .act-pop-cat { width: 250px; max-height: 360px; overflow-y: auto; }
    .act-pop-cat-head { display: flex; justify-content: space-between; align-items: center; font-size: 11px; text-transform: uppercase; letter-spacing: 0.07em; color: var(--primary-60); font-weight: 600; padding: 4px 8px 10px; }
    .act-cat-row { width: 100%; display: flex; align-items: center; gap: 9px; padding: 8px 9px; border: 0; background: none; font-family: inherit; font-size: 13.5px; color: var(--ink); border-radius: 9px; cursor: pointer; text-align: left; }
    .act-cat-row:hover:not(.dead) { background: var(--cream); }
    .act-cat-row.on { background: var(--primary-5); }
    .act-cat-row.dead { opacity: 0.45; cursor: not-allowed; }
    .act-check { width: 16px; height: 16px; border-radius: 5px; border: 1.5px solid var(--primary-20); display: inline-flex; align-items: center; justify-content: center; color: #fff; flex: 0 0 auto; }
    .act-cat-row.on .act-check { background: var(--primary); border-color: var(--primary); }
    .act-cat-dot { width: 9px; height: 9px; border-radius: 50%; flex: 0 0 auto; }
    .act-cat-name { flex: 1; }
    .act-cat-count { font-size: 11.5px; color: var(--primary-50); font-variant-numeric: tabular-nums; }

    .act-clear { height: 42px; padding: 0 14px; border-radius: 10px; border: 1px solid var(--error-border); background: var(--error-bg); color: var(--error-text); font-family: inherit; font-size: 13px; font-weight: 500; cursor: pointer; display: inline-flex; align-items: center; gap: 6px; }

    .act-statusseg { display: inline-flex; background: var(--primary-5); border-radius: 12px; padding: 4px; gap: 2px; margin-bottom: 18px; flex-wrap: wrap; }
    .act-seg { background: none; border: 0; cursor: pointer; padding: 8px 14px; border-radius: 9px; font-family: inherit; font-size: 13px; font-weight: 500; color: var(--primary-70); display: inline-flex; align-items: center; gap: 7px; }
    .act-seg:hover { color: var(--primary); }
    .act-seg.active { background: #fff; color: var(--primary); box-shadow: 0 1px 2px rgba(0,0,0,0.06), 0 0 0 1px var(--primary-10); }
    .act-seg-dot { width: 7px; height: 7px; border-radius: 50%; }
    .act-seg-n { font-size: 11px; padding: 1px 7px; border-radius: 999px; background: var(--primary-10); color: var(--primary-70); font-weight: 600; min-width: 18px; text-align: center; }
    .act-seg.active .act-seg-n { background: var(--primary); color: #fff; }

    .act-title { font-size: 13.5px; color: var(--ink); font-weight: 500; line-height: 1.35; }
    .act-msg { font-size: 12.5px; color: var(--primary-70); margin-top: 4px; line-height: 1.4; }
    .act-cat-cell { display: inline-flex; align-items: center; gap: 7px; font-size: 13px; color: var(--ink); font-weight: 500; }
    .act-who { font-size: 13px; color: var(--ink); font-weight: 500; }
    .act-target { font-size: 11.5px; color: var(--primary-50); font-family: var(--font-mono); margin-top: 3px; }

    .apager { display: flex; align-items: center; justify-content: space-between; padding: 14px 18px; border-top: 1px solid var(--primary-10); font-size: 12.5px; color: var(--primary-60); }
    .apager-controls { display: flex; align-items: center; gap: 4px; }
    .apager-btn { min-width: 30px; height: 30px; padding: 0 8px; border-radius: 8px; border: 1px solid var(--primary-10); background: #fff; color: var(--primary-70); font-family: inherit; font-size: 13px; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; transition: border-color .12s, background .12s; }
    .apager-btn:hover:not(:disabled) { border-color: var(--primary-30); }
    .apager-btn.active { background: var(--primary); color: #fff; border-color: var(--primary); }
    .apager-btn:disabled { opacity: 0.4; cursor: not-allowed; }

    .act-drawer-overlay { position: fixed; inset: 0; background: rgba(14,26,28,0.4); backdrop-filter: blur(3px); z-index: 200; display: flex; justify-content: flex-end; animation: lbIn .18s ease-out; }
    .act-drawer { width: 440px; max-width: 92vw; height: 100%; background: #fff; box-shadow: var(--shadow-pop); padding: 24px; overflow-y: auto; animation: drawerIn .26s cubic-bezier(.2,.7,.3,1); }
    @keyframes drawerIn { from { transform: translateX(40px); opacity: 0; } to { transform: translateX(0); opacity: 1; } }
    .act-drawer-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px; }
    .act-drawer-title { font-size: 19px; font-weight: 600; color: var(--ink); line-height: 1.3; margin: 0 0 20px; letter-spacing: -0.01em; }
    .act-drawer-rows { display: flex; flex-direction: column; }
    .act-drawer-row { display: flex; gap: 16px; padding: 11px 0; border-bottom: 1px solid var(--primary-10); font-size: 13.5px; }
    .act-drawer-k { width: 110px; flex: 0 0 auto; color: var(--primary-60); }
    .act-drawer-v { color: var(--ink); word-break: break-word; }
    .act-drawer-v code, .act-drawer-row code { font-family: var(--font-mono); font-size: 12px; background: var(--cream); padding: 1px 6px; border-radius: 5px; }
    .act-error { display: flex; gap: 9px; align-items: flex-start; background: var(--error-bg); border: 1px solid var(--error-border); color: var(--error-text); border-radius: 11px; padding: 12px 14px; margin-top: 18px; font-size: 13px; line-height: 1.5; }
    .act-tech-toggle { display: inline-flex; align-items: center; gap: 5px; margin-top: 20px; padding: 6px 0; background: none; border: 0; cursor: pointer; font-family: inherit; font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.06em; color: var(--primary-50); }
    .act-tech-toggle:hover { color: var(--primary); }
    .act-tech { animation: filterDown .15s ease-out; }
    .act-drawer-foot { display: flex; gap: 10px; justify-content: flex-end; margin-top: 22px; }
  `}</style>
);
