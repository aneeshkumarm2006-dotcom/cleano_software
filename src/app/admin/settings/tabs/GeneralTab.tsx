"use client";

import { useState } from "react";
import { Globe } from "lucide-react";
import Button from "@/components/ui/Button";
import { updateAppSetting } from "../../actions/updateAppSetting";
import { AppSettingRecord, getSetting } from "../types";
import { SectionCard, Field, Feedback, Msg, themedInputClass, themedSelectClass } from "./_shared";
import { SETTINGS, TIMEZONE_OPTIONS } from "@/lib/settings/registry";

const CURRENCY = SETTINGS["general.currency"];
const TIMEZONE = SETTINGS["general.timezone"];
const BUSINESS_NAME = SETTINGS["general.businessName"];
const BUSINESS_EMAIL = SETTINGS["general.businessEmail"];
const BUSINESS_PHONE = SETTINGS["general.businessPhone"];

interface Props {
  settings: AppSettingRecord[];
}

export default function GeneralTab({ settings }: Props) {
  const [currencyValue, setCurrencyValue] = useState<string>(
    getSetting<string>(settings, CURRENCY.key, CURRENCY.default)
  );
  const [timezone, setTimezone] = useState<string>(
    getSetting<string>(settings, TIMEZONE.key, TIMEZONE.default)
  );
  const [businessName, setBusinessName] = useState<string>(
    getSetting<string>(settings, BUSINESS_NAME.key, BUSINESS_NAME.default)
  );
  const [businessEmail, setBusinessEmail] = useState<string>(
    getSetting<string>(settings, BUSINESS_EMAIL.key, BUSINESS_EMAIL.default)
  );
  const [businessPhone, setBusinessPhone] = useState<string>(
    getSetting<string>(settings, BUSINESS_PHONE.key, BUSINESS_PHONE.default)
  );
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setMsg(null);
    const updates = [
      { key: CURRENCY.key, category: CURRENCY.category, value: currencyValue },
      { key: TIMEZONE.key, category: TIMEZONE.category, value: timezone },
      {
        key: BUSINESS_NAME.key,
        category: BUSINESS_NAME.category,
        value: businessName.trim(),
      },
      {
        key: BUSINESS_EMAIL.key,
        category: BUSINESS_EMAIL.category,
        value: businessEmail.trim(),
      },
      {
        key: BUSINESS_PHONE.key,
        category: BUSINESS_PHONE.category,
        value: businessPhone.trim(),
      },
    ];
    let failure: string | null = null;
    for (const u of updates) {
      const res = await updateAppSetting(u);
      if (!res.success) {
        failure = res.error || "Failed to save.";
        break;
      }
    }
    if (failure) setMsg({ type: "error", text: failure });
    else setMsg({ type: "success", text: "General settings saved." });
    setSaving(false);
  }

  return (
    <SectionCard
      title="General"
      description="Store-wide defaults. Changes are audit-logged."
      icon={Globe}>
      <form onSubmit={handleSave} className="space-y-4">
        <Field label={BUSINESS_NAME.label}>
          <input
            type="text"
            value={businessName}
            onChange={(e) => setBusinessName(e.target.value)}
            className={themedInputClass}
            placeholder="Cleano"
          />
        </Field>
        <p style={{ fontSize: 12, color: "var(--primary-60)" }}>
          Shown in the public website header and footer.
        </p>

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

        <Field label={TIMEZONE.label}>
          <select
            value={timezone}
            onChange={(e) => setTimezone(e.target.value)}
            className={themedSelectClass}>
            {TIMEZONE_OPTIONS.map((tz) => (
              <option key={tz.value} value={tz.value}>
                {tz.label}
              </option>
            ))}
          </select>
        </Field>
        <p style={{ fontSize: 12, color: "var(--primary-60)" }}>
          Used for booking lead-time cut-offs; the source of truth for date and
          time handling going forward.
        </p>

        <Field label={BUSINESS_EMAIL.label}>
          <input
            type="email"
            value={businessEmail}
            onChange={(e) => setBusinessEmail(e.target.value)}
            className={themedInputClass}
            placeholder="care@cleano.ca"
          />
        </Field>
        <Field label={BUSINESS_PHONE.label}>
          <input
            type="text"
            value={businessPhone}
            onChange={(e) => setBusinessPhone(e.target.value)}
            className={themedInputClass}
            placeholder="(514) 555-CLEAN"
          />
        </Field>
        <p style={{ fontSize: 12, color: "var(--primary-60)" }}>
          Shown to customers in the “Need help?” section of their booking and
          account pages.
        </p>

        {msg && <Feedback msg={msg} />}
        <Button type="submit" disabled={saving}>
          {saving ? "Saving…" : "Save"}
        </Button>
      </form>
    </SectionCard>
  );
}
