"use client";

import { useEffect, useMemo, useState } from "react";
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
  getChecklistScopeOptions,
  type ChecklistScopeClient,
} from "../../actions/getChecklistScopeOptions";
import {
  ChecklistTemplateRecord,
  AppSettingRecord,
  getSetting,
} from "../types";
import {
  SectionCard,
  Field,
  Feedback,
  Msg,
  themedInputClass,
  themedSelectClass,
} from "./_shared";
import {
  DEFAULT_SERVICE_CATALOG,
  serviceOptions as catalogServiceOptions,
} from "@/lib/service-catalog";
import { addOnKey, describeScope } from "@/lib/checklist-triggers";

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
  /** Customer scope (Stage 10 / PDF #10). "" = not customer-specific. */
  clientId: string;
  clientAddressId: string;
  isActive: boolean;
  items: DraftItem[];
}

// Job types come from the Settings service catalog (item 20). Template matching
// is done on the NORMALIZED category, so templates keep working across the old
// stored vocabularies too.
const JOB_TYPE_OPTIONS = catalogServiceOptions(DEFAULT_SERVICE_CATALOG);

const EMPTY_TEMPLATE: DraftTemplate = {
  id: null,
  name: "",
  description: "",
  jobType: "",
  addOnName: "",
  clientId: "",
  clientAddressId: "",
  isActive: true,
  items: [],
};

/** Chip colours per scope tier, narrowest first. */
const SCOPE_CHIP_STYLE = "text-xs bg-violet-100 text-violet-800 px-2 py-0.5 rounded-full";

export default function ChecklistTemplatesTab({
  templates,
  settings = [],
}: ChecklistTemplatesTabProps) {
  // Add-on triggers are chosen from the add-ons configured in Settings →
  // Pricing Rules (item 27), so a trigger can't be a typo. Any add-on already
  // referenced by a saved template is unioned in, so renaming an add-on never
  // makes an existing trigger disappear from the picker.
  const addOnChoices = useMemo(() => {
    const configured = getSetting<Array<{ name?: unknown }>>(
      settings,
      "pricing.addOns",
      []
    )
      .map((a: { name?: unknown }) =>
        typeof a?.name === "string" ? a.name.trim() : ""
      )
      .filter(Boolean);

    const used = templates
      .map((t) => t.addOnName?.trim())
      .filter((n): n is string => !!n);

    const seen = new Set<string>();
    return [...configured, ...used].filter((n) => {
      const k = addOnKey(n);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }, [settings, templates]);

  const [modalOpen, setModalOpen] = useState(false);
  const [draft, setDraft] = useState<DraftTemplate>(EMPTY_TEMPLATE);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);

  // Customer scope pickers (Stage 10 / PDF #10). Loaded the first time the
  // modal opens, not with the page — see getChecklistScopeOptions for why.
  const [scopeClients, setScopeClients] = useState<ChecklistScopeClient[] | null>(
    null
  );
  const [scopeLoading, setScopeLoading] = useState(false);
  const [scopeError, setScopeError] = useState<string | null>(null);

  useEffect(() => {
    if (!modalOpen || scopeClients || scopeLoading) return;
    setScopeLoading(true);
    getChecklistScopeOptions()
      .then((res) => {
        if (res.success) {
          setScopeClients(res.clients);
          setScopeError(null);
        } else {
          setScopeError(res.error);
        }
      })
      .catch(() => setScopeError("Could not load customers"))
      .finally(() => setScopeLoading(false));
  }, [modalOpen, scopeClients, scopeLoading]);

  // Addresses belong to the chosen customer only — an address-scoped template
  // pointing at somebody else's door is rejected server-side, so the picker
  // must not be able to produce one in the first place.
  const addressChoices = useMemo(() => {
    if (!draft.clientId) return [];
    return scopeClients?.find((c) => c.id === draft.clientId)?.addresses ?? [];
  }, [scopeClients, draft.clientId]);

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
      clientId: tpl.clientId ?? "",
      clientAddressId: tpl.clientAddressId ?? "",
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
      clientId: draft.clientId || null,
      // Never sent without its client — the server rejects that pairing, and
      // the state below already clears it whenever the customer changes.
      clientAddressId: draft.clientId ? draft.clientAddressId || null : null,
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
      description="Reusable checklists generated for jobs automatically. Scope one to a job type or add-on, or to a specific customer or location — a customer checklist replaces the service-type default for their jobs."
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
        <p className="text-sm text-[#008C9C]/60">
          No checklist templates yet.
        </p>
      ) : (
        <div className="space-y-2">
          {templates.map((tpl) => {
            // Prefer the STREET over the address label: two locations both
            // labelled "Other" would otherwise render as the same chip.
            const scopeLabel = describeScope({
              clientId: tpl.clientId,
              clientAddressId: tpl.clientAddressId,
              clientName: tpl.client?.name,
              addressLabel: tpl.clientAddress?.address ?? tpl.clientAddress?.label,
            });
            return (
            <div
              key={tpl.id}
              className="flex items-start justify-between gap-3 p-4 border border-[#008C9C]/10 rounded-xl bg-white hover:bg-[#008C9C]/3 transition-colors">
              <div className="flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="text-sm font-[400] text-[#008C9C]">
                    {tpl.name}
                  </h3>
                  {!tpl.isActive && (
                    <span className="text-xs text-[#008C9C]/40">
                      (inactive)
                    </span>
                  )}
                  {/* Stage 10 — the customer scope, first because it is the
                      strongest: a customer-scoped list REPLACES the service
                      default rather than adding to it. */}
                  {scopeLabel && (
                    <span className={SCOPE_CHIP_STYLE}>{scopeLabel}</span>
                  )}
                  {tpl.jobType && (
                    <span className="text-xs bg-[#008C9C]/10 text-[#008C9C] px-2 py-0.5 rounded-full">
                      Job: {tpl.jobType}
                    </span>
                  )}
                  {tpl.addOnName && (
                    <span className="text-xs bg-[#3E7596]/20 text-[#008C9C] px-2 py-0.5 rounded-full">
                      Add-on: {tpl.addOnName}
                    </span>
                  )}
                  {/* Item 27: make the AND explicit — a template scoped to both
                      fires only when the job matches both, and that used to be
                      silently wrong. */}
                  {tpl.jobType && tpl.addOnName && (
                    <span className="text-xs bg-amber-100 text-amber-800 px-2 py-0.5 rounded-full">
                      Both must match
                    </span>
                  )}
                  {/* "Standard (all jobs)" is only true when the template is
                      unscoped in EVERY dimension. A customer-scoped template
                      with no job type applies to all of THAT customer's jobs,
                      which is a very different promise. */}
                  {!tpl.jobType &&
                    !tpl.addOnName &&
                    !tpl.clientId &&
                    !tpl.clientAddressId && (
                      <span className="text-xs bg-neutral-200 text-neutral-600 px-2 py-0.5 rounded-full">
                        Standard (all jobs)
                      </span>
                    )}
                  {(tpl.clientId || tpl.clientAddressId) && (
                    <span className="text-xs bg-violet-50 text-violet-700 px-2 py-0.5 rounded-full">
                      Overrides the service default
                    </span>
                  )}
                </div>
                {tpl.description && (
                  <p className="text-xs text-[#008C9C]/60 mt-1">
                    {tpl.description}
                  </p>
                )}
                <p className="text-xs text-[#008C9C]/50 mt-1">
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

          {/* ── Customer scope (Stage 10 / PDF #10) ────────────────────────
              Above the service triggers, because it is the stronger rule: a
              template scoped to a customer REPLACES the service-type default
              for that customer's jobs. The PDF's example is exactly this —
              "every Mckiernan job should automatically use the strict
              Mckiernan restaurant checklist" — and it only reads correctly if
              the generic commercial list does not also come along. */}
          <div className="rounded-xl border border-violet-200 bg-violet-50/40 p-3 space-y-3">
            <div>
              <p className="text-xs font-[500] text-violet-900">
                Customer / contract checklist
              </p>
              <p className="text-xs text-violet-800/70 mt-0.5">
                Leave blank for a normal template. Pick a customer and this list
                is used for their jobs automatically — <strong>instead of</strong>{" "}
                the service-type default, not on top of it.
              </p>
            </div>

            {scopeError && (
              <p className="text-xs text-red-600">
                {scopeError} — the customer scope can&apos;t be changed right now.
              </p>
            )}

            <div className="grid grid-cols-2 gap-3">
              <Field
                label="Customer"
                hint="Every job for this customer uses this checklist.">
                <PremiumSelect
                  value={draft.clientId}
                  onChange={(v) =>
                    setDraft((prev) => ({
                      ...prev,
                      clientId: v,
                      // Switching customer invalidates the location — an
                      // address belongs to exactly one client.
                      clientAddressId: "",
                    }))
                  }
                  options={[
                    { value: "", label: "— Not customer-specific —" },
                    ...(scopeClients ?? []).map((c) => ({
                      value: c.id,
                      label: c.name,
                    })),
                  ]}
                  disabled={scopeLoading || !scopeClients}
                  placeholder={
                    scopeLoading ? "Loading customers…" : "— Not customer-specific —"
                  }
                  searchable
                  size="sm"
                />
              </Field>

              <Field
                label="Location"
                hint={
                  draft.clientId
                    ? "Optional. Narrow it to one of their addresses."
                    : "Pick a customer first."
                }>
                <PremiumSelect
                  value={draft.clientAddressId}
                  onChange={(v) =>
                    setDraft((prev) => ({ ...prev, clientAddressId: v }))
                  }
                  options={[
                    { value: "", label: "— All of their locations —" },
                    ...addressChoices.map((a) => ({
                      value: a.id,
                      label: a.address,
                      description: a.label,
                    })),
                  ]}
                  disabled={!draft.clientId || addressChoices.length === 0}
                  placeholder="— All of their locations —"
                  size="sm"
                />
              </Field>
            </div>

            {/* An edited template whose customer link exists but whose picker
                list hasn't arrived yet would otherwise look unscoped, and
                saving would silently clear the link. Say so instead. */}
            {draft.clientId &&
              scopeClients &&
              !scopeClients.some((c) => c.id === draft.clientId) && (
                <p className="text-xs text-amber-700">
                  This template is linked to a customer who is no longer in the
                  active list (archived or deleted). Saving now will clear the
                  link and turn it back into a normal template.
                </p>
              )}
            {draft.clientId && addressChoices.length === 0 && scopeClients && (
              <p className="text-xs text-violet-800/70">
                This customer has no saved addresses, so the checklist applies to
                all of their jobs.
              </p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field
              label="Job Type"
              hint={
                draft.clientId
                  ? "Optional. Narrows this customer checklist to one service."
                  : "Restrict template to a specific job type, or leave blank for all."
              }>
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

            {/* Item 27: picked from the add-ons configured in Settings →
                Pricing Rules, not typed by hand. Free text made a trigger that
                silently never fired if the spelling or case differed. */}
            <Field
              label="Add-On"
              hint={
                draft.jobType && draft.addOnName
                  ? "Triggers only when the job is this service type AND has this add-on."
                  : "Triggers when a job has this add-on. Combine with a job type to narrow it further."
              }>
              <select
                value={draft.addOnName}
                onChange={(e) =>
                  setDraft((prev) => ({ ...prev, addOnName: e.target.value }))
                }
                className={themedSelectClass}>
                <option value="">No add-on trigger</option>
                {addOnChoices.map((name: string) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
              {/* A template saved against an add-on that has since been renamed
                  or removed keeps its value visible instead of silently
                  resetting to "no trigger". */}
              {draft.addOnName &&
                !addOnChoices.some(
                  (n: string) => addOnKey(n) === addOnKey(draft.addOnName)
                ) && (
                  <p className="mt-1 text-xs text-amber-700">
                    &quot;{draft.addOnName}&quot; is not in Settings → Pricing Rules
                    add-ons. It will still match jobs carrying that add-on, but
                    pick from the list if it has been renamed.
                  </p>
                )}
            </Field>
          </div>

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

          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-[350] text-[#008C9C]/70 uppercase tracking-wide">
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
              <p className="text-xs text-[#008C9C]/60">No items added.</p>
            )}
            <div className="space-y-2">
              {draft.items.map((item, idx) => (
                <div
                  key={idx}
                  className="p-3 rounded-xl bg-[#008C9C]/5 space-y-2">
                  <div className="flex items-start gap-2">
                    <div className="flex flex-col gap-1">
                      <button
                        type="button"
                        onClick={() => moveItem(idx, -1)}
                        disabled={idx === 0}
                        className="p-1 rounded text-[#008C9C]/60 hover:bg-[#008C9C]/10 disabled:opacity-20 disabled:cursor-not-allowed"
                        aria-label="Move up">
                        <ArrowUp className="w-3 h-3" />
                      </button>
                      <button
                        type="button"
                        onClick={() => moveItem(idx, 1)}
                        disabled={idx === draft.items.length - 1}
                        className="p-1 rounded text-[#008C9C]/60 hover:bg-[#008C9C]/10 disabled:opacity-20 disabled:cursor-not-allowed"
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
                      <label className="flex items-center gap-2 text-xs text-[#008C9C] select-none">
                        <input
                          type="checkbox"
                          checked={item.isRequired}
                          onChange={(e) =>
                            updateItem(idx, { isRequired: e.target.checked })
                          }
                          className="accent-[#008C9C]"
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
