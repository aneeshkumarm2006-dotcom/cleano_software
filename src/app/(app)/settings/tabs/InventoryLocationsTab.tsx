"use client";

import { useState } from "react";
import { Plus, Trash2, Pencil, MapPin, X } from "lucide-react";
import Input from "@/components/ui/Input";
import Button from "@/components/ui/Button";
import IconButton from "@/components/ui/IconButton";
import Modal from "@/components/ui/Modal";
import { ConfirmDeleteModal } from "@/components/common/ConfirmDeleteModal";
import { createInventoryLocation } from "../../actions/createInventoryLocation";
import { updateInventoryLocation } from "../../actions/updateInventoryLocation";
import { deleteInventoryLocation } from "../../actions/deleteInventoryLocation";
import { setLocationStock } from "../../actions/setLocationStock";
import {
  ProductRecord,
  InventoryLocationRecord,
} from "../types";
import { SectionCard, Field, Feedback, Msg } from "./_shared";
import ImportCsvButton from "@/components/csv/ImportCsvButton";

interface InventoryLocationsTabProps {
  products: ProductRecord[];
  locations: InventoryLocationRecord[];
}

interface DraftLocation {
  id: string | null;
  name: string;
  address: string;
  notes: string;
  isActive: boolean;
}

const EMPTY_LOC: DraftLocation = {
  id: null,
  name: "",
  address: "",
  notes: "",
  isActive: true,
};

export default function InventoryLocationsTab({
  products,
  locations,
}: InventoryLocationsTabProps) {
  const [modalOpen, setModalOpen] = useState(false);
  const [draft, setDraft] = useState<DraftLocation>(EMPTY_LOC);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);

  const [stockModalOpen, setStockModalOpen] = useState(false);
  const [stockLocation, setStockLocation] =
    useState<InventoryLocationRecord | null>(null);
  const [stockEdits, setStockEdits] = useState<Record<string, number>>({});
  const [stockSavingId, setStockSavingId] = useState<string | null>(null);

  function openCreate() {
    setDraft(EMPTY_LOC);
    setModalOpen(true);
  }

  function openEdit(loc: InventoryLocationRecord) {
    setDraft({
      id: loc.id,
      name: loc.name,
      address: loc.address || "",
      notes: loc.notes || "",
      isActive: loc.isActive,
    });
    setModalOpen(true);
  }

  function openStockEditor(loc: InventoryLocationRecord) {
    setStockLocation(loc);
    const initial: Record<string, number> = {};
    for (const p of products) {
      const s = loc.stock.find((s) => s.productId === p.id);
      initial[p.id] = s?.quantity ?? 0;
    }
    setStockEdits(initial);
    setStockModalOpen(true);
  }

  async function handleSave() {
    if (!draft.name.trim()) {
      setMsg({ type: "error", text: "Location name is required." });
      return;
    }
    setSaving(true);
    setMsg(null);

    const payload = {
      name: draft.name,
      address: draft.address,
      notes: draft.notes,
      isActive: draft.isActive,
    };

    const res = draft.id
      ? await updateInventoryLocation({ id: draft.id, ...payload })
      : await createInventoryLocation(payload);

    if (res.success) {
      setMsg({ type: "success", text: "Location saved." });
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
    const res = await deleteInventoryLocation(id);
    if (res.success) {
      setMsg({ type: "success", text: "Location deleted." });
    } else {
      setMsg({ type: "error", text: res.error || "Failed to delete." });
    }
  }

  async function handleStockSave(productId: string) {
    if (!stockLocation) return;
    setStockSavingId(productId);
    const res = await setLocationStock({
      locationId: stockLocation.id,
      productId,
      quantity: stockEdits[productId] ?? 0,
    });
    if (res.success) {
      setMsg({ type: "success", text: "Stock updated." });
    } else {
      setMsg({ type: "error", text: res.error || "Failed to update stock." });
    }
    setStockSavingId(null);
  }

  return (
    <SectionCard
      title="Inventory Locations"
      description="Storage units and warehouses where employees pick up equipment."
      icon={MapPin}
      actions={
        <div className="flex items-center gap-2">
          <ImportCsvButton entity="inventory-locations" label="Import" triggerClassName="btn btn-secondary btn-sm" />
          <Button
            type="button"
            variant="action"
            border={false}
            size="sm"
            onClick={openCreate}
            className="rounded-xl">
            <Plus className="w-4 h-4 mr-1" /> New Location
          </Button>
        </div>
      }>
      {locations.length === 0 ? (
        <p className="text-sm text-[#005F6A]/60">No locations defined yet.</p>
      ) : (
        <div className="space-y-2">
          {locations.map((loc) => {
            const stockedCount = loc.stock.filter((s) => s.quantity > 0).length;
            return (
              <div
                key={loc.id}
                className="flex items-start justify-between gap-3 p-4 border border-[#005F6A]/10 rounded-xl bg-white hover:bg-[#005F6A]/3 transition-colors">
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-[400] text-[#005F6A]">
                      {loc.name}
                    </h3>
                    {!loc.isActive && (
                      <span className="text-xs text-[#005F6A]/40">
                        (inactive)
                      </span>
                    )}
                  </div>
                  {loc.address && (
                    <p className="text-xs text-[#005F6A]/60 mt-0.5">
                      {loc.address}
                    </p>
                  )}
                  {loc.notes && (
                    <p className="text-xs text-[#005F6A]/50 mt-0.5">
                      {loc.notes}
                    </p>
                  )}
                  <p className="text-xs text-[#005F6A]/60 mt-1">
                    {stockedCount} product{stockedCount === 1 ? "" : "s"} stocked
                  </p>
                </div>
                <div className="flex gap-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => openStockEditor(loc)}
                    className="rounded-xl">
                    Manage Stock
                  </Button>
                  <IconButton
                    icon={Pencil}
                    variant="ghost"
                    size="sm"
                    onClick={() => openEdit(loc)}
                  />
                  <IconButton
                    icon={Trash2}
                    variant="ghost"
                    size="sm"
                    onClick={() => handleDelete(loc.id)}
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
        title={draft.id ? "Edit Location" : "New Location"}>
        <div className="space-y-4">
          <Field label="Name">
            <Input
              variant="form"
              value={draft.name}
              onChange={(e) =>
                setDraft((prev) => ({ ...prev, name: e.target.value }))
              }
              placeholder="e.g. Main Storage"
            />
          </Field>
          <Field label="Address">
            <Input
              variant="form"
              value={draft.address}
              onChange={(e) =>
                setDraft((prev) => ({ ...prev, address: e.target.value }))
              }
              placeholder="Optional"
            />
          </Field>
          <Field label="Notes">
            <Input
              variant="form"
              value={draft.notes}
              onChange={(e) =>
                setDraft((prev) => ({ ...prev, notes: e.target.value }))
              }
              placeholder="Optional"
            />
          </Field>
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
              {saving ? "Saving..." : "Save Location"}
            </Button>
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={stockModalOpen}
        onClose={() => setStockModalOpen(false)}
        title={stockLocation ? `Stock at ${stockLocation.name}` : "Stock"}>
        <div className="space-y-3 max-h-[60vh] overflow-y-auto">
          {products.length === 0 ? (
            <p className="text-sm text-[#005F6A]/60">
              Add products in the Inventory page first.
            </p>
          ) : (
            products.map((p) => (
              <div
                key={p.id}
                className="grid grid-cols-[1fr_auto_auto] gap-2 items-center">
                <div>
                  <p className="text-sm text-[#005F6A]">{p.name}</p>
                  <p className="text-xs text-[#005F6A]/60">{p.unit}</p>
                </div>
                <Input
                  variant="form"
                  type="number"
                  min="0"
                  step="0.01"
                  value={stockEdits[p.id] ?? 0}
                  onChange={(e) =>
                    setStockEdits((prev) => ({
                      ...prev,
                      [p.id]: parseFloat(e.target.value) || 0,
                    }))
                  }
                  className="max-w-[140px]"
                />
                <Button
                  type="button"
                  variant="action"
                  border={false}
                  size="sm"
                  disabled={stockSavingId === p.id}
                  onClick={() => handleStockSave(p.id)}
                  className="rounded-xl">
                  {stockSavingId === p.id ? "..." : "Save"}
                </Button>
              </div>
            ))
          )}

          <div className="flex justify-end pt-2">
            <Button
              type="button"
              variant="ghost"
              border={false}
              onClick={() => setStockModalOpen(false)}
              className="rounded-xl">
              <X className="w-4 h-4 mr-1" /> Close
            </Button>
          </div>
        </div>
      </Modal>

      <ConfirmDeleteModal
        isOpen={!!deleteId}
        onClose={() => setDeleteId(null)}
        onConfirm={runDelete}
        fileName="this location"
        title="Delete location?"
        message="Stock entries will also be removed."
      />
    </SectionCard>
  );
}
