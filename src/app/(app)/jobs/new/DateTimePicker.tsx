"use client";

import { useState } from "react";
import DatePicker from "@/components/ui/DatePicker";

interface ControlledDatePickerProps {
  name: string;
  defaultValue?: string;
  size?: "sm" | "md" | "lg";
  placeholder?: string;
}

export function ControlledDatePicker({
  name,
  defaultValue = "",
  size = "md",
  placeholder,
}: ControlledDatePickerProps) {
  const [value, setValue] = useState(defaultValue);
  return (
    <DatePicker
      name={name}
      value={value}
      onChange={setValue}
      size={size}
      placeholder={placeholder}
    />
  );
}

const H = { sm: 34, md: 44, lg: 52 } as const;
const FS = { sm: 13, md: 14, lg: 15 } as const;
const BR = { sm: 9, md: 10, lg: 12 } as const;

interface ControlledTimePickerProps {
  name: string;
  defaultValue?: string;
  size?: "sm" | "md" | "lg";
  placeholder?: string;
}

export function ControlledTimePicker({
  name,
  defaultValue = "",
  size = "md",
}: ControlledTimePickerProps) {
  const [value, setValue] = useState(defaultValue);
  return (
    <input
      type="time"
      name={name}
      value={value}
      onChange={(e) => setValue(e.target.value)}
      style={{
        display: "block",
        width: "100%",
        height: H[size],
        padding: `0 ${size === "sm" ? 10 : 14}px`,
        borderRadius: BR[size],
        border: "1px solid rgba(0,95,106,0.16)",
        background: "#fff",
        fontSize: FS[size],
        color: value ? "#111" : "rgba(0,95,106,0.38)",
        fontFamily: "inherit",
        cursor: "pointer",
        outline: "none",
        boxSizing: "border-box",
      }}
      onFocus={(e) => {
        e.currentTarget.style.border = "1.5px solid #005F6A";
        e.currentTarget.style.boxShadow = "0 0 0 3px rgba(0,95,106,0.11)";
      }}
      onBlur={(e) => {
        e.currentTarget.style.border = "1px solid rgba(0,95,106,0.16)";
        e.currentTarget.style.boxShadow = "none";
      }}
    />
  );
}
