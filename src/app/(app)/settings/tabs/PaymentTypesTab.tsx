"use client";

import { useState } from "react";
import Input from "@/components/ui/Input";
import Button from "@/components/ui/Button";
import { updateAppSetting } from "../../actions/updateAppSetting";
import { AppSettingRecord, getSetting } from "../types";
import { SectionCard, Feedback, Msg } from "./_shared";

interface PaymentTypesTabProps {
  settings: AppSettingRecord[];
}

interface PaymentTypeLabels {
  CASH: string;
  CHEQUE: string;
  E_TRANSFER: string;
  CREDIT_CARD: string;
  OTHER: string;
}

const KEY = "paymentTypes.labels";

const DEFAULTS: PaymentTypeLabels = {
  CASH: "Cash",
  CHEQUE: "Cheque",
  E_TRANSFER: "E-Transfer",
  CREDIT_CARD: "Credit Card",
  OTHER: "Other",
};

export default function PaymentTypesTab({ settings }: PaymentTypesTabProps) {
  const initial = getSetting<PaymentTypeLabels>(settings, KEY, DEFAULTS);
  const [labels, setLabels] = useState<PaymentTypeLabels>({
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
      category: "paymentTypes",
      value: labels,
    });
    if (res.success) setMsg({ type: "success", text: "Payment types saved." });
    else setMsg({ type: "error", text: res.error || "Failed to save." });
    setSaving(false);
  }

  const keys: (keyof PaymentTypeLabels)[] = [
    "CASH",
    "CHEQUE",
    "E_TRANSFER",
    "CREDIT_CARD",
    "OTHER",
  ];

  return (
    <SectionCard
      title="Payment Types"
      description="Customize labels for the payment methods displayed throughout the app.">
      <div className="space-y-3">
        {keys.map((k) => (
          <div
            key={k}
            className="grid grid-cols-[140px_1fr] items-center gap-3">
            <span className="text-sm text-gray-500 font-mono">{k}</span>
            <Input
              value={labels[k]}
              onChange={(e) =>
                setLabels((prev) => ({ ...prev, [k]: e.target.value }))
              }
            />
          </div>
        ))}
      </div>

      {msg && <Feedback msg={msg} />}

      <div className="flex justify-end">
        <Button
          type="button"
          variant="primary"
          onClick={handleSave}
          disabled={saving}>
          {saving ? "Saving..." : "Save"}
        </Button>
      </div>
    </SectionCard>
  );
}
