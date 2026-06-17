"use client";

import { CBarChart } from "@/components/ui/Chart";

interface SupplierComparisonChartProps {
  data: Array<Record<string, string | number>>;
  supplierNames: string[];
}

export default function SupplierComparisonChart({
  data,
  supplierNames,
}: SupplierComparisonChartProps) {
  if (data.length === 0) {
    return (
      <p className="text-sm text-[#008C9C]/60 text-center py-8">
        No supplier data yet
      </p>
    );
  }

  return (
    <CBarChart
      data={data}
      dataKeys={supplierNames}
      xKey="product"
      height={300}
    />
  );
}
