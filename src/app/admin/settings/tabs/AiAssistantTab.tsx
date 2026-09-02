"use client";

import { useState } from "react";
import { Bot } from "lucide-react";
import Input from "@/components/ui/Input";
import Button from "@/components/ui/Button";
import { updateAppSetting } from "../../actions/updateAppSetting";
import { AppSettingRecord, getSetting } from "../types";
import { SectionCard, Field, Feedback, Msg } from "./_shared";
import {
  AI_ASSISTANT_CATEGORY,
  AI_ASSISTANT_KEY,
  DEFAULT_AI_ASSISTANT,
  normalizeAiAssistantConfig,
  type AiAssistantConfig,
} from "@/lib/ai-assistant/config";

interface Props {
  settings: AppSettingRecord[];
}

export default function AiAssistantTab({ settings }: Props) {
  // Normalize on the way in: an older stored shape still renders a valid form.
  const initial = normalizeAiAssistantConfig(
    getSetting<AiAssistantConfig>(settings, AI_ASSISTANT_KEY, DEFAULT_AI_ASSISTANT)
  );

  const [enabled, setEnabled] = useState(initial.enabled);
  const [smsReplies, setSmsReplies] = useState(initial.smsReplies);
  const [emailReplies, setEmailReplies] = useState(initial.emailReplies);
  const [businessFacts, setBusinessFacts] = useState(initial.businessFacts);
  const [dailyMessageCap, setDailyMessageCap] = useState(initial.dailyMessageCap);
  const [leadFollowUpDays, setLeadFollowUpDays] = useState(initial.leadFollowUpDays);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setMsg(null);
    const res = await updateAppSetting({
      key: AI_ASSISTANT_KEY,
      category: AI_ASSISTANT_CATEGORY,
      value: {
        enabled,
        smsReplies,
        emailReplies,
        businessFacts,
        dailyMessageCap,
        leadFollowUpDays,
      } satisfies AiAssistantConfig,
    });
    if (res.success) setMsg({ type: "success", text: "AI assistant settings saved." });
    else setMsg({ type: "error", text: res.error || "Failed to save." });
    setSaving(false);
  }

  return (
    <SectionCard
      title="AI Assistant"
      description="Answers customer texts and emails using your services, areas, policies and FAQ — and hands the conversation to your team whenever it's unsure, or the customer asks for a person. It never quotes prices; it sends people to your booking page."
      icon={Bot}>
      <form onSubmit={handleSave} className="space-y-4">
        <label className="flex items-center gap-2 text-sm text-gray-700">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
          />
          Turn the AI assistant on
        </label>

        <div className="grid grid-cols-2 gap-4">
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={smsReplies}
              disabled={!enabled}
              onChange={(e) => setSmsReplies(e.target.checked)}
            />
            Reply to text messages
          </label>
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={emailReplies}
              disabled={!enabled}
              onChange={(e) => setEmailReplies(e.target.checked)}
            />
            Reply to emails
          </label>
        </div>

        <Field label="Things the assistant should know">
          <textarea
            value={businessFacts}
            onChange={(e) => setBusinessFacts(e.target.value)}
            rows={8}
            maxLength={8000}
            placeholder={
              "Anything not already in your settings. For example:\n" +
              "- We don't clean carpets or windows above the ground floor.\n" +
              "- Free parking must be available, or a parking fee applies.\n" +
              "- We bring all supplies; unscented products on request."
            }
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[#008C9C]"
          />
          <p className="text-xs text-gray-500 mt-1">
            Your services, service areas, deposits, cancellation policy and FAQ
            are included automatically and always current — no need to repeat
            them here.
          </p>
        </Field>

        <Field label="Follow up with quiet leads after (days)">
          <Input
            variant="form"
            type="number"
            min="0"
            max="365"
            step="1"
            value={leadFollowUpDays}
            disabled={!enabled}
            onChange={(e) => setLeadFollowUpDays(parseInt(e.target.value, 10) || 0)}
          />
          <p className="text-xs text-gray-500 mt-1">
            Someone who inquired but never booked gets one friendly check-in
            with your booking link after this many quiet days, and never a
            second one. 0 turns this off.
          </p>
        </Field>

        <Field label="Daily message limit">
          <Input
            variant="form"
            type="number"
            min="10"
            max="2000"
            step="1"
            value={dailyMessageCap}
            disabled={!enabled}
            onChange={(e) => setDailyMessageCap(parseInt(e.target.value, 10) || 0)}
          />
          <p className="text-xs text-gray-500 mt-1">
            The most messages the assistant will send in one day, across all
            conversations. When the limit is reached it stays quiet and your
            team is notified instead.
          </p>
        </Field>

        {msg && <Feedback msg={msg} />}
        <Button type="submit" disabled={saving}>
          {saving ? "Saving…" : "Save"}
        </Button>
      </form>
    </SectionCard>
  );
}
