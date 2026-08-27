"use client";

import { useState } from "react";
import { Wallet } from "lucide-react";
import Input from "@/components/ui/Input";
import Button from "@/components/ui/Button";
import { updateAppSetting } from "../../actions/updateAppSetting";
import { AppSettingRecord, getSetting } from "../types";
import { SectionCard, Field, Feedback, Msg } from "./_shared";
import StripeConnectionSection from "./StripeConnectionSection";
import { SETTINGS } from "@/lib/settings/registry";

const FEE = SETTINGS["policy.cancellationFeeUsd"];
const WINDOW = SETTINGS["policy.cancellationFeeWindowHours"];
const TIERS = SETTINGS["payments.giftCardTiers"];

interface Props {
  settings: AppSettingRecord[];
}

export default function PaymentsTab({ settings }: Props) {
  const [fee, setFee] = useState<number>(
    getSetting<number>(settings, FEE.key, FEE.default)
  );
  const [windowHours, setWindowHours] = useState<number>(
    getSetting<number>(settings, WINDOW.key, WINDOW.default)
  );
  const [tiersText, setTiersText] = useState<string>(
    getSetting<number[]>(settings, TIERS.key, TIERS.default).join(", ")
  );
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setMsg(null);

    const tiers = tiersText
      .split(",")
      .map((s) => parseInt(s.trim(), 10))
      .filter((n) => Number.isFinite(n));

    const results = await Promise.all([
      updateAppSetting({ key: FEE.key, category: FEE.category, value: fee }),
      updateAppSetting({
        key: WINDOW.key,
        category: WINDOW.category,
        value: windowHours,
      }),
      updateAppSetting({
        key: TIERS.key,
        category: TIERS.category,
        value: tiers,
      }),
    ]);

    const failed = results.find((r) => !r.success);
    if (failed) setMsg({ type: "error", text: failed.error || "Failed to save." });
    else setMsg({ type: "success", text: "Payment settings saved." });
    setSaving(false);
  }

  return (
    <div className="space-y-6">
      {/* Which Stripe account the money goes into comes first: the fees below
          are meaningless until there is an account to collect them. */}
      <StripeConnectionSection />
    <SectionCard
      title="Payments &amp; Fees"
      description="Cancellation fee and gift-card pricing. Money-affecting changes are audit-logged. All charges are processed in CAD."
      icon={Wallet}>
      <form onSubmit={handleSave} className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <Field label={FEE.label}>
            <Input
              variant="form"
              type="number"
              min="0"
              step="0.01"
              value={fee}
              onChange={(e) => setFee(parseFloat(e.target.value) || 0)}
            />
          </Field>
          <Field label={WINDOW.label}>
            <Input
              variant="form"
              type="number"
              min="0"
              step="1"
              value={windowHours}
              onChange={(e) => setWindowHours(parseInt(e.target.value, 10) || 0)}
            />
          </Field>
        </div>

        <Field label={TIERS.label}>
          <Input
            variant="form"
            type="text"
            value={tiersText}
            onChange={(e) => setTiersText(e.target.value)}
            placeholder="150, 200, 250, 300, 350, 400"
          />
        </Field>
        <p style={{ fontSize: 12, color: "var(--primary-60)" }}>
          Comma-separated amounts a customer can choose when buying a gift card.
          The lowest amount is the effective minimum purchase. Charged to the
          customer&rsquo;s card when they cancel inside the late-cancellation
          window above.
        </p>

        {msg && <Feedback msg={msg} />}
        <Button type="submit" disabled={saving}>
          {saving ? "Saving…" : "Save"}
        </Button>
      </form>
    </SectionCard>
    </div>
  );
}
