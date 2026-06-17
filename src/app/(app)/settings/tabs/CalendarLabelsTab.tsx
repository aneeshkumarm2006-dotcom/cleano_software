"use client";

import { useState } from "react";
import { Tags } from "lucide-react";
import Button from "@/components/ui/Button";
import { updateAppSetting } from "../../actions/updateAppSetting";
import { AppSettingRecord, getSetting } from "../types";
import { SectionCard, Field, Feedback, Msg, themedSelectClass } from "./_shared";
import { SETTINGS } from "@/lib/settings/registry";
import {
  PriorityLabel,
  PRIORITY_LABEL_TEXT,
  SERVICE_CATEGORIES,
  normaliseLabelMap,
} from "@/lib/calendar-labels";

interface Props {
  settings: AppSettingRecord[];
}

const LABELS = SETTINGS["calendar.jobTypeLabels"];

// Tiny preview of the badge shown on the calendar for each choice.
function Preview({ label }: { label: PriorityLabel }) {
  if (label === "ROUTINE")
    return <span className="cal-badge cal-badge-routine">R</span>;
  if (label === "IMPORTANT")
    return <span className="cal-badge cal-badge-important">I</span>;
  return <span style={{ fontSize: 11.5, color: "var(--primary-40)" }}>—</span>;
}

export default function CalendarLabelsTab({ settings }: Props) {
  const stored = getSetting<Record<string, PriorityLabel>>(
    settings,
    LABELS.key,
    LABELS.default
  );
  const [map, setMap] = useState<Record<string, PriorityLabel>>(() =>
    normaliseLabelMap(stored)
  );
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);

  function setLabel(jobType: string, value: PriorityLabel) {
    setMap((m) => ({ ...m, [jobType]: value }));
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setMsg(null);
    const res = await updateAppSetting({
      key: LABELS.key,
      category: LABELS.category,
      value: map,
    });
    if (res.success)
      setMsg({ type: "success", text: "Calendar labels saved." });
    else setMsg({ type: "error", text: res.error || "Failed to save." });
    setSaving(false);
  }

  return (
    <SectionCard
      title="Calendar Labels"
      description="Choose which symbol each service type gets in the top-left of a booking on the calendar — “R” (Routine, blue) or “I” (Important, yellow). A red ⚠ badge always overrides these when a cleaner is missing equipment or a customer has requested a time/date change. Operations managers can override a single booking from its job detail page."
      icon={Tags}
    >
      <form onSubmit={handleSave} className="space-y-4">
        <div className="space-y-3">
          {SERVICE_CATEGORIES.map((cat) => (
            <Field key={cat.key} label={cat.label}>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <select
                  className={themedSelectClass}
                  value={map[cat.key] ?? "NONE"}
                  onChange={(e) =>
                    setLabel(cat.key, e.target.value as PriorityLabel)
                  }
                  style={{ maxWidth: 220 }}
                >
                  <option value="ROUTINE">{PRIORITY_LABEL_TEXT.ROUTINE}</option>
                  <option value="IMPORTANT">
                    {PRIORITY_LABEL_TEXT.IMPORTANT}
                  </option>
                  <option value="NONE">{PRIORITY_LABEL_TEXT.NONE}</option>
                </select>
                <Preview label={map[cat.key] ?? "NONE"} />
              </div>
            </Field>
          ))}
        </div>

        {msg && <Feedback msg={msg} />}
        <Button type="submit" disabled={saving}>
          {saving ? "Saving…" : "Save"}
        </Button>
      </form>
    </SectionCard>
  );
}
