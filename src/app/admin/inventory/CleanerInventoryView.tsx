"use client";

import React, { useMemo, useState } from "react";
import Link from "next/link";
import Card from "@/components/ui/Card";
import Badge from "@/components/ui/Badge";
import Input from "@/components/ui/Input";
import { Search, Users, AlertTriangle, ArrowUpRight } from "lucide-react";

interface CleanerItem {
  productId: string;
  productName: string;
  unit: string;
  quantity: number;
  costPerUnit: number;
  refillThreshold: number;
  isLow: boolean;
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
}

export default function CleanerInventoryView({ cleaners }: Props) {
  const [search, setSearch] = useState("");
  const [lowOnly, setLowOnly] = useState(false);

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
            Stock currently assigned to crew in the field
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
              {c.lowCount > 0 && (
                <Badge variant="error" size="sm">
                  {c.lowCount} low
                </Badge>
              )}
            </div>
            <div className="space-y-2">
              {c.items.map((i) => (
                <Link
                  key={i.productId}
                  href={`/admin/inventory/${i.productId}`}
                  className={`flex items-center justify-between p-3 rounded-xl transition-colors ${
                    i.isLow
                      ? "bg-red-50 border border-red-200 hover:bg-red-100/60"
                      : "bg-[#008C9C]/5 hover:bg-[#008C9C]/10"
                  }`}>
                  <span
                    className={`text-sm font-[400] ${
                      i.isLow ? "text-red-700" : "text-[#008C9C]"
                    }`}>
                    {i.productName}
                  </span>
                  <span className="flex items-center gap-2">
                    {i.isLow && (
                      <Badge variant="warning" size="sm">
                        Below {i.refillThreshold} {i.unit}
                      </Badge>
                    )}
                    <span
                      className={`text-sm ${
                        i.isLow ? "text-red-700 font-[500]" : "text-[#008C9C]/70"
                      }`}>
                      {i.quantity} {i.unit}
                    </span>
                  </span>
                </Link>
              ))}
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
