"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AlertCircle, Sparkles, CheckCircle2, Check, Clock, X } from "lucide-react";
import type { DuplicateGroup, ContactListItem } from "@/lib/crm-meta";
import { MATCH_LABELS, MERGE_FIELDS, LIFECYCLE_META, money, dateStr, relativeTime } from "@/lib/crm-meta";
import { Avatar } from "../_components";
import { mergeContacts, dismissDuplicateGroup } from "../../actions/contactActions";

const scoreClass = (s: number) => (s >= 90 ? "high" : s >= 75 ? "med" : "low");

function fieldValue(c: ContactListItem, k: string): string {
  switch (k) {
    case "name": return c.name;
    case "email": return c.email || "—";
    case "phone": return c.phone || "—";
    case "address": return c.address || "—";
    case "lifecycle": return LIFECYCLE_META[c.lifecycle].label;
    case "source": return c.source || "—";
    case "owner": return c.ownerName || "Unassigned";
    case "leadScore": return c.leadScore != null ? String(c.leadScore) : "—";
    case "bookings": return String(c.bookings);
    case "ltv": return c.lifetimeValue ? money(c.lifetimeValue) : "—";
    case "created": return dateStr(c.createdAt, { year: true });
    default: return "—";
  }
}

export default function DuplicatesView({ groups }: { groups: DuplicateGroup[] }) {
  const searchParams = useSearchParams();
  const focus = searchParams.get("focus");
  const focusGroup = focus ? groups.find((g) => g.members.some((m) => m.id === focus)) ?? null : null;
  const [active, setActive] = useState<DuplicateGroup | null>(focusGroup);

  const totalRecords = groups.reduce((s, g) => s + g.members.length, 0);

  return (
    <div className="admin-font">
      <header className="row-between" style={{ marginBottom: 32, alignItems: "flex-end", flexWrap: "wrap", gap: 16 }}>
        <div className="stack-8" style={{ minWidth: 0 }}>
          <p className="eyebrow">CRM · Data hygiene</p>
          <h1 className="display" style={{ fontSize: "clamp(34px, 4.2vw, 48px)" }}>
            Manage duplicates <span style={{ color: "var(--primary-40)", fontWeight: 300 }}>· {groups.length}</span>
          </h1>
        </div>
      </header>

      <div className="astat-grid" style={{ marginBottom: 28, gridTemplateColumns: "repeat(3, minmax(0,1fr))" }}>
        <Stat icon={AlertCircle} label="Duplicate groups" value={groups.length} hint="awaiting review" />
        <Stat icon={Sparkles} label="Records involved" value={totalRecords} hint="across all groups" />
        <Stat icon={CheckCircle2} label="Remain after merge" value={groups.length} hint="one master per group" />
      </div>

      {groups.length === 0 ? (
        <div className="dcard" style={{ padding: 64, textAlign: "center" }}>
          <div style={{ width: 56, height: 56, margin: "0 auto 16px", borderRadius: 16, background: "var(--emerald-50)", color: "var(--emerald-600)", display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
            <CheckCircle2 size={28} />
          </div>
          <h3 className="title-sm" style={{ marginBottom: 6 }}>All clear</h3>
          <p className="subtitle" style={{ fontSize: 14, margin: 0 }}>No duplicate groups left to review. New matches surface here automatically.</p>
        </div>
      ) : (
        <div className="stack-16">
          {groups.map((g) => <GroupCard key={g.id} group={g} onMerge={() => setActive(g)} />)}
        </div>
      )}

      {active ? <MergeComparator group={active} onClose={() => setActive(null)} /> : null}
    </div>
  );
}

function Stat({ icon: Icon, label, value, hint }: { icon: typeof AlertCircle; label: string; value: number; hint: string }) {
  return (
    <div className="astat">
      <div className="astat-head"><span>{label}</span><span className="astat-icon"><Icon size={16} /></span></div>
      <div className="astat-value">{value}</div>
      <div className="astat-delta">{hint}</div>
    </div>
  );
}

function GroupCard({ group, onMerge }: { group: DuplicateGroup; onMerge: () => void }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  function dismiss() {
    startTransition(async () => {
      const res = await dismissDuplicateGroup(group.members.map((m) => m.id));
      if ("error" in res) { alert(res.error); return; }
      router.refresh();
    });
  }
  return (
    <div className="dgroup">
      <div className="dgroup-head">
        <div className="dgroup-matched">
          <span className={`match-score ${scoreClass(group.score)}`}><AlertCircle size={13} /> {group.score}% match</span>
          <span className="mlabel">matched on</span>
          {group.matched.map((m) => (
            <span key={m} className="tagchip" style={{ background: "rgba(217,119,6,0.10)", color: "var(--amber-800)" }}>{MATCH_LABELS[m] || m}</span>
          ))}
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn btn-secondary btn-sm" disabled={pending} onClick={dismiss}>Not duplicates</button>
          <button className="btn btn-primary btn-sm" onClick={onMerge}>Review &amp; merge →</button>
        </div>
      </div>
      <div className="dgroup-members">
        {group.members.map((c) => {
          const isMaster = group.suggestedMasterId === c.id;
          return (
            <div key={c.id} className={`dmember ${isMaster ? "is-master" : ""}`} onClick={() => router.push(`/admin/contacts/${c.id}`)} style={{ cursor: "pointer" }}>
              <Avatar name={c.name} color={isMaster ? "var(--primary)" : "var(--primary-light)"} size={34} />
              <div style={{ minWidth: 0 }}>
                <div className="dmember-name">{c.name}</div>
                <div className="dmember-sub">{c.email || "—"}</div>
                <div className="dmember-sub">{c.phone || "—"} · {c.source || "—"}</div>
                <div className="dmember-badge">{isMaster ? "★ Suggested master" : `created ${dateStr(c.createdAt)}`}</div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function MergeComparator({ group, onClose }: { group: DuplicateGroup; onClose: () => void }) {
  const router = useRouter();
  const members = group.members;
  const [masterId, setMasterId] = useState(group.suggestedMasterId);
  const seed = useMemo(() => {
    const o: Record<string, string> = {};
    MERGE_FIELDS.forEach((f) => { o[f.k] = group.suggestedMasterId; });
    return o;
  }, [group.suggestedMasterId]);
  const [choices, setChoices] = useState<Record<string, string>>(seed);
  const [pending, startTransition] = useTransition();

  const newestId = useMemo(
    () => [...members].sort((a, b) => +new Date(b.lastActivityAt) - +new Date(a.lastActivityAt))[0].id,
    [members]
  );
  const byId = useMemo(() => new Map(members.map((m) => [m.id, m])), [members]);

  const pick = (fk: string, id: string) => setChoices((p) => ({ ...p, [fk]: id }));
  const useNewest = () => { const o: Record<string, string> = {}; MERGE_FIELDS.forEach((f) => (o[f.k] = newestId)); setChoices(o); };
  const useMaster = () => { const o: Record<string, string> = {}; MERGE_FIELDS.forEach((f) => (o[f.k] = masterId)); setChoices(o); };

  const fieldConflict = (k: string) => new Set(members.map((m) => fieldValue(m, k))).size > 1;
  const resName = byId.get(choices.name ?? masterId)?.name;
  const resEmail = byId.get(choices.email ?? masterId)?.email || "—";
  const resPhone = byId.get(choices.phone ?? masterId)?.phone || "—";

  function doMerge() {
    startTransition(async () => {
      const mergeable = Object.fromEntries(MERGE_FIELDS.filter((f) => f.mergeable).map((f) => [f.k, choices[f.k] ?? masterId]));
      const res = await mergeContacts(masterId, members.map((m) => m.id), mergeable);
      if ("error" in res) { alert(res.error); return; }
      onClose();
      router.refresh();
    });
  }

  const cols = `170px repeat(${members.length}, minmax(0, 1fr))`;

  return (
    <div className="crm-overlay" onClick={onClose}>
      <div className="crm-modal" style={{ width: Math.min(980, 320 + members.length * 240) }} onClick={(e) => e.stopPropagation()}>
        <div className="crm-modal-head">
          <div>
            <h2 className="crm-modal-title">Merge duplicate contacts</h2>
            <p className="crm-modal-sub">Pick the winning value for each field. Unselected records are archived to the audit log.</p>
          </div>
          <button className="dup-dismiss" aria-label="Close" onClick={onClose}><X size={18} /></button>
        </div>

        <div className="crm-modal-body">
          <div className="merge-toolbar">
            <button className="cview-chip" onClick={useNewest}><Clock size={13} /> Use newest values</button>
            <button className="cview-chip" onClick={useMaster}><Sparkles size={13} /> Use master&apos;s values</button>
            <div style={{ flex: 1 }} />
            <span style={{ fontSize: 12, color: "var(--primary-60)" }}>{members.length - 1} record{members.length > 2 ? "s" : ""} will be archived</span>
          </div>

          {/* Merge table scrolls horizontally on phones instead of squeezing columns */}
          <div style={{ overflowX: "auto" }}>
          <div className="merge-grid" style={{ minWidth: 170 + members.length * 190 }}>
            <div className="merge-row" style={{ gridTemplateColumns: cols }}>
              <div className="merge-corner"><span className="merge-corner-label">Field</span></div>
              {members.map((c) => {
                const isMaster = masterId === c.id;
                return (
                  <div className="merge-col-head" key={c.id} style={{ background: isMaster ? "var(--primary-5)" : "#fff" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 9, minWidth: 0 }}>
                      <Avatar name={c.name} color={isMaster ? "var(--primary)" : "var(--primary-light)"} size={30} />
                      <div style={{ minWidth: 0 }}>
                        <div className="dmember-name" style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{c.name}</div>
                        <div className="dmember-sub">{relativeTime(c.lastActivityAt)}</div>
                      </div>
                    </div>
                    <button className={`merge-master-btn ${isMaster ? "on" : ""}`} onClick={() => setMasterId(c.id)}>
                      {isMaster ? <Check size={12} /> : null}{isMaster ? "Master record" : "Make master"}
                    </button>
                  </div>
                );
              })}
            </div>

            {MERGE_FIELDS.map((f) => {
              const conflict = fieldConflict(f.k);
              return (
                <div className="merge-row" key={f.k} style={{ gridTemplateColumns: cols }}>
                  <div className={`merge-flabel ${conflict ? "conflict" : ""}`}>
                    {conflict ? <AlertCircle size={12} /> : null}{f.label}
                  </div>
                  {members.map((c) => {
                    const chosen = (choices[f.k] ?? masterId) === c.id;
                    const selectable = f.mergeable;
                    return (
                      <div className="merge-cell" key={c.id}>
                        <button
                          className={`merge-pick ${chosen ? "chosen" : ""} ${conflict ? "conflict" : ""} ${selectable ? "" : "static"}`}
                          onClick={() => selectable && pick(f.k, c.id)}
                          disabled={!selectable}
                        >
                          {selectable ? <span className="merge-radio" /> : null}
                          <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{fieldValue(c, f.k)}</span>
                        </button>
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
          </div>

          <div className="merge-preview">
            <span className="mp-icon"><CheckCircle2 size={18} /></span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="merge-preview-label">Resulting master record</div>
              <div className="merge-preview-val"><strong>{resName}</strong> · {resEmail} · {resPhone}</div>
            </div>
          </div>
        </div>

        <div className="crm-modal-foot">
          <button className="btn btn-secondary btn-sm" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary btn-sm" disabled={pending} onClick={doMerge}>Merge {members.length} records</button>
        </div>
      </div>
    </div>
  );
}
