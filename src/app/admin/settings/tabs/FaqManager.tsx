"use client";

import { useEffect, useState } from "react";
import {
  Plus,
  Trash2,
  Copy,
  ChevronUp,
  ChevronDown,
  Eye,
  EyeOff,
  FolderPlus,
} from "lucide-react";
import Input from "@/components/ui/Input";
import Button from "@/components/ui/Button";
import {
  getAdminFaqData,
  createFaq,
  updateFaq,
  duplicateFaq,
  deleteFaq,
  reorderFaqs,
  createFaqCategory,
  updateFaqCategory,
  deleteFaqCategory,
  reorderFaqCategories,
  type AdminFaqDataDTO,
} from "../../actions/faqActions";

/**
 * Table-backed FAQ editor (CLN-P1-4-08 questions, 4-09 categories, 4-10
 * visibility, 4-11 EN/FR).
 *
 * Replaces the two-field question/answer list that wrote the `content.faqs`
 * JSON blob. Each control maps to one server action, and every action writes
 * its own ActivityLog row — the settings spine used to do that for free, and it
 * is no longer in the path.
 *
 * Each row saves on blur rather than behind a single Save button: the old
 * editor saved everything at once, which meant a validation failure anywhere
 * discarded the whole screen.
 */
export default function FaqManager() {
  const [data, setData] = useState<AdminFaqDataDTO | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [newQuestion, setNewQuestion] = useState("");
  const [newAnswer, setNewAnswer] = useState("");
  const [newCategory, setNewCategory] = useState("");
  const [showFrench, setShowFrench] = useState(false);

  async function refresh() {
    const res = await getAdminFaqData();
    if (res.success) {
      setData(res.data);
      setError(null);
    } else {
      setError(res.error);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  /** Every mutation goes through here so one failure can't leave stale rows. */
  async function run<T>(
    fn: () => Promise<{ success: true; data: T } | { success: false; error: string }>,
    successMessage?: string
  ) {
    if (busy) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    const res = await fn();
    if (!res.success) setError(res.error);
    else if (successMessage) setNotice(successMessage);
    await refresh();
    setBusy(false);
  }

  if (!data) {
    return (
      <p style={{ fontSize: 13, color: "var(--primary-60)" }}>
        {error ?? "Loading the FAQ…"}
      </p>
    );
  }

  const categoryName = (id: string | null) =>
    data.categories.find((c) => c.id === id)?.name ?? "Uncategorised";

  function move(index: number, delta: number) {
    const ids = data!.faqs.map((f) => f.id);
    const target = index + delta;
    if (target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target], ids[index]];
    void run(() => reorderFaqs(ids));
  }

  function moveCategory(index: number, delta: number) {
    const ids = data!.categories.map((c) => c.id);
    const target = index + delta;
    if (target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target], ids[index]];
    void run(() => reorderFaqCategories(ids));
  }

  return (
    <div>
      {data.usingLegacyFallback && (
        <p
          style={{
            fontSize: 12.5,
            lineHeight: 1.5,
            color: "#92400e",
            background: "#fffbeb",
            border: "1px solid #fde68a",
            borderRadius: 10,
            padding: "10px 12px",
            marginBottom: 14,
          }}>
          No questions in the FAQ tables yet — the public FAQ and the customer
          Help page are still showing the older saved list. Add a question here
          and both pages switch to this editor.
        </p>
      )}

      {/* ── Categories ───────────────────────────────────────────────── */}
      <div style={{ marginBottom: 22 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 8,
          }}>
          <span style={{ fontSize: 13, fontWeight: 600 }}>Categories</span>
          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              fontSize: 12,
              color: "var(--primary-60)",
            }}>
            <input
              type="checkbox"
              checked={showFrench}
              onChange={(e) => setShowFrench(e.target.checked)}
            />
            Show French fields
          </label>
        </div>

        <div className="space-y-2">
          {data.categories.length === 0 && (
            <p style={{ fontSize: 13, color: "var(--primary-60)" }}>
              No categories yet. Questions without one appear together at the
              bottom of both FAQ pages.
            </p>
          )}
          {data.categories.map((c, i) => (
            <div
              key={c.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                border: "1px solid var(--primary-10)",
                borderRadius: 10,
                padding: "8px 10px",
              }}>
              <div style={{ display: "flex", flexDirection: "column" }}>
                <button
                  type="button"
                  className="chat-icon-btn"
                  onClick={() => moveCategory(i, -1)}
                  disabled={busy || i === 0}
                  aria-label={`Move ${c.name} up`}>
                  <ChevronUp size={13} />
                </button>
                <button
                  type="button"
                  className="chat-icon-btn"
                  onClick={() => moveCategory(i, 1)}
                  disabled={busy || i === data.categories.length - 1}
                  aria-label={`Move ${c.name} down`}>
                  <ChevronDown size={13} />
                </button>
              </div>
              <Input
                variant="form"
                type="text"
                defaultValue={c.name}
                onBlur={(e) => {
                  if (e.target.value.trim() !== c.name) {
                    void run(() => updateFaqCategory(c.id, { name: e.target.value }));
                  }
                }}
                placeholder="Category name"
              />
              {showFrench && (
                <Input
                  variant="form"
                  type="text"
                  defaultValue={c.nameFr ?? ""}
                  onBlur={(e) => {
                    if ((e.target.value.trim() || null) !== c.nameFr) {
                      void run(() => updateFaqCategory(c.id, { nameFr: e.target.value }));
                    }
                  }}
                  placeholder="Nom de la catégorie (FR)"
                />
              )}
              <span
                style={{
                  fontSize: 11.5,
                  color: "var(--primary-50)",
                  whiteSpace: "nowrap",
                }}>
                {c.faqCount} question{c.faqCount === 1 ? "" : "s"}
              </span>
              <button
                type="button"
                onClick={() => {
                  if (
                    c.faqCount > 0 &&
                    !confirm(
                      `Delete "${c.name}"? Its ${c.faqCount} question${c.faqCount === 1 ? "" : "s"} will be kept and become uncategorised.`
                    )
                  ) {
                    return;
                  }
                  void run(
                    () => deleteFaqCategory(c.id),
                    c.faqCount > 0
                      ? `Category deleted — ${c.faqCount} question${c.faqCount === 1 ? "" : "s"} kept, now uncategorised.`
                      : "Category deleted."
                  );
                }}
                disabled={busy}
                aria-label={`Delete ${c.name}`}
                style={{
                  background: "transparent",
                  border: "none",
                  color: "var(--primary-50)",
                  cursor: "pointer",
                  padding: 6,
                }}>
                <Trash2 size={15} />
              </button>
            </div>
          ))}
        </div>

        <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
          <Input
            variant="form"
            type="text"
            value={newCategory}
            onChange={(e) => setNewCategory(e.target.value)}
            placeholder="New category name"
          />
          <Button
            type="button"
            variant="secondary"
            disabled={busy || !newCategory.trim()}
            onClick={() =>
              void run(() => createFaqCategory(newCategory)).then(() => setNewCategory(""))
            }>
            <FolderPlus size={14} /> Add
          </Button>
        </div>
      </div>

      {/* ── Questions ────────────────────────────────────────────────── */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 8,
        }}>
        <span style={{ fontSize: 13, fontWeight: 600 }}>Questions</span>
        <span style={{ fontSize: 11.5, color: "var(--primary-50)" }}>
          {data.faqs.filter((f) => f.status === "PUBLISHED").length} published ·{" "}
          {data.faqs.filter((f) => f.status === "DRAFT").length} draft
        </span>
      </div>

      <div className="space-y-3">
        {data.faqs.length === 0 && (
          <p style={{ fontSize: 13, color: "var(--primary-60)" }}>
            No questions yet. Add one below — it starts as a draft, so nothing
            goes live until you publish it.
          </p>
        )}
        {data.faqs.map((f, i) => (
          <div
            key={f.id}
            style={{
              border: "1px solid var(--primary-10)",
              borderRadius: 12,
              padding: 12,
              background: f.status === "DRAFT" ? "rgba(0,0,0,0.015)" : undefined,
            }}>
            <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
              <div style={{ display: "flex", flexDirection: "column" }}>
                <button
                  type="button"
                  className="chat-icon-btn"
                  onClick={() => move(i, -1)}
                  disabled={busy || i === 0}
                  aria-label="Move question up">
                  <ChevronUp size={13} />
                </button>
                <button
                  type="button"
                  className="chat-icon-btn"
                  onClick={() => move(i, 1)}
                  disabled={busy || i === data.faqs.length - 1}
                  aria-label="Move question down">
                  <ChevronDown size={13} />
                </button>
              </div>
              <Input
                variant="form"
                type="text"
                defaultValue={f.question}
                onBlur={(e) => {
                  if (e.target.value.trim() !== f.question) {
                    void run(() => updateFaq(f.id, { question: e.target.value }));
                  }
                }}
                placeholder="Question"
              />
              <button
                type="button"
                onClick={() => void run(() => duplicateFaq(f.id), "Question duplicated as a draft.")}
                disabled={busy}
                aria-label="Duplicate question"
                title="Duplicate as a draft"
                style={{ background: "transparent", border: "none", color: "var(--primary-50)", cursor: "pointer", padding: 6 }}>
                <Copy size={15} />
              </button>
              <button
                type="button"
                onClick={() => {
                  if (!confirm(`Delete "${f.question}"? This cannot be undone.`)) return;
                  void run(() => deleteFaq(f.id), "Question deleted.");
                }}
                disabled={busy}
                aria-label="Delete question"
                style={{ background: "transparent", border: "none", color: "var(--primary-50)", cursor: "pointer", padding: 6 }}>
                <Trash2 size={15} />
              </button>
            </div>

            <textarea
              defaultValue={f.answer}
              onBlur={(e) => {
                if (e.target.value.trim() !== f.answer) {
                  void run(() => updateFaq(f.id, { answer: e.target.value }));
                }
              }}
              rows={3}
              placeholder="Answer"
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[#008C9C]"
            />

            {showFrench && (
              <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 8 }}>
                <Input
                  variant="form"
                  type="text"
                  defaultValue={f.questionFr ?? ""}
                  onBlur={(e) => {
                    if ((e.target.value.trim() || null) !== f.questionFr) {
                      void run(() => updateFaq(f.id, { questionFr: e.target.value }));
                    }
                  }}
                  placeholder="Question (FR) — laissez vide pour utiliser l'anglais"
                />
                <textarea
                  defaultValue={f.answerFr ?? ""}
                  onBlur={(e) => {
                    if ((e.target.value.trim() || null) !== f.answerFr) {
                      void run(() => updateFaq(f.id, { answerFr: e.target.value }));
                    }
                  }}
                  rows={3}
                  placeholder="Réponse (FR) — laissez vide pour utiliser l'anglais"
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[#008C9C]"
                />
              </div>
            )}

            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: 10,
                alignItems: "center",
                marginTop: 10,
              }}>
              <select
                value={f.categoryId ?? ""}
                disabled={busy}
                onChange={(e) =>
                  void run(() => updateFaq(f.id, { categoryId: e.target.value || null }))
                }
                aria-label={`Category for "${f.question}"`}
                className="border border-gray-200 rounded-lg px-2 py-1.5 text-xs">
                <option value="">Uncategorised</option>
                {data.categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>

              <select
                value={f.visibility}
                disabled={busy}
                onChange={(e) =>
                  void run(() =>
                    updateFaq(f.id, {
                      visibility: e.target.value as "PUBLIC" | "PORTAL" | "BOTH",
                    })
                  )
                }
                aria-label={`Where "${f.question}" appears`}
                className="border border-gray-200 rounded-lg px-2 py-1.5 text-xs">
                <option value="BOTH">Website + customer portal</option>
                <option value="PUBLIC">Public website only</option>
                <option value="PORTAL">Customer portal only</option>
              </select>

              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  void run(() =>
                    updateFaq(f.id, {
                      status: f.status === "PUBLISHED" ? "DRAFT" : "PUBLISHED",
                    })
                  )
                }
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 5,
                  border: "1px solid var(--primary-10)",
                  background: f.status === "PUBLISHED" ? "rgba(0,140,156,0.07)" : "transparent",
                  color: f.status === "PUBLISHED" ? "var(--primary)" : "var(--primary-60)",
                  borderRadius: 999,
                  padding: "5px 12px",
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: "pointer",
                }}>
                {f.status === "PUBLISHED" ? <Eye size={13} /> : <EyeOff size={13} />}
                {f.status === "PUBLISHED" ? "Published" : "Draft"}
              </button>

              <span style={{ fontSize: 11.5, color: "var(--primary-50)" }}>
                {categoryName(f.categoryId)}
              </span>
            </div>
          </div>
        ))}
      </div>

      {/* ── Add a question ───────────────────────────────────────────── */}
      <div
        style={{
          marginTop: 14,
          border: "1px dashed var(--primary-10)",
          borderRadius: 12,
          padding: 12,
        }}>
        <Input
          variant="form"
          type="text"
          value={newQuestion}
          onChange={(e) => setNewQuestion(e.target.value)}
          placeholder="New question"
        />
        <textarea
          value={newAnswer}
          onChange={(e) => setNewAnswer(e.target.value)}
          rows={3}
          placeholder="Answer"
          style={{ marginTop: 8 }}
          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[#008C9C]"
        />
        <Button
          type="button"
          variant="secondary"
          disabled={busy || !newQuestion.trim() || !newAnswer.trim()}
          onClick={() =>
            void run(
              () => createFaq({ question: newQuestion, answer: newAnswer }),
              "Question added as a draft — publish it when you're ready."
            ).then(() => {
              setNewQuestion("");
              setNewAnswer("");
            })
          }
          style={{ marginTop: 8 }}>
          <Plus size={14} /> Add question
        </Button>
      </div>

      {error && (
        <p style={{ fontSize: 12.5, color: "#dc2626", marginTop: 10 }}>{error}</p>
      )}
      {notice && (
        <p style={{ fontSize: 12.5, color: "var(--primary)", marginTop: 10 }}>{notice}</p>
      )}
    </div>
  );
}
