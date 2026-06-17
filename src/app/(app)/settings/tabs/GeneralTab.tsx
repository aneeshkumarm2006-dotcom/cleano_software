"use client";

import { useState } from "react";
import { Globe } from "lucide-react";
import Button from "@/components/ui/Button";
import { updateAppSetting } from "../../actions/updateAppSetting";
import { AppSettingRecord, getSetting } from "../types";
import { SectionCard, Field, Feedback, Msg } from "./_shared";
import { SETTINGS } from "@/lib/settings/registry";

const CURRENCY = SETTINGS["general.currency"];

interface Props {
  settings: AppSettingRecord[];
}

export default function GeneralTab({ settings }: Props) {
  const [currencyValue, setCurrencyValue] = useState<string>(
    getSetting<string>(settings, CURRENCY.key, CURRENCY.default)
  );
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setMsg(null);
    const res = await updateAppSetting({
      key: CURRENCY.key,
      category: CURRENCY.category,
      value: currencyValue,
    });
    if (res.success) setMsg({ type: "success", text: "General settings saved." });
    else setMsg({ type: "error", text: res.error || "Failed to save." });
    setSaving(false);
  }

  return (
    <SectionCard
      title="General"
      description="Store-wide defaults. Changes are audit-logged."
      icon={Globe}>
      <form onSubmit={handleSave} className="space-y-4">
        <Field label={CURRENCY.label}>
          <select
            value={currencyValue}
            onChange={(e) => setCurrencyValue(e.target.value)}
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[#008C9C]">
            <option value="CAD">CAD — Canadian dollar</option>
            <option value="USD">USD — US dollar</option>
          </select>
        </Field>
        <p style={{ fontSize: 12, color: "var(--primary-60)" }}>
          The store currency. Payments are already processed in CAD through
          Stripe; this is the source of truth for currency display going
          forward.
        </p>

        {msg && <Feedback msg={msg} />}
        <Button type="submit" disabled={saving}>
          {saving ? "Saving…" : "Save"}
        </Button>
      </form>
    </SectionCard>
  );
}
