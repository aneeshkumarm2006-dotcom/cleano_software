"use client";

import { useState } from "react";
import { Users } from "lucide-react";
import Input from "@/components/ui/Input";
import Button from "@/components/ui/Button";
import { updateAppSetting } from "../../actions/updateAppSetting";
import { AppSettingRecord, getSetting } from "../types";
import { SectionCard, Field, Feedback, Msg } from "./_shared";
import { SETTINGS } from "@/lib/settings/registry";

const DISCOUNT = SETTINGS["customer.newClientReferralDiscountUsd"];
const CREDIT = SETTINGS["customer.referrerCreditUsd"];
const REASONS = SETTINGS["customer.cancellationReasons"];
const BLOCKED = SETTINGS["customer.blockedMessage"];
const SMS_DEFAULT = SETTINGS["customer.smsOptInDefault"];
const REVIEWS_ON = SETTINGS["customer.liveReviewsEnabled"];
const REVIEW_MIN = SETTINGS["customer.liveReviewThreshold"];

interface Props {
  settings: AppSettingRecord[];
}

export default function CustomerTab({ settings }: Props) {
  const [discount, setDiscount] = useState<number>(
    getSetting<number>(settings, DISCOUNT.key, DISCOUNT.default)
  );
  const [credit, setCredit] = useState<number>(
    getSetting<number>(settings, CREDIT.key, CREDIT.default)
  );
  const [reasonsText, setReasonsText] = useState<string>(
    getSetting<string[]>(settings, REASONS.key, REASONS.default).join("\n")
  );
  const [blockedMsg, setBlockedMsg] = useState<string>(
    getSetting<string>(settings, BLOCKED.key, BLOCKED.default)
  );
  const [smsDefault, setSmsDefault] = useState<boolean>(
    getSetting<boolean>(settings, SMS_DEFAULT.key, SMS_DEFAULT.default)
  );
  const [reviewsOn, setReviewsOn] = useState<boolean>(
    getSetting<boolean>(settings, REVIEWS_ON.key, REVIEWS_ON.default)
  );
  const [reviewMin, setReviewMin] = useState<number>(
    getSetting<number>(settings, REVIEW_MIN.key, REVIEW_MIN.default)
  );
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setMsg(null);

    const reasons = reasonsText
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);

    const results = await Promise.all([
      updateAppSetting({
        key: DISCOUNT.key,
        category: DISCOUNT.category,
        value: discount,
      }),
      updateAppSetting({
        key: CREDIT.key,
        category: CREDIT.category,
        value: credit,
      }),
      updateAppSetting({
        key: REASONS.key,
        category: REASONS.category,
        value: reasons,
      }),
      updateAppSetting({
        key: BLOCKED.key,
        category: BLOCKED.category,
        value: blockedMsg,
      }),
      updateAppSetting({
        key: SMS_DEFAULT.key,
        category: SMS_DEFAULT.category,
        value: smsDefault,
      }),
      updateAppSetting({
        key: REVIEWS_ON.key,
        category: REVIEWS_ON.category,
        value: reviewsOn,
      }),
      updateAppSetting({
        key: REVIEW_MIN.key,
        category: REVIEW_MIN.category,
        value: reviewMin,
      }),
    ]);

    const failed = results.find((r) => !r.success);
    if (failed) setMsg({ type: "error", text: failed.error || "Failed to save." });
    else setMsg({ type: "success", text: "Customer settings saved." });
    setSaving(false);
  }

  return (
    <SectionCard
      title="Referrals"
      description="The credit economics of the customer referral program. Changes are audit-logged."
      icon={Users}>
      <form onSubmit={handleSave} className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <Field label={DISCOUNT.label}>
            <Input
              variant="form"
              type="number"
              min="0"
              step="0.01"
              value={discount}
              onChange={(e) => setDiscount(parseFloat(e.target.value) || 0)}
            />
          </Field>
          <Field label={CREDIT.label}>
            <Input
              variant="form"
              type="number"
              min="0"
              step="0.01"
              value={credit}
              onChange={(e) => setCredit(parseFloat(e.target.value) || 0)}
            />
          </Field>
        </div>
        <p style={{ fontSize: 12, color: "var(--primary-60)" }}>
          The discount is applied to a new customer&rsquo;s first booking when
          they use a referral code. The credit is added to the referring
          customer&rsquo;s balance once the new customer books.
        </p>

        <Field label={REASONS.label}>
          <textarea
            value={reasonsText}
            onChange={(e) => setReasonsText(e.target.value)}
            rows={6}
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[#005F6A]"
          />
        </Field>
        <p style={{ fontSize: 12, color: "var(--primary-60)" }}>
          One reason per line. These appear as a required dropdown when a
          customer cancels a booking in their portal; the choice is recorded on
          the job&rsquo;s activity log.
        </p>

        <label className="flex items-center gap-2 text-sm text-gray-700">
          <input
            type="checkbox"
            checked={smsDefault}
            onChange={(e) => setSmsDefault(e.target.checked)}
          />
          {SMS_DEFAULT.label}
        </label>

        <label className="flex items-center gap-2 text-sm text-gray-700">
          <input
            type="checkbox"
            checked={reviewsOn}
            onChange={(e) => setReviewsOn(e.target.checked)}
          />
          {REVIEWS_ON.label}
        </label>
        <Field label={REVIEW_MIN.label}>
          <Input
            variant="form"
            type="number"
            min="1"
            max="5"
            step="1"
            value={reviewMin}
            onChange={(e) => setReviewMin(parseInt(e.target.value, 10) || 5)}
          />
        </Field>
        <p style={{ fontSize: 12, color: "var(--primary-60)" }}>
          Controls whether the &ldquo;Send me SMS updates&rdquo; checkbox is
          pre-checked on the booking form. The customer&rsquo;s choice is saved
          on each booking.
        </p>

        <Field label={BLOCKED.label}>
          <textarea
            value={blockedMsg}
            onChange={(e) => setBlockedMsg(e.target.value)}
            rows={3}
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[#005F6A]"
          />
        </Field>
        <p style={{ fontSize: 12, color: "var(--primary-60)" }}>
          Shown full-screen when a deactivated customer opens their portal
          (admin sets a customer to inactive).
        </p>

        {msg && <Feedback msg={msg} />}
        <Button type="submit" disabled={saving}>
          {saving ? "Saving…" : "Save"}
        </Button>
      </form>
    </SectionCard>
  );
}
