"use client";

import { CLineChart } from "@/components/ui/Chart";

interface RevenueTrendChartProps {
  data: Array<{ month: string; revenue: number }>;
}

export default function RevenueTrendChart({ data }: RevenueTrendChartProps) {
  if (data.length === 0) {
    return (
      <p className="text-sm text-[#005F6A]/60 text-center py-8">
        No revenue data yet
      </p>
    );
  }

  return (
    <CLineChart
      data={data}
      dataKeys={["revenue"]}
      xKey="month"
      height={300}
    />
  );
}
