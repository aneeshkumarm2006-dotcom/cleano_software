"use client";

// CanonSelect — the canonical dropdown, ported from the Cleano design handoff.
// ONE component to replace the five variants (Select, PremiumSelect,
// SearchableDropdown, Dropdown, custom-dropdown). Covers: basic select,
// status dots, disabled options, and an optional searchable mode.
//
//   <CanonSelect value={v} onChange={setV} options={[{value,label,dot,disabled}]} />
//   <CanonSelect ... searchable placeholder="Assign cleaner" />

import { useEffect, useRef, useState } from "react";

export interface CanonSelectOption {
  value: string;
  label: string;
  /** Optional color dot (status indicator). */
  dot?: string;
  disabled?: boolean;
}

export interface CanonSelectProps {
  value?: string;
  onChange?: (value: string) => void;
  options: CanonSelectOption[];
  placeholder?: string;
  searchable?: boolean;
  width?: number | string;
}

export default function CanonSelect({
  value,
  onChange,
  options = [],
  placeholder = "Select…",
  searchable = false,
  width = 240,
}: CanonSelectProps) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [hi, setHi] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open]);

  useEffect(() => {
    if (open && searchable && searchRef.current) searchRef.current.focus();
  }, [open, searchable]);

  const sel = options.find((o) => o.value === value);
  const filtered =
    searchable && q
      ? options.filter((o) => o.label.toLowerCase().includes(q.toLowerCase()))
      : options;

  function choose(o: CanonSelectOption) {
    if (o.disabled) return;
    onChange?.(o.value);
    setOpen(false);
    setQ("");
  }

  function onKey(e: React.KeyboardEvent) {
    if (!open && (e.key === "Enter" || e.key === "ArrowDown")) {
      setOpen(true);
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHi((i) => Math.min(filtered.length - 1, i + 1));
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setHi((i) => Math.max(0, i - 1));
    }
    if (e.key === "Enter") {
      e.preventDefault();
      if (filtered[hi]) choose(filtered[hi]);
    }
    if (e.key === "Escape") setOpen(false);
  }

  return (
    <div ref={ref} style={{ position: "relative", width }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        onKeyDown={onKey}
        style={{
          width: "100%",
          height: 44,
          padding: "0 14px",
          borderRadius: "var(--radius-input, 12px)",
          border: `1px solid ${open ? "var(--primary)" : "var(--primary-15)"}`,
          background: "#fff",
          color: sel ? "var(--ink)" : "var(--primary-40)",
          font: "inherit",
          fontSize: 14,
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          gap: 9,
          boxShadow: open ? "0 0 0 4px var(--primary-15)" : "none",
          transition: "border-color .12s, box-shadow .12s",
        }}>
        {sel?.dot ? (
          <span style={{ width: 8, height: 8, borderRadius: 99, background: sel.dot, flex: "0 0 auto" }} />
        ) : null}
        <span
          style={{
            flex: 1,
            textAlign: "left",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}>
          {sel ? sel.label : placeholder}
        </span>
        <svg
          width="15"
          height="15"
          viewBox="0 0 24 24"
          fill="none"
          stroke="var(--primary-50)"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ transform: open ? "rotate(180deg)" : "none", transition: "transform .15s", flex: "0 0 auto" }}>
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      {open ? (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 6px)",
            left: 0,
            right: 0,
            zIndex: 60,
            background: "#fff",
            borderRadius: 12,
            boxShadow: "var(--shadow-pop)",
            border: "1px solid var(--primary-10)",
            padding: 6,
            maxHeight: 280,
            overflowY: "auto",
            animation: "dsPop .16s ease-out",
          }}>
          {searchable ? (
            <input
              ref={searchRef}
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setHi(0);
              }}
              onKeyDown={onKey}
              placeholder="Search…"
              style={{
                width: "100%",
                height: 36,
                marginBottom: 4,
                padding: "0 12px",
                borderRadius: 8,
                border: "1px solid var(--primary-10)",
                font: "inherit",
                fontSize: 13.5,
                outline: "none",
                boxSizing: "border-box",
              }}
            />
          ) : null}
          {filtered.length === 0 ? (
            <div style={{ padding: "14px 12px", fontSize: 13, color: "var(--primary-40)", textAlign: "center" }}>
              No matches
            </div>
          ) : (
            filtered.map((o, i) => {
              const active = o.value === value;
              return (
                <button
                  key={o.value}
                  type="button"
                  disabled={o.disabled}
                  onMouseEnter={() => setHi(i)}
                  onClick={() => choose(o)}
                  style={{
                    width: "100%",
                    display: "flex",
                    alignItems: "center",
                    gap: 9,
                    padding: "9px 10px",
                    border: 0,
                    borderRadius: 8,
                    font: "inherit",
                    fontSize: 13.5,
                    textAlign: "left",
                    cursor: o.disabled ? "not-allowed" : "pointer",
                    opacity: o.disabled ? 0.4 : 1,
                    color: "var(--ink)",
                    background:
                      hi === i && !o.disabled
                        ? "var(--cream)"
                        : active
                          ? "var(--primary-5)"
                          : "transparent",
                  }}>
                  {o.dot ? (
                    <span style={{ width: 8, height: 8, borderRadius: 99, background: o.dot, flex: "0 0 auto" }} />
                  ) : null}
                  <span style={{ flex: 1 }}>{o.label}</span>
                  {active ? (
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="var(--primary)"
                      strokeWidth="3"
                      strokeLinecap="round"
                      strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  ) : null}
                </button>
              );
            })
          )}
        </div>
      ) : null}
    </div>
  );
}
