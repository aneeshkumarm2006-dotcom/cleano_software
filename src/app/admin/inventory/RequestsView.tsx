"use client";

import React, { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import Badge from "@/components/ui/Badge";
import { ClipboardList, ArrowUpRight, AlertTriangle } from "lucide-react";
import { fmtDateTime } from "@/lib/time";
import { resolveInventoryRequest } from "../actions/resolveInventoryRequest";

interface RequestRow {
  id: string;
  employeeId: string;
  employeeName: string;
  productId: string | null;
  itemName: string;
  isKit: boolean;
  unit: string | null;
  warehouseStock: number | null;
  quantity: number;
  reason: string | null;
  status: "PENDING" | "APPROVED" | "REJECTED" | "FULFILLED";
  createdAt: string;
}

interface Props {
  requests: RequestRow[];
}

export default function RequestsView({ requests }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showResolved, setShowResolved] = useState(false);

  const pending = useMemo(
    () => requests.filter((r) => r.status === "PENDING"),
    [requests]
  );
  const resolved = useMemo(
    () => requests.filter((r) => r.status !== "PENDING"),
    [requests]
  );

  async function handle(id: string, decision: "APPROVED" | "REJECTED") {
    setBusy(id);
    setError(null);
    try {
      const res = await resolveInventoryRequest(id, decision);
      if (!res.success) {
        setError(res.error);
        return;
      }
      router.refresh();
    } catch {
      setError("Failed to resolve request. Please try again.");
    } finally {
      setBusy(null);
    }
  }

  const statusBadge = (status: RequestRow["status"]) => {
    if (status === "REJECTED")
      return <Badge variant="error" size="sm">Rejected</Badge>;
    if (status === "FULFILLED")
      return <Badge variant="success" size="sm">Fulfilled</Badge>;
    return <Badge variant="cleano" size="sm">Approved</Badge>;
  };

  const Row = ({ req }: { req: RequestRow }) => {
    const shortStock =
      req.warehouseStock !== null && req.warehouseStock < req.quantity;
    return (
      <div
        className={`flex items-center justify-between gap-3 p-3 rounded-xl ${
          req.status === "PENDING"
            ? "bg-amber-50 border border-amber-200"
            : "bg-[#008C9C]/5"
        }`}>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-[400] text-[#008C9C]">
            {req.productId ? (
              <Link
                href={`/admin/inventory/${req.productId}`}
                className="hover:underline">
                {req.itemName}
              </Link>
            ) : (
              <>
                {req.itemName}
                {req.isKit ? " (kit)" : ""}
              </>
            )}
            <span className="text-[#008C9C]/60">
              {" "}
              · {req.quantity}
              {req.unit ? ` ${req.unit}` : ""}
            </span>
          </p>
          <p className="text-xs text-[#008C9C]/60 truncate">
            <Link
              href={`/admin/employees/${req.employeeId}?tab=products`}
              className="hover:underline inline-flex items-center gap-0.5">
              {req.employeeName}
              <ArrowUpRight className="w-3 h-3" />
            </Link>
            {" · "}
            {fmtDateTime(req.createdAt)}
            {req.reason ? ` · ${req.reason}` : ""}
          </p>
          {req.status === "PENDING" && shortStock && (
            <p className="text-xs text-red-600 mt-1 inline-flex items-center gap-1">
              <AlertTriangle className="w-3 h-3" />
              Only {req.warehouseStock} {req.unit ?? ""} in warehouse
            </p>
          )}
        </div>
        {req.status === "PENDING" ? (
          <div className="flex items-center gap-2 shrink-0">
            <Button
              variant="primary"
              size="sm"
              border={false}
              disabled={busy === req.id}
              onClick={() => handle(req.id, "APPROVED")}
              className="rounded-2xl px-4 py-2">
              {busy === req.id ? "…" : "Approve"}
            </Button>
            <Button
              variant="default"
              size="sm"
              border={false}
              disabled={busy === req.id}
              onClick={() => handle(req.id, "REJECTED")}
              className="rounded-2xl px-4 py-2">
              Reject
            </Button>
          </div>
        ) : (
          statusBadge(req.status)
        )}
      </div>
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-[350] tracking-tight text-[#008C9C]">
            Refill &amp; Equipment Requests
          </h2>
          <p className="text-sm text-[#008C9C]/70 mt-1">
            Approve or reject stock requests from cleaners
          </p>
        </div>
        <Badge variant={pending.length > 0 ? "warning" : "cleano"} size="sm">
          {pending.length} pending
        </Badge>
      </div>

      {error && (
        <div className="bg-red-50 rounded-2xl p-3">
          <p className="text-xs text-red-600">{error}</p>
        </div>
      )}

      {/* Pending */}
      <Card variant="default" className="p-6">
        <div className="flex items-center gap-2 mb-4">
          <div className="p-2 bg-[#008C9C]/10 rounded-lg">
            <ClipboardList className="w-4 h-4 text-[#008C9C]" />
          </div>
          <h3 className="text-sm font-[350] text-[#008C9C]/80">
            Pending requests
          </h3>
        </div>
        {pending.length === 0 ? (
          <p className="text-sm text-[#008C9C]/60 py-4 text-center">
            No pending requests
          </p>
        ) : (
          <div className="space-y-2">
            {pending.map((req) => (
              <Row key={req.id} req={req} />
            ))}
          </div>
        )}
      </Card>

      {/* Resolved */}
      {resolved.length > 0 && (
        <Card variant="ghost" className="p-6">
          <button
            type="button"
            onClick={() => setShowResolved((v) => !v)}
            className="flex items-center gap-2 mb-4 text-sm font-[350] text-[#008C9C]/80">
            <ClipboardList className="w-4 h-4" />
            {showResolved ? "Hide" : "Show"} resolved ({resolved.length})
          </button>
          {showResolved && (
            <div className="space-y-2">
              {resolved.map((req) => (
                <Row key={req.id} req={req} />
              ))}
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
