"use client";

import React from "react";
import { LucideIcon } from "lucide-react";

export type Msg = { type: "success" | "error"; text: string } | null;

export function SectionCard({
  title,
  description,
  icon: Icon,
  children,
  actions,
}: {
  title: string;
  description?: string;
  icon?: LucideIcon;
  children: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <div className="cl-section-card">
      <div className="cl-section-card-head" style={actions ? { justifyContent: "space-between" } : undefined}>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          {Icon && (
            <span className="icon-bubble">
              <Icon className="w-5 h-5" strokeWidth={1.9} />
            </span>
          )}
          <div>
            <h3>{title}</h3>
            {description && <p>{description}</p>}
          </div>
        </div>
        {actions}
      </div>
      <div className="cl-section-card-body">{children}</div>
    </div>
  );
}

export function Field({
  label,
  htmlFor,
  hint,
  children,
}: {
  label: string;
  htmlFor?: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="cl-form-row">
      <label htmlFor={htmlFor} className="cl-form-label">{label}</label>
      {children}
      {hint && <div className="cl-form-hint">{hint}</div>}
    </div>
  );
}

export function Feedback({ msg }: { msg: NonNullable<Msg> }) {
  return (
    <div
      style={{
        padding: "12px 16px", borderRadius: 12, fontSize: 13,
        background: msg.type === "success" ? "rgba(0,140,156,0.08)" : "#fee2e2",
        color: msg.type === "success" ? "var(--primary)" : "#dc2626",
      }}>
      {msg.text}
    </div>
  );
}

/**
 * Themed input that matches the Cleano teal palette used across pages
 * like Analytics. Use this for any new free-form input inside settings tabs
 * (the shared `Input` component defaults to a neutral grey border).
 */
export const themedInputClass =
  "w-full px-4 py-2.5 rounded-xl border border-transparent bg-[#008C9C]/5 text-sm text-[#008C9C] placeholder:text-[#008C9C]/40 focus:outline-none focus:ring-2 focus:ring-[#008C9C]/20";

/**
 * Themed select that matches Cleano teal palette.
 */
export const themedSelectClass =
  "w-full px-4 py-2.5 rounded-xl border border-transparent bg-[#008C9C]/5 text-sm text-[#008C9C] focus:outline-none focus:ring-2 focus:ring-[#008C9C]/20";
