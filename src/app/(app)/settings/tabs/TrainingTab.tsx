"use client";

import { useState } from "react";
import {
  Plus,
  Trash2,
  Pencil,
  X,
  GraduationCap,
  ArrowUp,
  ArrowDown,
  Check,
} from "lucide-react";
import Input from "@/components/ui/Input";
import Button from "@/components/ui/Button";
import IconButton from "@/components/ui/IconButton";
import Modal from "@/components/ui/Modal";
import { ConfirmDeleteModal } from "@/components/common/ConfirmDeleteModal";
import { createTrainingModule } from "../../actions/createTrainingModule";
import { updateTrainingModule } from "../../actions/updateTrainingModule";
import { deleteTrainingModule } from "../../actions/deleteTrainingModule";
import {
  SectionCard,
  Field,
  Feedback,
  Msg,
  themedInputClass,
} from "./_shared";

export interface TrainingProgressRecord {
  id: string;
  employeeId: string;
  status: "NOT_STARTED" | "IN_PROGRESS" | "COMPLETED" | "FAILED";
  videoProgress: number;
  quizScore: number | null;
  employee: { id: string; name: string };
}

export interface TrainingQuizRecord {
  id: string;
  question: string;
  options: { text: string; isCorrect: boolean }[];
  sortOrder: number;
}

export interface TrainingModuleRecord {
  id: string;
  title: string;
  description: string | null;
  videoUrl: string | null;
  duration: number | null;
  isRequired: boolean;
  isActive: boolean;
  sortOrder: number;
  quizzes: TrainingQuizRecord[];
  progress: TrainingProgressRecord[];
}

interface TrainingTabProps {
  modules: TrainingModuleRecord[];
}

interface DraftOption {
  text: string;
  isCorrect: boolean;
}

interface DraftQuiz {
  question: string;
  options: DraftOption[];
}

interface DraftModule {
  id: string | null;
  title: string;
  description: string;
  videoUrl: string;
  duration: string;
  isRequired: boolean;
  isActive: boolean;
  sortOrder: number;
  quizzes: DraftQuiz[];
}

const EMPTY_MODULE: DraftModule = {
  id: null,
  title: "",
  description: "",
  videoUrl: "",
  duration: "",
  isRequired: false,
  isActive: true,
  sortOrder: 0,
  quizzes: [],
};

function emptyQuiz(): DraftQuiz {
  return {
    question: "",
    options: [
      { text: "", isCorrect: true },
      { text: "", isCorrect: false },
    ],
  };
}

export default function TrainingTab({ modules }: TrainingTabProps) {
  const [modalOpen, setModalOpen] = useState(false);
  const [statsModuleId, setStatsModuleId] = useState<string | null>(null);
  const [draft, setDraft] = useState<DraftModule>(EMPTY_MODULE);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);

  function openCreate() {
    setDraft({ ...EMPTY_MODULE, sortOrder: modules.length });
    setMsg(null);
    setModalOpen(true);
  }

  function openEdit(m: TrainingModuleRecord) {
    setDraft({
      id: m.id,
      title: m.title,
      description: m.description ?? "",
      videoUrl: m.videoUrl ?? "",
      duration: m.duration?.toString() ?? "",
      isRequired: m.isRequired,
      isActive: m.isActive,
      sortOrder: m.sortOrder,
      quizzes: [...m.quizzes]
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((q) => ({
          question: q.question,
          options: q.options.map((o) => ({
            text: o.text,
            isCorrect: o.isCorrect,
          })),
        })),
    });
    setMsg(null);
    setModalOpen(true);
  }

  function addQuiz() {
    setDraft((prev) => ({ ...prev, quizzes: [...prev.quizzes, emptyQuiz()] }));
  }

  function removeQuiz(idx: number) {
    setDraft((prev) => ({
      ...prev,
      quizzes: prev.quizzes.filter((_, i) => i !== idx),
    }));
  }

  function updateQuiz(idx: number, patch: Partial<DraftQuiz>) {
    setDraft((prev) => ({
      ...prev,
      quizzes: prev.quizzes.map((q, i) => (i === idx ? { ...q, ...patch } : q)),
    }));
  }

  function addOption(qIdx: number) {
    setDraft((prev) => ({
      ...prev,
      quizzes: prev.quizzes.map((q, i) =>
        i === qIdx
          ? { ...q, options: [...q.options, { text: "", isCorrect: false }] }
          : q
      ),
    }));
  }

  function removeOption(qIdx: number, oIdx: number) {
    setDraft((prev) => ({
      ...prev,
      quizzes: prev.quizzes.map((q, i) => {
        if (i !== qIdx) return q;
        const next = q.options.filter((_, j) => j !== oIdx);
        if (!next.some((o) => o.isCorrect) && next.length > 0) {
          next[0] = { ...next[0], isCorrect: true };
        }
        return { ...q, options: next };
      }),
    }));
  }

  function updateOption(qIdx: number, oIdx: number, patch: Partial<DraftOption>) {
    setDraft((prev) => ({
      ...prev,
      quizzes: prev.quizzes.map((q, i) => {
        if (i !== qIdx) return q;
        return {
          ...q,
          options: q.options.map((o, j) =>
            j === oIdx ? { ...o, ...patch } : o
          ),
        };
      }),
    }));
  }

  function setCorrectOption(qIdx: number, oIdx: number) {
    setDraft((prev) => ({
      ...prev,
      quizzes: prev.quizzes.map((q, i) => {
        if (i !== qIdx) return q;
        return {
          ...q,
          options: q.options.map((o, j) => ({
            ...o,
            isCorrect: j === oIdx,
          })),
        };
      }),
    }));
  }

  function moveModule(idx: number, direction: -1 | 1) {
    const target = idx + direction;
    if (target < 0 || target >= modules.length) return;
    const a = modules[idx];
    const b = modules[target];
    void Promise.all([
      updateTrainingModule({
        id: a.id,
        title: a.title,
        description: a.description,
        videoUrl: a.videoUrl,
        duration: a.duration,
        isRequired: a.isRequired,
        isActive: a.isActive,
        sortOrder: b.sortOrder,
        quizzes: a.quizzes.map((q) => ({
          question: q.question,
          options: q.options,
          sortOrder: q.sortOrder,
        })),
      }),
      updateTrainingModule({
        id: b.id,
        title: b.title,
        description: b.description,
        videoUrl: b.videoUrl,
        duration: b.duration,
        isRequired: b.isRequired,
        isActive: b.isActive,
        sortOrder: a.sortOrder,
        quizzes: b.quizzes.map((q) => ({
          question: q.question,
          options: q.options,
          sortOrder: q.sortOrder,
        })),
      }),
    ]);
  }

  async function handleSave() {
    if (!draft.title.trim()) {
      setMsg({ type: "error", text: "Title is required." });
      return;
    }

    for (const q of draft.quizzes) {
      if (!q.question.trim()) continue;
      if (q.options.length < 2) {
        setMsg({
          type: "error",
          text: "Each quiz question needs at least 2 options.",
        });
        return;
      }
      if (!q.options.some((o) => o.isCorrect)) {
        setMsg({
          type: "error",
          text: "Each quiz question needs a correct answer marked.",
        });
        return;
      }
      if (q.options.some((o) => !o.text.trim())) {
        setMsg({
          type: "error",
          text: "All quiz options need text.",
        });
        return;
      }
    }

    setSaving(true);
    setMsg(null);

    const duration = draft.duration.trim()
      ? parseInt(draft.duration, 10)
      : null;

    const payload = {
      title: draft.title,
      description: draft.description,
      videoUrl: draft.videoUrl,
      duration: Number.isFinite(duration as number) ? duration : null,
      isRequired: draft.isRequired,
      isActive: draft.isActive,
      sortOrder: draft.sortOrder,
      quizzes: draft.quizzes
        .filter((q) => q.question.trim())
        .map((q, idx) => ({
          question: q.question,
          options: q.options,
          sortOrder: idx,
        })),
    };

    const res = draft.id
      ? await updateTrainingModule({ id: draft.id, ...payload })
      : await createTrainingModule(payload);

    if (res.success) {
      setMsg({ type: "success", text: "Training module saved." });
      setModalOpen(false);
    } else {
      setMsg({ type: "error", text: res.error || "Failed to save." });
    }
    setSaving(false);
  }

  const [deleteId, setDeleteId] = useState<string | null>(null);
  function handleDelete(id: string) { setDeleteId(id); }
  async function runDelete() {
    if (!deleteId) return;
    const id = deleteId;
    setDeleteId(null);
    setMsg(null);
    const res = await deleteTrainingModule(id);
    if (res.success) {
      setMsg({ type: "success", text: "Module deleted." });
    } else {
      setMsg({ type: "error", text: res.error || "Failed to delete." });
    }
  }

  const statsModule = modules.find((m) => m.id === statsModuleId);

  return (
    <SectionCard
      title="Training Modules"
      description="Create video lessons and quizzes for employees."
      icon={GraduationCap}
      actions={
        <Button
          type="button"
          variant="action"
          border={false}
          size="sm"
          onClick={openCreate}
          className="rounded-xl">
          <Plus className="w-4 h-4 mr-1" /> New Module
        </Button>
      }>
      {modules.length === 0 ? (
        <p className="text-sm text-[#008C9C]/60">No training modules yet.</p>
      ) : (
        <div className="space-y-2">
          {modules.map((m, idx) => {
            const completed = m.progress.filter(
              (p) => p.status === "COMPLETED"
            ).length;
            const total = m.progress.length;
            return (
              <div
                key={m.id}
                className="flex items-start justify-between gap-3 p-4 border border-[#008C9C]/10 rounded-xl bg-white hover:bg-[#008C9C]/3 transition-colors">
                <div className="flex flex-col gap-1 pt-1">
                  <button
                    type="button"
                    onClick={() => moveModule(idx, -1)}
                    disabled={idx === 0}
                    className="p-1 rounded text-[#008C9C]/60 hover:bg-[#008C9C]/10 disabled:opacity-20 disabled:cursor-not-allowed"
                    aria-label="Move up">
                    <ArrowUp className="w-3 h-3" />
                  </button>
                  <button
                    type="button"
                    onClick={() => moveModule(idx, 1)}
                    disabled={idx === modules.length - 1}
                    className="p-1 rounded text-[#008C9C]/60 hover:bg-[#008C9C]/10 disabled:opacity-20 disabled:cursor-not-allowed"
                    aria-label="Move down">
                    <ArrowDown className="w-3 h-3" />
                  </button>
                </div>

                <div className="flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="text-sm font-[400] text-[#008C9C]">
                      {m.title}
                    </h3>
                    {!m.isActive && (
                      <span className="text-xs text-[#008C9C]/40">
                        (inactive)
                      </span>
                    )}
                    {m.isRequired && (
                      <span className="text-xs bg-[#008C9C]/10 text-[#008C9C] px-2 py-0.5 rounded-full">
                        Required
                      </span>
                    )}
                    {m.quizzes.length > 0 && (
                      <span className="text-xs bg-[#3E7596]/20 text-[#008C9C] px-2 py-0.5 rounded-full">
                        Quiz: {m.quizzes.length} q
                      </span>
                    )}
                  </div>
                  {m.description && (
                    <p className="text-xs text-[#008C9C]/60 mt-1">
                      {m.description}
                    </p>
                  )}
                  <div className="flex items-center gap-3 text-xs text-[#008C9C]/50 mt-1">
                    {m.videoUrl && <span>Video set</span>}
                    {m.duration != null && (
                      <span>{Math.round(m.duration / 60)} min</span>
                    )}
                    <button
                      type="button"
                      onClick={() => setStatsModuleId(m.id)}
                      className="text-[#008C9C] hover:underline">
                      {completed}/{total} completed — view stats
                    </button>
                  </div>
                </div>

                <div className="flex gap-1">
                  <IconButton
                    icon={Pencil}
                    variant="ghost"
                    size="sm"
                    onClick={() => openEdit(m)}
                  />
                  <IconButton
                    icon={Trash2}
                    variant="ghost"
                    size="sm"
                    onClick={() => handleDelete(m.id)}
                    className="text-red-500"
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}

      {msg && (
        <div className="mt-3">
          <Feedback msg={msg} />
        </div>
      )}

      <Modal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        title={draft.id ? "Edit Training Module" : "New Training Module"}>
        <div className="space-y-4 max-h-[70vh] overflow-y-auto pr-1">
          <Field label="Title">
            <Input
              variant="form"
              value={draft.title}
              onChange={(e) =>
                setDraft((prev) => ({ ...prev, title: e.target.value }))
              }
              placeholder="e.g. Workplace Safety 101"
            />
          </Field>

          <Field label="Description">
            <Input
              variant="form"
              value={draft.description}
              onChange={(e) =>
                setDraft((prev) => ({
                  ...prev,
                  description: e.target.value,
                }))
              }
              placeholder="Optional"
            />
          </Field>

          <Field
            label="Video URL"
            hint="Link to the training video (YouTube, Vimeo, MP4 URL).">
            <input
              type="text"
              value={draft.videoUrl}
              onChange={(e) =>
                setDraft((prev) => ({ ...prev, videoUrl: e.target.value }))
              }
              placeholder="https://..."
              className={themedInputClass}
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Duration (seconds)" hint="Optional.">
              <input
                type="number"
                min="0"
                value={draft.duration}
                onChange={(e) =>
                  setDraft((prev) => ({ ...prev, duration: e.target.value }))
                }
                placeholder="e.g. 600"
                className={themedInputClass}
              />
            </Field>
            <Field label="Order" hint="Lower numbers appear first.">
              <input
                type="number"
                value={draft.sortOrder}
                onChange={(e) =>
                  setDraft((prev) => ({
                    ...prev,
                    sortOrder: parseInt(e.target.value, 10) || 0,
                  }))
                }
                className={themedInputClass}
              />
            </Field>
          </div>

          <div className="flex gap-4 flex-wrap">
            <label className="flex items-center gap-2 text-sm text-[#008C9C] select-none">
              <input
                type="checkbox"
                checked={draft.isRequired}
                onChange={(e) =>
                  setDraft((prev) => ({
                    ...prev,
                    isRequired: e.target.checked,
                  }))
                }
                className="accent-[#008C9C]"
              />
              Required
            </label>
            <label className="flex items-center gap-2 text-sm text-[#008C9C] select-none">
              <input
                type="checkbox"
                checked={draft.isActive}
                onChange={(e) =>
                  setDraft((prev) => ({ ...prev, isActive: e.target.checked }))
                }
                className="accent-[#008C9C]"
              />
              Active
            </label>
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-[350] text-[#008C9C]/70 uppercase tracking-wide">
                Quiz Questions
              </label>
              <Button
                type="button"
                variant="default"
                border={false}
                size="sm"
                onClick={addQuiz}
                className="rounded-xl">
                <Plus className="w-4 h-4 mr-1" /> Add Question
              </Button>
            </div>
            {draft.quizzes.length === 0 && (
              <p className="text-xs text-[#008C9C]/60">
                No quiz questions added.
              </p>
            )}
            <div className="space-y-3">
              {draft.quizzes.map((q, qIdx) => (
                <div
                  key={qIdx}
                  className="p-3 rounded-xl bg-[#008C9C]/5 space-y-3">
                  <div className="flex items-start gap-2">
                    <div className="flex-1 space-y-2">
                      <Input
                        variant="form"
                        value={q.question}
                        onChange={(e) =>
                          updateQuiz(qIdx, { question: e.target.value })
                        }
                        placeholder={`Question ${qIdx + 1}`}
                      />
                    </div>
                    <IconButton
                      icon={X}
                      variant="ghost"
                      size="sm"
                      onClick={() => removeQuiz(qIdx)}
                      className="text-red-500"
                    />
                  </div>

                  <div className="space-y-2">
                    {q.options.map((opt, oIdx) => (
                      <div key={oIdx} className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => setCorrectOption(qIdx, oIdx)}
                          className={`p-1.5 rounded-lg border ${
                            opt.isCorrect
                              ? "bg-green-100 border-green-300 text-green-700"
                              : "bg-white border-[#008C9C]/20 text-[#008C9C]/40"
                          }`}
                          aria-label="Mark correct">
                          <Check className="w-3 h-3" />
                        </button>
                        <input
                          type="text"
                          value={opt.text}
                          onChange={(e) =>
                            updateOption(qIdx, oIdx, { text: e.target.value })
                          }
                          placeholder={`Option ${oIdx + 1}`}
                          className={`${themedInputClass} flex-1`}
                        />
                        <IconButton
                          icon={X}
                          variant="ghost"
                          size="sm"
                          onClick={() => removeOption(qIdx, oIdx)}
                          className="text-red-500"
                        />
                      </div>
                    ))}
                    <Button
                      type="button"
                      variant="ghost"
                      border={false}
                      size="sm"
                      onClick={() => addOption(qIdx)}
                      className="rounded-xl">
                      <Plus className="w-3 h-3 mr-1" /> Add Option
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {msg && <Feedback msg={msg} />}

          <div className="flex justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="ghost"
              border={false}
              onClick={() => setModalOpen(false)}
              className="rounded-xl">
              Cancel
            </Button>
            <Button
              type="button"
              variant="action"
              border={false}
              onClick={handleSave}
              disabled={saving}
              className="rounded-xl px-6">
              {saving ? "Saving..." : "Save Module"}
            </Button>
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={!!statsModule}
        onClose={() => setStatsModuleId(null)}
        title={statsModule ? `Stats — ${statsModule.title}` : "Stats"}>
        {statsModule && (
          <div className="space-y-3">
            {statsModule.progress.length === 0 ? (
              <p className="text-sm text-[#008C9C]/60">
                No employees have started this module yet.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50/50 border-b border-gray-100">
                      <th className="px-4 py-2 text-left text-xs font-[400] text-gray-500 uppercase tracking-wider">
                        Employee
                      </th>
                      <th className="px-4 py-2 text-left text-xs font-[400] text-gray-500 uppercase tracking-wider">
                        Status
                      </th>
                      <th className="px-4 py-2 text-left text-xs font-[400] text-gray-500 uppercase tracking-wider">
                        Video
                      </th>
                      <th className="px-4 py-2 text-left text-xs font-[400] text-gray-500 uppercase tracking-wider">
                        Quiz
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {statsModule.progress.map((p) => (
                      <tr key={p.id} className="hover:bg-gray-50/50">
                        <td className="px-4 py-2 text-[#008C9C]">
                          {p.employee.name}
                        </td>
                        <td className="px-4 py-2 text-[#008C9C]/80">
                          {p.status.replace("_", " ").toLowerCase()}
                        </td>
                        <td className="px-4 py-2 text-[#008C9C]/80">
                          {Math.round(p.videoProgress * 100)}%
                        </td>
                        <td className="px-4 py-2 text-[#008C9C]/80">
                          {p.quizScore != null
                            ? `${Math.round(p.quizScore * 100)}%`
                            : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </Modal>

      <ConfirmDeleteModal
        isOpen={!!deleteId}
        onClose={() => setDeleteId(null)}
        onConfirm={runDelete}
        fileName="this training module"
        title="Delete training module?"
        message="This action cannot be undone."
      />
    </SectionCard>
  );
}
