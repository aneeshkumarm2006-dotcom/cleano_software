"use client";

import { useState } from "react";
import Input from "@/components/ui/Input";
import Button from "@/components/ui/Button";
import { Star } from "lucide-react";
import { updateAppSetting } from "../../actions/updateAppSetting";
import { AppSettingRecord, getSetting } from "../types";
import { SectionCard, Feedback, Msg } from "./_shared";

interface MultipliersTabProps {
  settings: AppSettingRecord[];
}

interface RatingMultipliers {
  "1": number;
  "2": number;
  "3": number;
  "4": number;
  "5": number;
}

const KEY = "multipliers.ratings";
const DEFAULTS: RatingMultipliers = {
  "1": 0.8,
  "2": 0.9,
  "3": 1.0,
  "4": 1.1,
  "5": 1.25,
};

export default function MultipliersTab({ settings }: MultipliersTabProps) {
  const initial = getSetting<RatingMultipliers>(settings, KEY, DEFAULTS);
  const [values, setValues] = useState<RatingMultipliers>({
    ...DEFAULTS,
    ...initial,
  });
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);

  async function handleSave() {
    setSaving(true);
    setMsg(null);
    const res = await updateAppSetting({
      key: KEY,
      category: "multipliers",
      value: values,
    });
    if (res.success) setMsg({ type: "success", text: "Multipliers saved." });
    else setMsg({ type: "error", text: res.error || "Failed to save." });
    setSaving(false);
  }

  const stars: (keyof RatingMultipliers)[] = ["1", "2", "3", "4", "5"];

  return (
    <SectionCard
      title="Pay Rate Multipliers"
      description="Map cleaner star ratings to pay multipliers applied at payout calculation."
      icon={Star}>
      <div className="space-y-3">
        {stars.map((s) => (
          <div
            key={s}
            className="grid grid-cols-[160px_1fr] items-center gap-3">
            <div className="flex items-center gap-1">
              {Array.from({ length: parseInt(s) }).map((_, i) => (
                <Star
                  key={i}
                  className="w-4 h-4 fill-[#77C8CC] text-[#77C8CC]"
                />
              ))}
              {Array.from({ length: 5 - parseInt(s) }).map((_, i) => (
                <Star
                  key={`e${i}`}
                  className="w-4 h-4 text-[#005F6A]/20"
                />
              ))}
            </div>
            <Input
              variant="form"
              type="number"
              min="0"
              step="0.01"
              value={values[s]}
              onChange={(e) =>
                setValues((prev) => ({
                  ...prev,
                  [s]: parseFloat(e.target.value) || 0,
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
