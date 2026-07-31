"use client";

import { useMemo, useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import {
  Search, SlidersHorizontal, Columns3, Plus, ChevronRight, Check,
  Sparkles, AlertCircle, CalendarClock, CheckCircle2, Flag, Copy,
  Trash2, RotateCcw, Archive, Tag,
} from "lucide-react";
import type { LifecycleStage } from "@prisma/client";
import type { ContactListItem, CrmStats } from "@/lib/crm-meta";
import { LIFECYCLE_ORDER, LIFECYCLE_META, money, relativeTime } from "@/lib/crm-meta";
import { Avatar, LifecyclePill, AStat, ScoreMeter, Pager } from "./_components";
import Modal from "@/components/ui/Modal";
import { createContact } from "@/app/admin/actions/contactActions";
import { useRowSelection } from "@/components/common/useRowSelection";
import BulkActionBar, { type BulkAction } from "@/components/common/BulkActionBar";
import { bulkSoftDelete, bulkRestore } from "@/lib/bulk/actions";
import { bulkSetContactLifecycle } from "@/app/admin/actions/bulkSetContactLifecycle";

type ColId = "lifecycle" | "source" | "owner" | "activity" | "nextstep" | "score" | "bookings" | "ltv";
const COLUMNS: { id: ColId; label: string }[] = [
  { id: "lifecycle", label: "Lifecycle" },
  { id: "source", label: "Original source" },
  { id: "owner", label: "Owner" },
  { id: "activity", label: "Last activity" },
  { id: "nextstep", label: "Next step" },
  { id: "score", label: "Lead score" },
  { id: "bookings", label: "Bookings" },
  { id: "ltv", label: "Lifetime value" },
];
const DEFAULT_COLS: ColId[] = ["lifecycle", "source", "owner", "activity", "nextstep"];

type ViewId = "all" | "mine" | "new" | "qualified" | "active" | "applicants";
const VIEWS: { id: ViewId; label: string; apply: (c: ContactListItem, meId?: string) => boolean }[] = [
  { id: "all", label: "All contacts", apply: () => true },
  { id: "mine", label: "My leads", apply: (c, meId) => !!meId && c.ownerId === meId },
  { id: "new", label: "New leads", apply: (c) => c.lifecycle === "NEW_LEAD" },
  { id: "qualified", label: "Qualified", apply: (c) => c.lifecycle === "QUALIFIED" },
  { id: "active", label: "Active & returning", apply: (c) => c.lifecycle === "ACTIVE" || c.lifecycle === "RETURNING" },
  { id: "applicants", label: "Applicants", apply: (c) => c.lifecycle === "APPLICANT" },
];

export default function ContactsPageClient({
  initialContacts,
  initialStats,
  currentUserId,
  archived = false,
}: {
  initialContacts: ContactListItem[];
  initialStats: CrmStats;
  currentUserId?: string;
  archived?: boolean;
}) {
  const router = useRouter();
  const contacts = initialContacts;

  const [view, setView] = useState<ViewId>("all");
  const [search, setSearch] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [colsOpen, setColsOpen] = useState(false);
  const [cols, setCols] = useState<Set<ColId>>(new Set(DEFAULT_COLS));
  const [perPage, setPerPage] = useState(10);
  const [page, setPage] = useState(1);

  const [fLifecycle, setFLifecycle] = useState<"all" | LifecycleStage>("all");
  const [fSource, setFSource] = useState("all");
  const [fOwner, setFOwner] = useState("all");
  const [sort, setSort] = useState<"recent" | "name" | "value" | "score">("recent");

  const colWrapRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (colWrapRef.current && !colWrapRef.current.contains(e.target as Node)) setColsOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const sources = useMemo(
    () => [...new Set(contacts.map((c) => c.source).filter((s): s is string => !!s))].sort(),
    [contacts]
  );
  const owners = useMemo(() => {
    const map = new Map<string, string>();
    contacts.forEach((c) => { if (c.ownerId && c.ownerName) map.set(c.ownerId, c.ownerName); });
    return [...map.entries()];
  }, [contacts]);

  function resetFilters() { setFLifecycle("all"); setFSource("all"); setFOwner("all"); setSort("recent"); }
  const activeFilters =
    (fLifecycle !== "all" ? 1 : 0) + (fSource !== "all" ? 1 : 0) + (fOwner !== "all" ? 1 : 0) + (sort !== "recent" ? 1 : 0);

  const viewDef = VIEWS.find((v) => v.id === view) ?? VIEWS[0];

  const filtered = useMemo(() => {
    let list = contacts.filter((c) => viewDef.apply(c, currentUserId));
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter((c) =>
        c.name.toLowerCase().includes(q) ||
        (c.email || "").toLowerCase().includes(q) ||
        (c.phone || "").toLowerCase().includes(q) ||
        (c.address || "").toLowerCase().includes(q)
      );
    }
    if (fLifecycle !== "all") list = list.filter((c) => c.lifecycle === fLifecycle);
    if (fSource !== "all") list = list.filter((c) => c.source === fSource);
    if (fOwner !== "all") list = list.filter((c) => c.ownerId === fOwner);

    list = [...list];
    if (sort === "recent") list.sort((a, b) => +new Date(b.lastActivityAt) - +new Date(a.lastActivityAt));
    else if (sort === "name") list.sort((a, b) => a.name.localeCompare(b.name));
    else if (sort === "value") list.sort((a, b) => b.lifetimeValue - a.lifetimeValue);
    else if (sort === "score") list.sort((a, b) => (b.leadScore ?? 0) - (a.leadScore ?? 0));
    return list;
  }, [contacts, viewDef, currentUserId, search, fLifecycle, fSource, fOwner, sort]);

  const total = filtered.length;
  const pageCount = Math.max(1, Math.ceil(total / perPage));
  const safePage = Math.min(page, pageCount);
  const paged = filtered.slice((safePage - 1) * perPage, safePage * perPage);
  useEffect(() => { setPage(1); }, [view, search, fLifecycle, fSource, fOwner, sort, perPage]);

  function toggleCol(id: ColId) {
    setCols((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }
  const show = (id: ColId) => cols.has(id);
  const open = (id: string) => router.push(`/admin/contacts/${id}`);

  // ── Multi-select bulk actions ──
  const visibleIds = useMemo(() => paged.map((c) => c.id), [paged]);
  const selection = useRowSelection(visibleIds);
  const [stageMenuOpen, setStageMenuOpen] = useState(false);
  const stageMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!stageMenuOpen) return;
    function onDoc(e: MouseEvent) {
      if (stageMenuRef.current && !stageMenuRef.current.contains(e.target as Node)) setStageMenuOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [stageMenuOpen]);

  const afterBulk = () => { selection.clear(); setStageMenuOpen(false); router.refresh(); };

  async function applyLifecycle(stage: LifecycleStage) {
    await bulkSetContactLifecycle(selection.selectedIds, stage);
    afterBulk();
  }

  const bulkActions: BulkAction[] = archived
    ? [
        {
          key: "restore",
          label: "Restore",
          icon: <RotateCcw size={14} />,
          onRun: async () => { await bulkRestore("contact", selection.selectedIds); afterBulk(); },
        },
      ]
    : [
        {
          key: "lifecycle",
          label: "Set lifecycle stage",
          icon: <Tag size={14} />,
          onRun: () => { setStageMenuOpen((v) => !v); },
        },
        {
          key: "delete",
          label: "Delete",
          icon: <Trash2 size={14} />,
          variant: "danger",
          confirm: `Delete ${selection.count} contact${selection.count === 1 ? "" : "s"}? Recoverable from Archived.`,
          onRun: async () => { await bulkSoftDelete("contact", selection.selectedIds); afterBulk(); },
        },
      ];

  // ── New-contact create modal ──
  const [createOpen, setCreateOpen] = useState(false);
  const [cForm, setCForm] = useState<{
    name: string;
    email: string;
    phone: string;
    address: string;
    lifecycle: LifecycleStage;
    source: string;
  }>({ name: "", email: "", phone: "", address: "", lifecycle: "NEW_LEAD", source: "" });
  const [cSaving, setCSaving] = useState(false);
  const [cError, setCError] = useState<string | null>(null);

  function openCreate() {
    setCForm({ name: "", email: "", phone: "", address: "", lifecycle: "NEW_LEAD", source: "" });
    setCError(null);
    setCreateOpen(true);
  }
  async function submitCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!cForm.name.trim()) return;
    setCSaving(true);
    setCError(null);
    const res = await createContact(cForm);
    if ("error" in res) {
      setCError(res.error);
      setCSaving(false);
      return;
    }
    router.push(`/admin/contacts/${res.id}`);
  }

  return (
    <div className="admin-font">
      <header className="row-between" style={{ marginBottom: 32, alignItems: "flex-end", flexWrap: "wrap", gap: 16 }}>
        <div className="stack-8" style={{ minWidth: 0 }}>
          <p className="eyebrow">CRM</p>
          <h1 className="display" style={{ fontSize: "clamp(34px, 4.2vw, 48px)", whiteSpace: "nowrap" }}>
            Contacts <span style={{ color: "var(--primary-40)", fontWeight: 300 }}>· {initialStats.total}</span>
          </h1>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <a
            href={archived ? "/admin/contacts" : "/admin/contacts?archived=1"}
            className={`btn ${archived ? "btn-primary" : "btn-secondary"}`}>
            <Archive size={15} /> {archived ? "Active contacts" : "Archived"}
          </a>
          {!archived && (
            <>
              <button className="btn btn-secondary" onClick={() => router.push("/admin/contacts/duplicates")}>
                <Copy size={15} /> Manage duplicates
              </button>
              <button className="btn btn-primary" onClick={openCreate}>
                <Plus size={15} /> New contact
              </button>
            </>
          )}
        </div>
      </header>

      <Modal isOpen={createOpen} onClose={() => setCreateOpen(false)} title="New contact">
        <form onSubmit={submitCreate} className="stack-16" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <label style={{ display: "block" }}>
            <span className="label">Name<span style={{ color: "var(--error)" }}> *</span></span>
            <input
              className="input"
              value={cForm.name}
              onChange={(e) => setCForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="Full name"
              autoFocus
            />
          </label>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 16 }}>
            <label style={{ display: "block" }}>
              <span className="label">Email</span>
              <input
                className="input"
                type="email"
                value={cForm.email}
                onChange={(e) => setCForm((f) => ({ ...f, email: e.target.value }))}
                placeholder="name@example.com"
              />
            </label>
            <label style={{ display: "block" }}>
              <span className="label">Phone</span>
              <input
                className="input"
                value={cForm.phone}
                onChange={(e) => setCForm((f) => ({ ...f, phone: e.target.value }))}
                placeholder="(514) 555-0123"
              />
            </label>
          </div>
          <label style={{ display: "block" }}>
            <span className="label">Address</span>
            <input
              className="input"
              value={cForm.address}
              onChange={(e) => setCForm((f) => ({ ...f, address: e.target.value }))}
              placeholder="Street, city"
            />
          </label>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 16 }}>
            <label style={{ display: "block" }}>
              <span className="label">Lifecycle stage</span>
              <select
                className="input"
                value={cForm.lifecycle}
                onChange={(e) => setCForm((f) => ({ ...f, lifecycle: e.target.value as LifecycleStage }))}>
                {LIFECYCLE_ORDER.map((s) => (
                  <option key={s} value={s}>{LIFECYCLE_META[s].label}</option>
                ))}
              </select>
            </label>
            <label style={{ display: "block" }}>
              <span className="label">Source</span>
              <input
                className="input"
                value={cForm.source}
                onChange={(e) => setCForm((f) => ({ ...f, source: e.target.value }))}
                placeholder="e.g. Referral, Website"
              />
            </label>
          </div>
          {cError && (
            <div style={{ background: "#fee2e2", color: "#dc2626", padding: "10px 14px", borderRadius: 10, fontSize: 13 }}>
              {cError}
            </div>
          )}
          <div className="row" style={{ justifyContent: "flex-end", gap: 8 }}>
            <button type="button" className="btn btn-secondary" onClick={() => setCreateOpen(false)}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={cSaving || !cForm.name.trim()}>
              {cSaving ? "Creating…" : "Create contact"}
            </button>
          </div>
        </form>
      </Modal>

      <div className="astat-grid" style={{ marginBottom: 28 }}>
        <AStat icon={Sparkles} label="Total contacts" value={initialStats.total} hint="across all stages" />
        <AStat icon={AlertCircle} label="New leads · 7d" value={initialStats.newLeads7d} hint="awaiting first touch" deltaDir={initialStats.newLeads7d > 0 ? "up" : undefined} />
        <AStat icon={CalendarClock} label="Booked this month" value={initialStats.bookedThisMonth} hint="converted to a job" />
        <AStat icon={CheckCircle2} label="Conversion rate" value={`${initialStats.convRate}%`} hint="leads → booked" deltaDir="up" />
      </div>

      {/* Saved-views bar */}
      <div className="cviews">
        {VIEWS.map((v) => {
          const n = contacts.filter((c) => v.apply(c, currentUserId)).length;
          return (
            <button key={v.id} className={`cview-chip ${view === v.id ? "active" : ""}`} onClick={() => setView(v.id)}>
              {v.label}
              <span className="cview-count">{n}</span>
            </button>
          );
        })}
        <span className="cviews-sep" />
        <button className="cview-add" onClick={() => alert("Save current filters as a view")}>
          <Plus size={12} /> Save view
        </button>
      </div>

      {/* Toolbar */}
      <div className="atoolbar" style={{ marginBottom: filtersOpen ? 16 : 18 }}>
        <div className="atoolbar-search">
          <span className="atoolbar-search-icon"><Search size={16} /></span>
          <input className="input" type="search" placeholder="Search name, email, phone, address…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>

        <button className={`afilter-toggle ${filtersOpen ? "open" : ""}`} onClick={() => setFiltersOpen((v) => !v)}>
          <SlidersHorizontal size={14} /> Filters
          {activeFilters > 0 ? <span className="afilter-badge">{activeFilters}</span> : null}
        </button>

        <div className="col-wrap" ref={colWrapRef}>
          <button className={`afilter-toggle ${colsOpen ? "open" : ""}`} onClick={() => setColsOpen((v) => !v)}>
            <Columns3 size={14} /> Columns
          </button>
          {colsOpen ? (
            <div className="col-pop">
              <div className="col-pop-head">Visible columns</div>
              <button className="col-pop-item locked"><span className="col-pop-check on"><Check size={12} /></span>Contact</button>
              {COLUMNS.map((col) => {
                const on = cols.has(col.id);
                return (
                  <button key={col.id} className={`col-pop-item ${on ? "on" : ""}`} onClick={() => toggleCol(col.id)}>
                    <span className={`col-pop-check ${on ? "on" : ""}`}>{on ? <Check size={12} /> : null}</span>
                    {col.label}
                  </button>
                );
              })}
            </div>
          ) : null}
        </div>

        <div style={{ flex: 1 }} />

        <select className="aselect" value={perPage} onChange={(e) => setPerPage(parseInt(e.target.value, 10))}>
          <option value={10}>10 rows</option>
          <option value={25}>25 rows</option>
          <option value={50}>50 rows</option>
        </select>
      </div>

      {filtersOpen ? (
        <div className="afilter-panel" style={{ marginBottom: 20, gridTemplateColumns: "repeat(4, 1fr)" }}>
          <div className="field">
            <label className="label">Lifecycle stage</label>
            <select className="aselect" value={fLifecycle} onChange={(e) => setFLifecycle(e.target.value as "all" | LifecycleStage)}>
              <option value="all">All stages</option>
              {LIFECYCLE_ORDER.map((s) => <option key={s} value={s}>{LIFECYCLE_META[s].label}</option>)}
            </select>
          </div>
          <div className="field">
            <label className="label">Original source</label>
            <select className="aselect" value={fSource} onChange={(e) => setFSource(e.target.value)}>
              <option value="all">All sources</option>
              {sources.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div className="field">
            <label className="label">Owner</label>
            <select className="aselect" value={fOwner} onChange={(e) => setFOwner(e.target.value)}>
              <option value="all">Anyone</option>
              {owners.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
            </select>
          </div>
          <div className="field">
            <label className="label">Sort by</label>
            <select className="aselect" value={sort} onChange={(e) => setSort(e.target.value as typeof sort)}>
              <option value="recent">Recent activity</option>
              <option value="name">Name (A→Z)</option>
              <option value="value">Lifetime value</option>
              <option value="score">Lead score</option>
            </select>
          </div>
          <div className="afilter-panel-actions">
            <button className="link-muted" onClick={resetFilters} style={{ background: "none", border: 0, cursor: "pointer", fontSize: 13 }}>Reset filters</button>
            <button className="btn btn-primary btn-sm" onClick={() => setFiltersOpen(false)}>Done</button>
          </div>
        </div>
      ) : null}

      {paged.length === 0 ? (
        <div className="atable-wrap" style={{ padding: "80px 40px", textAlign: "center", color: "var(--primary-60)" }}>
          No contacts match these filters.
        </div>
      ) : (
        <>
          <div className="atable-wrap" id="contacts-desktop">
            <div className="atable-scroll">
              <table className="atable">
                <thead>
                  <tr>
                    <th style={{ width: 40 }}>
                      <input
                        type="checkbox"
                        aria-label="Select all contacts"
                        checked={selection.allSelected}
                        ref={(el) => { if (el) el.indeterminate = selection.someSelected; }}
                        onChange={selection.toggleAll}
                        style={{ cursor: "pointer", width: 16, height: 16 }}
                      />
                    </th>
                    <th>Contact</th>
                    {show("lifecycle") ? <th>Lifecycle</th> : null}
                    {show("source") ? <th>Original source</th> : null}
                    {show("owner") ? <th>Owner</th> : null}
                    {show("score") ? <th className="num">Score</th> : null}
                    {show("bookings") ? <th className="num">Bookings</th> : null}
                    {show("ltv") ? <th className="num">LTV</th> : null}
                    {show("activity") ? <th>Last activity</th> : null}
                    {show("nextstep") ? <th>Next step</th> : null}
                    <th className="col-actions" />
                  </tr>
                </thead>
                <tbody>
                  {paged.map((c) => (
                    <ContactRow
                      key={c.id}
                      c={c}
                      show={show}
                      onClick={() => open(c.id)}
                      selected={selection.isSelected(c.id)}
                      onToggle={() => selection.toggle(c.id)}
                    />
                  ))}
                </tbody>
              </table>
            </div>
            <Pager page={safePage} pageCount={pageCount} total={total} perPage={perPage} onChange={setPage} />
          </div>

          <div id="contacts-mobile" style={{ display: "none", flexDirection: "column", gap: 10 }}>
            {paged.map((c) => (
              <ContactCard
                key={c.id}
                c={c}
                onClick={() => open(c.id)}
                selected={selection.isSelected(c.id)}
                onToggle={() => selection.toggle(c.id)}
              />
            ))}
          </div>

          <style>{`
            @media (max-width: 1100px) {
              #contacts-desktop { display: none !important; }
              #contacts-mobile { display: flex !important; }
            }
            .atable tbody tr.row-selected { background: var(--primary-05, #f0fdff); }
            .jcard.row-selected { outline: 2px solid var(--primary-40, #008C9C); outline-offset: -1px; }
          `}</style>
        </>
      )}

      {stageMenuOpen && selection.count > 0 && (
        <div
          ref={stageMenuRef}
          style={{
            position: "fixed",
            left: "50%",
            bottom: 76,
            transform: "translateX(-50%)",
            zIndex: 50,
            background: "#fff",
            borderRadius: 12,
            boxShadow: "0 12px 40px rgba(0,0,0,0.22)",
            border: "1px solid var(--primary-10, #e2e8f0)",
            padding: 6,
            minWidth: 220,
            maxHeight: 320,
            overflowY: "auto",
          }}>
          <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.4, color: "var(--primary-60)", padding: "6px 10px 4px" }}>
            Set lifecycle stage
          </div>
          {LIFECYCLE_ORDER.map((s) => (
            <button
              key={s}
              onClick={() => applyLifecycle(s)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                width: "100%",
                textAlign: "left",
                background: "none",
                border: "none",
                cursor: "pointer",
                padding: "8px 10px",
                borderRadius: 8,
                fontSize: 13,
                color: "var(--ink)",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "var(--primary-05, #f0fdff)")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "none")}>
              <LifecyclePill stage={s} />
            </button>
          ))}
        </div>
      )}

      <BulkActionBar
        noun="contact"
        count={selection.count}
        actions={bulkActions}
        onClear={selection.clear}
        total={visibleIds.length}
        allSelected={selection.allSelected}
        onToggleAll={selection.toggleAll}
      />
    </div>
  );
}

function ContactRow({ c, show, onClick, selected, onToggle }: {
  c: ContactListItem;
  show: (id: ColId) => boolean;
  onClick: () => void;
  selected: boolean;
  onToggle: () => void;
}) {
  const due = c.nextStepDue ? new Date(c.nextStepDue) : null;
  const overdue = !!due && due < new Date(new Date().toDateString());
  const dueSoon = !!due && !overdue && +due - Date.now() < 2 * 86400000;
  return (
    <tr onClick={onClick} className={selected ? "row-selected" : undefined}>
      <td onClick={(e) => e.stopPropagation()} style={{ width: 40 }}>
        <input
          type="checkbox"
          aria-label={`Select ${c.name}`}
          checked={selected}
          onChange={onToggle}
          style={{ cursor: "pointer", width: 16, height: 16 }}
        />
      </td>
      <td style={{ minWidth: 230 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <Avatar name={c.name} color="var(--primary)" size={36} />
          <div style={{ minWidth: 0 }}>
            <div className="col-client" style={{ display: "flex", alignItems: "center", gap: 7 }}>
              {c.name}
              {c.duplicateIds.length ? (
                <span title={`${c.duplicateIds.length} possible duplicate${c.duplicateIds.length > 1 ? "s" : ""}`} className="dup-flag">
                  <Flag size={10} />
                </span>
              ) : null}
            </div>
            <div className="col-client-sub">{c.email || "—"}</div>
          </div>
        </div>
      </td>
      {show("lifecycle") ? <td><LifecyclePill stage={c.lifecycle} /></td> : null}
      {show("source") ? (
        <td>
          <div style={{ fontSize: 13, color: "var(--ink-soft)" }}>{c.source || "—"}</div>
          {c.sourceDetail ? <div className="col-client-sub" style={{ maxWidth: 200, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{c.sourceDetail}</div> : null}
        </td>
      ) : null}
      {show("owner") ? (
        <td>
          {c.ownerName ? (
            <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
              <Avatar name={c.ownerName} size={26} />
              <span style={{ fontSize: 13, color: "var(--ink-soft)" }}>{c.ownerName.split(" ")[0]}</span>
            </div>
          ) : <span style={{ fontSize: 12.5, color: "var(--primary-40)" }}>Unassigned</span>}
        </td>
      ) : null}
      {show("score") ? (
        <td className="num">{c.leadScore != null ? <ScoreMeter score={c.leadScore} align="end" /> : <span style={{ color: "var(--primary-40)" }}>—</span>}</td>
      ) : null}
      {show("bookings") ? <td className="num" style={{ fontWeight: 600 }}>{c.bookings || <span style={{ color: "var(--primary-40)", fontWeight: 400 }}>—</span>}</td> : null}
      {show("ltv") ? <td className="num" style={{ fontWeight: 600 }}>{c.lifetimeValue ? money(c.lifetimeValue) : <span style={{ color: "var(--primary-40)", fontWeight: 400 }}>—</span>}</td> : null}
      {show("activity") ? <td style={{ fontSize: 12.5, color: "var(--primary-70)" }}>{relativeTime(c.lastActivityAt)}</td> : null}
      {show("nextstep") ? (
        <td style={{ minWidth: 180 }}><span className={`next-step ${overdue ? "overdue" : dueSoon ? "due" : ""}`}>{c.nextStep || "—"}</span></td>
      ) : null}
      <td className="col-actions">
        <div className="row" style={{ justifyContent: "flex-end", gap: 6 }}>
          <button className="icon-btn" aria-label="View" onClick={(e) => { e.stopPropagation(); onClick(); }} style={{ width: 30, height: 30 }}>
            <ChevronRight size={14} />
          </button>
        </div>
      </td>
    </tr>
  );
}

function ContactCard({ c, onClick, selected, onToggle }: {
  c: ContactListItem;
  onClick: () => void;
  selected: boolean;
  onToggle: () => void;
}) {
  return (
    <article className={`jcard${selected ? " row-selected" : ""}`} onClick={onClick}>
      <div className="jcard-top">
        <div className="row" style={{ gap: 12 }}>
          <input
            type="checkbox"
            aria-label={`Select ${c.name}`}
            checked={selected}
            onClick={(e) => e.stopPropagation()}
            onChange={onToggle}
            style={{ cursor: "pointer", width: 16, height: 16 }}
          />
          <Avatar name={c.name} color="var(--primary)" size={36} />
          <div>
            <div className="jcard-client">{c.name}</div>
            <div className="jcard-meta">{c.email || "—"}</div>
          </div>
        </div>
        <LifecyclePill stage={c.lifecycle} />
      </div>
      <div className="jcard-row" style={{ paddingTop: 10, borderTop: "1px solid var(--primary-10)" }}>
        <div style={{ fontSize: 12.5, color: "var(--primary-70)" }}>{c.source || "—"} · {relativeTime(c.lastActivityAt)}</div>
        <div style={{ fontSize: 12, color: "var(--ink-soft)" }}>{c.bookings ? `${c.bookings} bookings` : (c.ownerName?.split(" ")[0] ?? "Unassigned")}</div>
      </div>
    </article>
  );
}
