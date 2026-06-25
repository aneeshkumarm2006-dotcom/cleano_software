"use client";

import { useEffect, useState } from "react";
import { Calendar } from "lucide-react";
import { getAvailability } from "../../actions/getAvailability";
import { setAvailability } from "../../actions/setAvailability";
import type { AvailabilitySlotInput } from "../../actions/setAvailability.types";
import type { AvailabilityDay } from "@prisma/client";
import { SectionCard, Feedback, Msg } from "./_shared";
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

interface AvailabilityTabProps {
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

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      const res = await getAvailability(employeeId);
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
        if (first) {
          setIsRecurring(first.isRecurring);
          setEffectiveFrom(
            first.effectiveFrom
              ? new Date(first.effectiveFrom).toISOString().split("T")[0]
              : ""
          );
          setEffectiveTo(
            first.effectiveTo
              ? new Date(first.effectiveTo).toISOString().split("T")[0]
              : ""
          );
        }
      } else {
        setMsg({ type: "error", text: res.error });
      }
      setLoading(false);
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [employeeId]);

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

    const res = await setAvailability({ employeeId, slots });
    if (res.success) {
      setMsg({ type: "success", text: "Availability saved." });
    } else {
      setMsg({ type: "error", text: res.error || "Failed to save." });
    }
    setSaving(false);
  }

  return (
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
  );
}
