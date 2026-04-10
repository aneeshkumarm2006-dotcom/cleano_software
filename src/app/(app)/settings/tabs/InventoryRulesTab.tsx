"use client";

import { useState } from "react";
import Input from "@/components/ui/Input";
import Button from "@/components/ui/Button";
import { createInventoryRule } from "../../actions/createInventoryRule";
import { deleteInventoryRule } from "../../actions/updateInventoryRule";
import { ProductRecord, InventoryRuleRecord } from "../types";
import { SectionCard, Feedback, Msg } from "./_shared";

interface InventoryRulesTabProps {
  products: ProductRecord[];
  rules: InventoryRuleRecord[];
}

interface RowState {
  productId: string;
  usagePerJob: number;
  refillThreshold: number;
  hasRule: boolean;
}

export default function InventoryRulesTab({
  products,
  rules,
}: InventoryRulesTabProps) {
  const initial: Record<string, RowState> = {};
  for (const p of products) {
    const existing = rules.find((r) => r.productId === p.id);
    initial[p.id] = {
      productId: p.id,
      usagePerJob: existing?.usagePerJob ?? 0,
      refillThreshold: existing?.refillThreshold ?? 0,
      hasRule: !!existing,
    };
  }

  const [rows, setRows] = useState(initial);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [msg, setMsg] = useState<Msg>(null);

  function update(productId: string, patch: Partial<RowState>) {
    setRows((prev) => ({
      ...prev,
      [productId]: { ...prev[productId], ...patch },
    }));
  }

  async function handleSave(productId: string) {
    setSavingId(productId);
    setMsg(null);
    const row = rows[productId];
    const res = await createInventoryRule({
      productId,
      usagePerJob: row.usagePerJob,
      refillThreshold: row.refillThreshold,
    });
    if (res.success) {
      update(productId, { hasRule: true });
      setMsg({ type: "success", text: "Inventory rule saved." });
    } else {
      setMsg({ type: "error", text: res.error || "Failed to save." });
    }
    setSavingId(null);
  }

  async function handleDelete(productId: string) {
    setSavingId(productId);
    setMsg(null);
    const res = await deleteInventoryRule(productId);
    if (res.success) {
      update(productId, {
        usagePerJob: 0,
        refillThreshold: 0,
        hasRule: false,
      });
      setMsg({ type: "success", text: "Inventory rule cleared." });
    } else {
      setMsg({ type: "error", text: res.error || "Failed to delete." });
    }
    setSavingId(null);
  }

  return (
    <SectionCard
      title="Inventory Rules"
      description="Configure usage per job and refill thresholds per product. Used by inventory forecasting.">
      {products.length === 0 ? (
        <p className="text-sm text-gray-500">
          No products yet. Add products in the Inventory page first.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-500 border-b border-gray-200">
                <th className="py-2 pr-3 font-[500]">Product</th>
                <th className="py-2 pr-3 font-[500]">Usage / Job</th>
                <th className="py-2 pr-3 font-[500]">Refill Threshold</th>
                <th className="py-2 pr-3 font-[500]">Stock</th>
                <th className="py-2 font-[500] text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {products.map((p) => {
                const row = rows[p.id];
                return (
                  <tr
                    key={p.id}
                    className="border-b border-gray-100 last:border-0">
                    <td className="py-2 pr-3 text-gray-900">
                      {p.name}
                      <span className="text-xs text-gray-500 ml-2">
                        ({p.unit})
                      </span>
                    </td>
                    <td className="py-2 pr-3">
                      <Input
                        type="number"
                        min="0"
                        step="0.01"
                        value={row.usagePerJob}
                        onChange={(e) =>
                          update(p.id, {
                            usagePerJob: parseFloat(e.target.value) || 0,
                          })
                        }
                        className="max-w-[120px]"
                      />
                    </td>
                    <td className="py-2 pr-3">
                      <Input
                        type="number"
                        min="0"
                        step="0.01"
                        value={row.refillThreshold}
                        onChange={(e) =>
                          update(p.id, {
                            refillThreshold: parseFloat(e.target.value) || 0,
                          })
                        }
                        className="max-w-[120px]"
                      />
                    </td>
                    <td className="py-2 pr-3 text-gray-600">
                      {p.stockLevel}
                    </td>
                    <td className="py-2 text-right space-x-2">
                      <Button
                        type="button"
                        variant="primary"
                        size="sm"
                        disabled={savingId === p.id}
                        onClick={() => handleSave(p.id)}>
                        {savingId === p.id ? "Saving..." : "Save"}
                      </Button>
                      {row.hasRule && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          disabled={savingId === p.id}
                          onClick={() => handleDelete(p.id)}>
                          Clear
                        </Button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {msg && (
        <div className="mt-3">
          <Feedback msg={msg} />
        </div>
      )}
    </SectionCard>
  );
}
