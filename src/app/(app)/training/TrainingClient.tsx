"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Card from "@/components/ui/Card";
import Badge from "@/components/ui/Badge";
import Button from "@/components/ui/Button";
import IconButton from "@/components/ui/IconButton";
import Input from "@/components/ui/Input";
import Modal from "@/components/ui/Modal";
import { ConfirmDeleteModal } from "@/components/common/ConfirmDeleteModal";
import {
  GraduationCap,
  Play,
  CheckCircle2,
  AlertCircle,
  Clock,
  ChevronRight,
  Plus,
  Pencil,
  Trash2,
  ArrowUp,
  ArrowDown,
  X,
  Check,
  BarChart3,
} from "lucide-react";
import { createTrainingModule } from "../actions/createTrainingModule";
import { updateTrainingModule } from "../actions/updateTrainingModule";
import { deleteTrainingModule } from "../actions/deleteTrainingModule";

type ModuleStatus = "NOT_STARTED" | "IN_PROGRESS" | "COMPLETED" | "FAILED";

interface ModuleData {
  id: string;
  title: string;
  description: string | null;
  videoUrl: string | null;
  duration: number | null;
  isRequired: boolean;
  isActive: boolean;
  hasQuiz: boolean;
  progress: {
    status: ModuleStatus;
    videoProgress: number;
    quizScore: number | null;
    quizAttempts: number;
    completedAt: string | null;
  } | null;
}

interface AdminQuiz {
  id: string;
  question: string;
  options: { text: string; isCorrect: boolean }[];
  sortOrder: number;
}

interface AdminProgress {
  id: string;
  employeeId: string;
  status: ModuleStatus;
  videoProgress: number;
  quizScore: number | null;
  employee: { id: string; name: string };
}

interface AdminModuleRecord {
  id: string;
  title: string;
  description: string | null;
  videoUrl: string | null;
  duration: number | null;
  isRequired: boolean;
  isActive: boolean;
  sortOrder: number;
  quizzes: AdminQuiz[];
  progress: AdminProgress[];
}

interface TrainingClientProps {
  modules: ModuleData[];
  isAdmin: boolean;
  adminModules: AdminModuleRecord[] | null;
  totalEmployees: number;
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

const themedInputClass =
  "w-full px-4 py-2.5 rounded-xl border border-transparent bg-[#008C9C]/5 text-sm text-[#008C9C] placeholder:text-[#008C9C]/40 focus:outline-none focus:ring-2 focus:ring-[#008C9C]/20";

function statusInfo(status: ModuleStatus) {
  switch (status) {
    case "COMPLETED":
      return {
        label: "Completed",
        icon: CheckCircle2,
        variant: "success" as const,
      };
    case "IN_PROGRESS":
      return {
        label: "In Progress",
        icon: Play,
        variant: "warning" as const,
      };
    case "FAILED":
      return {
        label: "Failed",
        icon: AlertCircle,
        variant: "error" as const,
      };
    default:
      return {
        label: "Not Started",
        icon: Clock,
        variant: "default" as const,
      };
  }
}

function formatDuration(seconds: number | null) {
  if (!seconds) return null;
  const m = Math.floor(seconds / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return rest === 0 ? `${h} hr` : `${h}h ${rest}m`;
}

export default function TrainingClient({
  modules,
  isAdmin,
  adminModules,
  totalEmployees,
}: TrainingClientProps) {
  const router = useRouter();

  const [modalOpen, setModalOpen] = useState(false);
  const [statsModuleId, setStatsModuleId] = useState<string | null>(null);
  const [draft, setDraft] = useState<DraftModule>(EMPTY_MODULE);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  const required = useMemo(
    () => modules.filter((m) => m.isRequired && m.isActive),
    [modules]
  );

  const totalRequired = required.length;
  const completedRequired = required.filter(
    (m) => m.progress?.status === "COMPLETED"
  ).length;
  const overallPct =
    totalRequired === 0
      ? 100
      : Math.round((completedRequired / totalRequired) * 100);

  const adminList = adminModules ?? [];
  const adminRequired = useMemo(
    () => adminList.filter((m) => m.isRequired),
    [adminList]
  );
  const adminOptional = useMemo(
    () => adminList.filter((m) => !m.isRequired),
    [adminList]
  );

  const employeeRequired = useMemo(
    () => modules.filter((m) => m.isRequired),
    [modules]
  );
  const employeeOptional = useMemo(
    () => modules.filter((m) => !m.isRequired),
    [modules]
  );

  function openCreate() {
    setDraft({ ...EMPTY_MODULE, sortOrder: adminList.length });
    setMsg(null);
    setModalOpen(true);
  }

  function openEdit(m: AdminModuleRecord) {
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

  function updateQuizQuestion(idx: number, question: string) {
    setDraft((prev) => ({
      ...prev,
      quizzes: prev.quizzes.map((q, i) =>
        i === idx ? { ...q, question } : q
      ),
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

  function updateOption(
    qIdx: number,
    oIdx: number,
    patch: Partial<DraftOption>
  ) {
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

  async function moveModule(idx: number, direction: -1 | 1) {
    const target = idx + direction;
    if (target < 0 || target >= adminList.length) return;
    const a = adminList[idx];
    const b = adminList[target];
    await Promise.all([
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
    router.refresh();
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
      router.refresh();
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
      router.refresh();
    } else {
      setMsg({ type: "error", text: res.error || "Failed to delete." });
    }
  }

  const statsModule = adminList.find((m) => m.id === statsModuleId);

  return (
    <div className={isAdmin ? "max-w-[80rem] mx-auto space-y-6" : undefined}>
      <div className={isAdmin ? "flex items-start justify-between gap-4 flex-wrap" : "cl-page-head"}>
        <div>
          <h1 className={isAdmin ? "text-3xl !font-light tracking-tight text-[#008C9C]" : "cl-page-title"}>
            Training
          </h1>
          <p className={isAdmin ? "text-sm text-[#008C9C]/70 !font-light mt-1" : "cl-page-sub"}>
            {isAdmin
              ? "Create and manage training modules for your team"
              : "Complete required modules to stay certified"}
          </p>
        </div>
        {isAdmin && (
          <Button
            type="button"
            variant="action"
            border={false}
            size="md"
            onClick={openCreate}
            className="rounded-xl px-5 py-3">
            <Plus className="w-4 h-4 mr-1.5" /> New Module
          </Button>
        )}
      </div>

      {!isAdmin && (
        <div className="cl-progress-card">
          <div className="icon">
            <GraduationCap className="w-6 h-6" />
          </div>
          <div className="text">
            <div className="label">Required progress</div>
            <div className="val">{completedRequired} of {totalRequired} complete</div>
          </div>
          <div className="cl-progress-bar">
            <div className="fill" style={{ width: `${overallPct}%` }} />
          </div>
          <div className="cl-progress-pct">{overallPct}%</div>
        </div>
      )}

      {msg && (
        <div
          className={`px-4 py-3 rounded-xl text-sm font-[350] ${
            msg.type === "success"
              ? "bg-[#008C9C]/10 text-[#008C9C] border border-[#008C9C]/15"
              : "bg-red-50 text-red-700 border border-red-200"
          }`}>
          {msg.text}
        </div>
      )}

      {isAdmin ? (
        <>
          <AdminModuleSection
            title="Required Modules"
            modules={adminRequired}
            allModules={adminList}
            onEdit={openEdit}
            onDelete={handleDelete}
            onMove={moveModule}
            onStats={(id) => setStatsModuleId(id)}
            emptyText="No required modules yet."
            totalEmployees={totalEmployees}
          />
          <AdminModuleSection
            title="Optional Modules"
            modules={adminOptional}
            allModules={adminList}
            onEdit={openEdit}
            onDelete={handleDelete}
            onMove={moveModule}
            onStats={(id) => setStatsModuleId(id)}
            emptyText="No optional modules yet."
            totalEmployees={totalEmployees}
          />
        </>
      ) : (
        <>
          <ModuleSection
            title="Required Modules"
            modules={employeeRequired}
            emptyText="No required modules assigned."
          />
          <ModuleSection
            title="Optional Modules"
            modules={employeeOptional}
            emptyText="No optional modules available."
          />
        </>
      )}

      {isAdmin && (
        <>
          <Modal
            isOpen={modalOpen}
            onClose={() => setModalOpen(false)}
            title={draft.id ? "Edit Training Module" : "New Training Module"}>
            <div className="space-y-4 max-h-[70vh] overflow-y-auto pr-1">
              <FormField label="Title">
                <Input
                  variant="form"
                  value={draft.title}
                  onChange={(e) =>
                    setDraft((prev) => ({ ...prev, title: e.target.value }))
                  }
                  placeholder="e.g. Workplace Safety 101"
                />
              </FormField>

              <FormField label="Description">
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
              </FormField>

              <FormField
                label="Video URL"
                hint="Link to the training video (YouTube, Vimeo, MP4 URL).">
                <input
                  type="text"
                  value={draft.videoUrl}
                  onChange={(e) =>
                    setDraft((prev) => ({
                      ...prev,
                      videoUrl: e.target.value,
                    }))
                  }
                  placeholder="https://..."
                  className={themedInputClass}
                />
              </FormField>

              <div className="grid grid-cols-2 gap-3">
                <FormField label="Duration (seconds)" hint="Optional.">
                  <input
                    type="number"
                    min="0"
                    value={draft.duration}
                    onChange={(e) =>
                      setDraft((prev) => ({
                        ...prev,
                        duration: e.target.value,
                      }))
                    }
                    placeholder="e.g. 600"
                    className={themedInputClass}
                  />
                </FormField>
                <FormField label="Order" hint="Lower numbers appear first.">
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
                </FormField>
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
                      setDraft((prev) => ({
                        ...prev,
                        isActive: e.target.checked,
                      }))
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
                              updateQuizQuestion(qIdx, e.target.value)
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
                                updateOption(qIdx, oIdx, {
                                  text: e.target.value,
                                })
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

              {msg && (
                <div
                  className={`px-4 py-3 rounded-xl text-sm font-[350] ${
                    msg.type === "success"
                      ? "bg-[#008C9C]/10 text-[#008C9C] border border-[#008C9C]/15"
                      : "bg-red-50 text-red-700 border border-red-200"
                  }`}>
                  {msg.text}
                </div>
              )}

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
        </>
      )}

      <ConfirmDeleteModal
        isOpen={!!deleteId}
        onClose={() => setDeleteId(null)}
        onConfirm={runDelete}
        fileName="this training module"
        title="Delete training module?"
        message="This action cannot be undone."
      />
    </div>
  );
}

function FormField({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="text-xs font-[350] text-[#008C9C]/70 uppercase tracking-wide mb-2 block">
        {label}
      </label>
      {children}
      {hint && <p className="text-xs text-[#008C9C]/60 mt-1">{hint}</p>}
    </div>
  );
}

function ModuleSection({
  title,
  modules,
  emptyText,
}: {
  title: string;
  modules: ModuleData[];
  emptyText: string;
}) {
  return (
    <div style={{ marginBottom: 28 }}>
      <h2 style={{ fontFamily: "var(--font-serif)", fontSize: 22, color: "var(--ink)", margin: "4px 0 12px", letterSpacing: "-0.01em", fontWeight: 400 }}>
        {title}
      </h2>
      {modules.length === 0 ? (
        <div className="cl-empty-block" style={{ marginBottom: 0 }}>
          <p style={{ margin: 0, color: "var(--ink-soft)" }}>{emptyText}</p>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {modules.map((m) => (
            <ModuleRow key={m.id} module={m} />
          ))}
        </div>
      )}
    </div>
  );
}

function ModuleRow({ module: m }: { module: ModuleData }) {
  const status = m.progress?.status ?? "NOT_STARTED";
  const info = statusInfo(status);
  const Icon = info.icon;
  const duration = formatDuration(m.duration);
  const videoPct = Math.round((m.progress?.videoProgress ?? 0) * 100);

  const statusPillCls = status === "COMPLETED" ? "passed" : status === "IN_PROGRESS" ? "scheduled" : status === "FAILED" ? "failed" : "";
  const statusLabel = info.label;

  return (
    <Link href={`/training/${m.id}`} className="cl-module">
      <div className="cl-module-meta">
        <div className="cl-module-head">
          <span className="cl-module-title">{m.title}</span>
          <span className={`cl-pill ${statusPillCls}`}>
            <Icon className="w-3 h-3" style={{ marginRight: 4 }} />
            {statusLabel}
          </span>
          {m.isRequired && <span className="cl-pill required">Required</span>}
          {m.hasQuiz && <span className="cl-pill quiz">Quiz</span>}
        </div>
        {m.description && (
          <div className="cl-module-summary">{m.description}</div>
        )}
        {(duration || (status === "IN_PROGRESS") || m.progress?.quizScore != null) && (
          <div style={{ fontSize: 11.5, color: "var(--primary-50)", marginTop: 6, display: "flex", gap: 12 }}>
            {duration && <span>{duration}</span>}
            {status === "IN_PROGRESS" && <span>{videoPct}% watched</span>}
            {m.progress?.quizScore != null && (
              <span>Quiz: {Math.round(m.progress.quizScore * 100)}%{m.progress.quizAttempts > 1 ? ` (${m.progress.quizAttempts} attempts)` : ""}</span>
            )}
          </div>
        )}
      </div>
      <div className="cl-module-chev">
        <ChevronRight className="w-5 h-5" />
      </div>
    </Link>
  );
}

function AdminModuleSection({
  title,
  modules,
  allModules,
  onEdit,
  onDelete,
  onMove,
  onStats,
  emptyText,
  totalEmployees,
}: {
  title: string;
  modules: AdminModuleRecord[];
  allModules: AdminModuleRecord[];
  onEdit: (m: AdminModuleRecord) => void;
  onDelete: (id: string) => void;
  onMove: (idx: number, direction: -1 | 1) => void;
  onStats: (id: string) => void;
  emptyText: string;
  totalEmployees: number;
}) {
  return (
    <div className="space-y-3">
      <h2 className="text-lg font-[350] tracking-tight text-[#008C9C]">
        {title}
      </h2>
      {modules.length === 0 ? (
        <Card variant="ghost" className="p-8">
          <p className="text-sm text-[#008C9C]/60 text-center">{emptyText}</p>
        </Card>
      ) : (
        <div className="space-y-2">
          {modules.map((m) => {
            const overallIdx = allModules.findIndex((x) => x.id === m.id);
            return (
              <AdminModuleRow
                key={m.id}
                module={m}
                idx={overallIdx}
                lastIdx={allModules.length - 1}
                onEdit={onEdit}
                onDelete={onDelete}
                onMove={onMove}
                onStats={onStats}
                totalEmployees={totalEmployees}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

function AdminModuleRow({
  module: m,
  idx,
  lastIdx,
  onEdit,
  onDelete,
  onMove,
  onStats,
  totalEmployees,
}: {
  module: AdminModuleRecord;
  idx: number;
  lastIdx: number;
  onEdit: (m: AdminModuleRecord) => void;
  onDelete: (id: string) => void;
  onMove: (idx: number, direction: -1 | 1) => void;
  onStats: (id: string) => void;
  totalEmployees: number;
}) {
  const router = useRouter();
  const duration = formatDuration(m.duration);
  const completed = m.progress.filter(
    (p) => p.status === "COMPLETED"
  ).length;
  const total = totalEmployees;

  return (
    <div className="flex items-start gap-3 p-4 border border-[#008C9C]/10 rounded-2xl bg-white hover:bg-[#008C9C]/3 transition-colors">
      <div className="flex flex-col gap-1 pt-1">
        <button
          type="button"
          onClick={() => onMove(idx, -1)}
          disabled={idx <= 0}
          className="p-1 rounded text-[#008C9C]/60 hover:bg-[#008C9C]/10 disabled:opacity-20 disabled:cursor-not-allowed"
          aria-label="Move up">
          <ArrowUp className="w-3 h-3" />
        </button>
        <button
          type="button"
          onClick={() => onMove(idx, 1)}
          disabled={idx >= lastIdx}
          className="p-1 rounded text-[#008C9C]/60 hover:bg-[#008C9C]/10 disabled:opacity-20 disabled:cursor-not-allowed"
          aria-label="Move down">
          <ArrowDown className="w-3 h-3" />
        </button>
      </div>

      <div
        role="button"
        tabIndex={0}
        onClick={() => router.push(`/training/${m.id}`)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            router.push(`/training/${m.id}`);
          }
        }}
        className="flex-1 min-w-0 text-left cursor-pointer">
        <div className="flex items-center gap-2 flex-wrap">
          <h3 className="text-sm font-[400] text-[#008C9C]">{m.title}</h3>
          {!m.isActive && (
            <Badge variant="default" size="sm">
              Inactive
            </Badge>
          )}
          {m.isRequired && (
            <Badge variant="cleano" size="sm">
              Required
            </Badge>
          )}
          {m.quizzes.length > 0 && (
            <Badge variant="default" size="sm">
              Quiz · {m.quizzes.length}q
            </Badge>
          )}
        </div>
        {m.description && (
          <p className="text-xs text-[#008C9C]/60 mt-1 line-clamp-2">
            {m.description}
          </p>
        )}
        <div className="flex items-center gap-4 mt-2 text-xs text-[#008C9C]/60">
          {duration && (
            <span className="flex items-center gap-1">
              <Clock className="w-3 h-3" />
              {duration}
            </span>
          )}
          {m.videoUrl && <span>Video set</span>}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onStats(m.id);
            }}
            className="text-[#008C9C] hover:underline inline-flex items-center gap-1">
            <BarChart3 className="w-3 h-3" />
            {completed}/{total} completed — view stats
          </button>
        </div>
      </div>

      <div className="flex gap-1 flex-shrink-0">
        <IconButton
          icon={Pencil}
          variant="ghost"
          size="sm"
          onClick={() => onEdit(m)}
        />
        <IconButton
          icon={Trash2}
          variant="ghost"
          size="sm"
          onClick={() => onDelete(m.id)}
          className="text-red-500"
        />
      </div>
    </div>
  );
}
