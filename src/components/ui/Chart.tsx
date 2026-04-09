"use client";

import {
  LineChart,
  Line,
  BarChart,
  Bar,
  AreaChart,
  Area,
  PieChart,
  Pie,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  Cell,
} from "recharts";

export const CLEANO_COLORS = [
  "#005F6A",
  "#00899A",
  "#00B4CC",
  "#4DD9EC",
  "#A8EDF5",
  "#003D45",
];

type ChartDataItem = Record<string, string | number>;

interface BaseChartProps {
  data: ChartDataItem[];
  height?: number;
  className?: string;
}

interface LineBarAreaChartProps extends BaseChartProps {
  dataKeys: string[];
  xKey?: string;
}

interface PieChartProps extends BaseChartProps {
  dataKey: string;
  nameKey?: string;
}

export function CLineChart({
  data,
  dataKeys,
  xKey = "name",
  height = 300,
  className,
}: LineBarAreaChartProps) {
  return (
    <div className={className}>
      <ResponsiveContainer width="100%" height={height}>
        <LineChart data={data} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
          <XAxis dataKey={xKey} tick={{ fontSize: 12, fill: "#6b7280" }} />
          <YAxis tick={{ fontSize: 12, fill: "#6b7280" }} />
          <Tooltip
            contentStyle={{
              borderRadius: "8px",
              border: "1px solid #e5e7eb",
              boxShadow: "0 4px 6px -1px rgba(0,0,0,0.1)",
            }}
          />
          <Legend />
          {dataKeys.map((key, i) => (
            <Line
              key={key}
              type="monotone"
              dataKey={key}
              stroke={CLEANO_COLORS[i % CLEANO_COLORS.length]}
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4 }}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export function CBarChart({
  data,
  dataKeys,
  xKey = "name",
  height = 300,
  className,
}: LineBarAreaChartProps) {
  return (
    <div className={className}>
      <ResponsiveContainer width="100%" height={height}>
        <BarChart data={data} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
          <XAxis dataKey={xKey} tick={{ fontSize: 12, fill: "#6b7280" }} />
          <YAxis tick={{ fontSize: 12, fill: "#6b7280" }} />
          <Tooltip
            contentStyle={{
              borderRadius: "8px",
              border: "1px solid #e5e7eb",
              boxShadow: "0 4px 6px -1px rgba(0,0,0,0.1)",
            }}
          />
          <Legend />
          {dataKeys.map((key, i) => (
            <Bar
              key={key}
              dataKey={key}
              fill={CLEANO_COLORS[i % CLEANO_COLORS.length]}
              radius={[4, 4, 0, 0]}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function CAreaChart({
  data,
  dataKeys,
  xKey = "name",
  height = 300,
  className,
}: LineBarAreaChartProps) {
  return (
    <div className={className}>
      <ResponsiveContainer width="100%" height={height}>
        <AreaChart data={data} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
          <defs>
            {dataKeys.map((key, i) => (
              <linearGradient key={key} id={`gradient-${key}`} x1="0" y1="0" x2="0" y2="1">
                <stop
                  offset="5%"
                  stopColor={CLEANO_COLORS[i % CLEANO_COLORS.length]}
                  stopOpacity={0.15}
                />
                <stop
                  offset="95%"
                  stopColor={CLEANO_COLORS[i % CLEANO_COLORS.length]}
                  stopOpacity={0}
                />
              </linearGradient>
            ))}
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
          <XAxis dataKey={xKey} tick={{ fontSize: 12, fill: "#6b7280" }} />
          <YAxis tick={{ fontSize: 12, fill: "#6b7280" }} />
          <Tooltip
            contentStyle={{
              borderRadius: "8px",
              border: "1px solid #e5e7eb",
              boxShadow: "0 4px 6px -1px rgba(0,0,0,0.1)",
            }}
          />
          <Legend />
          {dataKeys.map((key, i) => (
            <Area
              key={key}
              type="monotone"
              dataKey={key}
              stroke={CLEANO_COLORS[i % CLEANO_COLORS.length]}
              strokeWidth={2}
              fill={`url(#gradient-${key})`}
            />
          ))}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

export function CPieChart({
  data,
  dataKey,
  nameKey = "name",
  height = 300,
  className,
}: PieChartProps) {
  return (
    <div className={className}>
      <ResponsiveContainer width="100%" height={height}>
        <PieChart>
          <Pie
            data={data}
            dataKey={dataKey}
            nameKey={nameKey}
            cx="50%"
            cy="50%"
            outerRadius={Math.min(height / 2 - 30, 100)}
            strokeWidth={2}
            stroke="#fff"
          >
            {data.map((_, i) => (
              <Cell key={i} fill={CLEANO_COLORS[i % CLEANO_COLORS.length]} />
            ))}
          </Pie>
          <Tooltip
            contentStyle={{
              borderRadius: "8px",
              border: "1px solid #e5e7eb",
              boxShadow: "0 4px 6px -1px rgba(0,0,0,0.1)",
            }}
          />
          <Legend />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}
