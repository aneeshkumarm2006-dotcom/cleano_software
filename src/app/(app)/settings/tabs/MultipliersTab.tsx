"use client";

import { useState } from "react";
import Input from "@/components/ui/Input";
import Button from "@/components/ui/Button";
import { Star } from "lucide-react";
import { updateAppSetting } from "../../actions/updateAppSetting";
import { AppSettingRecord, getSetting } from "../types";
import { SectionCard, Feedback, Msg } from "./_shared";
import {
  RATING_STEPS,
  DEFAULT_RATING_MULTIPLIERS,
  type RatingMultiplierMap,
} from "@/lib/pay-multiplier";

interface MultipliersTabProps {
  settings: AppSettingRecord[];
}

const KEY = "multipliers.ratings";

export default function MultipliersTab({ settings }: MultipliersTabProps) {
  const initial = getSetting<RatingMultiplierMap>(
    settings,
    KEY,
    DEFAULT_RATING_MULTIPLIERS
  );
  const [values, setValues] = useState<RatingMultiplierMap>({
    ...DEFAULT_RATING_MULTIPLIERS,
    ...initial,
  });
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);

  async function handleSave() {
    setSaving(true);
    setMsg(null);
    // Persist only the configured 0.1 steps.
    const payload: RatingMultiplierMap = {};
    for (const step of RATING_STEPS) payload[step] = values[step] ?? 0;
    const res = await updateAppSetting({
      key: KEY,
      category: "multipliers",
      value: payload,
    });
    if (res.success) setMsg({ type: "success", text: "Multipliers saved." });
    else setMsg({ type: "error", text: res.error || "Failed to save." });
    setSaving(false);
  }

  return (
    <SectionCard
      title="Pay Rate Multipliers"
      description="Map cleaner ratings (4.0–5.0, in 0.1 steps) to pay multipliers applied at payout calculation."
      icon={Star}>
      <div className="space-y-3">
        {RATING_STEPS.map((step) => (
          <div
            key={step}
            className="grid grid-cols-[160px_1fr] items-center gap-3">
            <div className="flex items-center gap-2">
              <Star className="w-4 h-4 fill-[#3E7596] text-[#3E7596]" />
              <span className="text-sm font-medium text-[#008C9C] tabular-nums">
                {step}
              </span>
            </div>
            <Input
              variant="form"
              type="number"
              min="0"
              step="0.01"
              value={values[step] ?? 0}
              onChange={(e) =>
                setValues((prev) => ({
                  ...prev,
                  [step]: parseFloat(e.target.value) || 0,
                }))
              }
              className="max-w-[180px]"
            />
          </div>
        ))}
      </div>

      {msg && <Feedback msg={msg} />}

      <div className="flex justify-end">
        <Button
          type="button"
          variant="action"
          border={false}
          onClick={handleSave}
          disabled={saving}
          className="rounded-xl px-6 py-2.5">
          {saving ? "Saving..." : "Save"}
        </Button>
      </div>
    </SectionCard>
  );
}
