"use client";

import { useState } from "react";
import {
  Plus,
  Trash2,
  Pencil,
  ChevronDown,
  ChevronRight,
  Truck,
} from "lucide-react";
import Input from "@/components/ui/Input";
import Button from "@/components/ui/Button";
import IconButton from "@/components/ui/IconButton";
import Modal from "@/components/ui/Modal";
import {
  createSupplier,
  updateSupplier,
  deleteSupplier,
} from "../../actions/createSupplier";
import {
  updateSupplierPrice,
  deleteSupplierPrice,
} from "../../actions/updateSupplierPrice";
import { ProductRecord, SupplierRecord } from "../types";
import { SectionCard, Field, Feedback, Msg } from "./_shared";

interface SuppliersTabProps {
  products: ProductRecord[];
  suppliers: SupplierRecord[];
}

interface SupplierDraft {
  id: string | null;
  name: string;
  contact: string;
  email: string;
  phone: string;
  address: string;
  notes: string;
  isActive: boolean;
}

const EMPTY_DRAFT: SupplierDraft = {
  id: null,
  name: "",
  contact: "",
  email: "",
  phone: "",
  address: "",
  notes: "",
  isActive: true,
};

export default function SuppliersTab({
  products,
  suppliers,
}: SuppliersTabProps) {
  const [modalOpen, setModalOpen] = useState(false);
  const [draft, setDraft] = useState<SupplierDraft>(EMPTY_DRAFT);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);

  // Per-row price drafts: supplierId -> productId -> { price, unit }
  const [priceDrafts, setPriceDrafts] = useState<
    Record<string, Record<string, { price: number; unit: string }>>
  >(() => {
    const out: Record<
      string,
      Record<string, { price: number; unit: string }>
    > = {};
    for (const s of suppliers) {
      out[s.id] = {};
      for (const p of products) {
        const existing = s.prices.find((sp) => sp.productId === p.id);
        out[s.id][p.id] = {
          price: existing?.price ?? 0,
          unit: existing?.unit ?? p.unit ?? "",
        };
      }
    }
    return out;
  });

  function openCreate() {
    setDraft(EMPTY_DRAFT);
    setModalOpen(true);
  }

  function openEdit(s: SupplierRecord) {
    setDraft({
      id: s.id,
      name: s.name,
      contact: s.contact || "",
      email: s.email || "",
      phone: s.phone || "",
      address: s.address || "",
      notes: s.notes || "",
      isActive: s.isActive,
    });
    setModalOpen(true);
  }

  async function handleSaveSupplier() {
    if (!draft.name.trim()) {
      setMsg({ type: "error", text: "Supplier name is required." });
      return;
    }
    setSaving(true);
    setMsg(null);
    const payload = {
      name: draft.name,
      contact: draft.contact,
      email: draft.email,
      phone: draft.phone,
      address: draft.address,
      notes: draft.notes,
      isActive: draft.isActive,
    };
    const res = draft.id
      ? await updateSupplier({ id: draft.id, ...payload })
      : await createSupplier(payload);
    if (res.success) {
      setMsg({ type: "success", text: "Supplier saved." });
      setModalOpen(false);
    } else {
      setMsg({ type: "error", text: res.error || "Failed to save." });
    }
    setSaving(false);
  }

  async function handleDeleteSupplier(id: string) {
    if (!confirm("Delete this supplier and all its prices?")) return;
    setMsg(null);
    const res = await deleteSupplier(id);
    if (res.success) setMsg({ type: "success", text: "Supplier deleted." });
    else setMsg({ type: "error", text: res.error || "Failed to delete." });
  }

  function setPriceDraft(
    supplierId: string,
    productId: string,
    patch: Partial<{ price: number; unit: string }>
  ) {
    setPriceDrafts((prev) => ({
      ...prev,
      [supplierId]: {
        ...prev[supplierId],
        [productId]: { ...prev[supplierId][productId], ...patch },
      },
    }));
  }

  async function handleSavePrice(supplierId: string, productId: string) {
    const d = priceDrafts[supplierId]?.[productId];
    if (!d) return;
    setMsg(null);
    const res = await updateSupplierPrice({
      supplierId,
      productId,
      price: d.price,
      unit: d.unit,
    });
    if (res.success) setMsg({ type: "success", text: "Price saved." });
    else setMsg({ type: "error", text: res.error || "Failed to save price." });
  }

  async function handleDeletePrice(supplierId: string, productId: string) {
    setMsg(null);
    const res = await deleteSupplierPrice(supplierId, productId);
    if (res.success) {
      setPriceDraft(supplierId, productId, { price: 0 });
      setMsg({ type: "success", text: "Price cleared." });
    } else {
      setMsg({ type: "error", text: res.error || "Failed to clear price." });
    }
  }

  return (
    <SectionCard
      title="Suppliers"
      description="Manage suppliers and per-product pricing for procurement comparisons."
      icon={Truck}
      actions={
        <Button
          type="button"
          variant="action"
          border={false}
          size="sm"
          onClick={openCreate}
          className="rounded-xl">
          <Plus className="w-4 h-4 mr-1" /> New Supplier
        </Button>
      }>
      {suppliers.length === 0 ? (
        <p className="text-sm text-[#005F6A]/60">No suppliers yet.</p>
      ) : (
        <div className="space-y-2">
          {suppliers.map((s) => {
            const isOpen = expanded === s.id;
            return (
              <div
                key={s.id}
                className="border border-[#005F6A]/10 rounded-xl overflow-hidden bg-white">
                <div className="flex items-center justify-between p-3">
                  <button
                    type="button"
                    onClick={() => setExpanded(isOpen ? null : s.id)}
                    className="flex items-center gap-2 flex-1 text-left">
                    {isOpen ? (
                      <ChevronDown className="w-4 h-4 text-[#005F6A]/60" />
                    ) : (
                      <ChevronRight className="w-4 h-4 text-[#005F6A]/60" />
                    )}
                    <div>
                      <div className="text-sm font-[400] text-[#005F6A]">
                        {s.name}
                        {!s.isActive && (
                          <span className="ml-2 text-xs text-[#005F6A]/40">
                            (inactive)
                          </span>
                        )}
                      </div>
                      {(s.contact || s.email || s.phone) && (
                        <div className="text-xs text-[#005F6A]/60">
                          {[s.contact, s.email, s.phone]
                            .filter(Boolean)
                            .join(" · ")}
                        </div>
                      )}
                    </div>
                  </button>
                  <div className="flex gap-1">
                    <IconButton
                      icon={Pencil}
                      variant="ghost"
                      size="sm"
                      onClick={() => openEdit(s)}
                    />
                    <IconButton
                      icon={Trash2}
                      variant="ghost"
                      size="sm"
                      onClick={() => handleDeleteSupplier(s.id)}
                      className="text-red-500"
                    />
                  </div>
                </div>

                {isOpen && (
                  <div className="border-t border-[#005F6A]/10 p-4 bg-[#005F6A]/3">
                    {products.length === 0 ? (
                      <p className="text-xs text-[#005F6A]/60">
                        No products to price.
                      </p>
                    ) : (
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="text-left">
                            <th className="py-2 pr-2 text-xs font-[350] text-[#005F6A]/70 uppercase tracking-wide">
                              Product
                            </th>
                            <th className="py-2 pr-2 text-xs font-[350] text-[#005F6A]/70 uppercase tracking-wide">
                              Price ($)
                            </th>
                            <th className="py-2 pr-2 text-xs font-[350] text-[#005F6A]/70 uppercase tracking-wide">
                              Unit
                            </th>
                            <th className="py-2 text-xs font-[350] text-[#005F6A]/70 uppercase tracking-wide text-right">
                              Actions
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {products.map((p) => {
                            const d = priceDrafts[s.id]?.[p.id] ?? {
                              price: 0,
                              unit: p.unit,
                            };
                            const existing = s.prices.find(
                              (sp) => sp.productId === p.id
                            );
                            return (
                              <tr
                                key={p.id}
                                className="border-t border-[#005F6A]/10">
                                <td className="py-2 pr-2 text-sm text-[#005F6A]">
                                  {p.name}
                                </td>
                                <td className="py-2 pr-2">
                                  <Input
                                    variant="form"
                                    type="number"
                                    min="0"
                                    step="0.01"
                                    value={d.price}
                                    onChange={(e) =>
                                      setPriceDraft(s.id, p.id, {
                                        price:
                                          parseFloat(e.target.value) || 0,
                                      })
                                    }
                                    className="max-w-[140px]"
                                  />
                                </td>
                                <td className="py-2 pr-2">
                                  <Input
                                    variant="form"
                                    value={d.unit}
                                    onChange={(e) =>
                                      setPriceDraft(s.id, p.id, {
                                        unit: e.target.value,
                                      })
                                    }
                                    className="max-w-[120px]"
                                  />
                                </td>
                                <td className="py-2 text-right space-x-1">
                                  <Button
                                    type="button"
                                    variant="action"
                                    border={false}
                                    size="sm"
                                    onClick={() =>
                                      handleSavePrice(s.id, p.id)
                                    }
                                    className="rounded-xl">
                                    Save
                                  </Button>
                                  {existing && (
                                    <Button
                                      type="button"
                                      variant="ghost"
                                      size="sm"
                                      onClick={() =>
                                        handleDeletePrice(s.id, p.id)
                                      }
                                      className="rounded-xl">
                                      Clear
                                    </Button>
                                  )}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    )}
                  </div>
                )}
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
        title={draft.id ? "Edit Supplier" : "New Supplier"}>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <Field label="Name">
              <Input
                variant="form"
                value={draft.name}
                onChange={(e) =>
                  setDraft((prev) => ({ ...prev, name: e.target.value }))
                }
                placeholder="Supplier name"
              />
            </Field>
            <Field label="Contact Person">
              <Input
                variant="form"
                value={draft.contact}
                onChange={(e) =>
                  setDraft((prev) => ({ ...prev, contact: e.target.value }))
                }
              />
            </Field>
            <Field label="Email">
              <Input
                variant="form"
                type="email"
                value={draft.email}
                onChange={(e) =>
                  setDraft((prev) => ({ ...prev, email: e.target.value }))
                }
              />
            </Field>
            <Field label="Phone">
              <Input
                variant="form"
                type="tel"
                value={draft.phone}
                onChange={(e) =>
                  setDraft((prev) => ({ ...prev, phone: e.target.value }))
                }
              />
            </Field>
          </div>
          <Field label="Address">
            <Input
              variant="form"
              value={draft.address}
              onChange={(e) =>
                setDraft((prev) => ({ ...prev, address: e.target.value }))
              }
            />
          </Field>
          <Field label="Notes">
            <Input
              variant="form"
              value={draft.notes}
              onChange={(e) =>
                setDraft((prev) => ({ ...prev, notes: e.target.value }))
              }
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
              onClick={handleSaveSupplier}
              disabled={saving}
              className="rounded-xl px-6">
              {saving ? "Saving..." : "Save Supplier"}
            </Button>
          </div>
        </div>
      </Modal>
    </SectionCard>
  );
}
