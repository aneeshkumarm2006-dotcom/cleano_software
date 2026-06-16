"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft, ArrowRight, AlertCircle, X, PenLine, CalendarClock, CreditCard,
  Star, Sparkles, Mail, MessageSquare, Phone, CheckCircle2, XCircle, Lock, Plus,
} from "lucide-react";
import type { ContactActivityType } from "@prisma/client";
import type { ContactDetail, ActivityItem, BookingRow, DuplicateCandidate } from "@/lib/crm-meta";
import type { PropertyDef } from "@/lib/prop-engine-meta";
import { EVENT_META, money, dateStr, timeStr, relativeTime, bindingFor } from "@/lib/crm-meta";
import { GROUPS } from "@/lib/prop-engine-meta";
import { Avatar, LifecyclePill, AStat, ScoreMeter } from "../_components";
import {
  updateContactField, updateContactProp, logContactActivity, dismissContactDuplicates,
} from "../../actions/contactActions";

type TabId = "overview" | "activity" | "bookings" | "comms" | "source" | "ratings" | "dups";

const EVENT_ICON: Record<ContactActivityType, typeof Mail> = {
  NOTE: PenLine, EMAIL: Mail, SMS: MessageSquare, CALL: Phone,
  BOOKING: CalendarClock, RATING: Star, CANCEL: XCircle, LIFECYCLE: Sparkles, CREATE: Plus,
};

const JOB_PILL: Record<string, { bg: string; fg: string }> = {
  completed: { bg: "rgba(5,150,105,0.10)", fg: "#065f46" },
  paid: { bg: "rgba(5,150,105,0.18)", fg: "#064e3b" },
  scheduled: { bg: "rgba(2,132,199,0.10)", fg: "#075985" },
  inprogress: { bg: "rgba(217,119,6,0.12)", fg: "#92400e" },
  created: { bg: "rgba(100,116,139,0.12)", fg: "#334155" },
  cancelled: { bg: "rgba(148,163,184,0.18)", fg: "#64748b" },
};

export default function ContactDetailView({ contact: c, propertyDefs }: { contact: ContactDetail; propertyDefs: PropertyDef[] }) {
  const router = useRouter();
  const [tab, setTab] = useState<TabId>("overview");
  const [dupOpen, setDupOpen] = useState(true);

  const comms = c.activities.filter((e) => ["EMAIL", "SMS", "CALL"].includes(e.type));

  const TABS: { id: TabId; label: string }[] = [
    { id: "overview", label: "Overview" },
    { id: "activity", label: `Activity · ${c.activities.length}` },
    { id: "bookings", label: `Bookings · ${c.bookings}` },
    { id: "comms", label: `Communications · ${comms.length}` },
    { id: "source", label: "Source" },
    { id: "ratings", label: c.ratingCount ? `Ratings · ${c.ratingCount}` : "Ratings" },
    { id: "dups", label: c.duplicates.length ? `Duplicates · ${c.duplicates.length}` : "Duplicates" },
  ];

  return (
    <div className="admin-font">
      <button className="jdetail-back" onClick={() => router.push("/contacts")}><ArrowLeft size={14} /> Back to Contacts</button>

      {c.duplicates.length && dupOpen ? (
        <div className="dup-banner">
          <span className="dup-icon"><AlertCircle size={18} /></span>
          <div className="dup-text">
            <div className="dup-title">{c.duplicates.length} possible duplicate{c.duplicates.length > 1 ? "s" : ""} found</div>
            <div className="dup-sub">Matching phone &amp; email across {c.duplicates.length} other record{c.duplicates.length > 1 ? "s" : ""}. Review before this contact is worked.</div>
          </div>
          <button className="btn btn-secondary btn-sm" onClick={() => setTab("dups")}>Review</button>
          <button className="dup-dismiss" aria-label="Dismiss" onClick={() => setDupOpen(false)}><X size={16} /></button>
        </div>
      ) : null}

      <header className="jdetail-head">
        <div className="jdetail-head-left">
          <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 4 }}>
            <Avatar name={c.name} color="var(--primary)" size={56} />
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                <h1 className="jdetail-title" style={{ margin: 0 }}>{c.name}</h1>
                <LifecyclePill stage={c.lifecycle} />
              </div>
              {c.tags.length ? (
                <div style={{ display: "flex", gap: 6, marginTop: 10, flexWrap: "wrap" }}>
                  {c.tags.map((t) => <span key={t} className="tagchip">{t}</span>)}
                </div>
              ) : null}
            </div>
          </div>
          <p className="jdetail-desc" style={{ marginTop: 12 }}>
            <span style={{ color: "var(--ink-soft)" }}>{c.email || "—"}</span>
            <span style={{ color: "var(--primary-30)", margin: "0 8px" }}>·</span>
            <span style={{ color: "var(--ink-soft)" }}>{c.phone || "—"}</span>
            <span style={{ color: "var(--primary-30)", margin: "0 8px" }}>·</span>
            <span style={{ color: "var(--ink-soft)" }}>{c.address || "—"}</span>
          </p>
        </div>
        <div className="jdetail-actions">
          <button className="btn btn-secondary btn-sm" onClick={() => setTab("activity")}><PenLine size={14} /> Log activity</button>
          <button className="btn btn-primary btn-sm" onClick={() => alert("Book a job — flow not wired yet")}><CalendarClock size={14} /> Book a job</button>
        </div>
      </header>

      <div className="astat-grid" style={{ marginBottom: 24 }}>
        <AStat icon={CalendarClock} label="Bookings" value={c.bookings} hint={(c.props.frequency as string) || "no bookings yet"} />
        <AStat icon={CreditCard} label="Lifetime value" value={money(c.lifetimeValue)} hint="completed jobs" />
        <AStat icon={Star} label="Avg rating" value={c.ratingAvg != null ? c.ratingAvg.toFixed(1) : "—"} hint={c.ratingCount ? `${c.ratingCount} reviews` : "no reviews"} />
        <AStat icon={Sparkles} label="Lead score" value={c.leadScore != null ? c.leadScore : "—"} hint={c.leadScore != null ? "engagement model" : "not scored"} deltaDir={(c.leadScore ?? 0) >= 70 ? "up" : undefined} />
      </div>

      <div className="dtabs" role="tablist">
        {TABS.map((t) => (
          <button key={t.id} role="tab" aria-selected={t.id === tab} className={`dtab ${t.id === tab ? "active" : ""}`} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === "overview" ? <OverviewTab c={c} defs={propertyDefs} /> : null}
      {tab === "activity" ? <ActivityTab c={c} /> : null}
      {tab === "bookings" ? <BookingsTab rows={c.bookingRows} /> : null}
      {tab === "comms" ? <CommsTab comms={comms} /> : null}
      {tab === "source" ? <SourceTab c={c} /> : null}
      {tab === "ratings" ? <RatingsTab c={c} /> : null}
      {tab === "dups" ? <DuplicatesTab c={c} /> : null}
    </div>
  );
}

// ── Editable / locked property row ──
function PropRow({
  label, value, type = "text", options, locked, system, onCommit, render,
}: {
  label: string;
  value?: string | number | null;
  type?: "text" | "number" | "date";
  options?: string[];
  locked?: boolean;
  system?: boolean; // registry system property (locked from deletion) — value still editable
  onCommit?: (v: string | number | null) => void;
  render?: () => React.ReactNode;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value == null ? "" : String(value));
  const [, startTransition] = useTransition();
  const hasOptions = !!options && options.length > 0;

  function commit(next?: string) {
    setEditing(false);
    if (!onCommit) return;
    const raw = next ?? draft;
    const v = type === "number" ? (raw === "" ? null : Number(raw)) : raw;
    startTransition(() => onCommit(v));
  }
  const empty = value == null || value === "" || value === "—";

  return (
    <div className="prop-row">
      <div className="prop-label">
        {label}
        {system ? <span className="lock" title="System property — defined in the Property Engine"><Lock size={11} /></span> : null}
      </div>
      {locked ? (
        <div className="prop-value locked">{render ? render() : (empty ? "—" : value)}</div>
      ) : editing ? (
        hasOptions ? (
          <select
            className="prop-input" autoFocus value={draft}
            onChange={(e) => { setDraft(e.target.value); commit(e.target.value); }}
            onBlur={commit.bind(null, undefined)}
          >
            <option value="">—</option>
            {options!.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        ) : (
          <input
            className="prop-input" type={type === "number" ? "number" : type === "date" ? "date" : "text"} autoFocus
            value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={() => commit()}
            onKeyDown={(e) => { if (e.key === "Enter") commit(); if (e.key === "Escape") { setDraft(String(value ?? "")); setEditing(false); } }}
          />
        )
      ) : (
        <div
          className={`prop-value editable ${empty ? "muted" : ""}`}
          onClick={() => { setDraft(value == null ? "" : String(value)); setEditing(true); }}
          title="Click to edit"
        >
          {render ? render() : (empty ? "Add…" : value)}
        </div>
      )}
    </div>
  );
}

function PropertyCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="dcard" style={{ gap: 6 }}>
      <div className="dcard-head" style={{ marginBottom: 2 }}><h3>{title}</h3></div>
      <div className="prop-list">{children}</div>
    </div>
  );
}

function useFieldCommit(id: string) {
  const router = useRouter();
  return {
    field: (key: string) => (v: string | number | null) =>
      updateContactField(id, key, v == null ? null : String(v)).then(() => router.refresh()),
    prop: (key: string) => (v: string | number | null) =>
      updateContactProp(id, key, v).then(() => router.refresh()),
  };
}

// Registry-driven Overview. Each card is a property group from the Property
// Engine; each row reads/writes via its binding (column / props / system).
function OverviewTab({ c, defs }: { c: ContactDetail; defs: PropertyDef[] }) {
  const commit = useFieldCommit(c.id);
  const groups = GROUPS.map((g) => ({ group: g, rows: defs.filter((d) => d.groupName === g) })).filter((x) => x.rows.length);

  return (
    <div className="prop-grid">
      {groups.map(({ group, rows }) => (
        <PropertyCard key={group} title={group}>
          {rows.map((d) => <RegistryRow key={d.id} c={c} def={d} commit={commit} />)}
        </PropertyCard>
      ))}

      <div className="dcard" style={{ gridColumn: "1 / -1", gap: 14 }}>
        <div className="dcard-head"><h3>Next step</h3></div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
          <div style={{ fontSize: 15, color: "var(--ink)" }}>{c.nextStep || "—"}</div>
          <div style={{ fontSize: 12.5, color: "var(--primary-60)" }}>{c.nextStepDue ? `Due ${dateStr(c.nextStepDue, { year: true })}` : "No due date"}</div>
        </div>
      </div>
    </div>
  );
}

function RegistryRow({
  c, def, commit,
}: {
  c: ContactDetail;
  def: PropertyDef;
  commit: { field: (k: string) => (v: string | number | null) => void; prop: (k: string) => (v: string | number | null) => void };
}) {
  const b = bindingFor(def.internalName);
  const rowType = def.fieldType === "number" ? "number" : def.fieldType === "date" ? "date" : "text";
  const options = def.fieldType === "dropdown" ? def.options : undefined;

  // System bindings render read-only with bespoke displays.
  if (b.kind === "system") {
    switch (b.key) {
      case "lifecycle":
        return <PropRow label={def.label} locked system render={() => <LifecyclePill stage={c.lifecycle} />} />;
      case "owner":
        return <PropRow label={def.label} locked system render={() => c.ownerName
          ? <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}><Avatar name={c.ownerName} size={22} /> {c.ownerName}</span>
          : "Unassigned"} />;
      case "leadScore":
        return <PropRow label={def.label} locked system render={() => c.leadScore == null
          ? <span className="prop-value muted" style={{ padding: 0 }}>Not scored</span>
          : <ScoreMeter score={c.leadScore} />} />;
      case "id":
        return <PropRow label={def.label} locked system value={c.id} />;
      case "createdAt":
        return <PropRow label={def.label} locked system render={() => `${dateStr(c.createdAt, { year: true })}, ${timeStr(c.createdAt)}`} />;
      case "lastActivity":
        return <PropRow label={def.label} locked system render={() => relativeTime(c.lastActivityAt)} />;
      case "firstBooked": {
        const fb = c.props["firstBooked"];
        return <PropRow label={def.label} locked system render={() => (fb ? dateStr(String(fb), { year: true }) : "—")} />;
      }
      default:
        return <PropRow label={def.label} locked system value="—" />;
    }
  }

  if (b.kind === "column") {
    const value = (c as unknown as Record<string, string | number | null>)[b.key] ?? null;
    return <PropRow label={def.label} value={value} type={rowType} options={options} system={def.isSystem} onCommit={commit.field(b.key)} />;
  }

  // props bag
  const value = (c.props[b.key] ?? null) as string | number | null;
  return <PropRow label={def.label} value={value} type={rowType} options={options} system={def.isSystem} onCommit={commit.prop(b.key)} />;
}

function ActivityTimeline({ events }: { events: ActivityItem[] }) {
  return (
    <div className="timeline">
      {events.map((e) => {
        const meta = EVENT_META[e.type];
        const Icon = EVENT_ICON[e.type];
        return (
          <div className="tline-item" key={e.id}>
            <span className="tline-dot" style={{ background: meta.bg, color: meta.color }}><Icon size={14} /></span>
            <div>
              <div className="tline-text"><strong>{e.title}</strong></div>
              {e.body ? <div style={{ fontSize: 13, color: "var(--ink-soft)", marginTop: 3, lineHeight: 1.5 }}>{e.body}</div> : null}
              <div className="tline-actor">{e.actor || "System"} · {dateStr(e.ts, { year: true })}, {timeStr(e.ts)}</div>
            </div>
            <span className="tline-ts">{relativeTime(e.ts)}</span>
          </div>
        );
      })}
    </div>
  );
}

function ActivityTab({ c }: { c: ContactDetail }) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [type, setType] = useState<ContactActivityType>("NOTE");
  const [pending, startTransition] = useTransition();
  const TYPES: { id: ContactActivityType; label: string; icon: typeof PenLine }[] = [
    { id: "NOTE", label: "Note", icon: PenLine },
    { id: "CALL", label: "Call", icon: Phone },
    { id: "EMAIL", label: "Email", icon: Mail },
    { id: "SMS", label: "SMS", icon: MessageSquare },
  ];
  function submit() {
    if (!text.trim()) return;
    const t = text.trim();
    startTransition(async () => {
      const res = await logContactActivity(c.id, type, t);
      if ("error" in res) { alert(res.error); return; }
      setText("");
      router.refresh();
    });
  }
  return (
    <div>
      <div className="note-composer">
        <textarea placeholder={`Log a ${type.toLowerCase()}… (e.g. "Left voicemail about move-out quote")`} value={text} onChange={(e) => setText(e.target.value)} />
        <div className="note-composer-actions">
          <div className="note-type-row">
            {TYPES.map((t) => {
              const Icon = t.icon;
              return (
                <button key={t.id} className={`note-type ${type === t.id ? "active" : ""}`} onClick={() => setType(t.id)}>
                  <Icon size={13} /> {t.label}
                </button>
              );
            })}
          </div>
          <button className="btn btn-primary btn-sm" onClick={submit} disabled={!text.trim() || pending}>
            Log {type === "NOTE" ? "note" : type.toLowerCase()}
          </button>
        </div>
      </div>
      <div className="dcard"><ActivityTimeline events={c.activities} /></div>
    </div>
  );
}

function BookingsTab({ rows }: { rows: BookingRow[] }) {
  if (!rows.length) {
    return <div className="atable-wrap" style={{ padding: "60px 40px", textAlign: "center", color: "var(--primary-60)" }}>No bookings yet for this contact.</div>;
  }
  return (
    <div className="atable-wrap">
      <div className="atable-scroll">
        <table className="atable">
          <thead><tr><th>Date</th><th>Service</th><th>Cleaner</th><th>Status</th><th className="num">Amount</th><th>Payment</th></tr></thead>
          <tbody>
            {rows.map((b) => {
              const pill = JOB_PILL[b.status] ?? JOB_PILL.created;
              return (
                <tr key={b.id}>
                  <td><div style={{ fontSize: 13, color: "var(--ink)" }}>{dateStr(b.date, { year: true })}</div><div className="col-client-sub">{timeStr(b.date)}</div></td>
                  <td style={{ fontSize: 13, color: "var(--ink)" }}>{b.service}</td>
                  <td style={{ fontSize: 13, color: "var(--primary-70)" }}>{b.cleaner}</td>
                  <td><span className="pill" style={{ background: pill.bg, color: pill.fg }}>{b.status}</span></td>
                  <td className="num" style={{ fontWeight: 600 }}>{money(b.amount)}</td>
                  <td>{b.paid
                    ? <span className="pill" style={{ background: "rgba(5,150,105,0.12)", color: "#065f46" }}>Paid</span>
                    : <span className="pill" style={{ background: "var(--amber-50)", color: "var(--amber-800)" }}>Unpaid</span>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function CommsTab({ comms }: { comms: ActivityItem[] }) {
  if (!comms.length) {
    return <div className="atable-wrap" style={{ padding: "60px 40px", textAlign: "center", color: "var(--primary-60)" }}>No emails, SMS or calls logged yet.</div>;
  }
  return <div className="dcard"><ActivityTimeline events={comms} /></div>;
}

function SourceTab({ c }: { c: ContactDetail }) {
  const commit = useFieldCommit(c.id);
  const steps = [
    { label: "First touch", value: c.source, sub: c.sourceDetail || "Original source" },
    { label: "Campaign", value: c.campaign, sub: "Attributed campaign" },
    { label: "Created", value: dateStr(c.createdAt, { year: true }), sub: relativeTime(c.createdAt) },
    { label: c.lifetimeValue ? "Converted" : "Status", value: c.lifetimeValue ? `${money(c.lifetimeValue)} LTV` : null, sub: c.lifetimeValue ? "Lifetime value to date" : "Current stage" },
  ];
  return (
    <div className="prop-grid">
      <div className="dcard" style={{ gridColumn: "1 / -1" }}>
        <div className="dcard-head"><h3>Attribution path</h3></div>
        <div style={{ display: "grid", gridTemplateColumns: `repeat(${steps.length}, 1fr)`, marginTop: 8 }}>
          {steps.map((s, i) => (
            <div key={i} style={{ position: "relative", paddingRight: 14 }}>
              <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.1em", fontWeight: 700, color: "var(--primary-50)" }}>{s.label}</div>
              <div style={{ fontSize: 16, fontWeight: 600, color: "var(--ink)", marginTop: 6 }}>{s.value || "—"}</div>
              <div style={{ fontSize: 12, color: "var(--primary-60)", marginTop: 2 }}>{s.sub}</div>
              {i < steps.length - 1 ? <span style={{ position: "absolute", right: 4, top: 4, color: "var(--primary-30)" }}><ArrowRight size={14} /></span> : null}
            </div>
          ))}
        </div>
      </div>
      <PropertyCard title="Source detail">
        <PropRow label="Original source" value={c.source} onCommit={commit.field("source")} />
        <PropRow label="Campaign" value={c.campaign} onCommit={commit.field("campaign")} />
        <PropRow label="Detail" value={c.sourceDetail} onCommit={commit.field("sourceDetail")} />
      </PropertyCard>
      <div className="dcard">
        <div className="dcard-head"><h3>Lead score</h3></div>
        <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
          <div style={{ fontFamily: "var(--font-serif)", fontSize: 44, fontWeight: 400, color: "var(--primary)", lineHeight: 1 }}>{c.leadScore != null ? c.leadScore : "—"}</div>
          <div style={{ fontSize: 13, color: "var(--primary-60)" }}>/ 100</div>
        </div>
        {c.leadScore != null ? <div className="score-bar" style={{ maxWidth: "100%", height: 8, marginTop: 12 }}><span className="score-fill" style={{ width: `${c.leadScore}%` }} /></div> : null}
      </div>
    </div>
  );
}

function RatingsTab({ c }: { c: ContactDetail }) {
  if (!c.ratingCount || c.ratingAvg == null) {
    return (
      <div className="dcard" style={{ padding: 64, textAlign: "center" }}>
        <div style={{ width: 56, height: 56, margin: "0 auto 16px", borderRadius: 16, background: "var(--primary-5)", color: "var(--primary-40)", display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
          <Star size={28} />
        </div>
        <h3 className="title-sm" style={{ marginBottom: 6 }}>No ratings yet</h3>
        <p className="subtitle" style={{ fontSize: 14, margin: 0 }}>Ratings appear after a completed job is rated by this contact.</p>
      </div>
    );
  }
  const avg = c.ratingAvg;
  return (
    <div className="dcard" style={{ background: "linear-gradient(160deg, var(--primary-deep) 0%, var(--primary) 100%)", color: "#fff" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
        <div>
          <div style={{ fontFamily: "var(--font-serif)", fontSize: 56, fontWeight: 400, lineHeight: 1, color: "#fff" }}>{avg.toFixed(1)}</div>
          <div style={{ display: "flex", gap: 2, marginTop: 8 }}>
            {[1, 2, 3, 4, 5].map((n) => <Star key={n} size={14} fill={n <= Math.round(avg) ? "#facc15" : "none"} style={{ color: "#facc15" }} />)}
          </div>
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.1em", opacity: 0.7, fontWeight: 600 }}>Average rating</div>
          <div style={{ fontSize: 14, marginTop: 4, opacity: 0.85 }}>{c.ratingCount} review{c.ratingCount === 1 ? "" : "s"} from this contact</div>
        </div>
      </div>
    </div>
  );
}

function DuplicatesTab({ c }: { c: ContactDetail }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  if (!c.duplicates.length) {
    return (
      <div className="dcard" style={{ padding: 64, textAlign: "center" }}>
        <div style={{ width: 56, height: 56, margin: "0 auto 16px", borderRadius: 16, background: "var(--primary-5)", color: "var(--primary-40)", display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
          <CheckCircle2 size={28} />
        </div>
        <h3 className="title-sm" style={{ marginBottom: 6 }}>No duplicates</h3>
        <p className="subtitle" style={{ fontSize: 14, margin: 0 }}>This contact has no unresolved duplicate candidates.</p>
      </div>
    );
  }
  function dismiss() {
    startTransition(async () => {
      const res = await dismissContactDuplicates(c.id);
      if ("error" in res) { alert(res.error); return; }
      router.refresh();
    });
  }
  const FIELDS: { k: keyof DuplicateCandidate; label: string }[] = [
    { k: "phone", label: "Phone" }, { k: "email", label: "Email" }, { k: "address", label: "Address" }, { k: "source", label: "Source" },
  ];
  const norm = (v: string | null, isPhone: boolean) => isPhone ? (v || "").replace(/\D/g, "") : (v || "").toLowerCase().trim();
  return (
    <div className="stack-16">
      <div className="dcard" style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
        <div>
          <h3 style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>{c.duplicates.length} possible duplicate{c.duplicates.length > 1 ? "s" : ""}</h3>
          <p style={{ margin: "4px 0 0", fontSize: 13, color: "var(--primary-60)" }}>Compare matched fields, then open the merge tool to keep one master record.</p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn btn-secondary btn-sm" disabled={pending} onClick={dismiss}>Not duplicates</button>
          <button className="btn btn-primary btn-sm" onClick={() => router.push(`/contacts/duplicates?focus=${c.id}`)}>Open merge tool →</button>
        </div>
      </div>

      {c.duplicates.map((d) => {
        const matched = FIELDS.filter((f) => {
          const a = norm(c[f.k] as string | null, f.k === "phone");
          const b = norm(d[f.k], f.k === "phone");
          return a && b && a === b;
        });
        const score = Math.min(98, 60 + matched.length * 12);
        return (
          <article key={d.id} className="dcard">
            <div className="dcard-head" style={{ marginBottom: 8 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <Avatar name={d.name} color="var(--primary-light)" size={36} />
                <div>
                  <div style={{ fontSize: 14, fontWeight: 600, color: "var(--ink)" }}>{d.name}</div>
                  <div style={{ fontSize: 12, color: "var(--primary-60)" }}>{d.id.slice(0, 10)} · created {dateStr(d.createdAt, { year: true })}</div>
                </div>
              </div>
              <span className="pill" style={{ background: "rgba(217,119,6,0.12)", color: "var(--amber-800)" }}>{score}% match</span>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "120px 1fr 1fr", fontSize: 13 }}>
              <div style={{ padding: "6px 0" }} />
              <div style={{ fontWeight: 600, color: "var(--ink)", padding: "6px 0" }}>This record</div>
              <div style={{ fontWeight: 600, color: "var(--ink)", padding: "6px 0" }}>{d.name}</div>
              {FIELDS.map((f) => {
                const same = matched.includes(f);
                const bg = same ? "rgba(217,119,6,0.05)" : "transparent";
                return (
                  <div key={f.k} style={{ display: "contents" }}>
                    <div style={{ padding: "8px 0", color: "var(--primary-60)", fontSize: 12, borderTop: "1px solid var(--primary-10)" }}>{f.label}</div>
                    <div style={{ padding: "8px 12px 8px 0", color: "var(--ink)", borderTop: "1px solid var(--primary-10)", background: bg }}>{(c[f.k] as string | null) || "—"}</div>
                    <div style={{ padding: "8px 0", color: "var(--ink)", borderTop: "1px solid var(--primary-10)", background: bg }}>
                      {d[f.k] || "—"} {same ? <span style={{ fontSize: 11, color: "var(--amber-700)", fontWeight: 600, marginLeft: 6 }}>matches</span> : null}
                    </div>
                  </div>
                );
              })}
            </div>
          </article>
        );
      })}
    </div>
  );
}
