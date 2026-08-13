"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import {
  BookingDraft,
  BOOKING_DAY_START,
  BOOKING_DAY_END,
  TIME_SLOT_SUGGESTIONS,
} from "../types";
import { Field } from "@/components/customer/Field";
import { ChoiceButton } from "@/components/customer/atoms";
import DatePicker from "@/components/customer/DatePicker";
import {
  getDayAvailability,
  type DayAvailability,
} from "../../actions/getDayAvailability";
import { getDateClosures } from "../../actions/getDateClosures";
import {
  BOOKING_PAGE_DEFAULTS,
  resolveField,
  type BookingPageConfig,
} from "@/lib/booking-page-config";

/** "14:30" → "2:30 PM", "09:00" → "9 AM" */
function formatTimeLabel(t: string): string {
  const [hStr, mStr] = t.split(":");
  const hour = parseInt(hStr, 10);
  const min = parseInt(mStr, 10);
  const period = hour >= 12 ? "PM" : "AM";
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  return min === 0
    ? `${h12} ${period}`
    : `${h12}:${mStr.padStart(2, "0")} ${period}`;
}

interface Props {
  draft: BookingDraft;
  onChange: (patch: Partial<BookingDraft>) => void;
  /** Minimum days ahead a customer can book (admin setting; default 1). */
  minLeadDays?: number;
  /** Admin-editable field layout (item 17). Defaults = today's rendering. */
  bookingPage?: BookingPageConfig;
}

function earliestISO(leadDays: number) {
  const d = new Date();
  d.setDate(d.getDate() + Math.max(1, leadDays));
  return d.toISOString().slice(0, 10);
}
function maxISO() {
  const d = new Date();
  d.setDate(d.getDate() + 90);
  return d.toISOString().slice(0, 10);
}

export default function Step3Schedule({
  draft,
  onChange,
  minLeadDays = 1,
  bookingPage = BOOKING_PAGE_DEFAULTS,
}: Props) {
  // Labels and help text for this step come from the admin config (item 17).
  const dateField = resolveField(bookingPage, "schedule", "date", draft.serviceType);
  const timeField = resolveField(bookingPage, "schedule", "timeSlot", draft.serviceType);
  const timeSlotVisible = timeField?.visible ?? true;
  const [availability, setAvailability] = useState<DayAvailability>({
    ranges: [],
    fullTimes: [],
  });
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
    if (!draft.date) {
      setAvailability({ ranges: [], fullTimes: [] });
      return;
    }
    startTransition(async () => {
      const data = await getDayAvailability(draft.date);
      setAvailability(data);
    });
  }, [draft.date]);

  // Why a chosen "HH:MM" can't be booked, or null when it's fine. Range
  // boundaries are [start, end); HH:MM strings compare correctly as text.
  function timeUnavailableReason(t: string): string | null {
    if (!t) return null;
    if (t < BOOKING_DAY_START || t > BOOKING_DAY_END) {
      return `Please choose a time between ${formatTimeLabel(
        BOOKING_DAY_START
      )} and ${formatTimeLabel(BOOKING_DAY_END)}.`;
    }
    for (const r of availability.ranges) {
      if (t >= r.start && t < r.end) {
        return r.reason
          ? `Unavailable (${r.reason}). Please choose another time.`
          : "That time isn't available. Please choose another.";
      }
    }
    if (availability.fullTimes.includes(t)) {
      return "That time is fully booked. Please choose another.";
    }
    return null;
  }

  const selectedTimeError = useMemo(
    () => timeUnavailableReason(draft.timeSlot),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [draft.timeSlot, availability]
  );

  // With the time field hidden there is no way to pick a slot, so a draft left
  // on "Pick a time" by an earlier config would strand the customer on a step
  // whose Continue never enables. Fall back to flexible.
  useEffect(() => {
    if (!timeSlotVisible && (!draft.isFlexible || draft.timeSlot)) {
      onChange({ isFlexible: true, timeSlot: "" });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeSlotVisible, draft.isFlexible, draft.timeSlot]);

  // Keep the draft's validity flag in sync so the wizard can gate "Next".
  const computedValid = draft.timeSlot ? selectedTimeError === null : undefined;
  useEffect(() => {
    if (draft.timeSlotValid !== computedValid) {
      onChange({ timeSlotValid: computedValid });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [computedValid]);

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

      <Field label={dateField?.label ?? "Preferred date"} hint={dateField?.helpText || undefined}>
        <DatePicker
          value={draft.date}
          onChange={(iso) => onChange({ date: iso })}
          min={earliestISO(minLeadDays)}
          max={maxISO()}
          disabledDates={blockedDates}
          blockedReasons={blockedReasons}
          placeholder="Choose your preferred date"
        />
      </Field>

      {/* An admin who hides the time field leaves every booking flexible —
          the team confirms the exact slot, which is what the banner says. */}
      {timeSlotVisible && (
        <div className="cl-grid-2">
          <ChoiceButton
            large
            active={draft.isFlexible}
            title="I'm flexible"
            sub="Our team picks the best time for the day (9AM–7PM)."
            onClick={() => onChange({ isFlexible: true, timeSlot: "" })}
          />
          <ChoiceButton
            large
            active={!draft.isFlexible}
            title="Pick a time"
            sub="Choose any time between 9 AM and 7 PM."
            onClick={() => onChange({ isFlexible: false })}
          />
        </div>
      )}

      {draft.isFlexible && (
        <div style={{
          background: "rgba(0,140,156,0.06)",
          borderRadius: 12,
          padding: "12px 16px",
          fontSize: 14,
          color: "var(--primary)",
          fontWeight: 500,
        }}>
          Time window: <strong>9AM – 7PM</strong> · Our team will confirm your exact slot the day before.
        </div>
      )}

      {timeSlotVisible && !draft.isFlexible ? (
        <div className="cl-stack-12">
          <span className="cl-label">{timeField?.label ?? "Choose a time"}</span>
          {timeField?.helpText ? (
            <p style={{ fontSize: 12, color: "var(--primary-60)", margin: 0, lineHeight: 1.5 }}>
              {timeField.helpText}
            </p>
          ) : null}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(84px, 1fr))",
              gap: 10,
            }}>
            {TIME_SLOT_SUGGESTIONS.map((slot) => {
              const disabled = timeUnavailableReason(slot) !== null;
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
                    padding: "16px 8px",
                    fontSize: 15,
                    fontWeight: 500,
                  }}>
                  {formatTimeLabel(slot)}
                </button>
              );
            })}
          </div>

          <Field label="Or enter an exact time">
            <input
              type="time"
              className="cl-input"
              value={draft.timeSlot}
              min={BOOKING_DAY_START}
              max={BOOKING_DAY_END}
              step={300}
              onChange={(e) => onChange({ timeSlot: e.target.value })}
            />
          </Field>

          {selectedTimeError ? (
            <div style={{ fontSize: 12, color: "var(--danger, #c0392b)" }}>
              {selectedTimeError}
            </div>
          ) : (
            <div style={{ fontSize: 12, color: "var(--primary-50)" }}>
              Any time between {formatTimeLabel(BOOKING_DAY_START)} and{" "}
              {formatTimeLabel(BOOKING_DAY_END)} — greyed times are unavailable.
            </div>
          )}

          {availability.ranges.length > 0 ? (
            <div style={{ fontSize: 12, color: "var(--primary-50)" }}>
              Blocked this day:{" "}
              {availability.ranges
                .map(
                  (r) =>
                    `${formatTimeLabel(r.start)}–${formatTimeLabel(r.end)}${
                      r.reason ? ` (${r.reason})` : ""
                    }`
                )
                .join(", ")}
              .
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
