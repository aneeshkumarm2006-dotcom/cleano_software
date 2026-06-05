"use client";

import { useState } from "react";
import {
  Plus,
  Trash2,
  Pencil,
  X,
  ListChecks,
  ArrowUp,
  ArrowDown,
} from "lucide-react";
import Input from "@/components/ui/Input";
import Button from "@/components/ui/Button";
import IconButton from "@/components/ui/IconButton";
import Modal from "@/components/ui/Modal";
import { ConfirmDeleteModal } from "@/components/common/ConfirmDeleteModal";
import PremiumSelect from "@/components/ui/PremiumSelect";
import { createChecklistTemplate } from "../../actions/createChecklistTemplate";
import { updateChecklistTemplate } from "../../actions/updateChecklistTemplate";
import { deleteChecklistTemplate } from "../../actions/deleteChecklistTemplate";
import {
  ChecklistTemplateRecord,
  AppSettingRecord,
} from "../types";
import {
  SectionCard,
  Field,
  Feedback,
  Msg,
  themedInputClass,
  themedSelectClass,
} from "./_shared";

interface ChecklistTemplatesTabProps {
  templates: ChecklistTemplateRecord[];
  settings?: AppSettingRecord[];
}

interface DraftItem {
  title: string;
  description: string;
  isRequired: boolean;
}

interface DraftTemplate {
  id: string | null;
  name: string;
  description: string;
  jobType: string;
  addOnName: string;
  isActive: boolean;
  items: DraftItem[];
}

// Fixed job type values — must match what JobTypeSelector writes to Job.jobType
const JOB_TYPE_OPTIONS = [
  { value: "R - Residential", label: "R - Residential" },
  { value: "DEEP - Deep Cleaning", label: "DEEP - Deep Cleaning" },
  { value: "MOVE_IN - Move-in Cleaning", label: "MOVE_IN - Move-in Cleaning" },
  { value: "MOVE_OUT - Move-out Cleaning", label: "MOVE_OUT - Move-out Cleaning" },
  { value: "AIRBNB - Airbnb Cleaning", label: "AIRBNB - Airbnb Cleaning" },
  { value: "C - Commercial", label: "C - Commercial" },
  { value: "PC - Post Construction", label: "PC - Post Construction" },
  { value: "F - Follow-up", label: "F - Follow-up" },
];

const EMPTY_TEMPLATE: DraftTemplate = {
  id: null,
  name: "",
  description: "",
  jobType: "",
  addOnName: "",
  isActive: true,
  items: [],
};

export default function ChecklistTemplatesTab({
  templates,
}: ChecklistTemplatesTabProps) {
  const [modalOpen, setModalOpen] = useState(false);
  const [draft, setDraft] = useState<DraftTemplate>(EMPTY_TEMPLATE);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);

  function openCreate() {
    setDraft(EMPTY_TEMPLATE);
    setMsg(null);
    setModalOpen(true);
  }

  function openEdit(tpl: ChecklistTemplateRecord) {
    setDraft({
      id: tpl.id,
      name: tpl.name,
      description: tpl.description ?? "",
      jobType: tpl.jobType ?? "",
      addOnName: tpl.addOnName ?? "",
      isActive: tpl.isActive,
      items: [...tpl.items]
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((it) => ({
          title: it.title,
          description: it.description ?? "",
          isRequired: it.isRequired,
        })),
    });
    setMsg(null);
    setModalOpen(true);
  }

  function addItem() {
    setDraft((prev) => ({
      ...prev,
      items: [
        ...prev.items,
        { title: "", description: "", isRequired: true },
      ],
    }));
  }

  function removeItem(idx: number) {
    setDraft((prev) => ({
      ...prev,
      items: prev.items.filter((_, i) => i !== idx),
    }));
  }

  function updateItem(idx: number, patch: Partial<DraftItem>) {
    setDraft((prev) => ({
      ...prev,
      items: prev.items.map((it, i) =>
        i === idx ? { ...it, ...patch } : it
      ),
    }));
  }

  function moveItem(idx: number, direction: -1 | 1) {
    setDraft((prev) => {
      const target = idx + direction;
      if (target < 0 || target >= prev.items.length) return prev;
      const next = [...prev.items];
      [next[idx], next[target]] = [next[target], next[idx]];
      return { ...prev, items: next };
    });
  }

  async function handleSave() {
    if (!draft.name.trim()) {
      setMsg({ type: "error", text: "Template name is required." });
      return;
    }
    setSaving(true);
    setMsg(null);

    const payload = {
      name: draft.name,
      description: draft.description,
      jobType: draft.jobType || null,
      addOnName: draft.addOnName || null,
      isActive: draft.isActive,
      items: draft.items
        .filter((it) => it.title.trim())
        .map((it, idx) => ({
          title: it.title,
          description: it.description,
          isRequired: it.isRequired,
          sortOrder: idx,
        })),
    };

    const res = draft.id
      ? await updateChecklistTemplate({ id: draft.id, ...payload })
      : await createChecklistTemplate(payload);

    if (res.success) {
      setMsg({ type: "success", text: "Checklist template saved." });
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
    const res = await deleteChecklistTemplate(id);
    if (res.success) {
      setMsg({ type: "success", text: "Checklist template deleted." });
    } else {
      setMsg({ type: "error", text: res.error || "Failed to delete." });
    }
  }

  return (
    <SectionCard
      title="Checklist Templates"
      description="Define reusable checklists generated for jobs based on job type or add-on."
      icon={ListChecks}
      actions={
        <Button
          type="button"
          variant="action"
          border={false}
          size="sm"
          onClick={openCreate}
          className="rounded-xl">
          <Plus className="w-4 h-4 mr-1" /> New Template
        </Button>
      }>
      {templates.length === 0 ? (
        <p className="text-sm text-[#005F6A]/60">
          No checklist templates yet.
        </p>
      ) : (
        <div className="space-y-2">
          {templates.map((tpl) => (
            <div
              key={tpl.id}
              className="flex items-start justify-between gap-3 p-4 border border-[#005F6A]/10 rounded-xl bg-white hover:bg-[#005F6A]/3 transition-colors">
              <div className="flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="text-sm font-[400] text-[#005F6A]">
                    {tpl.name}
                  </h3>
                  {!tpl.isActive && (
                    <span className="text-xs text-[#005F6A]/40">
                      (inactive)
                    </span>
                  )}
                  {tpl.jobType && (
                    <span className="text-xs bg-[#005F6A]/10 text-[#005F6A] px-2 py-0.5 rounded-full">
                      Job: {tpl.jobType}
                    </span>
                  )}
                  {tpl.addOnName && (
                    <span className="text-xs bg-[#77C8CC]/20 text-[#005F6A] px-2 py-0.5 rounded-full">
                      Add-on: {tpl.addOnName}
                    </span>
                  )}
                  {!tpl.jobType && !tpl.addOnName && (
                    <span className="text-xs bg-neutral-200 text-neutral-600 px-2 py-0.5 rounded-full">
                      Standard (all jobs)
                    </span>
                  )}
                </div>
                {tpl.description && (
                  <p className="text-xs text-[#005F6A]/60 mt-1">
                    {tpl.description}
                  </p>
                )}
                <p className="text-xs text-[#005F6A]/50 mt-1">
                  {tpl.items.length} item{tpl.items.length === 1 ? "" : "s"}
                </p>
              </div>
              <div className="flex gap-1">
                <IconButton
                  icon={Pencil}
                  variant="ghost"
                  size="sm"
                  onClick={() => openEdit(tpl)}
                />
                <IconButton
                  icon={Trash2}
                  variant="ghost"
                  size="sm"
                  onClick={() => handleDelete(tpl.id)}
                  className="text-red-500"
                />
              </div>
            </div>
          ))}
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
        title={draft.id ? "Edit Checklist Template" : "New Checklist Template"}>
        <div className="space-y-4 max-h-[70vh] overflow-y-auto pr-1">
          <Field label="Template Name">
            <Input
              variant="form"
              value={draft.name}
              onChange={(e) =>
                setDraft((prev) => ({ ...prev, name: e.target.value }))
              }
              placeholder="e.g. Standard Residential Cleaning"
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

          <div className="grid grid-cols-2 gap-3">
            <Field
              label="Job Type"
              hint="Restrict template to a specific job type, or leave blank for all.">
              <PremiumSelect
                value={draft.jobType}
                onChange={(v) =>
                  setDraft((prev) => ({ ...prev, jobType: v }))
                }
                options={[
                  { value: "", label: "— Any (all jobs) —" },
                  ...JOB_TYPE_OPTIONS,
                ]}
                size="sm"
              />
            </Field>

            <Field
              label="Add-On Name"
              hint="Triggers when a job has this add-on (case-sensitive match).">
              <input
                type="text"
                value={draft.addOnName}
                onChange={(e) =>
                  setDraft((prev) => ({
                    ...prev,
                    addOnName: e.target.value,
                  }))
                }
                placeholder="e.g. Inside Fridge"
                className={themedInputClass}
              />
            </Field>
          </div>

          <label className="flex items-center gap-2 text-sm text-[#005F6A] select-none">
            <input
              type="checkbox"
              checked={draft.isActive}
              onChange={(e) =>
                setDraft((prev) => ({ ...prev, isActive: e.target.checked }))
              }
              className="accent-[#005F6A]"
            />
            Active
          </label>

          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-[350] text-[#005F6A]/70 uppercase tracking-wide">
                Checklist Items
              </label>
              <Button
                type="button"
                variant="default"
                border={false}
                size="sm"
                onClick={addItem}
                className="rounded-xl">
                <Plus className="w-4 h-4 mr-1" /> Add Item
              </Button>
            </div>
            {draft.items.length === 0 && (
              <p className="text-xs text-[#005F6A]/60">No items added.</p>
            )}
            <div className="space-y-2">
              {draft.items.map((item, idx) => (
                <div
                  key={idx}
                  className="p-3 rounded-xl bg-[#005F6A]/5 space-y-2">
                  <div className="flex items-start gap-2">
                    <div className="flex flex-col gap-1">
                      <button
                        type="button"
                        onClick={() => moveItem(idx, -1)}
                        disabled={idx === 0}
                        className="p-1 rounded text-[#005F6A]/60 hover:bg-[#005F6A]/10 disabled:opacity-20 disabled:cursor-not-allowed"
                        aria-label="Move up">
                        <ArrowUp className="w-3 h-3" />
                      </button>
                      <button
                        type="button"
                        onClick={() => moveItem(idx, 1)}
                        disabled={idx === draft.items.length - 1}
                        className="p-1 rounded text-[#005F6A]/60 hover:bg-[#005F6A]/10 disabled:opacity-20 disabled:cursor-not-allowed"
                        aria-label="Move down">
                        <ArrowDown className="w-3 h-3" />
                      </button>
                    </div>
                    <div className="flex-1 space-y-2">
                      <Input
                        variant="form"
                        value={item.title}
                        onChange={(e) =>
                          updateItem(idx, { title: e.target.value })
                        }
                        placeholder="Item title"
                      />
                      <Input
                        variant="form"
                        value={item.description}
                        onChange={(e) =>
                          updateItem(idx, { description: e.target.value })
                        }
                        placeholder="Optional description"
                      />
                      <label className="flex items-center gap-2 text-xs text-[#005F6A] select-none">
                        <input
                          type="checkbox"
                          checked={item.isRequired}
                          onChange={(e) =>
                            updateItem(idx, { isRequired: e.target.checked })
                          }
                          className="accent-[#005F6A]"
                        />
                        Required
                      </label>
                    </div>
                    <IconButton
                      icon={X}
                      variant="ghost"
                      size="sm"
                      onClick={() => removeItem(idx)}
                      className="text-red-500"
                    />
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
              {saving ? "Saving..." : "Save Template"}
            </Button>
          </div>
        </div>
      </Modal>

      <ConfirmDeleteModal
        isOpen={!!deleteId}
        onClose={() => setDeleteId(null)}
        onConfirm={runDelete}
        fileName="this checklist template"
        title="Delete checklist template?"
        message="This action cannot be undone."
      />
    </SectionCard>
  );
}
