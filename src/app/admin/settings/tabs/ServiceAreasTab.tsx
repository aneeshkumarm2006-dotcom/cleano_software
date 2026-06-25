"use client";

import { useState } from "react";
import { Plus, Trash2, Pencil, MapPinned } from "lucide-react";
import Button from "@/components/ui/Button";
import IconButton from "@/components/ui/IconButton";
import Modal from "@/components/ui/Modal";
import { ConfirmDeleteModal } from "@/components/common/ConfirmDeleteModal";
import { createServiceArea } from "../../actions/createServiceArea";
import { updateServiceArea } from "../../actions/updateServiceArea";
import { deleteServiceArea } from "../../actions/deleteServiceArea";
import { ServiceAreaRecord } from "../types";
import {
  SectionCard,
  Field,
  Feedback,
  Msg,
  themedInputClass,
} from "./_shared";

interface ServiceAreasTabProps {
  serviceAreas: ServiceAreaRecord[];
}

interface DraftArea {
  id: string | null;
  prefix: string;
  zoneName: string;
  travelFee: string;
  notes: string;
  isActive: boolean;
}

const EMPTY: DraftArea = {
  id: null,
  prefix: "",
  zoneName: "",
  travelFee: "0",
  notes: "",
  isActive: true,
};

export default function ServiceAreasTab({
  serviceAreas,
}: ServiceAreasTabProps) {
  const [modalOpen, setModalOpen] = useState(false);
  const [draft, setDraft] = useState<DraftArea>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);

  function openCreate() {
    setDraft(EMPTY);
    setMsg(null);
    setModalOpen(true);
  }

  function openEdit(area: ServiceAreaRecord) {
    setDraft({
      id: area.id,
      prefix: area.prefix,
      zoneName: area.zoneName,
      travelFee: String(area.travelFee),
      notes: area.notes ?? "",
      isActive: area.isActive,
    });
    setMsg(null);
    setModalOpen(true);
  }

  async function handleSave() {
    setSaving(true);
    setMsg(null);
    const travelFee = parseFloat(draft.travelFee) || 0;

    const res = draft.id
      ? await updateServiceArea({
          id: draft.id,
          zoneName: draft.zoneName,
          travelFee,
          notes: draft.notes,
          isActive: draft.isActive,
        })
      : await createServiceArea({
          prefix: draft.prefix,
          zoneName: draft.zoneName,
          travelFee,
          notes: draft.notes,
          isActive: draft.isActive,
        });

    setSaving(false);
    if (!res.success) {
      setMsg({ type: "error", text: res.error || "Failed to save" });
      return;
    }
    setModalOpen(false);
    setMsg({
      type: "success",
      text: draft.id ? "Service area updated" : "Service area added",
    });
  }

  const [deleteTarget, setDeleteTarget] = useState<{ id: string; prefix: string } | null>(null);
  function handleDelete(id: string, prefix: string) {
    setDeleteTarget({ id, prefix });
  }
  async function runDelete() {
    if (!deleteTarget) return;
    const { id, prefix } = deleteTarget;
    setDeleteTarget(null);
    const res = await deleteServiceArea(id);
    if (!res.success) {
      setMsg({ type: "error", text: res.error || "Failed to delete" });
    } else {
      setMsg({ type: "success", text: `${prefix} removed` });
    }
  }

  async function handleToggleActive(area: ServiceAreaRecord) {
    const res = await updateServiceArea({
      id: area.id,
      isActive: !area.isActive,
    });
    if (!res.success) {
      setMsg({ type: "error", text: res.error || "Failed to update" });
    }
  }

  const sorted = [...serviceAreas].sort((a, b) =>
    a.prefix.localeCompare(b.prefix)
  );

  return (
    <div className="space-y-4">
      <SectionCard
        title="Service Areas"
        description="Postal-code prefixes you cover. The booking form blocks signups outside these zones and captures their email as an out-of-area lead."
        icon={MapPinned}
        actions={
          <Button onClick={openCreate} size="sm">
            <Plus className="w-4 h-4" /> Add area
          </Button>
        }>
        {msg && <Feedback msg={msg} />}

        {sorted.length === 0 ? (
          <div className="text-sm text-[#008C9C]/60 py-8 text-center">
            No service areas yet. Add postal prefixes you cover (e.g. H1, H2,
            H3 for Montreal) to enable public bookings.
          </div>
        ) : (
          <div className="rounded-2xl bg-[#008C9C]/5 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-wide text-[#008C9C]/60">
                  <th className="px-4 py-3">Prefix</th>
                  <th className="px-4 py-3">Zone</th>
                  <th className="px-4 py-3">Travel Fee</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#008C9C]/10">
                {sorted.map((area) => (
                  <tr key={area.id} className="text-[#008C9C]">
                    <td className="px-4 py-3 font-mono font-medium">
                      {area.prefix}
                    </td>
                    <td className="px-4 py-3">{area.zoneName}</td>
                    <td className="px-4 py-3">
                      {area.travelFee > 0
                        ? `$${area.travelFee.toFixed(2)}`
                        : "—"}
                    </td>
                    <td className="px-4 py-3">
                      <button
                        type="button"
                        onClick={() => handleToggleActive(area)}
                        className={`px-2 py-1 rounded-full text-[10px] font-medium ${
                          area.isActive
                            ? "bg-emerald-100 text-emerald-700"
                            : "bg-gray-100 text-gray-500"
                        }`}>
                        {area.isActive ? "Active" : "Disabled"}
                      </button>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="inline-flex gap-1">
                        <IconButton
                          icon={Pencil}
                          size="sm"
                          variant="ghost"
                          aria-label="Edit"
                          onClick={() => openEdit(area)}
                        />
                        <IconButton
                          icon={Trash2}
                          size="sm"
                          variant="ghost"
                          aria-label="Delete"
                          onClick={() => handleDelete(area.id, area.prefix)}
                        />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>

      <Modal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        title={draft.id ? "Edit service area" : "Add service area"}>
        <div className="space-y-4">
          <Field
            label="Postal prefix"
            hint={
              draft.id
                ? "Prefix can't be changed after creation."
                : "Canadian postal prefix, 2–3 chars. Example: H1 (covers H1*) or H1A (more specific)."
            }>
            <input
              type="text"
              value={draft.prefix}
              disabled={!!draft.id}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  prefix: e.target.value.toUpperCase(),
                })
              }
              className={`${themedInputClass} ${
                draft.id ? "opacity-60 cursor-not-allowed" : ""
              }`}
              maxLength={3}
              placeholder="H1A"
            />
          </Field>

          <Field label="Zone name">
            <input
              type="text"
              value={draft.zoneName}
              onChange={(e) =>
                setDraft({ ...draft, zoneName: e.target.value })
              }
              className={themedInputClass}
              placeholder="Montreal — Downtown"
            />
          </Field>

          <Field label="Travel fee (optional)" hint="Added to job total for this zone.">
            <input
              type="number"
              step="0.01"
              min="0"
              value={draft.travelFee}
              onChange={(e) =>
                setDraft({ ...draft, travelFee: e.target.value })
              }
              className={themedInputClass}
            />
          </Field>

          <Field label="Notes (optional)">
            <textarea
              value={draft.notes}
              onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
              className={`${themedInputClass} min-h-20`}
              placeholder="Internal notes — driving times, parking, etc."
            />
          </Field>

          <label className="flex items-center gap-2 text-sm text-[#008C9C]">
            <input
              type="checkbox"
              checked={draft.isActive}
              onChange={(e) =>
                setDraft({ ...draft, isActive: e.target.checked })
              }
            />
            Active — accepts new bookings
          </label>

          {msg && <Feedback msg={msg} />}

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={() => setModalOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? "Saving..." : draft.id ? "Save changes" : "Add area"}
            </Button>
          </div>
        </div>
      </Modal>

      <ConfirmDeleteModal
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={runDelete}
        fileName={deleteTarget ? `service area ${deleteTarget.prefix}` : "this area"}
        title="Delete service area?"
        message="Bookings from this area will start failing the postal-code check."
      />
    </div>
  );
}
