"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Loader, Search } from "lucide-react";
import Modal from "@/components/ui/Modal";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import Select from "@/components/ui/Select";
import {
  bulkAssignCleanerInventory,
  type AssignMode,
} from "../actions/bulkAssignCleanerInventory";

export interface QuickAssignProduct {
  id: string;
  name: string;
  unit: string;
  /** Company stock at the selected location, keyed by locationId. */
  stockByLocation: Record<string, number>;
}

export interface QuickAssignCleaner {
  id: string;
  name: string;
  /** The cleaner's current kit counts, productId -> quantity. */
  held: Record<string, number>;
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  products: QuickAssignProduct[];
  cleaners: QuickAssignCleaner[];
  locations: { id: string; name: string }[];
  /** Pre-selected cleaner when opened from a specific row ("Assign more"). */
  initialCleanerId?: string | null;
}

/**
 * Assign inventory to one cleaner across many products from a single screen
 * (awer_fixes.pdf items 6, 13 and 17's "Assign More").
 *
 * The two modes are kept visually distinct because they mean different things:
 * From Locker MOVES stock out of a company location, Manual Adjust just
 * corrects what the cleaner's kit says it holds.
 */
export default function QuickAssignModal({
  isOpen,
  onClose,
  products,
  cleaners,
  locations,
  initialCleanerId = null,
}: Props) {
  const router = useRouter();
  const [cleanerId, setCleanerId] = useState(
    initialCleanerId ?? cleaners[0]?.id ?? ""
  );
  const [mode, setMode] = useState<AssignMode>("FROM_LOCKER");
  const [locationId, setLocationId] = useState(locations[0]?.id ?? "");
  const [search, setSearch] = useState("");
  const [notes, setNotes] = useState("");
  const [values, setValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);

  const cleaner = cleaners.find((c) => c.id === cleanerId) ?? null;

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return products;
    return products.filter((p) => p.name.toLowerCase().includes(q));
  }, [products, search]);

  // Only lines the admin actually typed into are sent.
  const entered = useMemo(
    () =>
      Object.entries(values)
        .map(([productId, raw]) => ({ productId, quantity: parseFloat(raw) }))
        .filter((i) => Number.isFinite(i.quantity)),
    [values]
  );

  const reset = () => {
    setValues({});
    setNotes("");
    setError(null);
    setWarnings([]);
  };

  const handleClose = () => {
    if (saving) return;
    reset();
    onClose();
  };

  const switchMode = (next: AssignMode) => {
    // The numbers mean different things in each mode ("give 2" vs "they hold
    // 2"), so carrying them across would silently change intent.
    setMode(next);
    setValues({});
    setWarnings([]);
    setError(null);
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    setWarnings([]);

    const res = await bulkAssignCleanerInventory({
      cleanerId,
      mode,
      locationId: mode === "FROM_LOCKER" ? locationId : null,
      items: entered,
      notes: notes.trim() || undefined,
    });

    setSaving(false);

    if (!res.success) {
      setError(res.error);
      return;
    }

    setWarnings(res.warnings);
    setValues({});
    setNotes("");
    // Cleaner inventory must reflect the save immediately (item 13).
    router.refresh();
    if (res.warnings.length === 0) handleClose();
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title="Assign inventory"
      subheader="Give a cleaner stock from a location, or correct what their kit holds."
      className="max-w-[52rem]">
      <div className="p-4 pt-3 overflow-y-auto flex flex-col gap-4">
        {/* Cleaner + mode */}
        <div className="grid gap-3 md:grid-cols-2">
          <div>
            <label className="text-[10px] uppercase tracking-wider text-[#008C9C]/60 font-[400]">
              Cleaner
            </label>
            <Select
              value={cleanerId}
              onChange={(v) => {
                setCleanerId(v);
                setValues({});
              }}
              options={cleaners.map((c) => ({ value: c.id, label: c.name }))}
              disabled={saving}
            />
          </div>
          <div>
            <label className="text-[10px] uppercase tracking-wider text-[#008C9C]/60 font-[400]">
              Mode
            </label>
            <div className="flex gap-2 mt-1">
              {(
                [
                  ["FROM_LOCKER", "From locker"],
                  ["MANUAL_ADJUST", "Manual adjust"],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  disabled={saving}
                  onClick={() => switchMode(value)}
                  className={`flex-1 rounded-xl px-3 py-2 text-xs font-[500] transition-colors ${
                    mode === value
                      ? "bg-[#008C9C] text-white"
                      : "bg-[#008C9C]/5 text-[#008C9C]"
                  }`}>
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <p className="text-xs text-[#008C9C]/70 bg-[#008C9C]/5 rounded-xl px-3 py-2">
          {mode === "FROM_LOCKER" ? (
            <>
              Enter <strong>how much to hand over</strong>. It is added to the
              cleaner&apos;s kit and subtracted from the location&apos;s stock.
            </>
          ) : (
            <>
              Enter the cleaner&apos;s <strong>new total count</strong>. Company
              stock is not changed — use this for stock counts and corrections.
            </>
          )}
        </p>

        {mode === "FROM_LOCKER" && (
          <div>
            <label className="text-[10px] uppercase tracking-wider text-[#008C9C]/60 font-[400]">
              Take from
            </label>
            {locations.length === 0 ? (
              <p className="text-xs text-red-600 mt-1">
                No active locations. Add one before assigning from a locker.
              </p>
            ) : (
              <Select
                value={locationId}
                onChange={setLocationId}
                options={locations.map((l) => ({ value: l.id, label: l.name }))}
                disabled={saving}
              />
            )}
          </div>
        )}

        {/* Product search */}
        <div className="relative">
          <Search
            className="absolute left-3 top-1/2 -translate-y-1/2 text-[#008C9C]/40"
            size={15}
          />
          <Input
            variant="form"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search products..."
            className="pl-9"
            disabled={saving}
          />
        </div>

        {/* Every product in the database, with a quantity field each */}
        <div className="border border-[#008C9C]/10 rounded-xl divide-y divide-[#008C9C]/10 max-h-[38vh] overflow-y-auto">
          {filtered.length === 0 ? (
            <p className="text-xs text-[#008C9C]/50 text-center py-6">
              No products match your search.
            </p>
          ) : (
            filtered.map((p) => {
              const held = cleaner?.held[p.id] ?? 0;
              const locker = p.stockByLocation[locationId] ?? 0;
              return (
                <div
                  key={p.id}
                  className="flex items-center gap-3 px-3 py-2">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-[#008C9C] truncate">{p.name}</div>
                    <div className="text-[11px] text-[#008C9C]/50">
                      Cleaner holds {held} {p.unit}
                      {mode === "FROM_LOCKER" && (
                        <>
                          {" · "}
                          <span className={locker <= 0 ? "text-amber-700" : ""}>
                            locker {locker} {p.unit}
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                  <Input
                    variant="form"
                    type="number"
                    min="0"
                    step="0.01"
                    value={values[p.id] ?? ""}
                    onChange={(e) =>
                      setValues((prev) => ({ ...prev, [p.id]: e.target.value }))
                    }
                    placeholder={mode === "FROM_LOCKER" ? "give" : String(held)}
                    disabled={saving}
                    className="!w-24 text-center"
                  />
                  <span className="text-[11px] text-[#008C9C]/50 w-10">
                    {p.unit}
                  </span>
                </div>
              );
            })
          )}
        </div>

        <div>
          <label className="text-[10px] uppercase tracking-wider text-[#008C9C]/60 font-[400]">
            Note (optional)
          </label>
          <Input
            variant="form"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Shows in the inventory activity log"
            disabled={saving}
          />
        </div>

        {error && <p className="text-xs text-red-600">{error}</p>}

        {warnings.length > 0 && (
          <div className="rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-800">
            <p className="flex items-center gap-1 font-[500]">
              <AlertTriangle className="w-3.5 h-3.5" />
              Saved — some locations went negative
            </p>
            <ul className="mt-1 list-disc pl-5">
              {warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          </div>
        )}

        <div className="flex items-center justify-between gap-3 pt-1">
          <span className="text-xs text-[#008C9C]/60">
            {entered.length === 0
              ? "No quantities entered"
              : `${entered.length} product${entered.length === 1 ? "" : "s"} to save`}
          </span>
          <div className="flex gap-2">
            <Button
              variant="default"
              size="sm"
              border={false}
              onClick={handleClose}
              disabled={saving}
              className="rounded-xl px-3 py-2">
              {warnings.length > 0 ? "Done" : "Cancel"}
            </Button>
            <Button
              variant="primary"
              size="sm"
              border={false}
              onClick={handleSave}
              disabled={
                saving ||
                entered.length === 0 ||
                !cleanerId ||
                (mode === "FROM_LOCKER" && !locationId)
              }
              className="rounded-xl px-3 py-2">
              {saving && <Loader className="w-3 h-3 mr-1 animate-spin" />}
              Save assignment
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
