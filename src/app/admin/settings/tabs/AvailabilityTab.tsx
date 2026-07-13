"use client";

import { useEffect, useState } from "react";
import { Calendar, CalendarOff, Plus, Trash2 } from "lucide-react";
import {
  getAvailability,
  listAvailabilityEmployees,
} from "../../actions/getAvailability";
import { setAvailability } from "../../actions/setAvailability";
import {
  addAvailabilityException,
  deleteAvailabilityException,
} from "../../actions/availabilityExceptions";
import type { AvailabilitySlotInput } from "../../actions/setAvailability.types";
import type {
  AvailabilityEmployeeDTO,
  AvailabilityExceptionDTO,
} from "../../actions/getAvailability.types";
import type { AvailabilityDay } from "@prisma/client";
import { SectionCard, Feedback, Msg, themedInputClass, themedSelectClass } from "./_shared";
import TimePicker from "@/components/ui/TimePicker";
import DatePicker from "@/components/ui/DatePicker";

const DAYS: { key: AvailabilityDay; label: string }[] = [
  { key: "MONDAY", label: "Monday" },
  { key: "TUESDAY", label: "Tuesday" },
  { key: "WEDNESDAY", label: "Wednesday" },
  { key: "THURSDAY", label: "Thursday" },
  { key: "FRIDAY", label: "Friday" },
  { key: "SATURDAY", label: "Saturday" },
  { key: "SUNDAY", label: "Sunday" },
];

interface DayRow {
  day: AvailabilityDay;
  isAvailable: boolean;
  startTime: string;
  endTime: string;
}

const DEFAULT_ROW = (day: AvailabilityDay): DayRow => ({
  day,
  isAvailable: false,
  startTime: "09:00",
  endTime: "17:00",
});

function todayKey(): string {
  return new Date().toLocaleDateString("en-CA");
}

/** "2026-07-13" → "Mon, Jul 13, 2026" (no timezone maths — it's a plain date). */
function prettyDate(dateKey: string): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  if (!y || !m || !d) return dateKey;
  return new Date(y, m - 1, d).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

interface AvailabilityTabProps {
  /** When set, the tab edits THIS employee (the cleaner's own page passes their
   *  id). When omitted, an OWNER/ADMIN gets a picker and defaults to themselves. */
  employeeId?: string;
}

export default function AvailabilityTab({ employeeId }: AvailabilityTabProps) {
  const [rows, setRows] = useState<DayRow[]>(() => DAYS.map((d) => DEFAULT_ROW(d.key)));
  const [isRecurring, setIsRecurring] = useState(true);
  const [effectiveFrom, setEffectiveFrom] = useState("");
  const [effectiveTo, setEffectiveTo] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);

  // Blocked dates (one-off time off: vacation / appointment / sick day).
  const [exceptions, setExceptions] = useState<AvailabilityExceptionDTO[]>([]);
  const [blockDate, setBlockDate] = useState("");
  const [blockReason, setBlockReason] = useState("");
  const [blocking, setBlocking] = useState(false);
  const [blockMsg, setBlockMsg] = useState<Msg>(null);

  // Admin-only: which cleaner is being edited ("" = myself).
  const [employees, setEmployees] = useState<AvailabilityEmployeeDTO[]>([]);
  const [selectedId, setSelectedId] = useState<string>("");

  // The employee whose availability is on screen. A fixed `employeeId` prop
  // always wins (the cleaner page), otherwise the admin's picker decides.
  const targetId = employeeId ?? (selectedId || undefined);

  useEffect(() => {
    if (employeeId) return; // cleaner page — no picker
    let cancelled = false;
    listAvailabilityEmployees().then((list) => {
      if (!cancelled) setEmployees(list);
    });
    return () => {
      cancelled = true;
    };
  }, [employeeId]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      const res = await getAvailability(targetId);
      if (cancelled) return;
      if (res.success) {
        const byDay = new Map(res.slots.map((s) => [s.day, s]));
        setRows(
          DAYS.map((d) => {
            const slot = byDay.get(d.key);
            if (!slot) return DEFAULT_ROW(d.key);
            return {
              day: d.key,
              isAvailable: slot.isAvailable,
              startTime: slot.startTime,
              endTime: slot.endTime,
            };
          })
        );
        const first = res.slots[0];
        setIsRecurring(first ? first.isRecurring : true);
        setEffectiveFrom(
          first?.effectiveFrom
            ? new Date(first.effectiveFrom).toISOString().split("T")[0]
            : ""
        );
        setEffectiveTo(
          first?.effectiveTo
            ? new Date(first.effectiveTo).toISOString().split("T")[0]
            : ""
        );
        setExceptions(res.exceptions);
      } else {
        setMsg({ type: "error", text: res.error });
      }
      setLoading(false);
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [targetId]);

  function updateRow(day: AvailabilityDay, patch: Partial<DayRow>) {
    setRows((prev) =>
      prev.map((r) => (r.day === day ? { ...r, ...patch } : r))
    );
  }

  async function handleSave() {
    setSaving(true);
    setMsg(null);

    for (const r of rows) {
      if (r.isAvailable && r.startTime >= r.endTime) {
        setMsg({
          type: "error",
          text: `End time must be after start time on ${r.day}.`,
        });
        setSaving(false);
        return;
      }
    }

    const slots: AvailabilitySlotInput[] = rows.map((r) => ({
      day: r.day,
      startTime: r.startTime,
      endTime: r.endTime,
      isAvailable: r.isAvailable,
      isRecurring,
      effectiveFrom: effectiveFrom || null,
      effectiveTo: effectiveTo || null,
    }));

    const res = await setAvailability({ employeeId: targetId, slots });
    if (res.success) {
      setMsg({ type: "success", text: "Availability saved." });
    } else {
      setMsg({ type: "error", text: res.error || "Failed to save." });
    }
    setSaving(false);
  }

  async function handleBlockDate() {
    if (!blockDate) {
      setBlockMsg({ type: "error", text: "Pick a date to block." });
      return;
    }
    setBlocking(true);
    setBlockMsg(null);

    const res = await addAvailabilityException({
      employeeId: targetId,
      date: blockDate,
      reason: blockReason.trim() || null,
    });

    if (res.success) {
      setExceptions((prev) => {
        const rest = prev.filter((e) => e.date !== res.exception.date);
        return [...rest, res.exception].sort((a, b) =>
          a.date.localeCompare(b.date)
        );
      });
      setBlockDate("");
      setBlockReason("");
      setBlockMsg({ type: "success", text: "Date blocked." });
    } else {
      setBlockMsg({ type: "error", text: res.error });
    }
    setBlocking(false);
  }

  async function handleUnblock(id: string) {
    setBlockMsg(null);
    const previous = exceptions;
    setExceptions((prev) => prev.filter((e) => e.id !== id));
    const res = await deleteAvailabilityException(id);
    if (!res.success) {
      setExceptions(previous);
      setBlockMsg({ type: "error", text: res.error });
    }
  }

  const showPicker = !employeeId && employees.length > 0;

  return (
    <div className="stack-24">
      {showPicker && (
        <SectionCard
          title="Whose availability?"
          description="Pick a cleaner to view and edit their schedule, or leave it on yourself."
          icon={Calendar}>
          <select
            className={themedSelectClass}
            value={selectedId}
            onChange={(e) => {
              setSelectedId(e.target.value);
              setMsg(null);
              setBlockMsg(null);
            }}>
            <option value="">Myself</option>
            {employees.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
          </select>
        </SectionCard>
      )}

      <SectionCard
        title="Weekly availability"
        description="Mark the days and hours you're available for jobs."
        icon={Calendar}>
        {loading ? (
          <p style={{ fontSize: 13, color: "var(--primary-60)" }}>Loading availability...</p>
        ) : (
          <>
            {rows.map((row) => {
              const label = DAYS.find((d) => d.key === row.day)?.label ?? row.day;
              return (
                <div key={row.day} className={`cl-avail-row${row.isAvailable ? "" : " disabled"}`}>
                  <div className="day-name">{label}</div>
                  <label className="avail-check">
                    <input
                      type="checkbox"
                      className="cl-checkbox"
                      checked={row.isAvailable}
                      onChange={(e) => updateRow(row.day, { isAvailable: e.target.checked })}
                    />
                    <span>Available</span>
                  </label>
                  <TimePicker
                    size="sm"
                    value={row.startTime}
                    disabled={!row.isAvailable}
                    onChange={(v) => updateRow(row.day, { startTime: v })}
                  />
                  <span className="sep">to</span>
                  <TimePicker
                    size="sm"
                    value={row.endTime}
                    disabled={!row.isAvailable}
                    onChange={(v) => updateRow(row.day, { endTime: v })}
                  />
                </div>
              );
            })}

            <div className="cl-avail-foot">
              <label className="avail-check" style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 14, color: "var(--ink)" }}>
                <input type="checkbox" className="cl-checkbox" checked={isRecurring} onChange={(e) => setIsRecurring(e.target.checked)} />
                <span>Recurring weekly</span>
              </label>
              <div className="cl-avail-eff">
                <div>
                  <label className="cl-form-label">Effective from</label>
                  <DatePicker size="sm" value={effectiveFrom} onChange={setEffectiveFrom} placeholder="Any time" />
                </div>
                <div>
                  <label className="cl-form-label">Effective to</label>
                  <DatePicker size="sm" value={effectiveTo} onChange={setEffectiveTo} placeholder="Ongoing" />
                </div>
              </div>
            </div>

            {msg && <Feedback msg={msg} />}

            <div className="cl-form-actions" style={{ marginTop: 18 }}>
              <button type="button" className="cl-form-save" disabled={saving} onClick={handleSave}>
                {saving ? "Saving..." : "Save availability"}
              </button>
            </div>
          </>
        )}
      </SectionCard>

      {/* One-off time off. Beats the weekly rule above: a blocked date always
          reads as unavailable, and the admin sees a warning if someone is
          scheduled on it anyway. */}
      <SectionCard
        title="Time off / blocked dates"
        description="Block specific days — vacation, an appointment, a sick day. These override the weekly schedule."
        icon={CalendarOff}>
        {loading ? (
          <p style={{ fontSize: 13, color: "var(--primary-60)" }}>Loading blocked dates...</p>
        ) : (
          <>
            {exceptions.length === 0 ? (
              <p style={{ fontSize: 13, color: "var(--primary-50)", margin: "0 0 14px" }}>
                No blocked dates. Every day follows the weekly schedule above.
              </p>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 16 }}>
                {exceptions.map((e) => (
                  <div
                    key={e.id}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      padding: "10px 12px",
                      borderRadius: 12,
                      background: "rgba(220,38,38,0.04)",
                      border: "1px solid rgba(220,38,38,0.12)",
                    }}>
                    <CalendarOff size={14} style={{ color: "#dc2626", flexShrink: 0 }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13.5, fontWeight: 600, color: "var(--ink)" }}>
                        {prettyDate(e.date)}
                      </div>
                      <div style={{ fontSize: 12, color: "var(--primary-60)" }}>
                        {e.reason || "Unavailable all day"}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleUnblock(e.id)}
                      aria-label={`Unblock ${e.date}`}
                      style={{
                        padding: "5px 9px",
                        borderRadius: 8,
                        background: "transparent",
                        border: "1px solid rgba(220,38,38,0.2)",
                        color: "#dc2626",
                        cursor: "pointer",
                        flexShrink: 0,
                      }}>
                      <Trash2 size={12} />
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "minmax(150px, 200px) 1fr auto",
                gap: 10,
                alignItems: "end",
              }}>
              <div>
                <label className="cl-form-label">Date</label>
                <DatePicker
                  size="sm"
                  value={blockDate}
                  onChange={setBlockDate}
                  min={todayKey()}
                  placeholder="Pick a date"
                />
              </div>
              <div>
                <label className="cl-form-label">Reason (optional)</label>
                <input
                  className={themedInputClass}
                  style={{ padding: "7px 12px", fontSize: 13 }}
                  value={blockReason}
                  maxLength={200}
                  onChange={(e) => setBlockReason(e.target.value)}
                  placeholder="Vacation, appointment, sick day…"
                />
              </div>
              <button
                type="button"
                className="cl-form-save"
                disabled={blocking || !blockDate}
                onClick={handleBlockDate}
                style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                <Plus size={14} />
                {blocking ? "Blocking..." : "Block date"}
              </button>
            </div>

            {blockMsg && (
              <div style={{ marginTop: 14 }}>
                <Feedback msg={blockMsg} />
              </div>
            )}
          </>
        )}
      </SectionCard>
    </div>
  );
}
