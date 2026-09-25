"use client";

import { useState } from "react";
import { CalendarOff, Trash2, Plus } from "lucide-react";
import DatePicker from "@/components/ui/DatePicker";
import TimePicker from "@/components/ui/TimePicker";
import Button from "@/components/ui/Button";
import IconButton from "@/components/ui/IconButton";
import { updateAppSetting } from "../../actions/updateAppSetting";
import { AppSettingRecord, getSetting } from "../types";
import { SectionCard, Feedback, Msg, themedInputClass } from "./_shared";

const BLOCKED_DATES_KEY = "booking.blockedDates";
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const HH_MM = /^\d{2}:\d{2}$/;

interface Closure {
  id: string;
  date: string;
  allDay: boolean;
  start: string | null;
  end: string | null;
  reason: string | null;
}

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

function fmtDate(d: string) {
  const dt = new Date(`${d}T00:00:00`);
  return dt.toLocaleDateString("en-US", {
    weekday: "short",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

function timeLabel(t: string) {
  const [h, m] = t.split(":").map(Number);
  const period = h >= 12 ? "PM" : "AM";
  const hh = h % 12 || 12;
  return `${hh}:${String(m).padStart(2, "0")} ${period}`;
}

// Seed state from the stored setting, tolerating the legacy {dates,slots} shape.
function normalizeInitial(raw: Record<string, unknown>): Closure[] {
  if (Array.isArray(raw.closures)) {
    return raw.closures
      .map((c): Closure | null => {
        if (!c || typeof c !== "object") return null;
        const r = c as Record<string, unknown>;
        const date = typeof r.date === "string" && ISO_DATE.test(r.date) ? r.date : null;
        if (!date) return null;
        const allDay = r.allDay === true;
        const start = typeof r.start === "string" && HH_MM.test(r.start) ? r.start : null;
        const end = typeof r.end === "string" && HH_MM.test(r.end) ? r.end : null;
        if (!allDay && (!start || !end)) return null;
        const reason = typeof r.reason === "string" && r.reason.trim() ? r.reason.trim() : null;
        return { id: typeof r.id === "string" && r.id ? r.id : uid(), date, allDay, start, end, reason };
      })
      .filter((c): c is Closure => c !== null);
  }
  const out: Closure[] = [];
  if (Array.isArray(raw.dates)) {
    for (const d of raw.dates) {
      if (typeof d === "string" && ISO_DATE.test(d)) {
        out.push({ id: uid(), date: d, allDay: true, start: null, end: null, reason: null });
      }
    }
  }
  if (Array.isArray(raw.slots)) {
    for (const s of raw.slots) {
      if (!s || typeof s !== "object") continue;
      const r = s as { date?: unknown; times?: unknown };
      const date = typeof r.date === "string" && ISO_DATE.test(r.date) ? r.date : null;
      const times = Array.isArray(r.times)
        ? r.times.filter((t): t is string => typeof t === "string" && HH_MM.test(t))
        : [];
      if (!date) continue;
      for (const t of times) {
        out.push({ id: uid(), date, allDay: false, start: t, end: t, reason: null });
      }
    }
  }
  return out;
}

interface ClosuresTabProps {
  settings: AppSettingRecord[];
}

export default function ClosuresTab({ settings }: ClosuresTabProps) {
  const initialRaw = getSetting<Record<string, unknown>>(settings, BLOCKED_DATES_KEY, {});
  const [closures, setClosures] = useState<Closure[]>(() => normalizeInitial(initialRaw));

  const [pDate, setPDate] = useState("");
  const [allDay, setAllDay] = useState(true);
  const [pStart, setPStart] = useState("");
  const [pEnd, setPEnd] = useState("");
  const [pReason, setPReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);

  // Build a Closure from the pending fields, or return an error string.
  function buildPending(): { closure?: Closure; error?: string } {
    if (!pDate) return { error: "Pick a date." };
    if (!allDay) {
      if (!pStart || !pEnd)
        return { error: "Enter both a start and end time, or choose Entire day." };
      if (pStart >= pEnd) return { error: "End time must be after start time." };
    }
    return {
      closure: {
        id: uid(),
        date: pDate,
        allDay,
        start: allDay ? null : pStart,
        end: allDay ? null : pEnd,
        reason: pReason.trim() || null,
      },
    };
  }

  function clearPending() {
    setPDate("");
    setPStart("");
    setPEnd("");
    setPReason("");
  }

  function addClosure() {
    const { closure, error } = buildPending();
    if (!closure) {
      setMsg({ type: "error", text: error ?? "Invalid closure." });
      return;
    }
    setClosures((prev) => [...prev, closure]);
    clearPending();
    setMsg(null);
  }

  function remove(id: string) {
    setClosures((prev) => prev.filter((c) => c.id !== id));
  }

  async function handleSave() {
    // Fold in a not-yet-added pending entry so forgetting "Add closure" can't
    // silently save nothing. If the pending fields are partially filled but
    // invalid, surface the error instead of dropping them.
    let toSave = closures;
    if (pDate || pStart || pEnd || pReason.trim()) {
      const { closure, error } = buildPending();
      if (!closure) {
        setMsg({ type: "error", text: error ?? "Finish the closure you're adding." });
        return;
      }
      toSave = [...closures, closure];
      setClosures(toSave);
      clearPending();
    }

    setSaving(true);
    setMsg(null);
    const res = await updateAppSetting({
      key: BLOCKED_DATES_KEY,
      category: "booking",
      value: { closures: toSave },
    });
    setMsg(
      res.success
        ? { type: "success", text: "Closures saved." }
        : { type: "error", text: res.error ?? "Failed to save." }
    );
    setSaving(false);
  }

  const sorted = [...closures].sort(
    (a, b) => a.date.localeCompare(b.date) || (a.start ?? "").localeCompare(b.start ?? "")
  );

  return (
    <SectionCard
      title="Closed dates & times"
      description="Block whole days or specific time ranges so customers can't book them. Existing jobs are unaffected — this only gates new bookings."
      icon={CalendarOff}>
      {/* Builder */}
      <div style={{ display: "flex", flexDirection: "column", gap: 14, marginBottom: 20 }}>
        <div style={{ display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap" }}>
          <div style={{ minWidth: 220 }}>
            <label className="cl-form-label">Date</label>
            <DatePicker size="sm" value={pDate} onChange={setPDate} placeholder="Choose a date" />
          </div>

          <div>
            <label className="cl-form-label">What to close</label>
            <div style={{ display: "flex", background: "var(--primary-5)", borderRadius: 10, padding: 3, gap: 2 }}>
              {([["day", "Entire day"], ["range", "Time range"]] as const).map(([val, label]) => {
                const active = (val === "day") === allDay;
                return (
                  <button
                    key={val}
                    type="button"
                    onClick={() => setAllDay(val === "day")}
                    style={{
                      padding: "7px 14px",
                      borderRadius: 8,
                      fontSize: 13,
                      fontWeight: active ? 600 : 400,
                      background: active ? "var(--primary)" : "transparent",
                      color: active ? "#fff" : "var(--primary-70)",
                      border: "none",
                      cursor: "pointer",
                    }}>
                    {label}
                  </button>
                );
              })}
            </div>
          </div>

          {!allDay && (
            <>
              <div style={{ width: 130 }}>
                <label className="cl-form-label">From</label>
                <TimePicker size="sm" value={pStart} onChange={setPStart} placeholder="Start" />
              </div>
              <div style={{ width: 130 }}>
                <label className="cl-form-label">To</label>
                <TimePicker size="sm" value={pEnd} onChange={setPEnd} placeholder="End" />
              </div>
            </>
          )}
        </div>

        <div style={{ display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: 240 }}>
            <label className="cl-form-label">Reason (shown to your team)</label>
            <input
              className={themedInputClass}
              value={pReason}
              onChange={(e) => setPReason(e.target.value)}
              placeholder="e.g. Public holiday, team training, fully booked"
            />
          </div>
          <Button
            type="button"
            variant="default"
            border={false}
            size="sm"
            onClick={addClosure}
            className="rounded-xl">
            <Plus className="w-4 h-4 mr-1" /> Add closure
          </Button>
        </div>
      </div>

      <p style={{ fontSize: 12, color: "var(--primary-50)", margin: "-8px 0 18px" }}>
        Click <strong>Add closure</strong> to put each one in the list below, then{" "}
        <strong>Save closures</strong>.
      </p>

      {/* List */}
      {sorted.length === 0 ? (
        <p style={{ fontSize: 13, color: "var(--primary-60)" }}>
          No closures. Customers can book any available day and time.
        </p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {sorted.map((c) => (
            <div
              key={c.id}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 12,
                padding: "10px 14px",
                borderRadius: 12,
                background: "var(--primary-5)",
              }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 14, color: "var(--ink)" }}>
                  {fmtDate(c.date)}
                  {" — "}
                  {c.allDay ? (
                    <strong>Entire day</strong>
                  ) : (
                    <strong>
                      {timeLabel(c.start!)} – {timeLabel(c.end!)}
                    </strong>
                  )}
                </div>
                {c.reason && (
                  <div style={{ fontSize: 12.5, color: "var(--primary-60)", marginTop: 2 }}>
                    {c.reason}
                  </div>
                )}
              </div>
              <IconButton
                icon={Trash2}
                variant="ghost"
                size="sm"
                onClick={() => remove(c.id)}
                className="text-red-500"
              />
            </div>
          ))}
        </div>
      )}

      {msg && (
        <div style={{ marginTop: 16 }}>
          <Feedback msg={msg} />
        </div>
      )}

      <div className="cl-form-actions" style={{ marginTop: 18 }}>
        <button type="button" className="cl-form-save" disabled={saving} onClick={handleSave}>
          {saving ? "Saving..." : "Save closures"}
        </button>
      </div>
    </SectionCard>
  );
}
