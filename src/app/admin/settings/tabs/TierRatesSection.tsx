"use client";

// Default hourly rates by payroll tier — the half of the Sept 17 list's item 22
// that was left. Item 22 shipped the per-cleaner rate and the per-profile
// default; an office taking on five trainees still had to type the same number
// onto five profiles, and the number drifted.
//
// Built from the same SectionCard/Field/Button pieces as every other settings
// section, so it is one more card on the Provider tab rather than a new kind of
// screen.

import { useState } from "react";
import { Wallet } from "lucide-react";
import Button from "@/components/ui/Button";
import { updateAppSetting } from "../../actions/updateAppSetting";
import { AppSettingRecord, getSetting } from "../types";
import { SectionCard, Field, Feedback, Msg } from "./_shared";
import { SETTINGS } from "@/lib/settings/registry";

const TIERS = [
  { def: SETTINGS["provider.hourlyRateTrainee"], name: "Trainee" },
  { def: SETTINGS["provider.hourlyRateStandard"], name: "Standard" },
  { def: SETTINGS["provider.hourlyRateFieldLead"], name: "Field Lead" },
] as const;

export default function TierRatesSection({
  settings,
}: {
  settings: AppSettingRecord[];
}) {
  // Held as strings so an admin can clear the box. Coercing on every keystroke
  // turns an empty field into 0, which here means "unpaid", not "blank".
  const [values, setValues] = useState<Record<string, string>>(() => {
    const out: Record<string, string> = {};
    for (const t of TIERS) {
      const v = getSetting<number>(settings, t.def.key, t.def.default);
      out[t.def.key] = v > 0 ? String(v) : "";
    }
    return out;
  });
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setMsg(null);

    for (const t of TIERS) {
      const raw = values[t.def.key].trim();
      if (raw !== "" && !(Number(raw) >= 0)) {
        setMsg({ type: "error", text: `${t.name} needs a number, or leave it blank.` });
        setSaving(false);
        return;
      }
    }

    const results = await Promise.all(
      TIERS.map((t) =>
        updateAppSetting({
          key: t.def.key,
          category: t.def.category,
          // Blank saves as 0, which the resolver reads as "no tier default".
          value: values[t.def.key].trim() === "" ? 0 : Number(values[t.def.key]),
        }),
      ),
    );
    const failed = results.find((r) => !r.success);
    if (failed) setMsg({ type: "error", text: failed.error || "Failed to save." });
    else setMsg({ type: "success", text: "Tier rates saved. They apply to new hourly jobs." });
    setSaving(false);
  }

  return (
    <SectionCard
      title="Default hourly rates by tier"
      description="The rate a cleaner on each payroll tier starts on. Changes are audit-logged."
      icon={Wallet}>
      <form onSubmit={handleSave} className="space-y-4">
        <div className="grid grid-cols-3 gap-4">
          {TIERS.map((t) => (
            <Field key={t.def.key} label={t.name}>
              <div className="flex items-center gap-1.5">
                <span className="text-sm text-gray-500">$</span>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={values[t.def.key]}
                  onChange={(e) => {
                    setValues((v) => ({ ...v, [t.def.key]: e.target.value }));
                    setMsg(null);
                  }}
                  placeholder="—"
                  className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm w-full focus:outline-none focus:ring-1 focus:ring-[#008C9C]"
                />
                <span className="text-xs text-gray-500">/h</span>
              </div>
            </Field>
          ))}
        </div>

        {/* The two things an admin has to know before typing a number here,
            and the second one is the one that would otherwise be found out
            the hard way. */}
        <p style={{ fontSize: 12, color: "var(--primary-60)" }}>
          A cleaner&rsquo;s own rate on their profile always wins. This is what
          they fall back to when that is blank, and leaving a tier blank means
          the job&rsquo;s own hourly rate is used instead.
        </p>
        <p style={{ fontSize: 12, color: "var(--primary-60)" }}>
          These apply to <strong>new hourly jobs only</strong>. Work already
          booked keeps the rate saved on it, so changing a number here never
          reprices a job somebody has already been paid for.
        </p>

        {msg && <Feedback msg={msg} />}
        <Button type="submit" disabled={saving}>
          {saving ? "Saving…" : "Save"}
        </Button>
      </form>
    </SectionCard>
  );
}
