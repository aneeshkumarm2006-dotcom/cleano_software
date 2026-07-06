"use client";

import { useState } from "react";
import { X, Loader2 } from "lucide-react";

export interface BulkAction {
  key: string;
  label: string;
  icon?: React.ReactNode;
  /** Runs the action for the selected ids. Return void/throw on error. */
  onRun: () => Promise<void> | void;
  /** Show a confirm prompt first (for destructive actions). */
  confirm?: string;
  /** Visual emphasis. */
  variant?: "default" | "danger";
}

interface BulkActionBarProps {
  count: number;
  actions: BulkAction[];
  onClear: () => void;
  /** Optional label for the selected unit, e.g. "job" → "3 jobs selected". */
  noun?: string;
  /** Total visible rows — with onToggleAll, renders a "Select all N" chip
      (the only select-all entry point on mobile card lists). */
  total?: number;
  allSelected?: boolean;
  onToggleAll?: () => void;
}

// Floating bar shown when ≥1 row is selected. Renders the provided actions and a
// clear button. Handles per-action busy state + optional confirm.
export default function BulkActionBar({ count, actions, onClear, noun = "item", total, allSelected, onToggleAll }: BulkActionBarProps) {
  const [busy, setBusy] = useState<string | null>(null);
  if (count <= 0) return null;

  async function run(action: BulkAction) {
    if (action.confirm && !window.confirm(action.confirm)) return;
    setBusy(action.key);
    try {
      await action.onRun();
    } catch (e) {
      console.error("bulk action failed", e);
      alert("That action failed. Please try again.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div
      style={{
        position: "sticky",
        bottom: 16,
        zIndex: 40,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexWrap: "wrap",
        gap: 10,
        margin: "0 auto",
        width: "fit-content",
        // Never wider than the phone viewport — wrap into rows instead.
        maxWidth: "calc(100vw - 32px)",
        padding: "10px 14px",
        borderRadius: 20,
        background: "#0f172a",
        color: "#fff",
        boxShadow: "0 8px 30px rgba(0,0,0,0.25)",
      }}>
      <span style={{ fontSize: 13, fontWeight: 600, whiteSpace: "nowrap" }}>
        {count} {noun}
        {count === 1 ? "" : "s"} selected
      </span>
      {onToggleAll && typeof total === "number" && total > 0 && (
        <button
          onClick={onToggleAll}
          disabled={busy !== null}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            fontSize: 13,
            fontWeight: 600,
            padding: "6px 12px",
            borderRadius: 999,
            border: "1px solid rgba(255,255,255,0.25)",
            cursor: busy ? "default" : "pointer",
            background: "transparent",
            color: "#fff",
            whiteSpace: "nowrap",
          }}>
          {allSelected ? "Deselect all" : `Select all ${total}`}
        </button>
      )}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "center" }}>
        {actions.map((a) => (
          <button
            key={a.key}
            onClick={() => run(a)}
            disabled={busy !== null}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              fontSize: 13,
              fontWeight: 600,
              padding: "6px 12px",
              borderRadius: 999,
              border: "none",
              cursor: busy ? "default" : "pointer",
              background: a.variant === "danger" ? "#dc2626" : "rgba(255,255,255,0.12)",
              color: "#fff",
              whiteSpace: "nowrap",
              opacity: busy && busy !== a.key ? 0.5 : 1,
            }}>
            {busy === a.key ? <Loader2 size={14} className="animate-spin" /> : a.icon}
            {a.label}
          </button>
        ))}
      </div>
      <button
        onClick={onClear}
        disabled={busy !== null}
        title="Clear selection"
        style={{
          display: "inline-flex",
          alignItems: "center",
          background: "transparent",
          border: "none",
          color: "rgba(255,255,255,0.7)",
          cursor: "pointer",
          padding: 4,
        }}>
        <X size={16} />
      </button>
    </div>
  );
}
