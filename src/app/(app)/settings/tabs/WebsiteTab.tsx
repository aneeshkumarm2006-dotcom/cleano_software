"use client";

import { useState } from "react";
import { Globe2, Plus, Trash2 } from "lucide-react";
import Input from "@/components/ui/Input";
import Button from "@/components/ui/Button";
import { updateAppSetting } from "../../actions/updateAppSetting";
import { AppSettingRecord, getSetting } from "../types";
import { SectionCard, Field, Feedback, Msg } from "./_shared";
import { SETTINGS } from "@/lib/settings/registry";

const DOMAIN = SETTINGS["website.customDomain"];
const FAQS = SETTINGS["content.faqs"];

type Faq = { question: string; answer: string };

interface Props {
  settings: AppSettingRecord[];
}

export default function WebsiteTab({ settings }: Props) {
  const [domain, setDomain] = useState<string>(
    getSetting<string>(settings, DOMAIN.key, DOMAIN.default)
  );
  const [faqs, setFaqs] = useState<Faq[]>(
    getSetting<Faq[]>(settings, FAQS.key, FAQS.default)
  );
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);

  function updateFaq(i: number, patch: Partial<Faq>) {
    setFaqs((rows) => rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }
  function addFaq() {
    setFaqs((rows) => [...rows, { question: "", answer: "" }]);
  }
  function removeFaq(i: number) {
    setFaqs((rows) => rows.filter((_, idx) => idx !== i));
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setMsg(null);

    const cleanFaqs = faqs
      .map((f) => ({ question: f.question.trim(), answer: f.answer.trim() }))
      .filter((f) => f.question && f.answer);

    const results = await Promise.all([
      updateAppSetting({
        key: DOMAIN.key,
        category: DOMAIN.category,
        value: domain.trim(),
      }),
      updateAppSetting({
        key: FAQS.key,
        category: FAQS.category,
        value: cleanFaqs,
      }),
    ]);

    const failed = results.find((r) => !r.success);
    if (failed) setMsg({ type: "error", text: failed.error || "Failed to save." });
    else setMsg({ type: "success", text: "Website settings saved." });
    setSaving(false);
  }

  return (
    <SectionCard
      title="Website &amp; Content"
      description="Public domain and the FAQ shown at /faq. Changes are audit-logged."
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

        <div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              marginBottom: 8,
            }}>
            <span style={{ fontSize: 13, fontWeight: 600 }}>{FAQS.label}</span>
            <Button type="button" variant="secondary" onClick={addFaq}>
              <Plus size={14} /> Add
            </Button>
          </div>

          <div className="space-y-3">
            {faqs.length === 0 && (
              <p style={{ fontSize: 13, color: "var(--primary-60)" }}>
                No FAQs yet. Click &ldquo;Add&rdquo; to create one.
              </p>
            )}
            {faqs.map((f, i) => (
              <div
                key={i}
                style={{
                  border: "1px solid var(--primary-10)",
                  borderRadius: 12,
                  padding: 12,
                }}>
                <div
                  style={{
                    display: "flex",
                    gap: 8,
                    alignItems: "center",
                    marginBottom: 8,
                  }}>
                  <Input
                    variant="form"
                    type="text"
                    value={f.question}
                    onChange={(e) => updateFaq(i, { question: e.target.value })}
                    placeholder="Question"
                  />
                  <button
                    type="button"
                    onClick={() => removeFaq(i)}
                    aria-label="Remove FAQ"
                    style={{
                      flexShrink: 0,
                      background: "transparent",
                      border: "none",
                      color: "var(--primary-50)",
                      cursor: "pointer",
                      padding: 6,
                    }}>
                    <Trash2 size={16} />
                  </button>
                </div>
                <textarea
                  value={f.answer}
                  onChange={(e) => updateFaq(i, { answer: e.target.value })}
                  rows={3}
                  placeholder="Answer"
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[#008C9C]"
                />
              </div>
            ))}
          </div>
        </div>

        {msg && <Feedback msg={msg} />}
        <Button type="submit" disabled={saving}>
          {saving ? "Saving…" : "Save"}
        </Button>
      </form>

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
    { label: "Customer login", path: "/portal/login" },
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
