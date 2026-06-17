"use client";

import React, { memo, useMemo } from "react";

interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?:
    | "default"
    | "white"
    | "minimal"
    | "elevated"
    | "recorder"
    | "cleano_light"
    | "cleano_light_bordered_high"
    | "cleano_light_bordered"
    | "cleano_light_lighter"
    | "cleano_dark"
    | "cleano_dark_lighter"
    | "error"
    | "ghost"
    | "warning"
    | "alert"
    | "cleano_dark_solid"
    | "cleano_light_solid"
    | "glassy"
    | "glassy_dark"
    | "glassy_high";
  border?: boolean;
}

const VARIANT_CLASSES = {
  default: "bg-[#fafafa]/60",
  white: "bg-white border-gray-200",
  minimal: "bg-gray-50/50 border border-gray-100",
  elevated: "bg-white border border-gray-200 shadow-lg",
  recorder: "bg-red-100 border border-red-200",
  cleano_light: "bg-[#3E7596]/10 text-[#3E7596] hover:bg-[#3E7596]/15",
  cleano_light_bordered_high: "bg-[#3E7596]/20 border-[#3E7596]/20",
  cleano_light_bordered: "bg-[#3E7596]/10 border-[#3E7596]/10",
  cleano_light_lighter: "bg-[#3E7596]/5 text-[#3E7596] hover:bg-[#3E7596]/10",
  cleano_dark: "bg-[#008C9C]/10 text-[#008C9C] hover:bg-[#008C9C]/30",
  cleano_dark_lighter: "bg-[#008C9C]/5 text-[#008C9C] hover:bg-[#008C9C]/10",
  cleano_dark_solid: "bg-[#008C9C]/4 text-white",
  cleano_light_solid: "bg-[#3E7596]/40 text-white",
  error: "bg-red-50/50 border-red-100",
  ghost: "bg-transparent border-none",
  warning: "bg-orange-50/20 border-orange-100",
  alert: "bg-amber-50/50 border-amber-100 text-amber-600",
  glassy: "bg-white/10 border-white/10",
  glassy_high: "bg-white/20 border-white/20 backdrop-blur-[3px]",
  glassy_dark: "bg-[#008C9C]/10 border-[#008C9C]/5",
} as const;

function Card({
  children,
  variant = "default",
  className = "",
  border = false,
  ...props
}: CardProps) {
  const variantClass = useMemo(() => VARIANT_CLASSES[variant], [variant]);

  const combinedClassName = useMemo(
    () =>
      `w-full relative z-10 rounded-2xl p-2 ${variantClass} ${className} duration-300 ${
        border ? "border" : "border-none"
      }`,
    [variantClass, className, border]
  );

  return (
    <div className={combinedClassName} {...props}>
      {children}
    </div>
  );
}

export default memo(Card);
