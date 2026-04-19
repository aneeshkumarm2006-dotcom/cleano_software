"use client";

import React from "react";
import Card from "@/components/ui/Card";
import Badge from "@/components/ui/Badge";
import Button from "@/components/ui/Button";
import { AlertTriangle, CheckCircle2, Package } from "lucide-react";

interface ForecastItem {
  productId: string;
  productName: string;
  unit: string;
  currentQuantity: number;
  usagePerJob: number;
  refillThreshold: number;
  projectedUsage: number;
  deficit: number;
  needsRefill: boolean;
}

interface ForecastCardProps {
  employeeName: string;
  employeeId: string;
  upcomingJobCount: number;
  items: ForecastItem[];
}

export default function ForecastCard({
  employeeName,
  employeeId,
  upcomingJobCount,
  items,
}: ForecastCardProps) {
  const needsRefillCount = items.filter((i) => i.needsRefill).length;

  return (
    <Card variant="default" className="p-6">
      <div className="flex items-start justify-between mb-4">
        <div>
          <h3 className="text-sm font-[400] text-[#005F6A]">{employeeName}</h3>
          <p className="text-xs text-[#005F6A]/60 mt-0.5">
            {upcomingJobCount} upcoming job{upcomingJobCount !== 1 ? "s" : ""}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {needsRefillCount > 0 ? (
            <Badge variant="error" size="sm">
              {needsRefillCount} need refill
            </Badge>
          ) : (
            <Badge variant="success" size="sm">
              All stocked
            </Badge>
          )}
          <Button
            variant="default"
            size="sm"
            border={false}
            href={`/employees/${employeeId}?tab=products`}
            className="rounded-2xl px-4 py-2.5">
            View
          </Button>
        </div>
      </div>

      <div className="space-y-2">
        {items.map((item) => {
          const usagePercent =
            item.currentQuantity > 0 && item.projectedUsage > 0
              ? Math.min(
                  100,
                  (item.currentQuantity / item.projectedUsage) * 100
                )
              : item.currentQuantity > 0
              ? 100
              : 0;

          return (
            <div
              key={item.productId}
              className={`p-3 rounded-xl ${
                item.needsRefill
                  ? "bg-red-50 border border-red-200"
                  : "bg-[#005F6A]/5"
              }`}>
              <div className="flex items-center justify-between mb-2">
                <span
                  className={`text-sm font-[350] ${
                    item.needsRefill ? "text-red-700" : "text-[#005F6A]"
                  }`}>
                  {item.productName}
                </span>
                <div className="flex items-center gap-2">
                  {item.deficit > 0 ? (
                    <span className="flex items-center gap-1 text-xs text-red-600">
                      <AlertTriangle className="w-3 h-3" />
                      Deficit: {item.deficit} {item.unit}
                    </span>
                  ) : item.needsRefill ? (
                    <span className="flex items-center gap-1 text-xs text-yellow-600">
                      <AlertTriangle className="w-3 h-3" />
                      Below threshold
                    </span>
                  ) : (
                    <span className="flex items-center gap-1 text-xs text-green-600">
                      <CheckCircle2 className="w-3 h-3" />
                      OK
                    </span>
                  )}
                </div>
              </div>

              {/* Progress Bar */}
              <div className="w-full bg-white/60 rounded-full h-2 mb-1">
                <div
                  className={`h-2 rounded-full transition-all ${
                    item.deficit > 0
                      ? "bg-red-400"
                      : item.needsRefill
                      ? "bg-yellow-400"
                      : "bg-green-400"
                  }`}
                  style={{ width: `${usagePercent}%` }}
                />
              </div>

              <div className="flex items-center justify-between text-xs text-[#005F6A]/50">
                <span>
                  Has: {item.currentQuantity} {item.unit}
                </span>
                <span>
                  Needs: {item.projectedUsage} {item.unit}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}
