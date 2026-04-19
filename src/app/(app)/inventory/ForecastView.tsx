"use client";

import React from "react";
import ForecastCard from "./ForecastCard";
import Badge from "@/components/ui/Badge";
import { TrendingDown } from "lucide-react";

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

interface ForecastEmployee {
  employeeId: string;
  employeeName: string;
  upcomingJobCount: number;
  items: ForecastItem[];
}

interface ForecastViewProps {
  employees: ForecastEmployee[];
}

export default function ForecastView({ employees }: ForecastViewProps) {
  const totalRefills = employees.reduce(
    (sum, e) => sum + e.items.filter((i) => i.needsRefill).length,
    0
  );

  if (employees.length === 0) {
    return (
      <div className="text-center py-12">
        <div className="w-16 h-16 bg-[#005F6A]/5 rounded-full flex items-center justify-center mx-auto mb-3">
          <TrendingDown className="w-8 h-8 text-[#005F6A]/40" />
        </div>
        <p className="text-sm font-[350] text-[#005F6A]/70">
          No forecast data available
        </p>
        <p className="text-xs font-[350] text-[#005F6A]/60 mt-1">
          Assign products to employees and set inventory rules to see forecasts
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-[350] tracking-tight text-[#005F6A]">
            Inventory Forecast
          </h2>
          <p className="text-sm text-[#005F6A]/70 mt-1">
            Projected usage based on upcoming jobs and inventory rules
          </p>
        </div>
        <div className="flex items-center gap-2">
          {totalRefills > 0 && (
            <Badge variant="error" size="sm">
              {totalRefills} refill{totalRefills !== 1 ? "s" : ""} needed
            </Badge>
          )}
          <Badge variant="cleano" size="sm">
            {employees.length} employee{employees.length !== 1 ? "s" : ""}
          </Badge>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {employees.map((emp) => (
          <ForecastCard
            key={emp.employeeId}
            employeeId={emp.employeeId}
            employeeName={emp.employeeName}
            upcomingJobCount={emp.upcomingJobCount}
            items={emp.items}
          />
        ))}
      </div>
    </div>
  );
}
