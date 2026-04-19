"use client";

import { CBarChart } from "@/components/ui/Chart";

interface ProfitLossChartProps {
  data: Array<{ month: string; revenue: number; expenses: number; net: number }>;
}

export default function ProfitLossChart({ data }: ProfitLossChartProps) {
  if (data.length === 0) {
    return (
      <p className="text-sm text-[#005F6A]/60 text-center py-8">
        No profit/loss data yet
      </p>
    );
  }

  return (
    <CBarChart
      data={data}
      dataKeys={["revenue", "expenses", "net"]}
      xKey="month"
      height={300}
    />
  );
}
