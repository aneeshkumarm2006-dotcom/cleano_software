"use client";

import React, { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { Calendar, ChevronLeft, ChevronRight } from "lucide-react";

interface DatePickerProps {
  value?: string;       // "YYYY-MM-DD"
  onChange?: (value: string) => void;
  placeholder?: string;
  min?: string;         // "YYYY-MM-DD"
  max?: string;         // "YYYY-MM-DD"
  disabled?: boolean;
  error?: boolean;
  size?: "sm" | "md" | "lg";
  name?: string;
  className?: string;
  style?: React.CSSProperties;
}

const MONTHS = [
  "January","February","March","April","May","June",
  "July","August","September","October","November","December",
];
const DAY_LABELS = ["Su","Mo","Tu","We","Th","Fr","Sa"];

function parseISO(str?: string): Date | null {
  if (!str) return null;
  const [y, m, d] = str.split("-").map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}

function toISO(date: Date): string {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

function formatDisplay(str?: string): string {
  const d = parseISO(str);
  if (!d) return "";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

const H = { sm: 34, md: 44, lg: 52 } as const;
const FS = { sm: 13, md: 14, lg: 15 } as const;
const BR = { sm: 9, md: 10, lg: 12 } as const;

export default function DatePicker({
  value,
  onChange,
  placeholder = "Select date",
  min,
  max,
  disabled = false,
  error = false,
  size = "md",
  name,
  className = "",
  style,
}: DatePickerProps) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });

  const sel = parseISO(value);
  const [viewYear, setViewYear] = useState(sel?.getFullYear() ?? today.getFullYear());
  const [viewMonth, setViewMonth] = useState(sel?.getMonth() ?? today.getMonth());

  const triggerRef = useRef<HTMLButtonElement>(null);
  const calRef = useRef<HTMLDivElement>(null);

  const minDate = parseISO(min);
  const maxDate = parseISO(max);

  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    const d = parseISO(value);
    if (d) { setViewYear(d.getFullYear()); setViewMonth(d.getMonth()); }
  }, [value]);

  function updatePos() {
    if (!triggerRef.current) return;
    const r = triggerRef.current.getBoundingClientRect();
    const CAL_W = 300;
    const CAL_H = calRef.current?.offsetHeight || 360;
    let left = r.left;
    if (left + CAL_W > window.innerWidth - 12) left = r.right - CAL_W;
    if (left < 12) left = 12;
    // Flip above the trigger when there isn't room below it (viewport-relative,
    // since the calendar is rendered with position: fixed).
    const spaceBelow = window.innerHeight - r.bottom;
    const top =
      spaceBelow < CAL_H + 12 && r.top > spaceBelow
        ? Math.max(12, r.top - 5 - CAL_H)
        : r.bottom + 5;
    setPos({ top, left });
  }

  useEffect(() => {
    if (!open) return;
    updatePos();
    const onSR = () => updatePos();
    document.addEventListener("scroll", onSR, true);
    window.addEventListener("resize", onSR);
    return () => {
      document.removeEventListener("scroll", onSR, true);
      window.removeEventListener("resize", onSR);
    };
  }, [open]);

  useEffect(() => {
    function onOut(e: MouseEvent) {
      if (
        calRef.current?.contains(e.target as Node) ||
        triggerRef.current?.contains(e.target as Node)
      ) return;
      setOpen(false);
    }
    document.addEventListener("mousedown", onOut);
    return () => document.removeEventListener("mousedown", onOut);
  }, []);

  function cells(): (number | null)[] {
    const firstDay = new Date(viewYear, viewMonth, 1).getDay();
    const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
    const arr: (number | null)[] = Array(firstDay).fill(null);
    for (let d = 1; d <= daysInMonth; d++) arr.push(d);
    while (arr.length % 7 !== 0) arr.push(null);
    return arr;
  }

  function dayDisabled(day: number) {
    const d = new Date(viewYear, viewMonth, day);
    if (minDate && d < minDate) return true;
    if (maxDate && d > maxDate) return true;
    return false;
  }

  function daySelected(day: number) {
    return (
      sel?.getFullYear() === viewYear &&
      sel?.getMonth() === viewMonth &&
      sel?.getDate() === day
    );
  }

  function dayIsToday(day: number) {
    return (
      today.getFullYear() === viewYear &&
      today.getMonth() === viewMonth &&
      today.getDate() === day
    );
  }

  function pickDay(day: number) {
    onChange?.(toISO(new Date(viewYear, viewMonth, day)));
    setOpen(false);
  }

  function prevMonth() {
    if (viewMonth === 0) { setViewMonth(11); setViewYear(y => y - 1); }
    else setViewMonth(m => m - 1);
  }

  function nextMonth() {
    if (viewMonth === 11) { setViewMonth(0); setViewYear(y => y + 1); }
    else setViewMonth(m => m + 1);
  }

  const border = error
    ? "1.5px solid #f87171"
    : open
    ? "1.5px solid #008C9C"
    : "1px solid rgba(0,140,156,0.16)";
  const boxShadow = open ? "0 0 0 3px rgba(0,140,156,0.11)" : "none";

  const NAV_BTN: React.CSSProperties = {
    width: 30, height: 30, borderRadius: 8, border: 0,
    background: "rgba(0,140,156,0.06)", color: "#008C9C",
    cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
    flexShrink: 0,
  };

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
          color: value ? "#111" : "rgba(0,140,156,0.38)",
          fontFamily: "inherit",
          cursor: disabled ? "not-allowed" : "pointer",
          transition: "border .15s, box-shadow .15s",
          boxShadow,
          gap: 8,
          outline: "none",
          opacity: disabled ? 0.55 : 1,
          ...style,
        }}>
        <Calendar size={14} style={{ flexShrink: 0, color: "rgba(0,140,156,0.45)" }} />
        <span style={{ flex: 1, textAlign: "left" }}>
          {value ? formatDisplay(value) : placeholder}
        </span>
      </button>

      {mounted &&
        open &&
        createPortal(
          <div
            ref={calRef}
            style={{
              position: "fixed",
              top: pos.top,
              left: pos.left,
              width: 300,
              zIndex: 9999,
              background: "#fff",
              borderRadius: 18,
              border: "1px solid rgba(0,140,156,0.1)",
              boxShadow: "0 12px 40px rgba(0,140,156,0.14), 0 2px 8px rgba(0,0,0,0.05)",
              padding: "18px 16px 14px",
              animation: "ps-drop .16s cubic-bezier(.2,.8,.3,1) both",
            }}>
            {/* Month nav */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                marginBottom: 14,
              }}>
              <button type="button" onClick={prevMonth} style={NAV_BTN}>
                <ChevronLeft size={15} />
              </button>
              <span
                style={{
                  fontSize: 14,
                  fontWeight: 700,
                  color: "#0a2e32",
                  letterSpacing: "-0.01em",
                }}>
                {MONTHS[viewMonth]} {viewYear}
              </span>
              <button type="button" onClick={nextMonth} style={NAV_BTN}>
                <ChevronRight size={15} />
              </button>
            </div>

            {/* Day headers */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(7, 1fr)",
                marginBottom: 4,
              }}>
              {DAY_LABELS.map(d => (
                <div
                  key={d}
                  style={{
                    textAlign: "center",
                    fontSize: 10,
                    fontWeight: 700,
                    color: "rgba(0,140,156,0.35)",
                    textTransform: "uppercase",
                    letterSpacing: "0.07em",
                    padding: "3px 0",
                  }}>
                  {d}
                </div>
              ))}
            </div>

            {/* Grid */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 2 }}>
              {cells().map((day, i) => {
                if (!day) return <div key={i} />;
                const isS = daySelected(day);
                const isT = dayIsToday(day);
                const isD = dayDisabled(day);
                return (
                  <button
                    key={i}
                    type="button"
                    disabled={isD}
                    onClick={() => pickDay(day)}
                    style={{
                      width: "100%",
                      aspectRatio: "1",
                      borderRadius: 8,
                      border: isT && !isS ? "1.5px solid rgba(0,140,156,0.28)" : 0,
                      fontSize: 13,
                      fontWeight: isS ? 700 : isT ? 600 : 400,
                      background: isS ? "#008C9C" : "transparent",
                      color: isS ? "#fff" : isD ? "rgba(0,140,156,0.22)" : isT ? "#008C9C" : "#1a1a1a",
                      cursor: isD ? "not-allowed" : "pointer",
                      fontFamily: "inherit",
                      transition: "background .1s, color .1s",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                    onMouseEnter={e => {
                      if (!isD && !isS)
                        (e.currentTarget as HTMLButtonElement).style.background =
                          "rgba(0,140,156,0.08)";
                    }}
                    onMouseLeave={e => {
                      if (!isS)
                        (e.currentTarget as HTMLButtonElement).style.background =
                          "transparent";
                    }}>
                    {day}
                  </button>
                );
              })}
            </div>

            {/* Footer */}
            <div
              style={{
                borderTop: "1px solid rgba(0,140,156,0.08)",
                marginTop: 12,
                paddingTop: 10,
                display: "flex",
                justifyContent: "space-between",
              }}>
              <button
                type="button"
                onClick={() => {
                  onChange?.(toISO(today));
                  setOpen(false);
                }}
                style={{
                  fontSize: 12,
                  fontWeight: 600,
                  color: "#008C9C",
                  background: "none",
                  border: 0,
                  cursor: "pointer",
                  fontFamily: "inherit",
                  padding: 0,
                }}>
                Today
              </button>
              {value && (
                <button
                  type="button"
                  onClick={() => { onChange?.(""); setOpen(false); }}
                  style={{
                    fontSize: 12,
                    color: "rgba(0,140,156,0.45)",
                    background: "none",
                    border: 0,
                    cursor: "pointer",
                    fontFamily: "inherit",
                    padding: 0,
                  }}>
                  Clear
                </button>
              )}
            </div>
          </div>,
          document.body
        )}
    </>
  );
}
