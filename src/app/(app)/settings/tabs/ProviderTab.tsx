"use client";

import { useState } from "react";
import { HardHat } from "lucide-react";
import Button from "@/components/ui/Button";
import { updateAppSetting } from "../../actions/updateAppSetting";
import { AppSettingRecord, getSetting } from "../types";
import { SectionCard, Field, Feedback, Msg } from "./_shared";
import { SETTINGS } from "@/lib/settings/registry";

const SHOW_PHONE = SETTINGS["provider.showCustomerPhone"];
const DEACTIVATED = SETTINGS["provider.deactivatedMessage"];

interface Props {
  settings: AppSettingRecord[];
}

export default function ProviderTab({ settings }: Props) {
  const [showPhone, setShowPhone] = useState<boolean>(
    getSetting<boolean>(settings, SHOW_PHONE.key, SHOW_PHONE.default)
  );
  const [deactivatedMsg, setDeactivatedMsg] = useState<string>(
    getSetting<string>(settings, DEACTIVATED.key, DEACTIVATED.default)
  );
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setMsg(null);
    const results = await Promise.all([
      updateAppSetting({
        key: SHOW_PHONE.key,
        category: SHOW_PHONE.category,
        value: showPhone,
      }),
      updateAppSetting({
        key: DEACTIVATED.key,
        category: DEACTIVATED.category,
        value: deactivatedMsg,
      }),
    ]);
    const failed = results.find((r) => !r.success);
    if (failed) setMsg({ type: "error", text: failed.error || "Failed to save." });
    else setMsg({ type: "success", text: "Provider settings saved." });
    setSaving(false);
  }

  return (
    <SectionCard
      title="Provider Privacy"
      description="What cleaners can see about the customer on a job. Changes are audit-logged."
      icon={HardHat}>
      <form onSubmit={handleSave} className="space-y-4">
        <label className="flex items-center gap-2 text-sm text-gray-700">
          <input
            type="checkbox"
            checked={showPhone}
            onChange={(e) => setShowPhone(e.target.checked)}
          />
          {SHOW_PHONE.label}
        </label>
        <p style={{ fontSize: 12, color: "var(--primary-60)" }}>
          When off, the customer&rsquo;s phone number is hidden from the cleaner
          on the job detail page. (Customer email is already hidden from
          cleaners; booking-price visibility is a separate, pending setting.)
        </p>

        <Field label={DEACTIVATED.label}>
          <textarea
            value={deactivatedMsg}
            onChange={(e) => setDeactivatedMsg(e.target.value)}
            rows={3}
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[#005F6A]"
          />
        </Field>
        <p style={{ fontSize: 12, color: "var(--primary-60)" }}>
          Shown full-screen when a deactivated cleaner opens the app (toggle a
          cleaner&rsquo;s &ldquo;Active account&rdquo; in Staff &rarr;
          Employees).
        </p>

        {msg && <Feedback msg={msg} />}
        <Button type="submit" disabled={saving}>
          {saving ? "Saving…" : "Save"}
        </Button>
      </form>
    </SectionCard>
  );
}
