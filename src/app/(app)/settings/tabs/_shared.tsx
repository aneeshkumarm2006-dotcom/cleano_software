"use client";

import React from "react";
import { LucideIcon } from "lucide-react";
import Card from "@/components/ui/Card";

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
    <Card variant="default" className="p-6">
      <div className="space-y-5">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-2">
            {Icon && (
              <div className="p-2 bg-[#005F6A]/10 rounded-lg">
                <Icon className="w-4 h-4 text-[#005F6A]" />
              </div>
            )}
            <div>
              <h2 className="text-sm font-[350] text-[#005F6A]/80">{title}</h2>
              {description && (
                <p className="text-xs text-[#005F6A]/60 mt-1">{description}</p>
              )}
            </div>
          </div>
          {actions}
        </div>
        {children}
      </div>
    </Card>
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
    <div>
      <label
        htmlFor={htmlFor}
        className="text-xs font-[350] text-[#005F6A]/70 uppercase tracking-wide mb-2 block">
        {label}
      </label>
      {children}
      {hint && <p className="text-xs text-[#005F6A]/60 mt-1">{hint}</p>}
    </div>
  );
}

export function Feedback({ msg }: { msg: NonNullable<Msg> }) {
  return (
    <div
      className={`px-4 py-3 rounded-xl text-sm font-[350] ${
        msg.type === "success"
          ? "bg-[#005F6A]/10 text-[#005F6A] border border-[#005F6A]/15"
          : "bg-red-50 text-red-700 border border-red-200"
      }`}>
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
  "w-full px-4 py-2.5 rounded-xl border border-transparent bg-[#005F6A]/5 text-sm text-[#005F6A] placeholder:text-[#005F6A]/40 focus:outline-none focus:ring-2 focus:ring-[#005F6A]/20";

/**
 * Themed select that matches Cleano teal palette.
 */
export const themedSelectClass =
  "w-full px-4 py-2.5 rounded-xl border border-transparent bg-[#005F6A]/5 text-sm text-[#005F6A] focus:outline-none focus:ring-2 focus:ring-[#005F6A]/20";
