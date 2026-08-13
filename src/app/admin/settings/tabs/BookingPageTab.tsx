"use client";

import { useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  Eye,
  EyeOff,
  Lock,
  Repeat,
  RotateCcw,
} from "lucide-react";
import Button from "@/components/ui/Button";
import { updateAppSetting } from "../../actions/updateAppSetting";
import { AppSettingRecord, getSetting } from "../types";
import { SectionCard, Feedback, Msg, themedInputClass } from "./_shared";
import {
  BOOKING_PAGE_CONFIG_KEY,
  BOOKING_PAGE_DEFAULTS,
  BOOKING_SERVICE_TYPES,
  BOOKING_STEP_IDS,
  BOOKING_STEP_LABELS,
  LOCKED_FIELD_REASON,
  isLockedField,
  normalizeBookingPageConfig,
  overrideKey,
  resolveFrequencyOptions,
  resolveStepFields,
  type BookingFieldConfig,
  type BookingFieldOverride,
  type BookingPageConfig,
  type BookingStepId,
} from "@/lib/booking-page-config";

interface BookingPageTabProps {
  settings: AppSettingRecord[];
}

/** "" = editing the base config that applies to every service. */
const ALL_SERVICES = "";

export default function BookingPageTab({ settings }: BookingPageTabProps) {
  const [cfg, setCfg] = useState<BookingPageConfig>(() =>
    normalizeBookingPageConfig(
      getSetting<unknown>(settings, BOOKING_PAGE_CONFIG_KEY, {})
    )
  );
  const [service, setService] = useState<string>(ALL_SERVICES);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);

  const scope = service || undefined;

  /* ------------------------------- mutations ------------------------------ */

  /** Write a patch to the base config, or to this service's override map. */
  function patchField(
    stepId: BookingStepId,
    fieldKey: string,
    patch: BookingFieldOverride
  ) {
    setMsg(null);
    setCfg((c) => {
      if (!service) {
        return {
          ...c,
          fields: {
            ...c.fields,
            [stepId]: c.fields[stepId].map((f) =>
              f.key === fieldKey ? { ...f, ...patch } : f
            ),
          },
        };
      }
      const k = overrideKey(stepId, fieldKey);
      const row = { ...(c.overrides[service] ?? {}) };
      row[k] = { ...(row[k] ?? {}), ...patch };
      return { ...c, overrides: { ...c.overrides, [service]: row } };
    });
  }

  /** Drop this service's override for one field, so it inherits the base again. */
  function clearOverride(stepId: BookingStepId, fieldKey: string) {
    if (!service) return;
    setMsg(null);
    setCfg((c) => {
      const row = { ...(c.overrides[service] ?? {}) };
      delete row[overrideKey(stepId, fieldKey)];
      return { ...c, overrides: { ...c.overrides, [service]: row } };
    });
  }

  function hasOverride(stepId: BookingStepId, fieldKey: string): boolean {
    if (!service) return false;
    return !!cfg.overrides[service]?.[overrideKey(stepId, fieldKey)];
  }

  /**
   * Swap a field with its neighbour in the CURRENT ordering. Orders are written
   * rather than swapped in an array, because ordering can itself be a
   * per-service override.
   */
  function move(stepId: BookingStepId, fieldKey: string, dir: -1 | 1) {
    const ordered = resolveStepFields(cfg, stepId, scope);
    const i = ordered.findIndex((f) => f.key === fieldKey);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= ordered.length) return;
    const a = ordered[i];
    const b = ordered[j];
    // Equal orders would leave the swap a no-op (the tiebreak is by key), so
    // fall back to index positions when the two share an order value.
    const aOrder = a.order === b.order ? j : b.order;
    const bOrder = a.order === b.order ? i : a.order;
    patchField(stepId, a.key, { order: aOrder });
    patchField(stepId, b.key, { order: bOrder });
  }

  function patchFrequency(
    value: string,
    patch: Partial<{ label: string; hint: string; visible: boolean; order: number }>
  ) {
    if (!service) return;
    setMsg(null);
    setCfg((c) => ({
      ...c,
      frequencyOptions: {
        ...c.frequencyOptions,
        [service]: (c.frequencyOptions[service] ?? []).map((o) =>
          o.value === value ? { ...o, ...patch } : o
        ),
      },
    }));
  }

  function moveFrequency(value: string, dir: -1 | 1) {
    if (!service) return;
    const ordered = resolveFrequencyOptions(cfg, service);
    const i = ordered.findIndex((o) => o.value === value);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= ordered.length) return;
    patchFrequency(ordered[i].value, { order: j });
    patchFrequency(ordered[j].value, { order: i });
  }

  async function handleSave() {
    setSaving(true);
    setMsg(null);
    const res = await updateAppSetting({
      key: BOOKING_PAGE_CONFIG_KEY,
      category: "bookings",
      value: cfg,
    });
    setMsg(
      res.success
        ? { type: "success", text: "Booking page saved. /book updates immediately." }
        : { type: "error", text: res.error ?? "Failed to save." }
    );
    setSaving(false);
  }

  function handleResetAll() {
    setCfg(normalizeBookingPageConfig(BOOKING_PAGE_DEFAULTS));
    setMsg({
      type: "success",
      text: "Reverted to the shipped defaults — press Save to apply.",
    });
  }

  /* -------------------------------- render -------------------------------- */

  return (
    <div className="space-y-6">
      <SectionCard
        title="Which service are you editing?"
        icon={Eye}
        description="“All services” sets the baseline. Pick a service to override just that one — hide a field, rename it, or move it, without touching the others.">
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          <ScopeChip
            label="All services"
            active={service === ALL_SERVICES}
            onClick={() => setService(ALL_SERVICES)}
          />
          {BOOKING_SERVICE_TYPES.map((s) => (
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
            ? "Changes here apply to this service only. Fields marked “Overridden” differ from the baseline — reset one to inherit it again."
            : "Changes here apply to every service that doesn’t override the field."}
        </p>
      </SectionCard>

      {BOOKING_STEP_IDS.map((stepId) => {
        const fields = resolveStepFields(cfg, stepId, scope);
        return (
          <SectionCard key={stepId} title={BOOKING_STEP_LABELS[stepId]}>
            <div style={{ display: "grid", gap: 12 }}>
              {fields.map((f, idx) => (
                <FieldRow
                  key={f.key}
                  field={f}
                  locked={isLockedField(stepId, f.key, scope)}
                  overridden={hasOverride(stepId, f.key)}
                  first={idx === 0}
                  last={idx === fields.length - 1}
                  onPatch={(p) => patchField(stepId, f.key, p)}
                  onMove={(d) => move(stepId, f.key, d)}
                  onReset={service ? () => clearOverride(stepId, f.key) : undefined}
                />
              ))}
            </div>
          </SectionCard>
        );
      })}

      <SectionCard
        title="Frequency choices"
        icon={Repeat}
        description="The recurring options offered for this service, and what each is called. Discount percentages live in Settings → Pricing Rules — these are labels only.">
        {!service ? (
          <p style={{ fontSize: 13, color: "var(--primary-60)", margin: 0 }}>
            Frequency choices are set per service. Pick a service above to edit
            them.
          </p>
        ) : (
          <div style={{ display: "grid", gap: 12 }}>
            {resolveFrequencyOptions(cfg, service).map((o, idx, arr) => {
              const locked = o.value === "ONE_TIME";
              return (
                <div
                  key={o.value}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "auto 1fr 1fr auto",
                    gap: 10,
                    alignItems: "center",
                    padding: "12px 14px",
                    borderRadius: 12,
                    background: "rgba(0,140,156,0.04)",
                    opacity: o.visible ? 1 : 0.6,
                  }}>
                  <MoveButtons
                    first={idx === 0}
                    last={idx === arr.length - 1}
                    onMove={(d) => moveFrequency(o.value, d)}
                  />
                  <input
                    className={themedInputClass}
                    value={o.label}
                    onChange={(e) => patchFrequency(o.value, { label: e.target.value })}
                    placeholder="Label shown to customers"
                  />
                  <input
                    className={themedInputClass}
                    value={o.hint}
                    onChange={(e) => patchFrequency(o.value, { hint: e.target.value })}
                    placeholder="Hint (replaced by the discount % when one applies)"
                  />
                  <VisibilityToggle
                    visible={o.visible}
                    disabled={locked}
                    disabledReason="A customer must always be able to book a one-time cleaning."
                    onToggle={() => patchFrequency(o.value, { visible: !o.visible })}
                  />
                </div>
              );
            })}
            <p style={{ fontSize: 12.5, color: "var(--primary-60)", margin: 0 }}>
              Hiding every recurring option makes this service one-off only — no
              frequency step, and no recurring discount is applied.
            </p>
          </div>
        )}
      </SectionCard>

      {msg && <Feedback msg={msg} />}
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
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
          {saving ? "Saving..." : "Save booking page"}
        </Button>
      </div>
    </div>
  );
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
  field: BookingFieldConfig;
  locked: boolean;
  overridden: boolean;
  first: boolean;
  last: boolean;
  onPatch: (patch: BookingFieldOverride) => void;
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
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            flexWrap: "wrap",
          }}>
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
              title={LOCKED_FIELD_REASON}
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
              disabledReason={LOCKED_FIELD_REASON}
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
            placeholder="Label shown to customers"
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
          Required — the customer can&apos;t continue without it
        </label>
      </div>
    </div>
  );
}
