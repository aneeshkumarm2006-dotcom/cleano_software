"use client";

import React from "react";

interface RingChartProps {
  used: number;
  total: number;
  size?: number;
  strokeWidth?: number;
  usedColor?: string;
  remainingColor?: string;
  backgroundColor?: string;
  showPercentage?: boolean;
  className?: string;
}

export default function RingChart({
  used,
  total,
  size = 80,
  strokeWidth = 8,
  usedColor = "#10b981", // green-500
  remainingColor = "#f3f4f6", // gray-100
  backgroundColor = "transparent",
  showPercentage = true,
  className = "",
}: RingChartProps) {
  const percentage = total > 0 ? Math.min((used / total) * 100, 100) : 0;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const strokeDasharray = circumference;
  const strokeDashoffset = circumference - (percentage / 100) * circumference;

  return (
    <div
      className={`relative inline-flex items-center justify-center ${className}`}>
      <svg
        width={size}
        height={size}
        className="transform -rotate-90"
        style={{ backgroundColor }}>
        {/* Background circle */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={remainingColor}
          strokeWidth={strokeWidth}
          fill="transparent"
        />
        {/* Progress circle */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={usedColor}
          strokeWidth={strokeWidth}
          fill="transparent"
          strokeDasharray={strokeDasharray}
          strokeDashoffset={strokeDashoffset}
          strokeLinecap="round"
          className="transition-all duration-300 ease-in-out"
        />
      </svg>
      {showPercentage && (
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-sm font-[400] text-gray-700">
            {Math.round(percentage)}%
          </span>
        </div>
      )}
    </div>
  );
}
