"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Activity, Loader, Package, User } from "lucide-react";
import Badge from "@/components/ui/Badge";
import Select from "@/components/ui/Select";
import { fmtDateTime } from "@/lib/time";
import { statusLabel } from "@/lib/inventory-status";
import { getInventoryActivity } from "../actions/getInventoryActivity";
import type { InventoryActivityEntry } from "../actions/getInventoryActivity.types";

interface Props {
  cleaners: { id: string; name: string }[];
  products: { id: string; name: string }[];
}

/**
 * Inventory activity log (awer_fixes.pdf item 18).
 *
 * Lazy-loaded in pages rather than fetching the whole history — this table is
 * append-only and grows with every pickup, adjustment and job.
 */
export default function ActivityView({ cleaners, products }: Props) {
  const [entries, setEntries] = useState<InventoryActivityEntry[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cleanerId, setCleanerId] = useState("");
  const [productId, setProductId] = useState("");

  // Guards against a slow first page resolving after a filter change and
  // appending stale rows underneath the new ones.
  const requestRef = useRef(0);

  const load = useCallback(
    async (opts: { reset?: boolean } = {}) => {
      const requestId = ++requestRef.current;
      setLoading(true);
      setError(null);

      const res = await getInventoryActivity({
        cursor: opts.reset ? null : cursor,
        cleanerId: cleanerId || null,
        productId: productId || null,
      });

      if (requestId !== requestRef.current) return;
      setLoading(false);

      if (!res.success) {
        setError(res.error);
        return;
      }
      setEntries((prev) =>
        opts.reset ? res.page.entries : [...prev, ...res.page.entries]
      );
      setCursor(res.page.nextCursor);
      setHasMore(res.page.nextCursor !== null);
    },
    [cursor, cleanerId, productId]
  );

  // Reload from the top whenever a filter changes.
  useEffect(() => {
    setEntries([]);
    setCursor(null);
    setHasMore(true);
    load({ reset: true });
    // `load` is intentionally omitted — it closes over `cursor`, which this
    // effect resets; including it would re-run on every page fetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cleanerId, productId]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-[350] tracking-tight text-[#008C9C]">
            Inventory Activity
          </h2>
          <p className="text-sm text-[#008C9C]/70 mt-1">
            Assignments, pickups, adjustments, reported issues and job usage —
            newest first
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select
            value={cleanerId}
            onChange={setCleanerId}
            size="sm"
            options={[
              { value: "", label: "All cleaners" },
              ...cleaners.map((c) => ({ value: c.id, label: c.name })),
            ]}
          />
          <Select
            value={productId}
            onChange={setProductId}
            size="sm"
            options={[
              { value: "", label: "All products" },
              ...products.map((p) => ({ value: p.id, label: p.name })),
            ]}
          />
        </div>
      </div>

      {error && <p className="text-xs text-red-600">{error}</p>}

      {entries.length === 0 && !loading && !error ? (
        <div className="text-center py-12">
          <div className="w-16 h-16 bg-[#008C9C]/5 rounded-full flex items-center justify-center mx-auto mb-3">
            <Activity className="w-8 h-8 text-[#008C9C]/40" />
          </div>
          <p className="text-sm font-[350] text-[#008C9C]/70">
            No inventory activity yet
          </p>
          <p className="text-xs font-[350] text-[#008C9C]/60 mt-1">
            Assignments, pickups and job usage will appear here
          </p>
        </div>
      ) : (
        <div className="border border-[#008C9C]/10 rounded-xl divide-y divide-[#008C9C]/10">
          {entries.map((e) => {
            const isCompany = e.cleanerId === null;
            const up = e.quantityChange > 0;
            return (
              <div
                key={e.id}
                className="flex items-start gap-3 px-4 py-3 flex-wrap sm:flex-nowrap">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge
                      variant="cleano"
                      size="sm"
                      title={
                        e.actionDerived
                          ? "Read from this row's wording — it predates the stored action column"
                          : undefined
                      }>
                      {e.action}
                      {e.actionDerived ? " ·" : ""}
                    </Badge>
                    <span className="text-sm text-[#008C9C] truncate inline-flex items-center gap-1">
                      <Package className="w-3.5 h-3.5 flex-shrink-0" />
                      {e.productName}
                    </span>
                    {/* PDF #1: history carries previous status → new status. */}
                    {e.newStatus && (
                      <span className="text-xs font-[500] text-[#008C9C]/80 whitespace-nowrap">
                        {e.previousStatus
                          ? `${statusLabel(e.previousStatus)} → ${statusLabel(e.newStatus)}`
                          : statusLabel(e.newStatus)}
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-[#008C9C]/60 mt-1 inline-flex items-center gap-1 flex-wrap">
                    <User className="w-3 h-3" />
                    {isCompany ? "Company stock" : e.cleanerName ?? "Unknown"}
                    {e.byName && e.byName !== e.cleanerName && (
                      <span>· by {e.byName}</span>
                    )}
                    <span>· {fmtDateTime(e.at)}</span>
                  </div>
                  {e.note && (
                    <p className="text-xs text-[#008C9C]/50 mt-1 italic break-words">
                      {e.note}
                    </p>
                  )}
                </div>
                <div className="text-right flex-shrink-0">
                  <div
                    className={`text-sm font-[500] tabular-nums ${
                      up ? "text-green-700" : "text-red-700"
                    }`}>
                    {up ? "+" : ""}
                    {e.quantityChange} {e.unit ?? ""}
                  </div>
                  {/* PDF #6's history list wants the OLD count as well as the
                      new one. `previous` is derived (new − change) so it can
                      never disagree with the delta above it — the same reading
                      the product's Stock History already shows. */}
                  <div className="text-[11px] text-[#008C9C]/50 tabular-nums">
                    {e.newQuantity - e.quantityChange} → {e.newQuantity}{" "}
                    {e.unit ?? ""}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {hasMore && (
        <div className="flex justify-center">
          <button
            type="button"
            onClick={() => load()}
            disabled={loading}
            className="btn btn-secondary btn-sm">
            {loading ? (
              <>
                <Loader className="w-3.5 h-3.5 mr-2 animate-spin" />
                Loading...
              </>
            ) : (
              "Load more"
            )}
          </button>
        </div>
      )}
    </div>
  );
}
