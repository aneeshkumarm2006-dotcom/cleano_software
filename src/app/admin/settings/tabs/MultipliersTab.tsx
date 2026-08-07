"use client";

import { useState } from "react";
import Input from "@/components/ui/Input";
import Button from "@/components/ui/Button";
import { Star } from "lucide-react";
import { updateAppSetting } from "../../actions/updateAppSetting";
import { recalculateAllMultipliers } from "../../actions/recalculateAllMultipliers";
import { AppSettingRecord, getSetting } from "../types";
import { SectionCard, Feedback, Msg } from "./_shared";
import {
  RATING_STEPS,
  DEFAULT_RATING_MULTIPLIERS,
  MIN_RATING_MULTIPLIER,
  MAX_RATING_MULTIPLIER,
  type RatingMultiplierMap,
} from "@/lib/pay-multiplier";
import { TIER_LABEL, formatRatePct, tierBaseRate, type CleanerTier } from "@/lib/pay-tiers";

interface MultipliersTabProps {
  settings: AppSettingRecord[];
}

const KEY = "multipliers.ratings";
const TIERS: CleanerTier[] = ["TRAINEE", "STANDARD", "FIELD_LEAD"];

export default function MultipliersTab({ settings }: MultipliersTabProps) {
  const initial: RatingMultiplierMap = {
    ...DEFAULT_RATING_MULTIPLIERS,
    ...getSetting<RatingMultiplierMap>(settings, KEY, DEFAULT_RATING_MULTIPLIERS),
  };
  // Held as TEXT, not numbers. A half-typed "1." or a cleared box must stay
  // exactly what the admin typed. The previous version coerced every keystroke
  // to a number and defaulted a missing step to zero on save, so clearing a box
  // persisted 0 — and now that this map drives pay, that would have paid every
  // cleaner in that rating band $0.00.
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(RATING_STEPS.map((s) => [s, (initial[s] ?? 1).toFixed(2)]))
  );
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);

  function parseAll(): { payload: RatingMultiplierMap } | { error: string } {
    const payload: RatingMultiplierMap = {};
    for (const step of RATING_STEPS) {
      const raw = (values[step] ?? "").trim();
      if (raw === "") {
        return {
          error: `${step}★ is empty — enter a multiplier (1.00 = the tier base rate, unchanged).`,
        };
      }
      const n = Number(raw);
      if (!Number.isFinite(n)) {
        return { error: `${step}★: "${raw}" is not a number.` };
      }
      if (n < MIN_RATING_MULTIPLIER || n > MAX_RATING_MULTIPLIER) {
        return {
          error: `${step}★: must be between ${MIN_RATING_MULTIPLIER.toFixed(2)}× and ${MAX_RATING_MULTIPLIER.toFixed(2)}×.`,
        };
      }
      payload[step] = Math.round(n * 100) / 100;
    }
    // A higher rating must never pay less than a lower one.
    for (let i = 1; i < RATING_STEPS.length; i++) {
      const prev = RATING_STEPS[i - 1];
      const cur = RATING_STEPS[i];
      if (payload[cur] < payload[prev]) {
        return {
          error: `${cur}★ (${payload[cur].toFixed(2)}×) cannot pay less than ${prev}★ (${payload[prev].toFixed(2)}×).`,
        };
      }
    }
    return { payload };
  }

  async function handleSave() {
    const parsed = parseAll();
    if ("error" in parsed) {
      setMsg({ type: "error", text: parsed.error });
      return;
    }
    setSaving(true);
    setMsg(null);

    const res = await updateAppSetting({
      key: KEY,
      category: "multipliers",
      value: parsed.payload,
    });
    if (!res.success) {
      setMsg({ type: "error", text: res.error || "Failed to save." });
      setSaving(false);
      return;
    }

    // These multipliers drive pay now, so User.payMultiplier — the number shown
    // on every cleaner's profile — is stale the moment the map changes.
    const recalc = await recalculateAllMultipliers();
    setMsg(
      recalc.success
        ? {
            type: "success",
            text: `Saved — ${recalc.changed ?? 0} of ${recalc.total ?? 0} cleaner multipliers updated.`,
          }
        : {
            type: "error",
            text: `Saved, but the cleaner multipliers could not be refreshed (${recalc.error}). Pay is unaffected; retry from an employee's profile.`,
          }
    );
    setSaving(false);
  }

  return (
    <SectionCard
      title="Pay Rate Multipliers"
      description="Cleaner pay = tier base rate × this multiplier. A 4.5★ Standard cleaner at 1.13× earns 40% × 1.13 = 45.20% of the job price. Applies once a cleaner has 5 ratings."
      icon={Star}>
      <div className="space-y-3">
        {RATING_STEPS.map((step) => {
          const raw = (values[step] ?? "").trim();
          const n = Number(raw);
          const valid =
            raw !== "" &&
            Number.isFinite(n) &&
            n >= MIN_RATING_MULTIPLIER &&
            n <= MAX_RATING_MULTIPLIER;
          return (
            <div
              key={step}
              className="grid grid-cols-[130px_150px_1fr] items-center gap-3">
              <div className="flex items-center gap-2">
                <Star className="w-4 h-4 fill-[#3E7596] text-[#3E7596]" />
                <span className="text-sm font-medium text-[#008C9C] tabular-nums">
                  {step}
                </span>
              </div>
              <Input
                variant="form"
                type="number"
                inputMode="decimal"
                min={MIN_RATING_MULTIPLIER}
                max={MAX_RATING_MULTIPLIER}
                step="0.01"
                value={values[step] ?? ""}
                onChange={(e) =>
                  setValues((prev) => ({ ...prev, [step]: e.target.value }))
                }
              />
              {/* The money consequence, visible before Save is pressed. */}
              <span className="text-xs tabular-nums text-[#008C9C]/70">
                {!valid ? (
                  `Enter ${MIN_RATING_MULTIPLIER.toFixed(2)}–${MAX_RATING_MULTIPLIER.toFixed(2)}`
                ) : (
                  <>
                    {TIERS.map(
                      (t) => `${TIER_LABEL[t]} ${formatRatePct(tierBaseRate(t) * n)}`
                    ).join(" · ")}
                    {n < 1 && (
                      <span className="ml-2 font-semibold text-amber-600">
                        below the tier base rate — this cuts pay
                      </span>
                    )}
                  </>
                )}
              </span>
            </div>
          );
        })}
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
