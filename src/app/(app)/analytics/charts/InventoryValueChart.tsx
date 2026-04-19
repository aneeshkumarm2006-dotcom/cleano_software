"use client";

import { CAreaChart } from "@/components/ui/Chart";

interface InventoryValueChartProps {
  data: Array<{ name: string; warehouse: number; inCirculation: number }>;
}

export default function InventoryValueChart({
  data,
}: InventoryValueChartProps) {
  if (data.length === 0) {
    return (
      <p className="text-sm text-[#005F6A]/60 text-center py-8">
        No inventory data yet
      </p>
    );
  }

  return (
    <CAreaChart
      data={data}
      dataKeys={["warehouse", "inCirculation"]}
      xKey="name"
      height={300}
    />
  );
}
