"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertCircle, Calendar, UserX, Users, Search, Archive, Trash2, RotateCcw, Tag, IdCard, ArrowUpRight } from "lucide-react";
import { updateLeadStatus } from "../actions/updateLeadStatus";
import { convertLeadToJob } from "../actions/convertLeadToJob";
import { bulkSetLeadStatus } from "../actions/bulkSetLeadStatus";
import { exportLeadsToContacts } from "../actions/exportLeadsToContacts";
import { useRowSelection } from "@/components/common/useRowSelection";
import BulkActionBar, { type BulkAction } from "@/components/common/BulkActionBar";
import { bulkSoftDelete, bulkRestore } from "@/lib/bulk/actions";
import PremiumSelect from "@/components/ui/PremiumSelect";

type Status = "NEW" | "CONTACTED" | "CONVERTED" | "DEAD" | "OUT_OF_AREA";

interface Lead {
  id: string;
  email: string;
  name: string | null;
  phone: string | null;
  postalCode: string | null;
  dropOffStep: number | null;
  serviceType: string | null;
  bedCount: number | null;
  bathCount: number | null;
  preferredDate: string | null;
  isFlexible: boolean;
  preferredSlot: string | null;
  status: Status;
  source: string | null;
  lastActivityAt: string;
  createdAt: string;
  convertedJob: { id: string; jobNumber: number; jobDate: string | null } | null;
  /** The CRM contact this lead already resolves to, if any (item 19). */
  contact: { id: string; name: string; linked: boolean } | null;
}

const SERVICE_LABELS: Record<string, string> = {
  standard: "Standard", deep: "Deep", "move-in": "Move-in",
  "move-out": "Move-out", office: "Office",
};

const STATUS_COLORS: Record<Status, { bg: string; fg: string; dot: string; label: string }> = {
  NEW:         { bg: "rgba(217,119,6,0.12)",   fg: "#92400e", dot: "#d97706", label: "New" },
  CONTACTED:   { bg: "rgba(2,132,199,0.10)",   fg: "#075985", dot: "#0284c7", label: "Contacted" },
  CONVERTED:   { bg: "rgba(5,150,105,0.10)",   fg: "#065f46", dot: "#10b981", label: "Converted" },
  DEAD:        { bg: "rgba(148,163,184,0.18)", fg: "#475569", dot: "#94a3b8", label: "Dead" },
  OUT_OF_AREA: { bg: "rgba(249,115,22,0.12)",  fg: "#9a3412", dot: "#f97316", label: "Out of area" },
};

const TABS = [
  { id: "all",         label: "All" },
  { id: "new",         label: "New" },
  { id: "contacted",   label: "Contacted" },
  { id: "converted",   label: "Converted" },
  { id: "out_of_area", label: "Out of area" },
  { id: "dead",        label: "Dead" },
] as const;
type TabId = (typeof TABS)[number]["id"];

function AStatCard({ icon: Icon, label, value, hint, delta, deltaDir }: {
  icon: React.ElementType; label: string; value: number | string;
  hint?: string; delta?: string; deltaDir?: "up" | "down";
}) {
  return (
    <div className="astat">
      <div className="astat-head">
        <span>{label}</span>
        <span className="astat-icon"><Icon size={15} /></span>
      </div>
      <div className="astat-value">{value}</div>
      {(hint || delta) && (
        <div className={`astat-delta ${deltaDir ?? ""}`}>
          {delta && <strong>{delta}</strong>}
          {hint && <> {hint}</>}
        </div>
      )}
    </div>
  );
}

function formatRelative(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

function dateStr(iso: string) {
  return new Date(iso).toLocaleDateString("en-CA", { month: "short", day: "numeric", year: "numeric" });
}

export default function LeadsPageClient({ leads, archived = false }: { leads: Lead[]; archived?: boolean }) {
  const router = useRouter();
  const [tab, setTab] = useState<TabId>("all");
  const [search, setSearch] = useState("");
  const [updating, setUpdating] = useState<string | null>(null);
  const [converting, setConverting] = useState<string | null>(null);
  const [statusMenuOpen, setStatusMenuOpen] = useState(false);
  const [exporting, setExporting] = useState<string | null>(null);
  const [exportNote, setExportNote] = useState<{ tone: "ok" | "err"; text: string } | null>(null);

  // Held locally so an export repaints the rows it touched before
  // `router.refresh()` lands. `revalidatePath` only marks the route dirty, and
  // this page re-queries every lead and then resolves each one against the CRM
  // (`findContactsForLeads`), so until the refresh arrives the row the admin
  // just exported still offered "+ Add to contacts" and the header still
  // counted it. The server payload replaces this wholesale the moment it
  // arrives — props only get a new identity when a new payload does — so the
  // local copy can be briefly ahead of the server, never divergent from it.
  const [liveLeads, setLiveLeads] = useState<Lead[]>(leads);
  useEffect(() => { setLiveLeads(leads); }, [leads]);

  const stats = useMemo(() => ({
    total:       liveLeads.length,
    new:         liveLeads.filter(l => l.status === "NEW").length,
    contacted:   liveLeads.filter(l => l.status === "CONTACTED").length,
    converted:   liveLeads.filter(l => l.status === "CONVERTED").length,
    dead:        liveLeads.filter(l => l.status === "DEAD").length,
    out_of_area: liveLeads.filter(l => l.status === "OUT_OF_AREA").length,
  }), [liveLeads]);

  const countFor = (id: TabId) =>
    id === "all" ? stats.total : (stats[id as keyof typeof stats] ?? 0);

  const filtered = useMemo(() => {
    let list = tab === "all"
      ? liveLeads
      : liveLeads.filter(l => l.status === tab.toUpperCase());
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(l =>
        l.email.toLowerCase().includes(q) ||
        (l.name && l.name.toLowerCase().includes(q)) ||
        (l.phone && l.phone.includes(q)) ||
        (l.postalCode && l.postalCode.toLowerCase().includes(q))
      );
    }
    return [...list].sort((a, b) =>
      new Date(b.lastActivityAt).getTime() - new Date(a.lastActivityAt).getTime()
    );
  }, [tab, search, liveLeads]);

  const visibleIds = useMemo(() => filtered.map((l) => l.id), [filtered]);
  const selection = useRowSelection(visibleIds);

  // Leads in the current view that aren't a contact yet — what "Export all"
  // acts on. Exporting the ones already in the CRM would be a no-op, so the
  // count on the button is the number of records it will actually add.
  const exportable = useMemo(() => filtered.filter((l) => !l.contact), [filtered]);

  const afterBulk = () => { selection.clear(); setStatusMenuOpen(false); router.refresh(); };

  /** Shared by the row button, the bulk action and "Export all to contacts". */
  async function runExport(ids: string[], key: string) {
    if (!ids.length) return;
    setExporting(key);
    setExportNote(null);
    const result = await exportLeadsToContacts(ids);
    setExporting(null);
    if ("error" in result) {
      setExportNote({ tone: "err", text: result.error });
      return;
    }
    const parts = [
      result.created ? `${result.created} contact${result.created === 1 ? "" : "s"} created` : null,
      result.linked ? `${result.linked} matched to an existing contact` : null,
      result.skipped ? `${result.skipped} already in contacts` : null,
    ].filter(Boolean);
    setExportNote({
      tone: "ok",
      text: parts.length ? parts.join(" · ") : "Nothing to export — these leads are already contacts.",
    });
    // Flip the rows the export resolved before the refresh: "+ Add to contacts"
    // becomes the "In contacts" link, and the header's "Export N to contacts"
    // drops by the same rows because it counts `!l.contact` over this list.
    //
    // Only the leads that were passed in are flipped. One export can also
    // resolve that person's OTHER lead rows (one email owns several), but
    // deciding that needs the email/phone matching in `lib/lead-contacts.ts`,
    // which is deliberately server-only so the button and the row can never
    // disagree. Those siblings flip when the refresh lands, so the count can be
    // briefly higher than final — never lower, and never wrong about a row.
    const resolved = result.contacts;
    if (Object.keys(resolved).length) {
      setLiveLeads((prev) =>
        prev.map((l) => (resolved[l.id] ? { ...l, contact: resolved[l.id] } : l))
      );
    }
    router.refresh();
  }

  const bulkActions: BulkAction[] = archived
    ? [
        {
          key: "restore",
          label: "Restore",
          icon: <RotateCcw size={14} />,
          onRun: async () => { await bulkRestore("lead", selection.selectedIds); afterBulk(); },
        },
      ]
    : [
        {
          key: "contacts",
          label: "Add to contacts",
          icon: <IdCard size={14} />,
          onRun: async () => { await runExport(selection.selectedIds, "bulk"); afterBulk(); },
        },
        {
          key: "status",
          label: "Change status",
          icon: <Tag size={14} />,
          onRun: () => setStatusMenuOpen((v) => !v),
        },
        {
          key: "delete",
          label: "Delete",
          icon: <Trash2 size={14} />,
          variant: "danger",
          confirm: `Delete ${selection.count} lead${selection.count === 1 ? "" : "s"}? Recoverable from Archived.`,
          onRun: async () => { await bulkSoftDelete("lead", selection.selectedIds); afterBulk(); },
        },
      ];

  async function handleBulkStatus(status: Status) {
    await bulkSetLeadStatus(selection.selectedIds, status);
    afterBulk();
  }

  async function handleStatusChange(id: string, status: Status) {
    setUpdating(id);
    await updateLeadStatus({ id, status });
    setUpdating(null);
  }

  async function handleConvert(id: string) {
    setConverting(id);
    const result = await convertLeadToJob(id);
    setConverting(null);
    if (result.success && result.jobId) {
      window.location.href = `/admin/jobs/${result.jobId}`;
    }
  }

  return (
    <div className="admin-font stack-24">
      <header className="row-between" style={{ alignItems: "flex-end", flexWrap: "wrap", gap: 16 }}>
        <div className="stack-8">
          <p className="eyebrow">Sales</p>
          <h1 className="display">
            {archived ? "Archived leads" : "Leads"}{" "}
            <span style={{ color: "var(--primary-40)", fontWeight: 300 }}>· {stats.total}</span>
          </h1>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          {!archived && (
            <button
              type="button"
              className="btn btn-secondary"
              disabled={exporting !== null || exportable.length === 0}
              title={
                exportable.length
                  ? `Create contact records for the ${exportable.length} lead${exportable.length === 1 ? "" : "s"} in this view that aren't in the CRM yet`
                  : "Every lead in this view is already a contact"
              }
              onClick={() => runExport(exportable.map((l) => l.id), "all")}>
              <IdCard size={16} />
              {exporting === "all"
                ? "Exporting…"
                : exportable.length
                  ? `Export ${exportable.length} to contacts`
                  : "All leads in contacts"}
            </button>
          )}
          <a
            href={archived ? "/admin/leads" : "/admin/leads?archived=1"}
            className={`btn ${archived ? "btn-primary" : "btn-secondary"}`}>
            <Archive size={16} /> {archived ? "Active leads" : "Archived"}
          </a>
        </div>
      </header>

      {exportNote && (
        <div
          className={`banner${exportNote.tone === "err" ? " banner-amber" : ""}`}
          role="status"
          style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <span>{exportNote.text}</span>
          <Link href="/admin/contacts" className="link" style={{ fontSize: 13, whiteSpace: "nowrap" }}>
            Open Contacts <ArrowUpRight size={13} style={{ verticalAlign: "-2px" }} />
          </Link>
        </div>
      )}

      <div className="astat-grid">
        <AStatCard icon={Users}       label="Total leads"   value={stats.total}     hint="all time" />
        <AStatCard icon={AlertCircle} label="New"           value={stats.new}       hint="not contacted" />
        <AStatCard
          icon={Calendar} label="Converted" value={stats.converted}
          delta={stats.total ? `${Math.round((stats.converted / stats.total) * 100)}%` : "0%"}
          deltaDir="up" hint="conversion rate"
        />
        <AStatCard
          icon={UserX} label="Dead / Lost"
          value={stats.dead + stats.out_of_area}
          hint="dead + out of area"
        />
      </div>

      <div className="atabs">
        {TABS.map(t => (
          <button key={t.id} type="button"
            className={`atab ${tab === t.id ? "active" : ""}`}
            onClick={() => setTab(t.id)}>
            {t.label}
            {countFor(t.id) > 0 && <span className="atab-count">{countFor(t.id)}</span>}
          </button>
        ))}
      </div>

      <div className="atoolbar">
        <div className="atoolbar-search">
          <span className="atoolbar-search-icon"><Search size={14} /></span>
          <input
            className="input"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search name, email, phone, postal…"
          />
        </div>
        <span style={{ fontSize: 13, color: "var(--primary-60)", marginLeft: "auto" }}>
          {filtered.length} lead{filtered.length !== 1 ? "s" : ""}
        </span>
      </div>

      {filtered.length === 0 ? (
        <div className="atable-wrap" style={{ padding: "80px 40px", textAlign: "center", color: "var(--primary-60)" }}>
          No leads in this view.
        </div>
      ) : (
        <>
          <div className="atable-wrap" id="ld-desktop">
            <div className="atable-scroll">
              <table className="atable">
                <thead>
                  <tr>
                    <th style={{ width: 40 }}>
                      <input
                        type="checkbox"
                        aria-label="Select all leads"
                        checked={selection.allSelected}
                        ref={(el) => { if (el) el.indeterminate = selection.someSelected; }}
                        onChange={selection.toggleAll}
                        style={{ cursor: "pointer", width: 16, height: 16 }}
                      />
                    </th>
                    <th>Contact</th>
                    <th>Property</th>
                    <th>Preferred</th>
                    <th>Status</th>
                    <th>Contact record</th>
                    <th>Job</th>
                    <th>Activity</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(l => (
                    <tr key={l.id} className={selection.isSelected(l.id) ? "row-selected" : undefined}>
                      <td onClick={(e) => e.stopPropagation()} style={{ width: 40 }}>
                        <input
                          type="checkbox"
                          aria-label={`Select ${l.name || l.email}`}
                          checked={selection.isSelected(l.id)}
                          onChange={() => selection.toggle(l.id)}
                          style={{ cursor: "pointer", width: 16, height: 16 }}
                        />
                      </td>
                      <td style={{ minWidth: 200 }}>
                        <div className="col-client">
                          {l.name || <em style={{ color: "var(--primary-50)", fontStyle: "normal" }}>No name</em>}
                        </div>
                        <div className="col-client-sub">{l.email}</div>
                        {l.phone && <div className="col-client-sub">{l.phone}</div>}
                        {l.postalCode && (
                          <span className="pill" style={{ marginTop: 4, fontSize: 10, background: "var(--primary-10)", color: "var(--primary)" }}>
                            {l.postalCode}
                          </span>
                        )}
                      </td>
                      <td style={{ minWidth: 180 }}>
                        {(l.bedCount !== null || l.bathCount !== null) && (
                          <div style={{ fontSize: 13, color: "var(--ink)" }}>
                            {l.bedCount ?? "?"}bd · {l.bathCount ?? "?"}ba
                          </div>
                        )}
                        {l.serviceType && (
                          <span className="pill" style={{ background: "var(--primary-10)", color: "var(--primary)", marginTop: 4 }}>
                            {SERVICE_LABELS[l.serviceType] ?? l.serviceType}
                          </span>
                        )}
                        {l.dropOffStep !== null && (
                          <div style={{ fontSize: 11, color: "var(--primary-50)", marginTop: 4 }}>
                            Stopped step {l.dropOffStep}
                          </div>
                        )}
                      </td>
                      <td style={{ minWidth: 140 }}>
                        {l.preferredDate ? (
                          <>
                            <div className="date-line" style={{ color: "var(--ink)", fontWeight: 600 }}>{dateStr(l.preferredDate)}</div>
                            <div className="time-line" style={{ color: "var(--primary-70)", fontSize: 11.5 }}>{l.isFlexible ? "Flexible" : (l.preferredSlot || "—")}</div>
                          </>
                        ) : <span style={{ color: "var(--primary-60)" }}>—</span>}
                      </td>
                      <td>
                        <PremiumSelect
                          value={l.status}
                          onChange={v => handleStatusChange(l.id, v as Status)}
                          disabled={updating === l.id}
                          size="sm"
                          options={Object.entries(STATUS_COLORS).map(([s, c]) => ({ value: s, label: c.label }))}
                          style={{ width: 130 }}
                        />
                      </td>
                      <td style={{ minWidth: 150 }}>
                        {l.contact ? (
                          <a
                            href={`/admin/contacts/${l.contact.id}`}
                            className="link"
                            style={{ fontSize: 13, display: "inline-flex", alignItems: "center", gap: 4 }}
                            title={
                              l.contact.linked
                                ? `Exported to ${l.contact.name}`
                                : `${l.contact.name} — matched on email or phone`
                            }>
                            <IdCard size={13} /> In contacts
                            <ArrowUpRight size={12} />
                          </a>
                        ) : archived ? (
                          <span style={{ color: "var(--primary-40)" }}>—</span>
                        ) : (
                          <button
                            type="button"
                            className="btn btn-secondary btn-sm"
                            disabled={exporting !== null}
                            onClick={() => runExport([l.id], l.id)}>
                            {exporting === l.id ? "Adding…" : "+ Add to contacts"}
                          </button>
                        )}
                      </td>
                      <td style={{ minWidth: 140 }}>
                        {l.convertedJob ? (
                          <a href={`/admin/jobs/${l.convertedJob.id}`} className="link" style={{ fontSize: 13 }}>
                            Job #{l.convertedJob.jobNumber}
                          </a>
                        ) : (l.status === "NEW" || l.status === "CONTACTED") ? (
                          <button
                            type="button"
                            className="btn btn-primary btn-sm"
                            disabled={converting === l.id}
                            onClick={() => handleConvert(l.id)}>
                            {converting === l.id ? "Converting…" : "→ Job"}
                          </button>
                        ) : <span style={{ color: "var(--primary-40)" }}>—</span>}
                      </td>
                      <td style={{ minWidth: 100 }}>
                        <div className="time-line" style={{ fontSize: 12, color: "var(--primary-70)" }}>
                          {formatRelative(l.lastActivityAt)}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div id="ld-mobile" style={{ display: "none", flexDirection: "column", gap: 10 }}>
            {filtered.map(l => {
              const c = STATUS_COLORS[l.status];
              return (
                <article key={l.id} className={`jcard${selection.isSelected(l.id) ? " row-selected" : ""}`}>
                  <div className="jcard-top">
                    <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                      <input
                        type="checkbox"
                        aria-label={`Select ${l.name || l.email}`}
                        checked={selection.isSelected(l.id)}
                        onClick={(e) => e.stopPropagation()}
                        onChange={() => selection.toggle(l.id)}
                        style={{ cursor: "pointer", width: 16, height: 16, marginTop: 2 }}
                      />
                      <div>
                        <div className="jcard-client">{l.name || l.email}</div>
                        <div className="jcard-meta">{l.email}</div>
                        {l.phone && <div className="jcard-meta">{l.phone}</div>}
                      </div>
                    </div>
                    <span className="pill" style={{ background: c.bg, color: c.fg }}>
                      <span className="pill-dot" style={{ background: c.dot }} />
                      {c.label}
                    </span>
                  </div>
                  <div className="jcard-row" style={{ marginTop: 10 }}>
                    <div>
                      {l.preferredDate && (
                        <div style={{ fontSize: 13, color: "var(--ink)", fontWeight: 500 }}>
                          {dateStr(l.preferredDate)}
                        </div>
                      )}
                      {(l.bedCount !== null || l.bathCount !== null) && (
                        <div style={{ fontSize: 11, color: "var(--primary-60)" }}>
                          {l.bedCount ?? "?"}bd · {l.bathCount ?? "?"}ba
                        </div>
                      )}
                    </div>
                    <div style={{ textAlign: "right" }}>
                      {l.serviceType && (
                        <div style={{ fontSize: 13 }}>{SERVICE_LABELS[l.serviceType] ?? l.serviceType}</div>
                      )}
                      <div style={{ fontSize: 11, color: "var(--primary-60)" }}>
                        {formatRelative(l.lastActivityAt)}
                      </div>
                    </div>
                  </div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8, paddingTop: 10, borderTop: "1px solid var(--primary-10)", marginTop: 10 }}>
                    {(l.status === "NEW" || l.status === "CONTACTED") && !l.convertedJob && (
                      <button
                        type="button"
                        className="btn btn-primary btn-sm"
                        disabled={converting === l.id}
                        onClick={() => handleConvert(l.id)}>
                        {converting === l.id ? "Converting…" : "→ Convert to Job"}
                      </button>
                    )}
                    {l.contact ? (
                      <a
                        href={`/admin/contacts/${l.contact.id}`}
                        className="link"
                        style={{ fontSize: 13, display: "inline-flex", alignItems: "center", gap: 4 }}>
                        <IdCard size={13} /> In contacts <ArrowUpRight size={12} />
                      </a>
                    ) : !archived ? (
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        disabled={exporting !== null}
                        onClick={() => runExport([l.id], l.id)}>
                        {exporting === l.id ? "Adding…" : "+ Add to contacts"}
                      </button>
                    ) : null}
                    {l.convertedJob && (
                      <a href={`/admin/jobs/${l.convertedJob.id}`} className="link" style={{ fontSize: 13, alignSelf: "center" }}>
                        Job #{l.convertedJob.jobNumber}
                      </a>
                    )}
                  </div>
                </article>
              );
            })}
          </div>

          <style>{`
            @media (max-width: 900px) {
              #ld-desktop { display: none !important; }
              #ld-mobile  { display: flex !important; }
            }
            .atable tbody tr.row-selected { background: var(--primary-05, #f0fdff); }
            .jcard.row-selected { outline: 2px solid var(--primary-40, #008C9C); outline-offset: -1px; }
          `}</style>
        </>
      )}

      {statusMenuOpen && selection.count > 0 && !archived && (
        <div
          style={{
            position: "sticky",
            bottom: 76,
            zIndex: 41,
            margin: "0 auto",
            maxWidth: "fit-content",
            display: "flex",
            flexDirection: "column",
            gap: 2,
            padding: 6,
            borderRadius: 12,
            background: "#0f172a",
            boxShadow: "0 8px 30px rgba(0,0,0,0.25)",
          }}>
          <span style={{ fontSize: 11, fontWeight: 600, color: "rgba(255,255,255,0.6)", padding: "4px 10px" }}>
            Set status to…
          </span>
          {(Object.entries(STATUS_COLORS) as [Status, (typeof STATUS_COLORS)[Status]][]).map(([s, c]) => (
            <button
              key={s}
              type="button"
              onClick={() => handleBulkStatus(s)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                fontSize: 13,
                fontWeight: 500,
                textAlign: "left",
                padding: "7px 10px",
                borderRadius: 8,
                border: "none",
                background: "transparent",
                color: "#fff",
                cursor: "pointer",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.12)")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}>
              <span style={{ width: 8, height: 8, borderRadius: 999, background: c.dot }} />
              {c.label}
            </button>
          ))}
        </div>
      )}

      <BulkActionBar
        noun="lead"
        count={selection.count}
        actions={bulkActions}
        onClear={() => { setStatusMenuOpen(false); selection.clear(); }}
        total={visibleIds.length}
        allSelected={selection.allSelected}
        onToggleAll={selection.toggleAll}
      />
    </div>
  );
}
