"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Search, Plus, Pencil, Mail, Phone, CalendarClock, Check, User, X, Lock,
  AlertCircle, ChevronUp, ChevronDown, Sparkles,
} from "lucide-react";
import type { PropertyDef } from "@/lib/prop-engine-meta";
import { OBJECT_TYPES, FIELD_TYPES, GROUPS, HAS_OPTIONS, fieldTypeLabel, toInternal } from "@/lib/prop-engine-meta";
import {
  createPropertyDefinition, updatePropertyDefinition, deletePropertyDefinition,
} from "../actions/propertyActions";

const TEXT_GLYPH: Record<string, string> = { text: "Aa", textarea: "¶", number: "#", dropdown: "▾", multi: "≣" };

function FTGlyph({ type, size = 30 }: { type: string; size?: number }) {
  const icon =
    type === "email" ? <Mail size={15} /> :
    type === "phone" ? <Phone size={15} /> :
    type === "date" ? <CalendarClock size={15} /> :
    type === "checkbox" ? <Check size={15} /> :
    type === "user" ? <User size={15} /> : null;
  return <span className="ft-badge" style={{ width: size, height: size }}>{icon ?? TEXT_GLYPH[type] ?? "?"}</span>;
}

export default function PropertyEngineView({ properties }: { properties: PropertyDef[] }) {
  const [object, setObject] = useState("contact");
  const [group, setGroup] = useState("all");
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<PropertyDef | null>(null);
  const [creating, setCreating] = useState(false);

  const forObject = useMemo(() => properties.filter((p) => p.objectType === object), [properties, object]);
  const counts = useMemo(() => {
    const byGroup: Record<string, number> = {};
    GROUPS.forEach((g) => { byGroup[g] = forObject.filter((p) => p.groupName === g).length; });
    return { total: forObject.length, byGroup };
  }, [forObject]);
  const objectCount = (id: string) => properties.filter((p) => p.objectType === id).length;

  let list = forObject;
  if (group !== "all") list = list.filter((p) => p.groupName === group);
  if (search.trim()) {
    const q = search.toLowerCase();
    list = list.filter((p) => p.label.toLowerCase().includes(q) || p.internalName.includes(q));
  }
  const groupsToShow = group === "all" ? GROUPS : [group];

  return (
    <div className="admin-font">
      <header className="row-between" style={{ marginBottom: 28, alignItems: "flex-end", flexWrap: "wrap", gap: 16 }}>
        <div className="stack-8" style={{ minWidth: 0 }}>
          <p className="eyebrow">Settings · Data model</p>
          <h1 className="display" style={{ fontSize: "clamp(32px, 4vw, 46px)", whiteSpace: "nowrap" }}>Property engine</h1>
        </div>
        <button className="btn btn-primary" onClick={() => setCreating(true)}><Plus size={15} /> New property</button>
      </header>

      <div className="pengine">
        <aside className="pengine-menu">
          <div className="pengine-obj">
            <div className="pengine-obj-label">Object</div>
            {OBJECT_TYPES.map((o) => (
              <button key={o.id} className={`pmenu-item ${object === o.id ? "active" : ""}`} onClick={() => { setObject(o.id); setGroup("all"); }}>
                <Sparkles size={15} /> {o.label}
                <span className="pmenu-count">{objectCount(o.id)}</span>
              </button>
            ))}
          </div>
          <div className="pengine-obj" style={{ borderTop: "1px solid var(--primary-10)" }}>
            <div className="pengine-obj-label">Groups</div>
            <button className={`pmenu-item ${group === "all" ? "active" : ""}`} onClick={() => setGroup("all")}>
              All properties <span className="pmenu-count">{counts.total}</span>
            </button>
            {GROUPS.filter((g) => counts.byGroup[g] > 0).map((g) => (
              <button key={g} className={`pmenu-item ${group === g ? "active" : ""}`} onClick={() => setGroup(g)}>
                {g} <span className="pmenu-count">{counts.byGroup[g]}</span>
              </button>
            ))}
          </div>
        </aside>

        <div style={{ minWidth: 0 }}>
          <div className="atoolbar" style={{ marginBottom: 18 }}>
            <div className="atoolbar-search">
              <span className="atoolbar-search-icon"><Search size={16} /></span>
              <input className="input" type="search" placeholder="Search properties…" value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
            <div style={{ flex: 1 }} />
            <span style={{ fontSize: 13, color: "var(--primary-60)" }}>{list.length} propert{list.length === 1 ? "y" : "ies"}</span>
          </div>

          {list.length === 0 ? (
            <div className="atable-wrap" style={{ padding: "60px 40px", textAlign: "center", color: "var(--primary-60)" }}>No properties match.</div>
          ) : (
            groupsToShow.map((g) => {
              const rows = list.filter((p) => p.groupName === g);
              if (!rows.length) return null;
              return (
                <div className="pgroup" key={g}>
                  <div className="pgroup-head"><h3>{g}</h3><span className="pgroup-count">{rows.length}</span></div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {rows.map((p) => <PropertyRow key={p.id} p={p} onEdit={() => setEditing(p)} />)}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {editing ? <EditorModal prop={editing} object={object} onClose={() => setEditing(null)} /> : null}
      {creating ? <EditorModal prop={null} object={object} onClose={() => setCreating(false)} /> : null}
    </div>
  );
}

function PropertyRow({ p, onEdit }: { p: PropertyDef; onEdit: () => void }) {
  return (
    <div className="pdef-row" onClick={onEdit}>
      <FTGlyph type={p.fieldType} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span style={{ fontSize: 14, fontWeight: 600, color: "var(--ink)" }}>{p.label}</span>
          {p.isSystem ? <span className="lock-badge"><Lock size={11} /> System</span> : null}
          {p.isRequired ? <span className="tagchip" style={{ background: "rgba(220,38,38,0.08)", color: "#b91c1c" }}>Required</span> : null}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 3, flexWrap: "wrap" }}>
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 11.5, color: "var(--primary-60)" }}>{p.internalName}</span>
          <span style={{ color: "var(--primary-30)" }}>·</span>
          <span style={{ fontSize: 12, color: "var(--primary-60)" }}>{fieldTypeLabel(p.fieldType)}</span>
          {p.options.length ? <span style={{ fontSize: 11.5, color: "var(--primary-50)" }}>· {p.options.length} options</span> : null}
        </div>
      </div>
      <span style={{ fontSize: 11.5, color: "var(--primary-50)", whiteSpace: "nowrap" }}>{p.visibility === "admin" ? "Admins only" : "Everyone"}</span>
      <button className="icon-btn" style={{ width: 30, height: 30 }} onClick={(e) => { e.stopPropagation(); onEdit(); }}><Pencil size={13} /></button>
    </div>
  );
}

function OptionManager({ options, onChange }: { options: string[]; onChange: (o: string[]) => void }) {
  const move = (i: number, dir: number) => {
    const j = i + dir;
    if (j < 0 || j >= options.length) return;
    const next = [...options];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };
  return (
    <div>
      {options.map((opt, i) => (
        <div className="opt-row" key={i}>
          <input value={opt} onChange={(e) => { const n = [...options]; n[i] = e.target.value; onChange(n); }} placeholder={`Option ${i + 1}`} />
          <button className="opt-btn" onClick={() => move(i, -1)} title="Move up"><ChevronUp size={14} /></button>
          <button className="opt-btn" onClick={() => move(i, 1)} title="Move down"><ChevronDown size={14} /></button>
          <button className="opt-btn" onClick={() => onChange(options.filter((_, k) => k !== i))} title="Remove"><X size={14} /></button>
        </div>
      ))}
      <button className="btn btn-secondary btn-sm" onClick={() => onChange([...options, ""])} style={{ marginTop: 2 }}>
        <Plus size={13} /> Add option
      </button>
    </div>
  );
}

function ACheck({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint: string }) {
  return (
    <button className={`acheck ${checked ? "on" : ""}`} onClick={() => onChange(!checked)}>
      <span className="acheck-box">{checked ? <Check size={12} /> : null}</span>
      <span>
        <span>{label}</span>
        <span style={{ display: "block", fontSize: 11.5, color: "var(--primary-60)", fontWeight: 400 }}>{hint}</span>
      </span>
    </button>
  );
}

function EditorModal({ prop, object, onClose }: { prop: PropertyDef | null; object: string; onClose: () => void }) {
  const router = useRouter();
  const isNew = !prop;
  const system = !!prop?.isSystem;
  const [label, setLabel] = useState(prop?.label ?? "");
  const [obj, setObj] = useState(prop?.objectType ?? object);
  const [type, setType] = useState(prop?.fieldType ?? "text");
  const [options, setOptions] = useState<string[]>(prop ? [...prop.options] : []);
  const [required, setRequired] = useState(prop?.isRequired ?? false);
  const [unique, setUnique] = useState(prop?.isUnique ?? false);
  const [visibility, setVisibility] = useState(prop?.visibility ?? "everyone");
  const [pending, startTransition] = useTransition();

  const internal = isNew ? toInternal(label) : prop!.internalName;
  const hasOptions = HAS_OPTIONS.has(type);

  function save() {
    if (!label.trim()) return;
    const input = {
      label, objectType: obj, groupName: prop?.groupName ?? "Contact info",
      fieldType: type, options: hasOptions ? options : [], isRequired: required, isUnique: unique, visibility,
    };
    startTransition(async () => {
      const res = isNew ? await createPropertyDefinition(input) : await updatePropertyDefinition(prop!.id, input);
      if ("error" in res) { alert(res.error); return; }
      onClose();
      router.refresh();
    });
  }

  function del() {
    if (!prop || !confirm(`Delete the "${label}" property? Existing values are archived.`)) return;
    startTransition(async () => {
      const res = await deletePropertyDefinition(prop.id);
      if ("error" in res) { alert(res.error); return; }
      onClose();
      router.refresh();
    });
  }

  return (
    <div className="crm-overlay" onClick={onClose}>
      <div className="crm-modal" style={{ width: 640 }} onClick={(e) => e.stopPropagation()}>
        <div className="crm-modal-head">
          <div>
            <h2 className="crm-modal-title">{isNew ? "Create property" : `Edit · ${prop!.label}`}</h2>
            <p className="crm-modal-sub">{system ? "System field — core attributes are locked." : "Define how this field is captured and who can see it."}</p>
          </div>
          <button className="dup-dismiss" aria-label="Close" onClick={onClose}><X size={18} /></button>
        </div>

        <div className="crm-modal-body">
          {system ? (
            <div className="dup-banner" style={{ marginBottom: 18, background: "var(--primary-5)", borderColor: "var(--primary-15)" }}>
              <span className="dup-icon" style={{ color: "var(--primary)" }}><AlertCircle size={18} /></span>
              <div className="dup-text">
                <div className="dup-title" style={{ color: "var(--ink)" }}>This is a system property</div>
                <div className="dup-sub" style={{ color: "var(--primary-60)" }}>Label and options stay editable, but its type, internal name and presence are locked.</div>
              </div>
            </div>
          ) : null}

          <div className="ed-grid">
            <div className="field full">
              <label className="label">Label</label>
              <input className="input" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Gate code" autoFocus={isNew} />
            </div>
            <div className="field full">
              <label className="label">Internal name</label>
              <div className="ed-internal">
                <span>{internal || "auto_generated"}</span>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11 }}>{!isNew ? <><Lock size={11} /> locked</> : "auto"}</span>
              </div>
            </div>
            <div className="field">
              <label className="label">Object type</label>
              <select className="aselect" value={obj} onChange={(e) => setObj(e.target.value)} disabled={!isNew}>
                {OBJECT_TYPES.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
              </select>
            </div>
            <div className="field">
              <label className="label">Access</label>
              <select className="aselect" value={visibility} onChange={(e) => setVisibility(e.target.value)}>
                <option value="everyone">Everyone</option>
                <option value="admin">Admins only</option>
              </select>
            </div>
          </div>

          <div style={{ marginTop: 16 }}>
            <div className="label" style={{ marginBottom: 8 }}>Field type</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              {FIELD_TYPES.map((ft) => (
                <button
                  key={ft.id}
                  className={`ftype-pick ${type === ft.id ? "on" : ""}`}
                  onClick={() => !system && setType(ft.id)}
                  disabled={system}
                  style={system ? { opacity: type === ft.id ? 1 : 0.4, cursor: "not-allowed" } : {}}
                >
                  <FTGlyph type={ft.id} size={26} />{ft.label}
                </button>
              ))}
            </div>
          </div>

          {hasOptions ? (
            <div style={{ marginTop: 18 }}>
              <div className="label" style={{ marginBottom: 8 }}>Options <span style={{ color: "var(--primary-50)", fontWeight: 400 }}>· reorder with arrows</span></div>
              <OptionManager options={options} onChange={setOptions} />
            </div>
          ) : null}

          <div style={{ marginTop: 18, borderTop: "1px solid var(--primary-10)", paddingTop: 8 }}>
            <div className="label" style={{ marginBottom: 4 }}>Validation</div>
            <ACheck checked={required} onChange={setRequired} label="Required" hint="Must be filled before the record can be saved" />
            <ACheck checked={unique} onChange={setUnique} label="Unique" hint="No two records can share this value (powers duplicate detection)" />
          </div>
        </div>

        <div className="crm-modal-foot">
          {!isNew && !system ? (
            <button className="btn btn-danger-ghost btn-sm" style={{ marginRight: "auto" }} disabled={pending} onClick={del}>Delete property</button>
          ) : null}
          <button className="btn btn-secondary btn-sm" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary btn-sm" onClick={save} disabled={!label.trim() || pending}>{isNew ? "Create property" : "Save changes"}</button>
        </div>
      </div>
    </div>
  );
}
