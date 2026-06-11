"use client";

import React, { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { Clock } from "lucide-react";

interface TimePickerProps {
  value?: string;         // "HH:MM" 24-hour
  onChange?: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  error?: boolean;
  size?: "sm" | "md" | "lg";
  step?: number;          // minute step, default 15
  name?: string;
  className?: string;
  style?: React.CSSProperties;
}

function formatDisplay(str?: string): string {
  if (!str) return "";
  const [h, m] = str.split(":").map(Number);
  if (isNaN(h) || isNaN(m)) return str;
  const period = h >= 12 ? "PM" : "AM";
  const hour = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${hour}:${String(m).padStart(2, "0")} ${period}`;
}

/**
 * Parse a free-form typed time into canonical "HH:MM" (24-hour), or null if it
 * can't be understood. Accepts: "9", "930", "9:30", "0930", "9pm", "9:30 pm",
 * "230pm", "14:30", "1430". This is what restores manual keyboard entry.
 */
export function parseTimeInput(raw: string): string | null {
  if (!raw) return null;
  let s = raw.trim().toLowerCase();
  if (!s) return null;
  let ampm: "am" | "pm" | null = null;
  if (/[ap]\.?m?\.?$/.test(s)) {
    if (s.includes("p")) ampm = "pm";
    else if (s.includes("a")) ampm = "am";
    s = s.replace(/[ap]\.?m?\.?$/, "");
  }
  s = s.replace(/[^\d:]/g, "");
  if (!s) return null;
  let h: number;
  let m: number;
  if (s.includes(":")) {
    const [hp, mp] = s.split(":");
    h = parseInt(hp, 10);
    m = mp ? parseInt(mp.slice(0, 2), 10) : 0;
  } else if (s.length <= 2) {
    h = parseInt(s, 10);
    m = 0;
  } else if (s.length === 3) {
    h = parseInt(s.slice(0, 1), 10);
    m = parseInt(s.slice(1), 10);
  } else {
    h = parseInt(s.slice(0, 2), 10);
    m = parseInt(s.slice(2, 4), 10);
  }
  if (isNaN(h) || isNaN(m)) return null;
  if (ampm === "pm" && h < 12) h += 12;
  if (ampm === "am" && h === 12) h = 0;
  if (h < 0 || h > 23 || m < 0 || m > 59) return null;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

const H = { sm: 34, md: 44, lg: 52 } as const;
const FS = { sm: 13, md: 14, lg: 15 } as const;
const BR = { sm: 9, md: 10, lg: 12 } as const;

export default function TimePicker({
  value,
  onChange,
  placeholder = "Select time",
  disabled = false,
  error = false,
  size = "md",
  step = 15,
  name,
  className = "",
  style,
}: TimePickerProps) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const [mounted, setMounted] = useState(false);
  // Typed-text buffer for manual keyboard entry. While `editing`, the input
  // shows the raw text the user is typing; otherwise it shows the formatted value.
  const [text, setText] = useState("");
  const [editing, setEditing] = useState(false);
  const triggerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const dropRef = useRef<HTMLDivElement>(null);
  const hourColRef = useRef<HTMLDivElement>(null);
  const minColRef = useRef<HTMLDivElement>(null);

  useEffect(() => { setMounted(true); }, []);

  const hours = Array.from({ length: 24 }, (_, i) => i);
  const minutes = Array.from({ length: Math.floor(60 / step) }, (_, i) => i * step);

  const [selHour, selMinute] = value
    ? value.split(":").map(Number)
    : [null, null];

  function updatePos() {
    if (!triggerRef.current) return;
    const r = triggerRef.current.getBoundingClientRect();
    const dropW = 220;
    let left = r.left;
    if (left + dropW > window.innerWidth - 12) left = r.right - dropW;
    setPos({ top: r.bottom + 5, left });
  }

  useEffect(() => {
    if (!open) return;
    updatePos();
    const onSR = () => updatePos();
    document.addEventListener("scroll", onSR, true);
    window.addEventListener("resize", onSR);

    // Scroll selected items into view
    setTimeout(() => {
      if (selHour !== null && hourColRef.current) {
        const btn = hourColRef.current.children[selHour] as HTMLElement;
        btn?.scrollIntoView({ block: "center" });
      }
      if (selMinute !== null && minColRef.current) {
        const idx = minutes.indexOf(selMinute);
        const btn = minColRef.current.children[idx] as HTMLElement;
        btn?.scrollIntoView({ block: "center" });
      }
    }, 30);

    return () => {
      document.removeEventListener("scroll", onSR, true);
      window.removeEventListener("resize", onSR);
    };
  }, [open]);

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

  function pick(h: number, m: number) {
    onChange?.(`${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`);
    setOpen(false);
  }

  // Commit whatever the user typed. Valid → fire onChange; invalid → silently
  // revert to the current value (display falls back to formatDisplay(value)).
  function commitTyped() {
    const parsed = parseTimeInput(text);
    if (parsed && parsed !== value) onChange?.(parsed);
  }

  const border = error
    ? "1.5px solid #f87171"
    : open
    ? "1.5px solid #005F6A"
    : "1px solid rgba(0,95,106,0.16)";
  const boxShadow = open ? "0 0 0 3px rgba(0,95,106,0.11)" : "none";

  const COL_LABEL: React.CSSProperties = {
    padding: "10px 10px 6px",
    fontSize: 10,
    fontWeight: 700,
    textTransform: "uppercase",
    letterSpacing: "0.09em",
    color: "rgba(0,95,106,0.38)",
    borderBottom: "1px solid rgba(0,95,106,0.07)",
    position: "sticky",
    top: 0,
    background: "#fff",
    zIndex: 1,
  };

  function ColBtn({
    active,
    onClick,
    children,
  }: {
    active: boolean;
    onClick: () => void;
    children: React.ReactNode;
  }) {
    return (
      <button
        type="button"
        onClick={onClick}
        style={{
          width: "100%",
          padding: "8px 10px",
          borderRadius: 8,
          border: 0,
          background: active ? "#005F6A" : "transparent",
          color: active ? "#fff" : "#111",
          fontSize: 13,
          fontWeight: active ? 700 : 400,
          fontFamily: "inherit",
          cursor: "pointer",
          textAlign: "left",
          transition: "background .1s",
        }}
        onMouseEnter={e => {
          if (!active)
            (e.currentTarget as HTMLButtonElement).style.background =
              "rgba(0,95,106,0.06)";
        }}
        onMouseLeave={e => {
          if (!active)
            (e.currentTarget as HTMLButtonElement).style.background = "transparent";
        }}>
        {children}
      </button>
    );
  }

  return (
    <>
      {name && <input type="hidden" name={name} value={value ?? ""} />}

      <div
        ref={triggerRef}
        className={className}
        onClick={() => { if (!disabled) inputRef.current?.focus(); }}
        style={{
          display: "inline-flex",
          alignItems: "center",
          width: "100%",
          height: H[size],
          padding: `0 ${size === "sm" ? 10 : 14}px`,
          borderRadius: BR[size],
          border,
          background: disabled ? "rgba(0,95,106,0.04)" : "#fff",
          fontFamily: "inherit",
          cursor: disabled ? "not-allowed" : "text",
          transition: "border .15s, box-shadow .15s",
          boxShadow,
          gap: 8,
          opacity: disabled ? 0.55 : 1,
          ...style,
        }}>
        <Clock size={14} style={{ flexShrink: 0, color: "rgba(0,95,106,0.45)" }} />
        <input
          ref={inputRef}
          type="text"
          inputMode="numeric"
          disabled={disabled}
          placeholder={placeholder}
          value={editing ? text : value ? formatDisplay(value) : ""}
          onFocus={() => {
            setEditing(true);
            setText(value ? formatDisplay(value) : "");
            setOpen(true);
          }}
          onChange={(e) => setText(e.target.value)}
          onBlur={() => { commitTyped(); setEditing(false); }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commitTyped();
              setEditing(false);
              setOpen(false);
              inputRef.current?.blur();
            } else if (e.key === "Escape") {
              setEditing(false);
              setOpen(false);
              inputRef.current?.blur();
            }
          }}
          style={{
            flex: 1,
            minWidth: 0,
            border: 0,
            outline: "none",
            background: "transparent",
            fontSize: FS[size],
            color: value ? "#111" : "rgba(0,95,106,0.45)",
            fontFamily: "inherit",
            padding: 0,
          }}
        />
      </div>

      {mounted &&
        open &&
        createPortal(
          <div
            ref={dropRef}
            style={{
              position: "fixed",
              top: pos.top,
              left: pos.left,
              width: 220,
              zIndex: 9999,
              background: "#fff",
              borderRadius: 16,
              border: "1px solid rgba(0,95,106,0.1)",
              boxShadow: "0 8px 32px rgba(0,95,106,0.13), 0 2px 8px rgba(0,0,0,0.05)",
              overflow: "hidden",
              animation: "ps-drop .16s cubic-bezier(.2,.8,.3,1) both",
            }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr" }}>
              {/* Hours */}
              <div style={{ borderRight: "1px solid rgba(0,95,106,0.08)", display: "flex", flexDirection: "column" }}>
                <div style={COL_LABEL}>Hour</div>
                <div
                  ref={hourColRef}
                  style={{ maxHeight: 220, overflowY: "auto", padding: "4px 5px 5px" }}>
                  {hours.map(hr => {
                    const period = hr >= 12 ? "PM" : "AM";
                    const label = hr === 0 ? "12" : hr > 12 ? String(hr - 12) : String(hr);
                    return (
                      <ColBtn
                        key={hr}
                        active={hr === selHour}
                        onClick={() => pick(hr, selMinute ?? 0)}>
                        <span style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                          <span>{label}</span>
                          <span style={{ fontSize: 10, opacity: 0.6 }}>{period}</span>
                        </span>
                      </ColBtn>
                    );
                  })}
                </div>
              </div>

              {/* Minutes */}
              <div style={{ display: "flex", flexDirection: "column" }}>
                <div style={COL_LABEL}>Min</div>
                <div
                  ref={minColRef}
                  style={{ maxHeight: 220, overflowY: "auto", padding: "4px 5px 5px" }}>
                  {minutes.map(min => (
                    <ColBtn
                      key={min}
                      active={min === selMinute}
                      onClick={() => pick(selHour ?? 9, min)}>
                      :{String(min).padStart(2, "0")}
                    </ColBtn>
                  ))}
                </div>
              </div>
            </div>
          </div>,
          document.body
        )}
    </>
  );
}
