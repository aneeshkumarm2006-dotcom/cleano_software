"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Badge from "@/components/ui/Badge";
import Select from "@/components/ui/Select";
import Input from "@/components/ui/Input";
import { AlertTriangle, Check, Loader, PackagePlus, Search, X } from "lucide-react";
import { fmtDateTime } from "@/lib/time";
import {
  INVENTORY_FLAG_LABEL,
  type InventoryFlagType,
} from "@/lib/inventory-status";
import {
  createRestockRequestFromFlag,
  resolveInventoryFlag,
} from "../actions/resolveInventoryFlag";

/**
 * The admin attention queue (cleano_inventory_operations_fixes.pdf #1/#2 —
 * "these reports should create a flag for admin review or restock", Stage 3.5).
 *
 * WHY IT IS NOT THE REQUESTS TAB. `InventoryRequest` is an APPROVAL queue: a
 * cleaner asks for N units, an admin says yes or no, warehouse stock moves. A
 * flag is "somebody should look at this" — a scraper reported damaged is not a
 * request for anything, and filing it as one is how the Requests tab in the
 * PDF's screenshot ended up with 48 pending rows nobody could work through.
 *
 * The two connect in one direction only: an admin who decides a flag needs
 * stock clicks **Restock** and the flag OPENS a request. Nothing goes the other
 * way, and the flag stays open until the cleaner is actually holding the thing.
 */

export interface InventoryFlagEntry {
  id: string;
  type: InventoryFlagType;
  source: string;
  notes: string | null;
  createdAt: string;
  employeeId: string;
  employeeName: string;
  productId: string;
  productName: string;
  unit: string;
  /** What the cleaner currently holds, for sizing a restock. */
  quantity: number;
  jobId: string | null;
  jobNumber: number | null;
}

/** Missing and damaged stop a job; low, empty and servicing do not — yet. */
const FLAG_TONE: Record<InventoryFlagType, "error" | "warning" | "cleano"> = {
  MISSING: "error",
  DAMAGED: "error",
  EMPTY: "error",
  LOW: "warning",
  NEEDS_REPLACEMENT: "warning",
  NEEDS_MAINTENANCE: "warning",
  RESTOCK: "cleano",
};

const SOURCE_LABEL: Record<string, string> = {
  CLOCK_OUT: "Reported at clock-out",
  RECOUNT: "Reported from My Inventory",
  ISSUE_REPORT: "Issue report",
  ADMIN: "Raised by admin",
};

interface Props {
  flags: InventoryFlagEntry[];
}

export default function AttentionView({ flags }: Props) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [cleanerFilter, setCleanerFilter] = useState("");
  const [productFilter, setProductFilter] = useState("");

  const [openId, setOpenId] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [restockQty, setRestockQty] = useState("1");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, startAction] = useTransition();

  const cleaners = useMemo(() => {
    const map = new Map<string, string>();
    flags.forEach((f) => map.set(f.employeeId, f.employeeName));
    return [...map.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [flags]);

  const products = useMemo(() => {
    const map = new Map<string, string>();
    flags.forEach((f) => map.set(f.productId, f.productName));
    return [...map.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [flags]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return flags.filter((f) => {
      if (typeFilter && f.type !== typeFilter) return false;
      if (cleanerFilter && f.employeeId !== cleanerFilter) return false;
      if (productFilter && f.productId !== productFilter) return false;
      if (!q) return true;
      return (
        f.employeeName.toLowerCase().includes(q) ||
        f.productName.toLowerCase().includes(q) ||
        (f.notes ?? "").toLowerCase().includes(q)
      );
    });
  }, [flags, search, typeFilter, cleanerFilter, productFilter]);

  function openPanel(flag: InventoryFlagEntry) {
    setOpenId(flag.id);
    setNote("");
    // Enough to clear the problem rather than a token 1 — an admin can still
    // change it, but the common answer to "empty" is "send a replacement".
    setRestockQty(String(Math.max(1, Math.ceil(flag.quantity > 0 ? flag.quantity : 1))));
    setError(null);
    setNotice(null);
  }

  function closePanel() {
    setOpenId(null);
    setNote("");
    setError(null);
  }

  function decide(flagId: string, decision: "RESOLVED" | "DISMISSED") {
    setError(null);
    startAction(async () => {
      const res = await resolveInventoryFlag({ flagId, decision, note });
      if (!res.success) {
        setError(res.error);
        return;
      }
      closePanel();
      router.refresh();
    });
  }

  function restock(flag: InventoryFlagEntry) {
    setError(null);
    const quantity = Number(restockQty);
    if (!Number.isFinite(quantity) || quantity <= 0) {
      setError("Enter a quantity of 1 or more.");
      return;
    }
    startAction(async () => {
      const res = await createRestockRequestFromFlag({
        flagId: flag.id,
        quantity,
      });
      if (!res.success) {
        setError(res.error);
        return;
      }
      setNotice(
        res.alreadyPending
          ? `${flag.employeeName} already has a pending request for ${flag.productName} — nothing duplicated.`
          : `Restock request created for ${flag.employeeName} · ${quantity} ${flag.unit} of ${flag.productName}. Approve it on the Requests tab.`
      );
      router.refresh();
    });
  }

  if (flags.length === 0) {
    return (
      <div className="text-center py-12">
        <div className="w-16 h-16 bg-[#008C9C]/5 rounded-full flex items-center justify-center mx-auto mb-3">
          <Check className="w-8 h-8 text-[#008C9C]/40" />
        </div>
        <p className="text-sm font-[350] text-[#008C9C]/70">
          Nothing needs attention
        </p>
        <p className="text-xs font-[350] text-[#008C9C]/60 mt-1">
          Items cleaners report as low, empty, missing, damaged or needing
          service — at clock-out or from their own inventory — appear here.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-[350] tracking-tight text-[#008C9C]">
            Needs Attention
          </h2>
          <p className="text-sm text-[#008C9C]/70 mt-1">
            What cleaners have reported — newest first. Resolve it, dismiss it,
            or send a restock.
          </p>
        </div>
        <Badge variant="error" size="sm">
          {flags.length} open
        </Badge>
      </div>

      {notice && (
        <div className="text-xs text-[#008C9C] bg-[#008C9C]/5 border border-[#008C9C]/15 rounded-xl px-3 py-2">
          {notice}
        </div>
      )}

      {/* Filters — type, cleaner, product, per PDF #2's "filters" bullet. */}
      <div className="flex flex-col lg:flex-row gap-2">
        <div className="flex-1">
          <div className="relative">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-[#008C9C] z-10 w-4 h-4" />
            <Input
              placeholder="Search cleaner, product or note..."
              value={search}
              size="md"
              onChange={(e) => setSearch(e.target.value)}
              className="pl-10 h-[42px] py-3 placeholder:!text-[#008C9C]/40 placeholder:!font-[350]"
              variant="form"
              border={false}
            />
          </div>
        </div>
        <Select
          value={typeFilter}
          onChange={setTypeFilter}
          size="sm"
          options={[
            { value: "", label: "All types" },
            ...Object.entries(INVENTORY_FLAG_LABEL).map(([value, label]) => ({
              value,
              label,
            })),
          ]}
        />
        <Select
          value={cleanerFilter}
          onChange={setCleanerFilter}
          size="sm"
          options={[
            { value: "", label: "All cleaners" },
            ...cleaners.map(([id, name]) => ({ value: id, label: name })),
          ]}
        />
        <Select
          value={productFilter}
          onChange={setProductFilter}
          size="sm"
          options={[
            { value: "", label: "All products" },
            ...products.map(([id, name]) => ({ value: id, label: name })),
          ]}
        />
      </div>

      <div className="border border-[#008C9C]/10 rounded-xl divide-y divide-[#008C9C]/10">
        {filtered.map((flag) => {
          const expanded = openId === flag.id;
          return (
            <div key={flag.id} className="px-4 py-3">
              <div className="flex items-start gap-3 flex-wrap sm:flex-nowrap">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge variant={FLAG_TONE[flag.type]} size="sm">
                      {INVENTORY_FLAG_LABEL[flag.type]}
                    </Badge>
                    <Link
                      href={`/admin/inventory/${flag.productId}`}
                      className="text-sm text-[#008C9C] hover:underline truncate">
                      {flag.productName}
                    </Link>
                    <span className="text-xs text-[#008C9C]/60">
                      · {flag.quantity} {flag.unit} held
                    </span>
                  </div>
                  <div className="text-xs text-[#008C9C]/60 mt-1 flex items-center gap-1 flex-wrap">
                    <Link
                      href={`/admin/employees/${flag.employeeId}?tab=products`}
                      className="hover:underline">
                      {flag.employeeName}
                    </Link>
                    <span>· {SOURCE_LABEL[flag.source] ?? flag.source}</span>
                    {/* The job it came off, so an admin can see the shift that
                        produced the report rather than just the date. */}
                    {flag.jobId && flag.jobNumber != null && (
                      <>
                        <span>·</span>
                        <Link
                          href={`/admin/jobs/${flag.jobId}`}
                          className="hover:underline">
                          job #{flag.jobNumber}
                        </Link>
                      </>
                    )}
                    <span>· {fmtDateTime(flag.createdAt)}</span>
                  </div>
                  {flag.notes && (
                    <p className="text-xs text-[#008C9C]/50 mt-1 italic break-words whitespace-pre-line">
                      {flag.notes}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() => (expanded ? closePanel() : openPanel(flag))}>
                    {expanded ? "Close" : "Take action"}
                  </button>
                </div>
              </div>

              {expanded && (
                <div className="mt-3 rounded-xl border border-[#008C9C]/15 bg-[#008C9C]/[0.03] p-3 space-y-3">
                  <input
                    type="text"
                    value={note}
                    maxLength={300}
                    disabled={busy}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="What did you do? (optional — kept on the flag)"
                    className="w-full px-3 py-2 rounded-lg border border-[#008C9C]/20 text-sm text-[#003C46] placeholder:text-[#008C9C]/50 focus:outline-none focus:border-[#008C9C]"
                  />
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => decide(flag.id, "RESOLVED")}
                      className="btn btn-primary btn-sm">
                      {busy ? (
                        <Loader className="w-3.5 h-3.5 mr-2 animate-spin" />
                      ) : (
                        <Check className="w-3.5 h-3.5 mr-2" />
                      )}
                      Resolve
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => decide(flag.id, "DISMISSED")}
                      className="btn btn-secondary btn-sm"
                      title="Nothing to do — kept separate from Resolved so real problems stay countable">
                      <X className="w-3.5 h-3.5 mr-2" />
                      Dismiss
                    </button>
                    <span className="flex items-center gap-2 ml-auto">
                      <input
                        type="number"
                        min={1}
                        step="1"
                        value={restockQty}
                        disabled={busy}
                        onChange={(e) => setRestockQty(e.target.value)}
                        aria-label={`Restock quantity for ${flag.productName}`}
                        className="w-20 px-2 py-1.5 rounded-lg border border-[#008C9C]/20 text-sm text-[#003C46] focus:outline-none focus:border-[#008C9C]"
                      />
                      <span className="text-xs text-[#008C9C]/60">{flag.unit}</span>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => restock(flag)}
                        className="btn btn-secondary btn-sm"
                        title="Creates a pre-filled refill request in the Requests tab">
                        <PackagePlus className="w-3.5 h-3.5 mr-2" />
                        Create restock request
                      </button>
                    </span>
                  </div>
                  {error && <p className="text-xs text-red-600">{error}</p>}
                  <p className="text-[11px] text-[#008C9C]/50">
                    A restock request goes to the Requests tab for approval and
                    leaves this flag open until the cleaner has the item.
                  </p>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {filtered.length === 0 && (
        <div className="text-center py-10 text-sm text-[#008C9C]/60 flex flex-col items-center gap-2">
          <AlertTriangle className="w-5 h-5 text-[#008C9C]/40" />
          No flags match your filters
        </div>
      )}
    </div>
  );
}
