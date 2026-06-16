"use client";

import { useState } from "react";
import { CalendarClock } from "lucide-react";
import Input from "@/components/ui/Input";
import Button from "@/components/ui/Button";
import { updateAppSetting } from "../../actions/updateAppSetting";
import { AppSettingRecord, getSetting } from "../types";
import { SectionCard, Field, Feedback, Msg } from "./_shared";
import { SETTINGS } from "@/lib/settings/registry";

interface Props {
  settings: AppSettingRecord[];
}

const NO_SHOW = SETTINGS["scheduling.noShowFeeUsd"];
const TIMEOUT = SETTINGS["scheduling.acceptDeclineTimeoutMin"];
const HORIZON = SETTINGS["scheduling.recurringWeeklyHorizon"];
const LEAD = SETTINGS["scheduling.minLeadDays"];

export default function SchedulingTab({ settings }: Props) {
  const [noShowFee, setNoShowFee] = useState<number>(
    getSetting<number>(settings, NO_SHOW.key, NO_SHOW.default)
  );
  const [timeoutMin, setTimeoutMin] = useState<number>(
    getSetting<number>(settings, TIMEOUT.key, TIMEOUT.default)
  );
  const [horizon, setHorizon] = useState<number>(
    getSetting<number>(settings, HORIZON.key, HORIZON.default)
  );
  const [leadDays, setLeadDays] = useState<number>(
    getSetting<number>(settings, LEAD.key, LEAD.default)
  );
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setMsg(null);

    const results = await Promise.all([
      updateAppSetting({
        key: NO_SHOW.key,
        category: NO_SHOW.category,
        value: noShowFee,
      }),
      updateAppSetting({
        key: TIMEOUT.key,
        category: TIMEOUT.category,
        value: timeoutMin,
      }),
      updateAppSetting({
        key: HORIZON.key,
        category: HORIZON.category,
        value: horizon,
      }),
      updateAppSetting({
        key: LEAD.key,
        category: LEAD.category,
        value: leadDays,
      }),
    ]);

    const failed = results.find((r) => !r.success);
    if (failed) {
      setMsg({ type: "error", text: failed.error || "Failed to save." });
    } else {
      setMsg({ type: "success", text: "Scheduling settings saved." });
    }
    setSaving(false);
  }

  return (
    <SectionCard
      title="Scheduling & Penalties"
      description="Timing rules and fees applied across booking assignment and no-shows. Changes are audit-logged."
      icon={CalendarClock}>
      <form onSubmit={handleSave} className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <Field label={NO_SHOW.label}>
            <Input
              variant="form"
              type="number"
              min="0"
              step="0.01"
              value={noShowFee}
              onChange={(e) => setNoShowFee(parseFloat(e.target.value) || 0)}
            />
          </Field>
          <Field label={TIMEOUT.label}>
            <Input
              variant="form"
              type="number"
              min="1"
              step="1"
              value={timeoutMin}
              onChange={(e) => setTimeoutMin(parseInt(e.target.value, 10) || 0)}
            />
          </Field>
          <Field label={HORIZON.label}>
            <Input
              variant="form"
              type="number"
              min="0"
              step="1"
              value={horizon}
              onChange={(e) => setHorizon(parseInt(e.target.value, 10) || 0)}
            />
          </Field>
          <Field label={LEAD.label}>
            <Input
              variant="form"
              type="number"
              min="0"
              step="1"
              value={leadDays}
              onChange={(e) => setLeadDays(parseInt(e.target.value, 10) || 0)}
            />
          </Field>
        </div>

        <p style={{ fontSize: 12, color: "var(--primary-60)" }}>
          The no-show fee is charged to the customer&rsquo;s saved card when an
          admin marks a booking as a no-show. The accept/decline timeout is how
          long a newly assigned cleaner has to respond before the job is
          released back to the unassigned folder.
        </p>

        {msg && <Feedback msg={msg} />}
        <Button type="submit" disabled={saving}>
          {saving ? "Saving…" : "Save"}
        </Button>
      </form>
    </SectionCard>
  );
}
