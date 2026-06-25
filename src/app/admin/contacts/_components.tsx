"use client";

import type { ComponentType } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { LifecycleStage } from "@prisma/client";
import { LIFECYCLE_META } from "@/lib/crm-meta";
import { avatarColor, initials } from "@/lib/avatar";

export function Avatar({ name, color, size = 28, title }: { name: string; color?: string; size?: number; title?: string }) {
  return (
    <span
      className="avatar"
      title={title || name}
      style={{ width: size, height: size, background: color || avatarColor(name), fontSize: Math.max(9, Math.round(size * 0.36)) }}
    >
      {initials(name)}
    </span>
  );
}

export function LifecyclePill({ stage }: { stage: LifecycleStage }) {
  const s = LIFECYCLE_META[stage];
  return (
    <span className="pill" style={{ background: s.bg, color: s.fg }}>
      <span className="pill-dot" style={{ background: s.dot }} />
      {s.label}
    </span>
  );
}

export function AStat({
  icon: Icon,
  label,
  value,
  hint,
  deltaDir,
}: {
  icon: ComponentType<{ size?: number }>;
  label: string;
  value: string | number;
  hint?: string;
  deltaDir?: "up" | "down";
}) {
  return (
    <div className="astat">
      <div className="astat-head">
        <span>{label}</span>
        <span className="astat-icon"><Icon size={16} /></span>
      </div>
      <div className="astat-value">{value}</div>
      {hint ? <div className={`astat-delta ${deltaDir ?? ""}`}>{hint}</div> : null}
    </div>
  );
}

export function ScoreMeter({ score, align = "start" }: { score: number; align?: "start" | "end" }) {
  return (
    <div className="score-meter" style={{ justifyContent: align === "end" ? "flex-end" : "flex-start" }}>
      <span className="score-bar"><span className="score-fill" style={{ width: `${score}%` }} /></span>
      <span className="score-num">{score}</span>
    </div>
  );
}

export function Pager({
  page,
  pageCount,
  total,
  perPage,
  onChange,
}: {
  page: number;
  pageCount: number;
  total: number;
  perPage: number;
  onChange: (p: number) => void;
}) {
  if (pageCount <= 1) {
    return (
      <div className="apager">
        <span>{total} {total === 1 ? "result" : "results"}</span>
        <span />
      </div>
    );
  }
  const start = (page - 1) * perPage + 1;
  const end = Math.min(page * perPage, total);

  // Windowed page list: 1 … (page-1) page (page+1) … last
  const items: (number | "…")[] = [];
  for (let i = 1; i <= pageCount; i++) {
    if (i === 1 || i === pageCount || (i >= page - 1 && i <= page + 1)) {
      items.push(i);
    } else if (items[items.length - 1] !== "…") {
      items.push("…");
    }
  }

  return (
    <div className="apager">
      <span>{start}–{end} of {total}</span>
      <div className="apager-controls">
        <button className="apager-btn" disabled={page === 1} onClick={() => onChange(page - 1)}><ChevronLeft size={16} /></button>
        {items.map((p, i) =>
          p === "…" ? (
            <span key={`gap-${i}`} className="apager-gap">…</span>
          ) : (
            <button key={p} className={`apager-btn ${p === page ? "active" : ""}`} onClick={() => onChange(p)}>{p}</button>
          )
        )}
        <button className="apager-btn" disabled={page === pageCount} onClick={() => onChange(page + 1)}><ChevronRight size={16} /></button>
      </div>
    </div>
  );
}
