"use client";

import React from "react";
import { Check } from "lucide-react";

interface CheckboxProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "type"> {
  variant?: "default" | "minimal";
  color?:
    | "red"
    | "yellow"
    | "purple"
    | "gray"
    | "blue"
    | "green"
    | "black"
    | "cleano"
    | "primary";
}

export default function Checkbox({
  variant = "default",
  color = "blue",
  className = "",
  checked,
  ...props
}: CheckboxProps) {
  const colorClasses = {
    red: "border-red-300 data-[checked]:bg-red-500 data-[checked]:border-red-500",
    yellow:
      "border-yellow-300 data-[checked]:bg-yellow-500 data-[checked]:border-yellow-500",
    purple:
      "border-purple-300 data-[checked]:bg-purple-500 data-[checked]:border-purple-500",
    gray: "border-gray-300 data-[checked]:bg-gray-500 data-[checked]:border-gray-500",
    blue: "border-blue-300 data-[checked]:bg-blue-500 data-[checked]:border-blue-500",
    green:
      "border-green-300 data-[checked]:bg-green-500 data-[checked]:border-green-500",
    black: "border-black data-[checked]:bg-black data-[checked]:border-black",
    cleano:
      "border-neutral-950/70 data-[checked]:bg-neutral-950/70 data-[checked]:border-neutral-950/70",
    primary:
      "border-neutral-950/70 data-[checked]:bg-neutral-950/70 data-[checked]:border-neutral-950/70",
  }[color];

  return (
    <label className="relative inline-flex items-center justify-center cursor-pointer">
      <input type="checkbox" className="sr-only" checked={checked} {...props} />
      <div
        className={`w-4 h-4 rounded border-2 transition-all duration-200 flex items-center justify-center ${colorClasses} ${className}`}
        data-checked={checked || undefined}>
        {checked && <Check className="w-3 h-3 text-white" strokeWidth={2.5} />}
      </div>
    </label>
  );
}
