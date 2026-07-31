"use client";

import { useState } from "react";
import { Globe2 } from "lucide-react";
import Input from "@/components/ui/Input";
import Button from "@/components/ui/Button";
import { updateAppSetting } from "../../actions/updateAppSetting";
import { AppSettingRecord, getSetting } from "../types";
import { SectionCard, Field, Feedback, Msg } from "./_shared";
import { SETTINGS } from "@/lib/settings/registry";
import FaqManager from "./FaqManager";
import FaqAnalyticsPanel from "./FaqAnalyticsPanel";

const DOMAIN = SETTINGS["website.customDomain"];

interface Props {
  settings: AppSettingRecord[];
}

export default function WebsiteTab({ settings }: Props) {
  const [domain, setDomain] = useState<string>(
    getSetting<string>(settings, DOMAIN.key, DOMAIN.default)
  );
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setMsg(null);

    const res = await updateAppSetting({
      key: DOMAIN.key,
      category: DOMAIN.category,
      value: domain.trim(),
    });

    if (!res.success) setMsg({ type: "error", text: res.error || "Failed to save." });
    else setMsg({ type: "success", text: "Website settings saved." });
    setSaving(false);
  }

  return (
    <SectionCard
      title="Website &amp; Content"
      description="Public domain and the FAQ shown at /faq and in the customer portal. Changes are audit-logged."
      icon={Globe2}>
      <form onSubmit={handleSave} className="space-y-5">
        <Field label={DOMAIN.label}>
          <Input
            variant="form"
            type="text"
            value={domain}
            onChange={(e) => setDomain(e.target.value)}
            placeholder="teamcleano.com"
          />
        </Field>
        <p style={{ fontSize: 12, color: "var(--primary-60)" }}>
          Stored for display and links. Pointing DNS to the app is a separate
          infrastructure step.
        </p>

        {msg && <Feedback msg={msg} />}
        <Button type="submit" disabled={saving}>
          {saving ? "Saving…" : "Save"}
        </Button>
      </form>

      {/* The FAQ moved off the `content.faqs` blob and onto real tables, so it
          manages itself: each control is its own server action with its own
          audit row, rather than one Save button over the whole list. */}
      <div style={{ marginTop: 26, borderTop: "1px solid var(--primary-10)", paddingTop: 20 }}>
        <p style={{ fontSize: 12, color: "var(--primary-60)", margin: "0 0 14px" }}>
          Questions save as you leave each field. Drafts are invisible on both
          FAQ pages until you publish them.
        </p>
        <FaqManager />
      </div>

      <div style={{ marginTop: 26, borderTop: "1px solid var(--primary-10)", paddingTop: 20 }}>
        <FaqAnalyticsPanel />
      </div>

      <EmbedCodes domain={domain} />
    </SectionCard>
  );
}

/** Read-only copy-paste iframe snippets for the public forms/pages. */
function EmbedCodes({ domain }: { domain: string }) {
  const base = domain.trim() ? `https://${domain.trim()}` : "https://your-domain.com";
  const embeds: { label: string; path: string }[] = [
    { label: "Booking form", path: "/book" },
    { label: "Gift cards", path: "/gift-card" },
    { label: "FAQ", path: "/faq" },
    { label: "Reviews", path: "/reviews" },
    { label: "Customer login", path: "/login" },
  ];

  return (
    <div style={{ marginTop: 24, borderTop: "1px solid var(--primary-10)", paddingTop: 16 }}>
      <span style={{ fontSize: 13, fontWeight: 600 }}>Embed codes</span>
      <p style={{ fontSize: 12, color: "var(--primary-60)", margin: "4px 0 12px" }}>
        Paste these into your website to embed a Cleano form. Set your domain
        above first.
      </p>
      <div className="space-y-3">
        {embeds.map((e) => (
          <div key={e.path}>
            <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>
              {e.label}
            </div>
            <pre
              style={{
                background: "var(--primary-5)",
                borderRadius: 8,
                padding: "8px 10px",
                fontSize: 11,
                overflowX: "auto",
                margin: 0,
              }}>
              {`<iframe src="${base}${e.path}" width="100%" height="800" frameborder="0"></iframe>`}
            </pre>
          </div>
        ))}
      </div>
    </div>
  );
}
