"use client";

import { useState } from "react";
import { HeartHandshake } from "lucide-react";
import Input from "@/components/ui/Input";
import Button from "@/components/ui/Button";
import { updateAppSetting } from "../../actions/updateAppSetting";
import { AppSettingRecord, getSetting } from "../types";
import { SectionCard, Field, Feedback, Msg } from "./_shared";
import {
  RECURRING_SAVE_OFFER_KEY,
  RECURRING_SAVE_OFFER_CATEGORY,
  DEFAULT_SAVE_OFFER,
  type SaveOfferConfig,
} from "@/lib/retention-constants";

interface Props {
  settings: AppSettingRecord[];
}

export default function RetentionTab({ settings }: Props) {
  const initial = getSetting<SaveOfferConfig>(
    settings,
    RECURRING_SAVE_OFFER_KEY,
    DEFAULT_SAVE_OFFER
  );

  const [enabled, setEnabled] = useState(initial.enabled);
  const [offerType, setOfferType] = useState<SaveOfferConfig["offerType"]>(
    initial.offerType
  );
  const [offerValue, setOfferValue] = useState(initial.offerValue);
  const [emailIntro, setEmailIntro] = useState(initial.emailIntro);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setMsg(null);
    const res = await updateAppSetting({
      key: RECURRING_SAVE_OFFER_KEY,
      category: RECURRING_SAVE_OFFER_CATEGORY,
      value: { enabled, offerType, offerValue, emailIntro } satisfies SaveOfferConfig,
    });
    if (res.success) setMsg({ type: "success", text: "Retention settings saved." });
    else setMsg({ type: "error", text: res.error || "Failed to save." });
    setSaving(false);
  }

  return (
    <SectionCard
      title="Recurring Save Offer"
      description="The check-in email + save offer sent when a customer cancels their entire recurring service. There's a 30-day cooldown per customer."
      icon={HeartHandshake}>
      <form onSubmit={handleSave} className="space-y-4">
        <label className="flex items-center gap-2 text-sm text-gray-700">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
          />
          Include a save offer in the check-in email
        </label>

        <div className="grid grid-cols-2 gap-4">
          <Field label="Offer type">
            <select
              value={offerType}
              onChange={(e) => setOfferType(e.target.value as SaveOfferConfig["offerType"])}
              disabled={!enabled}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[#005F6A] disabled:opacity-50">
              <option value="PERCENT">% off next cleaning</option>
              <option value="FIXED">$ off next cleaning</option>
            </select>
          </Field>
          <Field label={offerType === "PERCENT" ? "Percent off" : "Dollars off"}>
            <Input
              variant="form"
              type="number"
              min="0"
              step={offerType === "PERCENT" ? "1" : "0.01"}
              value={offerValue}
              disabled={!enabled}
              onChange={(e) => setOfferValue(parseFloat(e.target.value) || 0)}
            />
          </Field>
        </div>

        <Field label="Email intro wording">
          <textarea
            value={emailIntro}
            onChange={(e) => setEmailIntro(e.target.value)}
            rows={3}
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[#005F6A]"
          />
        </Field>

        {msg && <Feedback msg={msg} />}
        <Button type="submit" disabled={saving}>
          {saving ? "Saving…" : "Save"}
        </Button>
      </form>
    </SectionCard>
  );
}
