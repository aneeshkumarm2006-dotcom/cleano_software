import React, { useState } from "react";

interface ColorPickerProps {
  value: string;
  onChange: (color: string) => void;
  label?: string;
  className?: string;
}

export default function ColorPicker({
  value,
  onChange,
  label,
  className = "",
}: ColorPickerProps) {
  const [isOpen, setIsOpen] = useState(false);

  // 5 rows of colors (8 colors per row = 40 total colors)
  const colorPalette = [
    // Row 1 - Grays and blacks
    [
      "#000000",
      "#1F2937",
      "#374151",
      "#4B5563",
      "#6B7280",
      "#9CA3AF",
      "#D1D5DB",
      "#F3F4F6",
    ],
    // Row 2 - Reds and oranges
    [
      "#7F1D1D",
      "#DC2626",
      "#EF4444",
      "#F87171",
      "#FCA5A5",
      "#EA580C",
      "#F97316",
      "#FB923C",
    ],
    // Row 3 - Yellows and greens
    [
      "#A16207",
      "#D97706",
      "#F59E0B",
      "#FBBF24",
      "#65A30D",
      "#16A34A",
      "#22C55E",
      "#4ADE80",
    ],
    // Row 4 - Cyans and blues
    [
      "#0E7490",
      "#0891B2",
      "#06B6D4",
      "#22D3EE",
      "#0284C7",
      "#2563EB",
      "#3B82F6",
      "#60A5FA",
    ],
    // Row 5 - Purples and pinks
    [
      "#6D28D9",
      "#7C3AED",
      "#8B5CF6",
      "#A78BFA",
      "#C026D3",
      "#D946EF",
      "#E879F9",
      "#F0ABFC",
    ],
  ];

  return (
    <div className={`relative ${className}`}>
      {label && (
        <label className="block text-sm text-gray-700 mb-1">{label}</label>
      )}

      <div className="flex items-center gap-2">
        {/* Color Preview Button */}
        <button
          type="button"
          onClick={() => setIsOpen(!isOpen)}
          className="w-8 h-8 rounded-2xl shadow-sm hover:border-gray-400 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1"
          style={{ backgroundColor: value }}
          aria-label={`Select color. Current color: ${value}`}
        />

        {/* Color Value Display */}
        <span className="text-sm text-neutral-950 font-mono">{value}</span>
      </div>

      {/* Color Picker Popup */}
      {isOpen && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 z-40"
            onClick={() => setIsOpen(false)}
          />

          {/* Color Picker Panel */}
          <div className="absolute top-full left-0 mt-2 z-50 bg-white rounded-2xl shadow-lg border border-gray-200 p-4 min-w-[280px]">
            <div className="space-y-2">
              {colorPalette.map((row, rowIndex) => (
                <div key={rowIndex} className="flex gap-1">
                  {row.map((color) => (
                    <button
                      key={color}
                      type="button"
                      onClick={() => {
                        onChange(color);
                        setIsOpen(false);
                      }}
                      className="w-8 h-8 rounded-md border border-gray-300 hover:scale-110 transition-transform focus:outline-none focus:ring-2 focus:ring-blue-500"
                      style={{ backgroundColor: color }}
                      aria-label={`Select color ${color}`}
                    />
                  ))}
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
