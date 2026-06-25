"use client";

import { useState } from "react";
import { Percent } from "lucide-react";
import Input from "@/components/ui/Input";
import Button from "@/components/ui/Button";
import { updateAppSetting } from "../../actions/updateAppSetting";
import { AppSettingRecord, getSetting } from "../types";
import { SectionCard, Field, Feedback, Msg } from "./_shared";

interface TaxSettingsTabProps {
  settings: AppSettingRecord[];
}

interface TaxConfig {
  gstRate: number;
  qstRate: number;
  gstNumber: string;
  qstNumber: string;
}

const KEY = "tax.config";

export default function TaxSettingsTab({ settings }: TaxSettingsTabProps) {
  const initial = getSetting<TaxConfig>(settings, KEY, {
    gstRate: 5,
    qstRate: 9.975,
    gstNumber: "",
    qstNumber: "",
  });

  const [gstRate, setGstRate] = useState(initial.gstRate);
  const [qstRate, setQstRate] = useState(initial.qstRate);
  const [gstNumber, setGstNumber] = useState(initial.gstNumber);
  const [qstNumber, setQstNumber] = useState(initial.qstNumber);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setMsg(null);
    const res = await updateAppSetting({
      key: KEY,
      category: "tax",
      value: { gstRate, qstRate, gstNumber, qstNumber },
    });
    if (res.success) setMsg({ type: "success", text: "Tax settings saved." });
    else setMsg({ type: "error", text: res.error || "Failed to save." });
    setSaving(false);
  }

  return (
    <SectionCard
      title="Tax Settings"
      description="Configure GST/QST rates applied to invoices and finance reports."
      icon={Percent}>
      <form onSubmit={handleSave} className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <Field label="GST Rate (%)">
            <Input
              variant="form"
              type="number"
              step="0.001"
              min="0"
              value={gstRate}
              onChange={(e) => setGstRate(parseFloat(e.target.value) || 0)}
            />
          </Field>
          <Field label="QST Rate (%)">
            <Input
              variant="form"
              type="number"
              step="0.001"
              min="0"
              value={qstRate}
              onChange={(e) => setQstRate(parseFloat(e.target.value) || 0)}
            />
          </Field>
          <Field label="GST Number">
            <Input
              variant="form"
              value={gstNumber}
              onChange={(e) => setGstNumber(e.target.value)}
              placeholder="123456789 RT0001"
            />
          </Field>
          <Field label="QST Number">
            <Input
              variant="form"
              value={qstNumber}
              onChange={(e) => setQstNumber(e.target.value)}
              placeholder="1234567890 TQ0001"
            />
          </Field>
        </div>
        {msg && <Feedback msg={msg} />}
        <div className="flex justify-end">
          <Button
            type="submit"
            variant="action"
            border={false}
            disabled={saving}
            className="rounded-xl px-6 py-2.5">
            {saving ? "Saving..." : "Save"}
          </Button>
        </div>
      </form>
    </SectionCard>
  );
}
