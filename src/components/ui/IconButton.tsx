"use client";

import React from "react";
import { LucideIcon } from "lucide-react";

interface IconButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  icon: LucideIcon;
  size?: "xs" | "sm" | "md" | "lg";
  variant?: "ghost" | "outline";
}

export default function IconButton({
  icon: Icon,
  size = "md",
  variant = "outline",
  className = "",
  ...rest
}: IconButtonProps) {
  const sizeClasses = {
    xs: "p-0.5",
    sm: "p-1",
    md: "p-2",
    lg: "p-3",
  }[size];

  const iconSizeClasses = {
    xs: "w-3 h-3",
    sm: "w-4 h-4",
    md: "w-5 h-5",
    lg: "w-6 h-6",
  }[size];

  const variantClasses =
    variant === "ghost"
      ? "hover:bg-neutral-100"
      : "border border-gray-200 bg-white hover:bg-neutral-100";

  return (
    <button
      {...rest}
      className={`rounded-sm flex items-center justify-center transition-colors cursor-pointer ${sizeClasses} ${variantClasses} ${className}`.trim()}>
      <Icon className={`${iconSizeClasses} text-neutral-950`} />
    </button>
  );
}
