"use client";

import { useState } from "react";
import { Plus, Trash2, Pencil, X, Package } from "lucide-react";
import Input from "@/components/ui/Input";
import Button from "@/components/ui/Button";
import IconButton from "@/components/ui/IconButton";
import Modal from "@/components/ui/Modal";
import { createKitTemplate } from "../../actions/createKitTemplate";
import { updateKitTemplate } from "../../actions/updateKitTemplate";
import { deleteKitTemplate } from "../../actions/deleteKitTemplate";
import { ProductRecord, KitTemplateRecord } from "../types";
import {
  SectionCard,
  Field,
  Feedback,
  Msg,
  themedSelectClass,
} from "./_shared";

interface KitTemplatesTabProps {
  products: ProductRecord[];
  kitTemplates: KitTemplateRecord[];
}

interface DraftItem {
  productId: string;
  quantity: number;
}

interface DraftKit {
  id: string | null;
  name: string;
  description: string;
  isActive: boolean;
  items: DraftItem[];
}

const EMPTY_KIT: DraftKit = {
  id: null,
  name: "",
  description: "",
  isActive: true,
  items: [],
};

export default function KitTemplatesTab({
  products,
  kitTemplates,
}: KitTemplatesTabProps) {
  const [modalOpen, setModalOpen] = useState(false);
  const [draft, setDraft] = useState<DraftKit>(EMPTY_KIT);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);

  function openCreate() {
    setDraft(EMPTY_KIT);
    setModalOpen(true);
  }

  function openEdit(kit: KitTemplateRecord) {
    setDraft({
      id: kit.id,
      name: kit.name,
      description: kit.description || "",
      isActive: kit.isActive,
      items: kit.items.map((it) => ({
        productId: it.productId,
        quantity: it.quantity,
      })),
    });
    setModalOpen(true);
  }

  function addItem() {
    setDraft((prev) => ({
      ...prev,
      items: [...prev.items, { productId: "", quantity: 1 }],
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
      items: prev.items.map((it, i) => (i === idx ? { ...it, ...patch } : it)),
    }));
  }

  async function handleSave() {
    if (!draft.name.trim()) {
      setMsg({ type: "error", text: "Kit name is required." });
      return;
    }
    setSaving(true);
    setMsg(null);

    const payload = {
      name: draft.name,
      description: draft.description,
      isActive: draft.isActive,
      items: draft.items.filter((i) => i.productId && i.quantity > 0),
    };

    const res = draft.id
      ? await updateKitTemplate({ id: draft.id, ...payload })
      : await createKitTemplate(payload);

    if (res.success) {
      setMsg({ type: "success", text: "Kit template saved." });
      setModalOpen(false);
    } else {
      setMsg({ type: "error", text: res.error || "Failed to save." });
    }
    setSaving(false);
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this kit template?")) return;
    setMsg(null);
    const res = await deleteKitTemplate(id);
    if (res.success) {
      setMsg({ type: "success", text: "Kit template deleted." });
    } else {
      setMsg({ type: "error", text: res.error || "Failed to delete." });
    }
  }

  return (
    <SectionCard
      title="Kit Templates"
      description="Define reusable starter kits combining multiple products."
      icon={Package}
      actions={
        <Button
          type="button"
          variant="action"
          border={false}
          size="sm"
          onClick={openCreate}
          className="rounded-xl">
          <Plus className="w-4 h-4 mr-1" /> New Kit
        </Button>
      }>
      {kitTemplates.length === 0 ? (
        <p className="text-sm text-[#005F6A]/60">No kit templates yet.</p>
      ) : (
        <div className="space-y-2">
          {kitTemplates.map((kit) => (
            <div
              key={kit.id}
              className="flex items-start justify-between gap-3 p-4 border border-[#005F6A]/10 rounded-xl bg-white hover:bg-[#005F6A]/3 transition-colors">
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-[400] text-[#005F6A]">
                    {kit.name}
                  </h3>
                  {!kit.isActive && (
                    <span className="text-xs text-[#005F6A]/40">
                      (inactive)
                    </span>
                  )}
                </div>
                {kit.description && (
                  <p className="text-xs text-[#005F6A]/60 mt-0.5">
                    {kit.description}
                  </p>
                )}
                <div className="mt-2 flex flex-wrap gap-1">
                  {kit.items.map((it) => (
                    <span
                      key={it.id}
                      className="text-xs bg-[#005F6A]/10 text-[#005F6A] px-2 py-0.5 rounded-full">
                      {it.product.name} × {it.quantity}
                    </span>
                  ))}
                </div>
              </div>
              <div className="flex gap-1">
                <IconButton
                  icon={Pencil}
                  variant="ghost"
                  size="sm"
                  onClick={() => openEdit(kit)}
                />
                <IconButton
                  icon={Trash2}
                  variant="ghost"
                  size="sm"
                  onClick={() => handleDelete(kit.id)}
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
        title={draft.id ? "Edit Kit Template" : "New Kit Template"}>
        <div className="space-y-4">
          <Field label="Name">
            <Input
              variant="form"
              value={draft.name}
              onChange={(e) =>
                setDraft((prev) => ({ ...prev, name: e.target.value }))
              }
              placeholder="e.g. Standard Starter Kit"
            />
          </Field>
          <Field label="Description">
            <Input
              variant="form"
              value={draft.description}
              onChange={(e) =>
                setDraft((prev) => ({ ...prev, description: e.target.value }))
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

          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-[350] text-[#005F6A]/70 uppercase tracking-wide">
                Products
              </label>
              <Button
                type="button"
                variant="default"
                border={false}
                size="sm"
                onClick={addItem}
                className="rounded-xl">
                <Plus className="w-4 h-4 mr-1" /> Add Product
              </Button>
            </div>
            {draft.items.length === 0 && (
              <p className="text-xs text-[#005F6A]/60">No products added.</p>
            )}
            <div className="space-y-2">
              {draft.items.map((item, idx) => (
                <div
                  key={idx}
                  className="grid grid-cols-[2fr_1fr_auto] gap-2 items-center">
                  <select
                    value={item.productId}
                    onChange={(e) =>
                      updateItem(idx, { productId: e.target.value })
                    }
                    className={themedSelectClass}>
                    <option value="">Select product...</option>
                    {products.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                  <Input
                    variant="form"
                    type="number"
                    min="0"
                    step="0.01"
                    value={item.quantity}
                    onChange={(e) =>
                      updateItem(idx, {
                        quantity: parseFloat(e.target.value) || 0,
                      })
                    }
                  />
                  <IconButton
                    icon={X}
                    variant="ghost"
                    size="sm"
                    onClick={() => removeItem(idx)}
                    className="text-red-500"
                  />
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
              {saving ? "Saving..." : "Save Kit"}
            </Button>
          </div>
        </div>
      </Modal>
    </SectionCard>
  );
}
