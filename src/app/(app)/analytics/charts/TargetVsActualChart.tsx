"use client";

import { CBarChart } from "@/components/ui/Chart";

interface TargetVsActualChartProps {
  data: Array<{ metric: string; target: number; actual: number }>;
}

export default function TargetVsActualChart({
  data,
}: TargetVsActualChartProps) {
  if (data.length === 0) {
    return (
      <p className="text-sm text-[#005F6A]/60 text-center py-8">
        No targets set yet
      </p>
    );
  }

  return (
    <CBarChart
      data={data}
      dataKeys={["target", "actual"]}
      xKey="metric"
      height={300}
    />
  );
}
