"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, ChevronRight, Calendar as CalendarIcon } from "lucide-react";

interface DatePickerProps {
  value: string; // YYYY-MM-DD
  onChange: (iso: string) => void;
  min?: string; // YYYY-MM-DD
  max?: string;
  placeholder?: string;
  /** Fully-closed days ("YYYY-MM-DD") that can't be selected. */
  disabledDates?: string[];
  /** Reason per closed day ("YYYY-MM-DD" → reason), shown when one is tapped. */
  blockedReasons?: Record<string, string>;
}

const DAY_LABELS = ["S", "M", "T", "W", "T", "F", "S"];
const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

function toISO(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function fromISO(s: string): Date | null {
  if (!s) return null;
  const [y, m, d] = s.split("-").map((n) => parseInt(n, 10));
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}
function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

export default function DatePicker({
  value,
  onChange,
  min,
  max,
  placeholder = "Select a date",
  disabledDates,
  blockedReasons,
}: DatePickerProps) {
  const blockedSet = new Set(disabledDates ?? []);
  const [blockedMsg, setBlockedMsg] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [popupPos, setPopupPos] = useState<{ top: number; left: number } | null>(
    null
  );
  const selected = fromISO(value);
  const minDate = fromISO(min ?? "");
  const maxDate = fromISO(max ?? "");
  const [viewMonth, setViewMonth] = useState<Date>(
    selected ?? minDate ?? new Date()
  );

  useEffect(() => setMounted(true), []);

  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open || !triggerRef.current) return;
    function reposition() {
      if (!triggerRef.current) return;
      const rect = triggerRef.current.getBoundingClientRect();
      const popupW = 340;
      const viewportW = window.innerWidth;
      const viewportH = window.innerHeight;
      let left = rect.left;
      if (left + popupW > viewportW - 12) {
        left = Math.max(12, viewportW - popupW - 12);
      }
      const estimatedHeight = 380;
      let top = rect.bottom + 8;
      if (top + estimatedHeight > viewportH - 12) {
        top = Math.max(12, rect.top - estimatedHeight - 8);
      }
      setPopupPos({ top, left });
    }
    reposition();
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    return () => {
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      const target = e.target as Node;
      if (rootRef.current?.contains(target)) return;
      if (popupRef.current?.contains(target)) return;
      setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const monthStart = new Date(viewMonth.getFullYear(), viewMonth.getMonth(), 1);
  const startWeekday = monthStart.getDay();
  const daysInMonth = new Date(
    viewMonth.getFullYear(),
    viewMonth.getMonth() + 1,
    0
  ).getDate();

  const cells: Array<{ date: Date | null; muted: boolean }> = [];
  for (let i = 0; i < startWeekday; i++) {
    const d = new Date(
      viewMonth.getFullYear(),
      viewMonth.getMonth(),
      i - startWeekday + 1
    );
    cells.push({ date: d, muted: true });
  }
  for (let day = 1; day <= daysInMonth; day++) {
    cells.push({
      date: new Date(viewMonth.getFullYear(), viewMonth.getMonth(), day),
      muted: false,
    });
  }
  while (cells.length < 42) {
    const last = cells[cells.length - 1].date!;
    const d = new Date(last);
    d.setDate(d.getDate() + 1);
    cells.push({ date: d, muted: true });
  }

  function outOfRange(d: Date): boolean {
    if (minDate && d < minDate) return true;
    if (maxDate && d > maxDate) return true;
    return false;
  }
  function isBlocked(d: Date): boolean {
    return blockedSet.has(toISO(d));
  }
  function isDisabled(d: Date): boolean {
    return outOfRange(d) || isBlocked(d);
  }

  function gotoPrev() {
    setViewMonth(new Date(viewMonth.getFullYear(), viewMonth.getMonth() - 1, 1));
  }
  function gotoNext() {
    setViewMonth(new Date(viewMonth.getFullYear(), viewMonth.getMonth() + 1, 1));
  }
  function pickToday() {
    const t = new Date();
    if (isDisabled(t)) return;
    onChange(toISO(t));
    setViewMonth(new Date(t.getFullYear(), t.getMonth(), 1));
    setOpen(false);
  }
  function clear() {
    onChange("");
    setOpen(false);
  }

  const displayLabel = selected
    ? selected.toLocaleDateString("en-US", {
        weekday: "short",
        month: "long",
        day: "numeric",
        year: "numeric",
      })
    : placeholder;

  const popup =
    open && popupPos ? (
      <div
        ref={popupRef}
        className="cl-dp-pop"
        role="dialog"
        aria-label="Choose a date"
        style={{
          position: "fixed",
          top: popupPos.top,
          left: popupPos.left,
        }}>
        <div className="cl-dp-head">
          <button
            type="button"
            className="cl-dp-nav"
            aria-label="Previous month"
            onClick={gotoPrev}>
            <ChevronLeft size={16} />
          </button>
          <div className="cl-dp-title">
            {MONTH_NAMES[viewMonth.getMonth()]} {viewMonth.getFullYear()}
          </div>
          <button
            type="button"
            className="cl-dp-nav"
            aria-label="Next month"
            onClick={gotoNext}>
            <ChevronRight size={16} />
          </button>
        </div>

        <div className="cl-dp-weekdays">
          {DAY_LABELS.map((d, i) => (
            <span key={i}>{d}</span>
          ))}
        </div>

        <div className="cl-dp-grid">
          {cells.map((cell, i) => {
            const d = cell.date!;
            const isSel = selected && isSameDay(d, selected);
            const oor = outOfRange(d);
            const blocked = isBlocked(d);
            const today = isSameDay(d, new Date());
            const cls = [
              "cl-dp-day",
              cell.muted ? "muted" : "",
              isSel ? "selected" : "",
              today && !isSel ? "today" : "",
              oor ? "disabled" : "",
            ]
              .filter(Boolean)
              .join(" ");
            return (
              <button
                key={i}
                type="button"
                className={cls}
                // Out-of-range days are hard-disabled. Blocked days stay
                // clickable so tapping one can explain why it's closed.
                disabled={oor}
                style={
                  blocked && !isSel
                    ? {
                        textDecoration: "line-through",
                        color: "var(--primary-40)",
                        cursor: "pointer",
                      }
                    : undefined
                }
                onClick={() => {
                  if (blocked) {
                    const r = blockedReasons?.[toISO(d)];
                    setBlockedMsg(
                      r && r.trim()
                        ? `Closed — ${r.trim()}`
                        : "This day is closed for booking."
                    );
                    return;
                  }
                  setBlockedMsg(null);
                  onChange(toISO(d));
                  if (cell.muted) {
                    setViewMonth(new Date(d.getFullYear(), d.getMonth(), 1));
                  }
                  setOpen(false);
                }}>
                {d.getDate()}
              </button>
            );
          })}
        </div>

        {blockedMsg && (
          <div
            style={{
              margin: "10px 12px 0",
              padding: "9px 12px",
              borderRadius: 10,
              background: "rgba(0,95,106,0.08)",
              color: "var(--primary)",
              fontSize: 12.5,
              lineHeight: 1.4,
            }}>
            {blockedMsg}
          </div>
        )}

        <div className="cl-dp-foot">
          <button type="button" className="cl-dp-link" onClick={clear}>
            Clear
          </button>
          <button type="button" className="cl-dp-link" onClick={pickToday}>
            Today
          </button>
        </div>
      </div>
    ) : null;

  return (
    <div className="cl-dp" ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className="cl-dp-trigger"
        onClick={() => {
          setBlockedMsg(null);
          setOpen((v) => !v);
        }}
        aria-haspopup="dialog"
        aria-expanded={open}>
        <span
          style={{
            flex: 1,
            color: selected ? "var(--ink)" : "var(--primary-40)",
          }}>
          {displayLabel}
        </span>
        <CalendarIcon size={18} style={{ color: "var(--primary-60)" }} />
      </button>

      {mounted && popup ? createPortal(popup, document.body) : null}
    </div>
  );
}
