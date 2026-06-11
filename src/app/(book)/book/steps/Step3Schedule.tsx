"use client";

import { useEffect, useState, useTransition } from "react";
import { BookingDraft, TIME_SLOTS } from "../types";
import { Field } from "@/components/customer/Field";
import { ChoiceButton } from "@/components/customer/atoms";
import DatePicker from "@/components/customer/DatePicker";
import { getUnavailableSlots } from "../../actions/getUnavailableSlots";
import { getDateClosures } from "../../actions/getDateClosures";

interface Props {
  draft: BookingDraft;
  onChange: (patch: Partial<BookingDraft>) => void;
}

function todayISO() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}
function maxISO() {
  const d = new Date();
  d.setDate(d.getDate() + 90);
  return d.toISOString().slice(0, 10);
}

export default function Step3Schedule({ draft, onChange }: Props) {
  const [unavailableSlots, setUnavailableSlots] = useState<string[]>([]);
  const [blockedDates, setBlockedDates] = useState<string[]>([]);
  const [blockedReasons, setBlockedReasons] = useState<Record<string, string>>({});
  const [, startTransition] = useTransition();

  // Load admin-configured fully-closed days (with reasons) once, and clear the
  // selection if the currently-picked date is one of them.
  useEffect(() => {
    let cancelled = false;
    getDateClosures().then((list) => {
      if (cancelled) return;
      setBlockedDates(list.map((c) => c.date));
      const reasons: Record<string, string> = {};
      for (const c of list) if (c.reason) reasons[c.date] = c.reason;
      setBlockedReasons(reasons);
      if (draft.date && list.some((c) => c.date === draft.date)) {
        onChange({ date: "", timeSlot: "" });
      }
    });
    return () => {
      cancelled = true;
    };
    // Intentionally run once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!draft.date) { setUnavailableSlots([]); return; }
    startTransition(async () => {
      const slots = await getUnavailableSlots(draft.date);
      setUnavailableSlots(slots);
    });
  }, [draft.date]);

  const UNAVAILABLE_SLOTS = unavailableSlots;

  return (
    <div className="cl-stack-32">
      <header className="cl-stack-8">
        <p className="cl-eyebrow">Step 3</p>
        <h1
          className="cl-display"
          style={{ fontSize: "clamp(34px, 4.4vw, 52px)" }}>
          When works
          <br />
          for <em>you?</em>
        </h1>
        <p className="cl-subtitle">
          Pick a date, then choose a time slot or stay flexible.
        </p>
      </header>

      <Field label="Preferred date">
        <DatePicker
          value={draft.date}
          onChange={(iso) => onChange({ date: iso })}
          min={todayISO()}
          max={maxISO()}
          disabledDates={blockedDates}
          blockedReasons={blockedReasons}
          placeholder="Choose your preferred date"
        />
      </Field>

      <div className="cl-grid-2">
        <ChoiceButton
          large
          active={draft.isFlexible}
          title="I'm flexible"
          sub="Our team picks the best time for the day (9AM–7PM) — usually $10 less."
          onClick={() => onChange({ isFlexible: true, timeSlot: "" })}
        />
        <ChoiceButton
          large
          active={!draft.isFlexible}
          title="Pick a time"
          sub="Choose from available slots."
          onClick={() => onChange({ isFlexible: false })}
        />
      </div>

      {draft.isFlexible && (
        <div style={{
          background: "rgba(0,95,106,0.06)",
          borderRadius: 12,
          padding: "12px 16px",
          fontSize: 14,
          color: "var(--primary)",
          fontWeight: 500,
        }}>
          Time window: <strong>9AM – 7PM</strong> · Our team will confirm your exact slot the day before.
        </div>
      )}

      {!draft.isFlexible ? (
        <div className="cl-stack-12">
          <span className="cl-label">Available time slots</span>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(4, 1fr)",
              gap: 10,
            }}>
            {TIME_SLOTS.map((slot) => {
              const [h] = slot.split(":");
              const hour = parseInt(h);
              const label = `${hour > 12 ? hour - 12 : hour} ${
                hour >= 12 ? "PM" : "AM"
              }`;
              const disabled = UNAVAILABLE_SLOTS.includes(slot);
              const active = draft.timeSlot === slot;
              return (
                <button
                  key={slot}
                  type="button"
                  className={`cl-choice ${active ? "active" : ""}`}
                  disabled={disabled}
                  onClick={() => onChange({ timeSlot: slot })}
                  style={{
                    justifyContent: "center",
                    alignItems: "center",
                    opacity: disabled ? 0.4 : 1,
                    cursor: disabled ? "not-allowed" : "pointer",
                    textAlign: "center",
                    padding: "18px 8px",
                    fontSize: 15,
                    fontWeight: 500,
                  }}>
                  {label}
                </button>
              );
            })}
          </div>
          <div style={{ fontSize: 12, color: "var(--primary-50)" }}>
            Greyed slots mean no capacity.
          </div>
        </div>
      ) : null}
    </div>
  );
}
