"use client";

import React, { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Card from "@/components/ui/Card";
import Badge from "@/components/ui/Badge";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import {
  Search,
  Users,
  AlertTriangle,
  ArrowUpRight,
  Pencil,
  Loader,
  X,
  PackagePlus,
} from "lucide-react";
import { fmtDateTime } from "@/lib/time";
import { LOW_STOCK_LABEL } from "@/lib/inventory-thresholds";
import { setCleanerProductQuantity } from "../actions/setCleanerProductQuantity";

interface LastChange {
  at: string;
  by: string | null;
  delta: number;
  reason: string | null;
}

interface CleanerItem {
  productId: string;
  productName: string;
  unit: string;
  quantity: number;
  costPerUnit: number;
  refillThreshold: number;
  isLow: boolean;
  /** Most recent InventoryChange for this (cleaner, product) — admin OR cleaner. */
  lastChange?: LastChange | null;
}

interface Cleaner {
  employeeId: string;
  employeeName: string;
  role: string;
  itemCount: number;
  totalUnits: number;
  totalValue: number;
  lowCount: number;
  items: CleanerItem[];
}

interface Props {
  cleaners: Cleaner[];
  /** OWNER/ADMIN only. The server action enforces this too — this just hides the UI. */
  canEdit?: boolean;
  /** Opens the bulk assign screen, optionally pre-selecting a cleaner (item 17). */
  onAssign?: (cleanerId?: string) => void;
}

export default function CleanerInventoryView({
  cleaners,
  canEdit = false,
  onAssign,
}: Props) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [lowOnly, setLowOnly] = useState(false);

  // Inline "set quantity" editor — one row at a time, keyed by cleaner+product.
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [qty, setQty] = useState("");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return cleaners.filter((c) => {
      if (lowOnly && c.lowCount === 0) return false;
      if (!q) return true;
      return (
        c.employeeName.toLowerCase().includes(q) ||
        c.items.some((i) => i.productName.toLowerCase().includes(q))
      );
    });
  }, [cleaners, search, lowOnly]);

  const totalLow = cleaners.reduce((s, c) => s + c.lowCount, 0);

  const openEditor = (cleanerId: string, item: CleanerItem) => {
    setEditingKey(`${cleanerId}|${item.productId}`);
    setQty(String(item.quantity));
    setReason("");
    setError(null);
  };

  const closeEditor = () => {
    setEditingKey(null);
    setQty("");
    setReason("");
    setError(null);
  };

  async function save(cleanerId: string, item: CleanerItem) {
    const value = Number(qty);
    if (!Number.isFinite(value) || value < 0) {
      setError("Enter a quantity of 0 or more.");
      return;
    }
    setSaving(true);
    setError(null);
    const res = await setCleanerProductQuantity({
      cleanerId,
      productId: item.productId,
      quantity: value,
      reason: reason.trim() || undefined,
    });
    setSaving(false);
    if (!res.success) {
      setError(res.error);
      return;
    }
    closeEditor();
    router.refresh();
  }

  if (cleaners.length === 0) {
    return (
      <div className="text-center py-12">
        <div className="w-16 h-16 bg-[#008C9C]/5 rounded-full flex items-center justify-center mx-auto mb-3">
          <Users className="w-8 h-8 text-[#008C9C]/40" />
        </div>
        <p className="text-sm font-[350] text-[#008C9C]/70">
          No cleaner-assigned stock yet
        </p>
        <p className="text-xs font-[350] text-[#008C9C]/60 mt-1">
          Assign products to cleaners to see their field inventory here
        </p>
        {/* Without this the empty state was a dead end — the only way to assign
            stock was from a cleaner who already had some. */}
        {onAssign && (
          <button
            type="button"
            onClick={() => onAssign()}
            className="btn btn-primary btn-sm mt-4">
            <PackagePlus className="w-4 h-4 mr-2" />
            Assign inventory
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-[350] tracking-tight text-[#008C9C]">
            Cleaner Inventory
          </h2>
          <p className="text-sm text-[#008C9C]/70 mt-1">
            {canEdit
              ? "Stock currently assigned to crew in the field — set a count to correct it"
              : "Stock currently assigned to crew in the field"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {totalLow > 0 && (
            <Badge variant="error" size="sm">
              {totalLow} low item{totalLow !== 1 ? "s" : ""}
            </Badge>
          )}
          <Badge variant="cleano" size="sm">
            {cleaners.length} cleaner{cleaners.length !== 1 ? "s" : ""}
          </Badge>
          {onAssign && (
            <button
              type="button"
              onClick={() => onAssign()}
              className="btn btn-primary btn-sm">
              <PackagePlus className="w-4 h-4 mr-2" />
              Assign inventory
            </button>
          )}
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-col lg:flex-row gap-2">
        <div className="flex-1">
          <div className="relative">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-[#008C9C] z-10 w-4 h-4" />
            <Input
              placeholder="Search by cleaner or product..."
              value={search}
              size="md"
              onChange={(e) => setSearch(e.target.value)}
              className="pl-10 h-[42px] py-3 placeholder:!text-[#008C9C]/40 placeholder:!font-[350]"
              variant="form"
              border={false}
            />
          </div>
        </div>
        <button
          type="button"
          onClick={() => setLowOnly((v) => !v)}
          className="btn btn-secondary btn-sm h-[42px]"
          style={
            lowOnly
              ? { background: "var(--primary)", color: "#fff", borderColor: "var(--primary)" }
              : undefined
          }>
          <AlertTriangle className="w-4 h-4 mr-2" />
          Low only
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {filtered.map((c) => (
          <Card key={c.employeeId} variant="default" className="p-6">
            <div className="flex items-start justify-between gap-3 mb-4">
              <div className="min-w-0">
                <Link
                  href={`/admin/employees/${c.employeeId}?tab=products`}
                  className="text-sm font-[500] text-[#008C9C] hover:underline inline-flex items-center gap-1">
                  {c.employeeName}
                  <ArrowUpRight className="w-3.5 h-3.5" />
                </Link>
                <p className="text-xs text-[#008C9C]/60 mt-0.5">
                  {c.itemCount} item{c.itemCount !== 1 ? "s" : ""} ·{" "}
                  {c.totalUnits} units · ${c.totalValue.toFixed(2)}
                </p>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                {c.lowCount > 0 && (
                  <Badge variant="error" size="sm">
                    {c.lowCount} low
                  </Badge>
                )}
                {/* Item 17: open inventory assignment for THIS cleaner. */}
                {onAssign && (
                  <button
                    type="button"
                    onClick={() => onAssign(c.employeeId)}
                    className="btn btn-secondary btn-sm whitespace-nowrap">
                    <PackagePlus className="w-3.5 h-3.5 mr-1" />
                    Assign more
                  </button>
                )}
              </div>
            </div>
            <div className="space-y-2">
              {c.items.map((i) => {
                const key = `${c.employeeId}|${i.productId}`;
                const editing = editingKey === key;

                if (editing) {
                  return (
                    <div
                      key={i.productId}
                      className="p-3 rounded-xl bg-white border border-[#008C9C]/30 space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-[400] text-[#008C9C] truncate">
                          {i.productName}
                        </span>
                        <button
                          type="button"
                          aria-label="Cancel"
                          onClick={closeEditor}
                          disabled={saving}
                          className="text-[#008C9C]/50 hover:text-[#008C9C]">
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                      <div className="flex items-center gap-2">
                        <label className="text-xs text-[#008C9C]/60 shrink-0">
                          Set to
                        </label>
                        <input
                          type="number"
                          min={0}
                          step="0.01"
                          autoFocus
                          value={qty}
                          disabled={saving}
                          onChange={(e) => setQty(e.target.value)}
                          className="w-24 px-2 py-1.5 rounded-lg border border-[#008C9C]/20 text-sm text-[#003C46] focus:outline-none focus:border-[#008C9C]"
                        />
                        <span className="text-xs text-[#008C9C]/60">{i.unit}</span>
                        <span className="text-xs text-[#008C9C]/40 ml-auto">
                          was {i.quantity}
                        </span>
                      </div>
                      <input
                        type="text"
                        value={reason}
                        maxLength={500}
                        disabled={saving}
                        onChange={(e) => setReason(e.target.value)}
                        placeholder="Reason (optional) — e.g. cycle count, restocked van"
                        className="w-full px-2 py-1.5 rounded-lg border border-[#008C9C]/20 text-sm text-[#003C46] placeholder:text-[#008C9C]/40 focus:outline-none focus:border-[#008C9C]"
                      />
                      {error && <p className="text-xs text-red-600">{error}</p>}
                      <div className="flex items-center gap-2">
                        <Button
                          variant="primary"
                          size="sm"
                          border={false}
                          disabled={saving}
                          onClick={() => save(c.employeeId, i)}
                          className="rounded-xl px-4 py-2">
                          {saving ? (
                            <>
                              <Loader className="w-3 h-3 mr-2 animate-spin" />
                              Saving…
                            </>
                          ) : (
                            "Save count"
                          )}
                        </Button>
                        <Button
                          variant="default"
                          size="sm"
                          border={false}
                          disabled={saving}
                          onClick={closeEditor}
                          className="rounded-xl px-4 py-2">
                          Cancel
                        </Button>
                      </div>
                      <p className="text-[11px] text-[#008C9C]/50">
                        Recorded in the product&rsquo;s stock history with your name
                        and the change amount. Warehouse stock is not affected.
                      </p>
                    </div>
                  );
                }

                return (
                  <div
                    key={i.productId}
                    className={`flex items-center justify-between gap-2 p-3 rounded-xl transition-colors ${
                      i.isLow
                        ? "bg-red-50 border border-red-200"
                        : "bg-[#008C9C]/5"
                    }`}>
                    <div className="min-w-0">
                      <Link
                        href={`/admin/inventory/${i.productId}`}
                        className={`text-sm font-[400] hover:underline ${
                          i.isLow ? "text-red-700" : "text-[#008C9C]"
                        }`}>
                        {i.productName}
                      </Link>
                      {i.lastChange && (
                        <p className="text-[11px] text-[#008C9C]/50 truncate mt-0.5">
                          {i.lastChange.delta >= 0 ? "+" : ""}
                          {i.lastChange.delta} {i.unit} ·{" "}
                          {fmtDateTime(i.lastChange.at)}
                          {i.lastChange.by ? ` by ${i.lastChange.by}` : ""}
                        </p>
                      )}
                    </div>
                    <span className="flex items-center gap-2 shrink-0">
                      {/* Item 14: name the action. This is the CLEANER restock
                          threshold, not the company reorder point. */}
                      {i.isLow && (
                        <Badge
                          variant="warning"
                          size="sm"
                          title={`${LOW_STOCK_LABEL.CLEANER_RESTOCK} — at or below the cleaner restock threshold of ${i.refillThreshold} ${i.unit}`}>
                          Restock needed
                        </Badge>
                      )}
                      <span
                        className={`text-sm ${
                          i.isLow ? "text-red-700 font-[500]" : "text-[#008C9C]/70"
                        }`}>
                        {i.quantity} {i.unit}
                      </span>
                      {canEdit && (
                        <button
                          type="button"
                          aria-label={`Set ${i.productName} quantity for ${c.employeeName}`}
                          title="Set quantity"
                          onClick={() => openEditor(c.employeeId, i)}
                          className="p-1.5 rounded-lg text-[#008C9C]/60 hover:text-[#008C9C] hover:bg-[#008C9C]/10">
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </span>
                  </div>
                );
              })}
            </div>
          </Card>
        ))}
      </div>

      {filtered.length === 0 && (
        <div className="text-center py-10 text-sm text-[#008C9C]/60">
          No cleaners match your filters
        </div>
      )}
    </div>
  );
}
