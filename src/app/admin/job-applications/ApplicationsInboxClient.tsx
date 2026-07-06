"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Mail,
  Phone,
  MapPin,
  Clock,
  Briefcase,
  Car,
  Sparkles,
  FileText,
  Check,
  UserPlus,
  Calendar,
  ShieldCheck,
  Users,
  Heart,
  HelpCircle,
  Cake,
  BadgeCheck,
  Trash2,
  RotateCcw,
  Archive,
} from "lucide-react";
import { initials } from "@/lib/avatar";
import { updateApplicationStatus } from "../actions/updateApplicationStatus";
import { bulkSetApplicationStatus } from "../actions/bulkSetApplicationStatus";
import { hireApplicant } from "../actions/hireApplicant";
import { useRowSelection } from "@/components/common/useRowSelection";
import BulkActionBar, { type BulkAction } from "@/components/common/BulkActionBar";
import { bulkSoftDelete, bulkRestore } from "@/lib/bulk/actions";

type Status =
  | "NEW"
  | "CONTACTED"
  | "INTERVIEWING"
  | "HIRED"
  | "REJECTED"
  | "ARCHIVED";

interface Application {
  id: string;
  name: string;
  gender: string | null;
  dateOfBirth: string | null;
  email: string;
  phone: string | null;
  address: string;
  cityArea: string | null;
  hasTransport: boolean | null;
  driversLicense: string | null;
  hasInsurance: boolean | null;
  insuranceDetails: string | null;
  availability: string | null;
  earliestStart: string | null;
  yearsExperience: string | null;
  experienceTypes: string[];
  experience: string | null;
  resumeUrl: string | null;
  whyCleano: string | null;
  hasConviction: boolean | null;
  convictionDetails: string | null;
  hearAbout: string | null;
  referrerName: string | null;
  references: string[];
  backgroundConsent: boolean;
  consentDate: string | null;
  source: string | null;
  status: Status;
  notes: string | null;
  createdAt: string;
}

const ORDER: Status[] = [
  "NEW",
  "CONTACTED",
  "INTERVIEWING",
  "HIRED",
  "REJECTED",
  "ARCHIVED",
];

const STATUS: Record<Status, { label: string; dot: string; bg: string; fg: string }> = {
  NEW: { label: "New", dot: "#2f6fae", bg: "var(--blue-100)", fg: "var(--blue-800)" },
  CONTACTED: { label: "Contacted", dot: "#7c3aed", bg: "#ede9fe", fg: "#5b21b6" },
  INTERVIEWING: { label: "Interviewing", dot: "#d97706", bg: "var(--amber-50)", fg: "var(--amber-800)" },
  HIRED: { label: "Hired", dot: "#059669", bg: "var(--emerald-100)", fg: "var(--emerald-800)" },
  REJECTED: { label: "Rejected", dot: "#dc2626", bg: "var(--error-bg)", fg: "var(--error-text)" },
  ARCHIVED: { label: "Archived", dot: "#64748b", bg: "var(--slate-100)", fg: "var(--slate-700)" },
};

function StatusPill({ status, sm }: { status: Status; sm?: boolean }) {
  const m = STATUS[status];
  return (
    <span
      className="pill"
      style={{ background: m.bg, color: m.fg, ...(sm ? { fontSize: 10.5 } : {}) }}>
      <span className="pill-dot" style={{ background: m.dot }} />
      {m.label}
    </span>
  );
}

function Avatar({ name, size }: { name: string; size: number }) {
  return (
    <span
      className="avatar"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.32,
        border: 0,
        background: "var(--primary)",
      }}>
      {initials(name)}
    </span>
  );
}

function Row({
  icon,
  k,
  v,
}: {
  icon: React.ReactNode;
  k: string;
  v: React.ReactNode;
}) {
  if (v === null || v === undefined || v === "" || v === "—") return null;
  return (
    <div className="apps-row">
      <span className="apps-row-k">
        {icon} {k}
      </span>
      <span className="apps-row-v">{v}</span>
    </div>
  );
}

const yn = (b: boolean | null) => (b == null ? null : b ? "Yes" : "No");

export default function ApplicationsInboxClient({
  applications,
  archived = false,
}: {
  applications: Application[];
  archived?: boolean;
}) {
  const router = useRouter();
  const [filter, setFilter] = useState<"ALL" | Status>("ALL");
  const [selId, setSelId] = useState<string | null>(
    applications.find((a) => a.status === "NEW")?.id ?? applications[0]?.id ?? null
  );
  const [notesDraft, setNotesDraft] = useState<Record<string, string>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const [savedFlash, setSavedFlash] = useState(false);
  const [hiring, setHiring] = useState(false);
  const [hireMsg, setHireMsg] = useState<
    { kind: "password"; value: string } | { kind: "info" | "error"; value: string } | null
  >(null);

  const counts = useMemo(() => {
    const m: Record<string, number> = { ALL: applications.length };
    ORDER.forEach((s) => {
      m[s] = applications.filter((a) => a.status === s).length;
    });
    return m;
  }, [applications]);

  const visible = filter === "ALL" ? applications : applications.filter((a) => a.status === filter);
  const sel = applications.find((a) => a.id === selId) ?? null;

  const visibleIds = useMemo(() => visible.map((a) => a.id), [visible]);
  const selection = useRowSelection(visibleIds);

  const afterBulk = () => {
    selection.clear();
    router.refresh();
  };

  const bulkActions: BulkAction[] = archived
    ? [
        {
          key: "restore",
          label: "Restore",
          icon: <RotateCcw size={14} />,
          onRun: async () => {
            await bulkRestore("jobApplication", selection.selectedIds);
            afterBulk();
          },
        },
      ]
    : [
        {
          key: "contacted",
          label: "Contacted",
          onRun: async () => {
            await bulkSetApplicationStatus(selection.selectedIds, "CONTACTED");
            afterBulk();
          },
        },
        {
          key: "interviewing",
          label: "Interviewing",
          onRun: async () => {
            await bulkSetApplicationStatus(selection.selectedIds, "INTERVIEWING");
            afterBulk();
          },
        },
        {
          key: "rejected",
          label: "Rejected",
          onRun: async () => {
            await bulkSetApplicationStatus(selection.selectedIds, "REJECTED");
            afterBulk();
          },
        },
        {
          key: "archive",
          label: "Archive",
          icon: <Archive size={14} />,
          onRun: async () => {
            await bulkSetApplicationStatus(selection.selectedIds, "ARCHIVED");
            afterBulk();
          },
        },
        {
          key: "delete",
          label: "Delete",
          icon: <Trash2 size={14} />,
          variant: "danger",
          confirm: `Delete ${selection.count} application${
            selection.count === 1 ? "" : "s"
          }? Recoverable from Archived.`,
          onRun: async () => {
            await bulkSoftDelete("jobApplication", selection.selectedIds);
            afterBulk();
          },
        },
      ];

  const FILTERS: { id: "ALL" | Status; label: string }[] = [
    { id: "ALL", label: "All" },
    ...ORDER.map((s) => ({ id: s, label: STATUS[s].label })),
  ];

  async function setStatus(status: Status) {
    if (!sel || sel.status === status) return;
    setSavingId(sel.id);
    const res = await updateApplicationStatus({ applicationId: sel.id, status });
    setSavingId(null);
    if (res.success) router.refresh();
  }

  async function hire() {
    if (!sel) return;
    setHiring(true);
    setHireMsg(null);
    const res = await hireApplicant(sel.id);
    setHiring(false);
    if ("error" in res) {
      setHireMsg({ kind: "error", value: res.error });
      return;
    }
    if (res.existing) {
      setHireMsg({ kind: "info", value: "Existing account reactivated and marked hired." });
    } else {
      setHireMsg({ kind: "password", value: res.tempPassword });
    }
    router.refresh();
  }

  async function saveNotes() {
    if (!sel) return;
    setSavingId(sel.id);
    const res = await updateApplicationStatus({
      applicationId: sel.id,
      status: sel.status,
      notes: notesDraft[sel.id] ?? sel.notes ?? "",
    });
    setSavingId(null);
    if (res.success) {
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 1600);
      router.refresh();
    }
  }

  const draftVal = sel ? notesDraft[sel.id] ?? sel.notes ?? "" : "";
  const dirty = sel ? draftVal !== (sel.notes ?? "") : false;

  return (
    <div className="admin-font">
      <header style={{ marginBottom: 20 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
          <h1 className="title" style={{ fontSize: 30 }}>
            {archived ? "Archived applications" : "Job applications"}
          </h1>
          <span className="apps-headcount">{applications.length}</span>
          <a
            href={archived ? "/admin/job-applications" : "/admin/job-applications?archived=1"}
            className={`btn ${archived ? "btn-primary" : "btn-secondary"} btn-sm`}
            style={{ marginLeft: "auto", textDecoration: "none" }}>
            <Archive size={16} /> {archived ? "Active applications" : "Archived"}
          </a>
        </div>
        <p className="subtitle" style={{ marginTop: 8, fontSize: 15 }}>
          {archived
            ? "Soft-deleted applications. Restore any you removed by mistake."
            : "Move applicants through the hiring pipeline — from new lead to hired."}
        </p>
      </header>

      {/* Filter pills */}
      <div className="apps-filters">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            className={`apps-filter ${filter === f.id ? "active" : ""}`}
            onClick={() => setFilter(f.id)}>
            {f.id !== "ALL" ? (
              <span className="apps-filter-dot" style={{ background: STATUS[f.id as Status].dot }} />
            ) : null}
            {f.label}
            <span className="apps-filter-count">{counts[f.id] ?? 0}</span>
          </button>
        ))}
      </div>

      {/* Split */}
      <div className="apps-split">
        {/* List */}
        <div className="apps-list">
          {visible.length === 0 ? (
            <div className="apps-empty">
              <Briefcase size={28} />
              <p>
                No {filter === "ALL" ? "" : STATUS[filter].label.toLowerCase() + " "}applications.
              </p>
            </div>
          ) : (
            <>
              <label
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "6px 10px",
                  fontSize: 12.5,
                  fontWeight: 600,
                  color: "var(--slate-700)",
                  cursor: "pointer",
                }}>
                <input
                  type="checkbox"
                  checked={selection.allSelected}
                  ref={(el) => {
                    if (el) el.indeterminate = selection.someSelected;
                  }}
                  onChange={selection.toggleAll}
                />
                {selection.count > 0 ? `${selection.count} selected` : "Select all"}
              </label>
              {visible.map((a) => (
                <div
                  key={a.id}
                  role="button"
                  tabIndex={0}
                  className={`apps-card ${a.id === selId ? "active" : ""}${
                    selection.isSelected(a.id) ? " row-selected" : ""
                  }`}
                  onClick={() => { setSelId(a.id); setHireMsg(null); }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setSelId(a.id);
                      setHireMsg(null);
                    }
                  }}>
                  <input
                    type="checkbox"
                    checked={selection.isSelected(a.id)}
                    onClick={(e) => e.stopPropagation()}
                    onChange={() => selection.toggle(a.id)}
                    style={{ flexShrink: 0 }}
                  />
                  <Avatar name={a.name} size={42} />
                  <div className="apps-card-body">
                    <div className="apps-card-name">{a.name}</div>
                    <div className="apps-card-sub">
                      {[a.cityArea, a.source].filter(Boolean).join(" · ") || "—"}
                    </div>
                  </div>
                  <StatusPill status={a.status} sm />
                </div>
              ))}
            </>
          )}
        </div>

        {/* Detail */}
        {!sel ? (
          <div className="apps-detail apps-detail-empty">
            <Briefcase size={32} />
            <p>Select an applicant to view details.</p>
          </div>
        ) : (
          <div className="apps-detail">
            <div className="apps-detail-head">
              <Avatar name={sel.name} size={56} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <h2 className="apps-detail-name">{sel.name}</h2>
                <div className="apps-detail-contact">
                  <a className="apps-contact-link" href={`mailto:${sel.email}`}>
                    <Mail size={14} /> {sel.email}
                  </a>
                  {sel.phone ? (
                    <a className="apps-contact-link" href={`tel:${sel.phone}`}>
                      <Phone size={14} /> {sel.phone}
                    </a>
                  ) : null}
                </div>
              </div>
              <StatusPill status={sel.status} />
            </div>

            <div className="apps-rows">
              <Row icon={<Cake size={15} />} k="Date of birth" v={sel.dateOfBirth} />
              <Row icon={<Users size={15} />} k="Gender" v={sel.gender} />
              <Row icon={<MapPin size={15} />} k="Address" v={sel.address || null} />
              <Row
                icon={<Car size={15} />}
                k="Vehicle"
                v={
                  sel.hasTransport == null
                    ? null
                    : sel.hasTransport
                    ? "Has own vehicle"
                    : "No vehicle"
                }
              />
              <Row icon={<BadgeCheck size={15} />} k="Driver's licence" v={sel.driversLicense} />
              <Row icon={<ShieldCheck size={15} />} k="Liability insurance" v={yn(sel.hasInsurance)} />
              <Row icon={<ShieldCheck size={15} />} k="Insurance details" v={sel.insuranceDetails} />
              <Row icon={<Clock size={15} />} k="Availability" v={sel.availability} />
              <Row icon={<Calendar size={15} />} k="Earliest start" v={sel.earliestStart} />
              <Row icon={<Briefcase size={15} />} k="Years experience" v={sel.yearsExperience} />
              <Row
                icon={<Briefcase size={15} />}
                k="Experience type"
                v={sel.experienceTypes.length ? sel.experienceTypes.join(", ") : null}
              />
              <Row icon={<Briefcase size={15} />} k="Experience" v={sel.experience} />
              <Row icon={<Heart size={15} />} k="Why Cleano" v={sel.whyCleano} />
              <Row
                icon={<ShieldCheck size={15} />}
                k="Criminal conviction"
                v={
                  sel.hasConviction == null
                    ? null
                    : sel.hasConviction
                    ? `Yes${sel.convictionDetails ? ` — ${sel.convictionDetails}` : ""}`
                    : "No"
                }
              />
              <Row icon={<HelpCircle size={15} />} k="Heard via" v={sel.hearAbout} />
              <Row icon={<Users size={15} />} k="Referrer" v={sel.referrerName} />
              {sel.references.map((r, i) => (
                <Row key={i} icon={<Users size={15} />} k={`Reference ${i + 1}`} v={r} />
              ))}
              <Row
                icon={<ShieldCheck size={15} />}
                k="Background consent"
                v={
                  sel.backgroundConsent
                    ? `Yes${sel.consentDate ? ` (${sel.consentDate})` : ""}`
                    : "No"
                }
              />
              <Row icon={<Sparkles size={15} />} k="Source" v={sel.source} />
            </div>

            {sel.resumeUrl ? (
              <a
                href={sel.resumeUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="btn btn-secondary btn-sm apps-resume"
                style={{ textDecoration: "none", width: "fit-content" }}>
                <FileText size={14} /> View résumé (PDF)
              </a>
            ) : (
              <button className="btn btn-secondary btn-sm apps-resume" disabled>
                <FileText size={14} /> No résumé on file
              </button>
            )}

            {/* Hire → provision cleaner account */}
            <div className="apps-section-label">Onboarding</div>
            <button
              className="btn btn-primary btn-sm"
              disabled={hiring}
              onClick={hire}>
              <UserPlus size={14} />
              {sel.status === "HIRED" ? "Re-provision cleaner account" : "Hire & create cleaner account"}
            </button>
            {hireMsg ? (
              <div
                style={{
                  marginTop: 10,
                  padding: "10px 14px",
                  borderRadius: 10,
                  fontSize: 13,
                  background:
                    hireMsg.kind === "error" ? "#fee2e2" : "rgba(0,140,156,0.08)",
                  color: hireMsg.kind === "error" ? "#dc2626" : "var(--primary)",
                }}>
                {hireMsg.kind === "password" ? (
                  <>
                    Account created. Share this temporary password with the cleaner —
                    they sign in at <strong>/cleanos/login</strong>:
                    <div
                      style={{
                        marginTop: 6,
                        fontFamily: "var(--font-mono)",
                        fontSize: 15,
                        fontWeight: 700,
                        letterSpacing: "0.04em",
                        userSelect: "all",
                      }}>
                      {hireMsg.value}
                    </div>
                  </>
                ) : (
                  hireMsg.value
                )}
              </div>
            ) : null}

            {/* Status workflow */}
            <div className="apps-section-label" style={{ marginTop: 18 }}>Move to stage</div>
            <div className="apps-status-grid">
              {ORDER.map((s) => {
                const m = STATUS[s];
                const on = sel.status === s;
                return (
                  <button
                    key={s}
                    className={`apps-status-btn ${on ? "on" : ""}`}
                    disabled={savingId === sel.id}
                    onClick={() => setStatus(s)}
                    style={on ? { background: m.bg, color: m.fg, borderColor: m.dot } : undefined}>
                    <span className="apps-filter-dot" style={{ background: m.dot }} />
                    {m.label}
                  </button>
                );
              })}
            </div>

            {/* Notes */}
            <div className="apps-section-label">Admin notes</div>
            <textarea
              className="textarea"
              rows={4}
              placeholder="Add a private note about this applicant…"
              value={draftVal}
              onChange={(e) => setNotesDraft((d) => ({ ...d, [sel.id]: e.target.value }))}
            />
            <div className="apps-notes-foot">
              {savedFlash ? (
                <span className="apps-saved">
                  <Check size={14} /> Saved
                </span>
              ) : (
                <span />
              )}
              <button
                className="btn btn-primary btn-sm"
                disabled={!dirty || savingId === sel.id}
                onClick={saveNotes}>
                {savingId === sel.id ? "Saving…" : "Save notes"}
              </button>
            </div>
          </div>
        )}
      </div>

      <BulkActionBar
        noun="application"
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
