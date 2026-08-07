"use client";

import { Minus, Plus } from "lucide-react";

// ─── Number stepper ───
/**
 * The bare −/value/+ cluster, without a label.
 *
 * Split out of `NumberStepper` so the add-on cards can carry a quantity
 * stepper: an add-on card is itself a `<button>`, and nesting these buttons
 * inside it would be invalid HTML that React will happily render anyway.
 * `compact` drops the outer padding so it fits a 120px card.
 */
export function QuantityStepper({
  value,
  onChange,
  min = 0,
  max = 99,
  ariaLabel,
  compact = false,
}: {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  /** What the −/+ buttons are adjusting, e.g. "Bedrooms" or "Inside Fridge quantity". */
  ariaLabel: string;
  compact?: boolean;
}) {
  return (
    <div
      className={`cl-stepper-controls${compact ? " cl-stepper-controls--compact" : ""}`}>
      <button
        type="button"
        className="cl-stepper-btn"
        aria-label={`Decrease ${ariaLabel}`}
        onClick={() => onChange(Math.max(min, value - 1))}
        disabled={value <= min}>
        <Minus size={14} />
      </button>
      <span className="cl-stepper-value">{value}</span>
      <button
        type="button"
        className="cl-stepper-btn"
        aria-label={`Increase ${ariaLabel}`}
        onClick={() => onChange(Math.min(max, value + 1))}
        disabled={value >= max}>
        <Plus size={14} />
      </button>
    </div>
  );
}

export function NumberStepper({
  label,
  value,
  onChange,
  min = 0,
  max = 99,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
}) {
  return (
    <div className="cl-stepper">
      <span className="cl-stepper-label">{label}</span>
      <QuantityStepper
        value={value}
        onChange={onChange}
        min={min}
        max={max}
        ariaLabel={label}
      />
    </div>
  );
}

// ─── Choice button ───
export function ChoiceButton({
  active,
  large,
  title,
  sub,
  hint,
  onClick,
  disabled,
  style,
}: {
  active?: boolean;
  large?: boolean;
  title?: string;
  sub?: string;
  hint?: string;
  onClick?: () => void;
  disabled?: boolean;
  style?: React.CSSProperties;
}) {
  const cls = [
    "cl-choice",
    large ? "cl-choice-large" : "",
    active ? "active" : "",
  ]
    .filter(Boolean)
    .join(" ");
  if (large) {
    return (
      <button
        type="button"
        className={cls}
        onClick={onClick}
        disabled={disabled}
        style={style}>
        <span className="cl-choice-title">{title}</span>
        {sub ? <span className="cl-choice-sub">{sub}</span> : null}
      </button>
    );
  }
  return (
    <button
      type="button"
      className={cls}
      onClick={onClick}
      disabled={disabled}
      style={style}>
      <span>{title}</span>
      {hint ? <span className="cl-choice-hint">{hint}</span> : null}
    </button>
  );
}

// ─── Status badge ───
export function StatusBadge({
  status,
}: {
  status: string;
}) {
  const s = (status || "").toLowerCase();
  const key =
    s === "created" || s === "scheduling"
      ? "scheduling"
      : s === "scheduled"
      ? "scheduled"
      : s === "in_progress" || s === "inprogress"
      ? "inprogress"
      : s === "completed"
      ? "completed"
      : s === "paid"
      ? "paid"
      : "cancelled";
  const label = {
    scheduling: "Scheduling",
    scheduled: "Scheduled",
    inprogress: "In progress",
    completed: "Completed",
    paid: "Paid",
    cancelled: "Cancelled",
  }[key];
  return <span className={`cl-badge cl-badge-${key}`}>{label}</span>;
}

// ─── Date badge (used in portal overview & bookings) ───
export function DateBadge({ iso }: { iso: string }) {
  const d = new Date(iso);
  const day = d.toLocaleDateString("en-US", { day: "numeric" });
  const mon = d
    .toLocaleDateString("en-US", { month: "short" })
    .toUpperCase();
  return (
    <div className="cl-date-badge">
      <span className="cl-date-badge-mon">{mon}</span>
      <span className="cl-date-badge-day">{day}</span>
    </div>
  );
}
