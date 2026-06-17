"use client";

import React, { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown } from "lucide-react";

export interface PremiumSelectOption {
  value: string;
  label: string;
  description?: string;
  keywords?: string; // extra search terms (e.g. email, phone) — not displayed
  disabled?: boolean;
}

interface PremiumSelectProps {
  value?: string;
  onChange?: (value: string) => void;
  options: PremiumSelectOption[];
  placeholder?: string;
  disabled?: boolean;
  error?: boolean;
  size?: "sm" | "md" | "lg";
  searchable?: boolean;
  className?: string;
  name?: string;
  style?: React.CSSProperties;
}

const H = { sm: 34, md: 44, lg: 52 } as const;
const FS = { sm: 13, md: 14, lg: 15 } as const;
const BR = { sm: 9, md: 10, lg: 12 } as const;

export default function PremiumSelect({
  value,
  onChange,
  options,
  placeholder = "Select…",
  disabled = false,
  error = false,
  size = "md",
  searchable = false,
  className = "",
  name,
  style,
}: PremiumSelectProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [pos, setPos] = useState({ top: 0, left: 0, width: 0 });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dropRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => { setMounted(true); }, []);

  const selected = options.find(o => o.value === value);
  const filtered = search.trim()
    ? options.filter(o => {
        const q = search.toLowerCase();
        return o.label.toLowerCase().includes(q) || o.keywords?.toLowerCase().includes(q);
      })
    : options;

  function updatePos() {
    if (!triggerRef.current) return;
    const r = triggerRef.current.getBoundingClientRect();
    const dropWidth = Math.max(r.width, 180);
    let left = r.left;
    if (left + dropWidth > window.innerWidth - 12) left = r.right - dropWidth;
    setPos({ top: r.bottom + 5, left, width: dropWidth });
  }

  useEffect(() => {
    if (!open) { setSearch(""); return; }
    updatePos();
    if (searchable) setTimeout(() => searchRef.current?.focus(), 50);
    const onSR = () => updatePos();
    document.addEventListener("scroll", onSR, true);
    window.addEventListener("resize", onSR);
    return () => {
      document.removeEventListener("scroll", onSR, true);
      window.removeEventListener("resize", onSR);
    };
  }, [open, searchable]);

  useEffect(() => {
    function onOut(e: MouseEvent) {
      if (
        dropRef.current?.contains(e.target as Node) ||
        triggerRef.current?.contains(e.target as Node)
      ) return;
      setOpen(false);
    }
    document.addEventListener("mousedown", onOut);
    return () => document.removeEventListener("mousedown", onOut);
  }, []);

  function pick(val: string) {
    onChange?.(val);
    setOpen(false);
  }

  const border = error
    ? "1.5px solid #f87171"
    : open
    ? "1.5px solid #008C9C"
    : "1px solid rgba(0,140,156,0.16)";
  const boxShadow = open ? "0 0 0 3px rgba(0,140,156,0.11)" : "none";

  return (
    <>
      {name && <input type="hidden" name={name} value={value ?? ""} />}

      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        onClick={() => setOpen(v => !v)}
        className={className}
        style={{
          display: "inline-flex",
          alignItems: "center",
          width: "100%",
          height: H[size],
          padding: `0 ${size === "sm" ? 10 : 14}px`,
          borderRadius: BR[size],
          border,
          background: disabled ? "rgba(0,140,156,0.04)" : "#fff",
          fontSize: FS[size],
          color: selected ? "#111" : "rgba(0,140,156,0.38)",
          fontFamily: "inherit",
          cursor: disabled ? "not-allowed" : "pointer",
          transition: "border .15s, box-shadow .15s",
          boxShadow,
          gap: 8,
          outline: "none",
          opacity: disabled ? 0.55 : 1,
          ...style,
        }}>
        <span
          style={{
            flex: 1,
            textAlign: "left",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}>
          {selected?.label ?? placeholder}
        </span>
        <ChevronDown
          size={14}
          style={{
            flexShrink: 0,
            color: "rgba(0,140,156,0.45)",
            transform: open ? "rotate(180deg)" : "none",
            transition: "transform .2s",
          }}
        />
      </button>

      {mounted &&
        open &&
        createPortal(
          <div
            ref={dropRef}
            style={{
              position: "fixed",
              top: pos.top,
              left: pos.left,
              width: pos.width,
              zIndex: 9999,
              background: "#fff",
              borderRadius: 14,
              border: "1px solid rgba(0,140,156,0.1)",
              boxShadow:
                "0 8px 32px rgba(0,140,156,0.13), 0 2px 8px rgba(0,0,0,0.05)",
              overflow: "hidden",
              animation: "ps-drop .16s cubic-bezier(.2,.8,.3,1) both",
            }}>
            {searchable && (
              <div
                style={{
                  padding: "8px 8px 4px",
                  borderBottom: "1px solid rgba(0,140,156,0.07)",
                }}>
                <input
                  ref={searchRef}
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder="Search…"
                  style={{
                    width: "100%",
                    height: 34,
                    borderRadius: 8,
                    border: "1px solid rgba(0,140,156,0.14)",
                    padding: "0 12px",
                    fontSize: 13,
                    color: "#111",
                    fontFamily: "inherit",
                    outline: "none",
                    background: "rgba(0,140,156,0.03)",
                  }}
                />
              </div>
            )}

            <div style={{ maxHeight: 280, overflowY: "auto", padding: 5 }}>
              {filtered.length === 0 ? (
                <div
                  style={{
                    padding: "14px 12px",
                    fontSize: 13,
                    color: "rgba(0,140,156,0.4)",
                    textAlign: "center",
                  }}>
                  No options
                </div>
              ) : (
                filtered.map(opt => {
                  const active = opt.value === value;
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      disabled={opt.disabled}
                      onClick={() => !opt.disabled && pick(opt.value)}
                      style={{
                        width: "100%",
                        padding: "9px 12px",
                        borderRadius: 9,
                        border: 0,
                        background: active
                          ? "rgba(0,140,156,0.08)"
                          : "transparent",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: 8,
                        cursor: opt.disabled ? "not-allowed" : "pointer",
                        fontSize: 13,
                        fontWeight: active ? 600 : 400,
                        color: opt.disabled
                          ? "rgba(0,140,156,0.28)"
                          : active
                          ? "#008C9C"
                          : "#111",
                        fontFamily: "inherit",
                        textAlign: "left",
                        transition: "background .1s",
                      }}
                      onMouseEnter={e => {
                        if (!opt.disabled && !active)
                          (
                            e.currentTarget as HTMLButtonElement
                          ).style.background = "rgba(0,140,156,0.04)";
                      }}
                      onMouseLeave={e => {
                        (e.currentTarget as HTMLButtonElement).style.background =
                          active ? "rgba(0,140,156,0.08)" : "transparent";
                      }}>
                      <span>{opt.label}</span>
                      {active && (
                        <Check
                          size={13}
                          style={{ color: "#008C9C", flexShrink: 0 }}
                        />
                      )}
                    </button>
                  );
                })
              )}
            </div>
          </div>,
          document.body
        )}

      <style>{`
        @keyframes ps-drop {
          from { opacity: 0; transform: translateY(-5px) scale(0.98); }
          to   { opacity: 1; transform: translateY(0) scale(1); }
        }
      `}</style>
    </>
  );
}
