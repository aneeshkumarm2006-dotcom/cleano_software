"use client";

/**
 * The **Form** tab on `/admin/quotes` — item 18's "modular" ask.
 *
 * It lives here rather than under Settings deliberately (Q6 §C): the client
 * went looking for the quote page from the Quotes screen, and found an inbox
 * with no editor. The Booking Page equivalent sits in Settings because that is
 * where he found *that* one.
 *
 * Scope (decision D7): page copy, plus per-field label / help text / order /
 * show-hide / required, plus per-service visibility. No custom field types and
 * no form builder — every key maps to a real `QuoteRequest` column.
 *
 * The preview on the right mounts the SAME component `/quote` renders, so it
 * cannot drift from the page it claims to preview.
 */

import { useMemo, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  ExternalLink,
  Eye,
  EyeOff,
  FileText,
  Lock,
  RotateCcw,
  Type,
} from "lucide-react";
import Button from "@/components/ui/Button";
import { SectionCard, Feedback, Msg, themedInputClass } from "../settings/tabs/_shared";
import { saveQuotePageConfig } from "../actions/saveQuotePageConfig";
import QuoteForm from "@/components/quote/QuoteForm";
import {
  LOCKED_QUOTE_FIELD_REASON,
  QUOTE_PAGE_DEFAULTS,
  isLockedQuoteField,
  normalizeQuotePageConfig,
  resolveQuoteFields,
  type QuoteFieldConfig,
  type QuoteFieldKey,
  type QuoteFieldOverride,
  type QuotePageConfig,
  type QuotePageCopy,
} from "@/lib/quote-page-config";

/** "" = editing the base config that applies to every service. */
const ALL_SERVICES = "";

interface Props {
  initialConfig: QuotePageConfig;
  /** Active services from the catalog — value = canonical category key. */
  services: { value: string; label: string }[];
  brandName: string;
  /** Public URL for the "View public page" link (respects the custom domain). */
  publicUrl: string;
}

const COPY_FIELDS: {
  key: keyof QuotePageCopy;
  label: string;
  hint?: string;
  multiline?: boolean;
}[] = [
  {
    key: "eyebrow",
    label: "Eyebrow",
    hint: "Small line above the title. Leave blank to show your business name.",
  },
  { key: "title", label: "Page title" },
  { key: "subhead", label: "Intro paragraph", multiline: true },
  { key: "submitLabel", label: "Submit button" },
  { key: "successTitle", label: "Thank-you headline" },
  { key: "successBody", label: "Thank-you message", multiline: true },
];

export default function QuoteFormTab({
  initialConfig,
  services,
  brandName,
  publicUrl,
}: Props) {
  const [cfg, setCfg] = useState<QuotePageConfig>(() =>
    normalizeQuotePageConfig(initialConfig)
  );
  const [service, setService] = useState<string>(ALL_SERVICES);
  const [showSuccess, setShowSuccess] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);

  const scope = service || undefined;
  const fields = useMemo(() => resolveQuoteFields(cfg, scope), [cfg, scope]);

  /* ------------------------------- mutations ------------------------------ */

  function patchCopy(key: keyof QuotePageCopy, v: string) {
    setMsg(null);
    setCfg((c) => ({ ...c, copy: { ...c.copy, [key]: v } }));
  }

  /** Write a patch to the base config, or to this service's override map. */
  function patchField(fieldKey: QuoteFieldKey, patch: QuoteFieldOverride) {
    setMsg(null);
    setCfg((c) => {
      if (!service) {
        return {
          ...c,
          fields: c.fields.map((f) =>
            f.key === fieldKey ? { ...f, ...patch } : f
          ),
        };
      }
      const row = { ...(c.overrides[service] ?? {}) };
      row[fieldKey] = { ...(row[fieldKey] ?? {}), ...patch };
      return { ...c, overrides: { ...c.overrides, [service]: row } };
    });
  }

  /** Drop this service's override for one field, so it inherits the base again. */
  function clearOverride(fieldKey: QuoteFieldKey) {
    if (!service) return;
    setMsg(null);
    setCfg((c) => {
      const row = { ...(c.overrides[service] ?? {}) };
      delete row[fieldKey];
      return { ...c, overrides: { ...c.overrides, [service]: row } };
    });
  }

  function hasOverride(fieldKey: QuoteFieldKey): boolean {
    if (!service) return false;
    return !!cfg.overrides[service]?.[fieldKey];
  }

  /**
   * Swap a field with its neighbour in the CURRENT ordering. Orders are written
   * rather than swapped in an array, because ordering can itself be a
   * per-service override.
   */
  function move(fieldKey: QuoteFieldKey, dir: -1 | 1) {
    const i = fields.findIndex((f) => f.key === fieldKey);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= fields.length) return;
    const a = fields[i];
    const b = fields[j];
    // Equal orders would leave the swap a no-op (the tiebreak is by key), so
    // fall back to index positions when the two share an order value.
    const aOrder = a.order === b.order ? j : b.order;
    const bOrder = a.order === b.order ? i : a.order;
    patchField(a.key, { order: aOrder });
    patchField(b.key, { order: bOrder });
  }

  async function handleSave() {
    setSaving(true);
    setMsg(null);
    const res = await saveQuotePageConfig(cfg);
    setMsg(
      res.success
        ? { type: "success", text: "Quote page saved. /quote updates immediately." }
        : { type: "error", text: res.error ?? "Failed to save." }
    );
    setSaving(false);
  }

  function handleResetAll() {
    setCfg(normalizeQuotePageConfig(QUOTE_PAGE_DEFAULTS));
    setMsg({
      type: "success",
      text: "Reverted to the shipped defaults — press Save to apply.",
    });
  }

  /* -------------------------------- render -------------------------------- */

  return (
    <div className="qform-tab">
      <div className="qform-editor">
        <SectionCard
          title="Page copy"
          icon={Type}
          description="Every word on the public quote page. Nothing here is in the code.">
          <div style={{ display: "grid", gap: 12 }}>
            {COPY_FIELDS.map((c) => (
              <div key={c.key}>
                <label
                  htmlFor={`qcopy-${c.key}`}
                  style={{
                    display: "block",
                    fontSize: 12.5,
                    fontWeight: 600,
                    color: "var(--primary-70)",
                    marginBottom: 5,
                  }}>
                  {c.label}
                </label>
                {c.multiline ? (
                  <textarea
                    id={`qcopy-${c.key}`}
                    className={themedInputClass}
                    rows={3}
                    value={cfg.copy[c.key]}
                    onChange={(e) => patchCopy(c.key, e.target.value)}
                  />
                ) : (
                  <input
                    id={`qcopy-${c.key}`}
                    className={themedInputClass}
                    value={cfg.copy[c.key]}
                    onChange={(e) => patchCopy(c.key, e.target.value)}
                    placeholder={c.key === "eyebrow" ? brandName : undefined}
                  />
                )}
                {c.hint && (
                  <p style={{ fontSize: 11.5, color: "var(--primary-50)", margin: "4px 0 0" }}>
                    {c.hint}
                  </p>
                )}
              </div>
            ))}
          </div>
        </SectionCard>

        <SectionCard
          title="Which service are you editing?"
          icon={Eye}
          description="“All services” sets the baseline. Pick a service to override just that one — e.g. hide Bedrooms for Commercial.">
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            <ScopeChip
              label="All services"
              active={service === ALL_SERVICES}
              onClick={() => setService(ALL_SERVICES)}
            />
            {services.map((s) => (
              <ScopeChip
                key={s.value}
                label={s.label}
                active={service === s.value}
                onClick={() => setService(s.value)}
              />
            ))}
          </div>
          <p style={{ fontSize: 12.5, color: "var(--primary-60)", marginTop: 12 }}>
            {service
              ? "Changes here apply when a visitor picks this service. Fields marked “Overridden” differ from the baseline — reset one to inherit it again."
              : "Changes here apply to every service that doesn’t override the field."}
          </p>
          {/* The services list itself is the service catalog — saying so here is
              what turns "stop offering a service" from a code request into a
              two-click edit the client already knows how to make. */}
          <p style={{ fontSize: 12.5, color: "var(--primary-60)", marginTop: 8 }}>
            The service dropdown on the quote page is your service catalog. To
            add, rename or stop offering a service, edit the{" "}
            <a className="link" href="/admin/settings">
              Job Types
            </a>{" "}
            tab in Settings — the quote form follows immediately.
          </p>
        </SectionCard>

        <SectionCard
          title="Form fields"
          icon={FileText}
          description="Show, hide, rename, reorder and require any of the ten quote fields.">
          <div style={{ display: "grid", gap: 12 }}>
            {fields.map((f, idx) => (
              <FieldRow
                key={f.key}
                field={f}
                locked={isLockedQuoteField(f.key)}
                overridden={hasOverride(f.key)}
                first={idx === 0}
                last={idx === fields.length - 1}
                onPatch={(p) => patchField(f.key, p)}
                onMove={(d) => move(f.key, d)}
                onReset={service ? () => clearOverride(f.key) : undefined}
              />
            ))}
          </div>
        </SectionCard>

        {msg && <Feedback msg={msg} />}

        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 12,
            flexWrap: "wrap",
          }}>
          <button
            type="button"
            onClick={handleResetAll}
            className="inline-flex items-center gap-1.5 text-sm text-[#008C9C] hover:underline">
            <RotateCcw className="w-4 h-4" />
            Reset everything to defaults
          </button>
          <Button
            type="button"
            variant="action"
            border={false}
            onClick={handleSave}
            disabled={saving}
            className="rounded-xl px-6 py-2.5">
            {saving ? "Saving..." : "Save quote page"}
          </Button>
        </div>
      </div>

      {/* ── Live preview ─────────────────────────────────────────────────── */}
      <aside className="qform-preview">
        <div className="qform-preview-head">
          <div>
            <span style={{ fontSize: 13, fontWeight: 600 }}>Preview</span>
            <p style={{ fontSize: 11.5, color: "var(--primary-60)", margin: "2px 0 0" }}>
              Unsaved edits included
            </p>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div className="atabs" style={{ padding: 3 }}>
              <button
                type="button"
                className={`atab ${!showSuccess ? "active" : ""}`}
                style={{ padding: "5px 10px", fontSize: 12 }}
                onClick={() => setShowSuccess(false)}>
                Form
              </button>
              <button
                type="button"
                className={`atab ${showSuccess ? "active" : ""}`}
                style={{ padding: "5px 10px", fontSize: 12 }}
                onClick={() => setShowSuccess(true)}>
                Thank-you
              </button>
            </div>
            <a
              className="btn btn-secondary btn-sm"
              href={publicUrl}
              target="_blank"
              rel="noopener noreferrer">
              Open <ExternalLink size={13} />
            </a>
          </div>
        </div>
        <div className="qform-preview-body">
          {/* Keyed on the scope so switching service resets the preview's own
              service choice to the one being edited. */}
          <QuoteForm
            key={`${service}-${showSuccess}`}
            config={
              service
                ? withPreviewService(cfg, service)
                : cfg
            }
            services={services}
            brandName={brandName}
            preview
            forceSuccess={showSuccess}
          />
        </div>
      </aside>

      <style>{`
        .qform-tab { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 460px); gap: 24px; align-items: start; }
        .qform-editor { display: flex; flex-direction: column; gap: 0; min-width: 0; }
        .qform-preview { position: sticky; top: 16px; background: #fff; border-radius: 18px; box-shadow: var(--shadow-soft); overflow: hidden; }
        .qform-preview-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; padding: 14px 18px; border-bottom: 1px solid var(--primary-10); }
        .qform-preview-body { padding: 20px; background: linear-gradient(180deg, #f7faf9 0%, #ffffff 100%); max-height: calc(100vh - 160px); overflow-y: auto; }
        @media (max-width: 1180px) { .qform-tab { grid-template-columns: 1fr; } .qform-preview { position: static; } }
      `}</style>
    </div>
  );
}

/**
 * The preview renders the real form, which reads per-service overrides off the
 * service the *visitor* picks. To show the admin what the service they are
 * editing looks like, that service's overrides are folded into the base for the
 * preview only — otherwise editing "Commercial" would show the baseline until
 * the admin also picked Commercial in the preview's own dropdown.
 */
function withPreviewService(cfg: QuotePageConfig, service: string): QuotePageConfig {
  const patches = cfg.overrides[service] ?? {};
  return {
    ...cfg,
    fields: cfg.fields.map((f) =>
      patches[f.key] ? { ...f, ...patches[f.key], key: f.key } : f
    ),
  };
}

/* -------------------------------- pieces --------------------------------- */

function ScopeChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      style={{
        padding: "8px 14px",
        borderRadius: 999,
        fontSize: 13,
        fontWeight: 500,
        cursor: "pointer",
        border: `1px solid ${active ? "transparent" : "rgba(0,140,156,0.25)"}`,
        background: active ? "#008C9C" : "rgba(0,140,156,0.05)",
        color: active ? "#fff" : "#008C9C",
      }}>
      {label}
    </button>
  );
}

function MoveButtons({
  first,
  last,
  onMove,
}: {
  first: boolean;
  last: boolean;
  onMove: (dir: -1 | 1) => void;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <button
        type="button"
        aria-label="Move up"
        disabled={first}
        onClick={() => onMove(-1)}
        style={moveBtnStyle(first)}>
        <ArrowUp className="w-3.5 h-3.5" />
      </button>
      <button
        type="button"
        aria-label="Move down"
        disabled={last}
        onClick={() => onMove(1)}
        style={moveBtnStyle(last)}>
        <ArrowDown className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

function moveBtnStyle(disabled: boolean): React.CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: 24,
    height: 20,
    borderRadius: 6,
    border: "1px solid rgba(0,140,156,0.2)",
    background: "#fff",
    color: "#008C9C",
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.35 : 1,
  };
}

function VisibilityToggle({
  visible,
  disabled,
  disabledReason,
  onToggle,
}: {
  visible: boolean;
  disabled?: boolean;
  disabledReason?: string;
  onToggle: () => void;
}) {
  const Icon = visible ? Eye : EyeOff;
  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={disabled}
      title={disabled ? disabledReason : visible ? "Hide this field" : "Show this field"}
      aria-pressed={visible}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "7px 12px",
        borderRadius: 10,
        fontSize: 12.5,
        fontWeight: 500,
        whiteSpace: "nowrap",
        border: "1px solid rgba(0,140,156,0.2)",
        background: visible ? "rgba(0,140,156,0.08)" : "#fff",
        color: visible ? "#008C9C" : "#94a3b8",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.6 : 1,
      }}>
      {disabled ? <Lock className="w-3.5 h-3.5" /> : <Icon className="w-3.5 h-3.5" />}
      {visible ? "Shown" : "Hidden"}
    </button>
  );
}

function FieldRow({
  field,
  locked,
  overridden,
  first,
  last,
  onPatch,
  onMove,
  onReset,
}: {
  field: QuoteFieldConfig;
  locked: boolean;
  overridden: boolean;
  first: boolean;
  last: boolean;
  onPatch: (patch: QuoteFieldOverride) => void;
  onMove: (dir: -1 | 1) => void;
  onReset?: () => void;
}) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "auto 1fr",
        gap: 12,
        alignItems: "start",
        padding: "14px 16px",
        borderRadius: 12,
        background: "rgba(0,140,156,0.04)",
        opacity: field.visible ? 1 : 0.62,
      }}>
      <MoveButtons first={first} last={last} onMove={onMove} />

      <div style={{ display: "grid", gap: 8, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <code
            style={{
              fontSize: 11,
              padding: "2px 7px",
              borderRadius: 6,
              background: "rgba(0,140,156,0.1)",
              color: "#008C9C",
            }}>
            {field.key}
          </code>
          {overridden && (
            <span
              style={{
                fontSize: 11,
                padding: "2px 8px",
                borderRadius: 999,
                background: "#fef3c7",
                color: "#92400e",
                fontWeight: 600,
              }}>
              Overridden
            </span>
          )}
          {locked && (
            <span
              title={LOCKED_QUOTE_FIELD_REASON}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                fontSize: 11,
                color: "#64748b",
              }}>
              <Lock className="w-3 h-3" />
              Always shown &amp; required
            </span>
          )}
          <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
            {onReset && overridden && (
              <button
                type="button"
                onClick={onReset}
                className="inline-flex items-center gap-1 text-xs text-[#008C9C] hover:underline">
                <RotateCcw className="w-3 h-3" />
                Reset
              </button>
            )}
            <VisibilityToggle
              visible={field.visible}
              disabled={locked}
              disabledReason={LOCKED_QUOTE_FIELD_REASON}
              onToggle={() => onPatch({ visible: !field.visible })}
            />
          </div>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)",
            gap: 10,
          }}>
          <input
            className={themedInputClass}
            value={field.label}
            onChange={(e) => onPatch({ label: e.target.value })}
            placeholder="Label shown to visitors"
            aria-label={`${field.key} label`}
          />
          <input
            className={themedInputClass}
            value={field.helpText}
            onChange={(e) => onPatch({ helpText: e.target.value })}
            placeholder="Help text (optional)"
            aria-label={`${field.key} help text`}
          />
        </div>

        <label
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            fontSize: 12.5,
            color: locked ? "#94a3b8" : "var(--primary-70, #008C9C)",
            cursor: locked ? "not-allowed" : "pointer",
          }}>
          <input
            type="checkbox"
            checked={field.required}
            disabled={locked}
            onChange={(e) => onPatch({ required: e.target.checked })}
          />
          Required — the visitor can&apos;t submit without it
        </label>
      </div>
    </div>
  );
}
