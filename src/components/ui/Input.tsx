"use client";

import React from "react";

interface InputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "size"> {
  variant?:
    | "default"
    | "minimal"
    | "badge"
    | "ghost"
    | "outline"
    | "search"
    | "compact"
    | "large"
    | "form";
  error?: boolean;
  size?: "sm" | "md" | "lg" | undefined;
  border?: boolean;
}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  (
    {
      variant = "default",
      error = false,
      className = "",
      size = "md",
      border = true,
      ...props
    },
    ref
  ) => {
    const baseClasses =
      "w-full text-left transition-all duration-200 text-black !rounded-2xl outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none";

    const variantClasses = {
      default:
        "border-neutral-950/10 hover:border-neutral-950/20 focus:border-neutral-950 ",
      minimal:
        "bg-transparent border-0 border-b border-gray-200 hover:border-gray-400 focus:border-neutral-950/70",
      badge:
        "font-[400] bg-white border-gray-200 hover:border-gray-300 focus:border-neutral-950/70",
      search:
        "pl-3 border-neutral-950/10 hover:border-neutral-950/20 focus:border-neutral-950",
      compact:
        "border-gray-200 hover:border-gray-300 focus:border-neutral-950/70",
      large:
        "border-gray-200 hover:border-gray-300 focus:border-neutral-950/70",
      ghost:
        "bg-transparent border-0 hover:bg-gray-50 focus:bg-white focus:focus:border-neutral-950/70",
      outline:
        "bg-white border-neutral-950/10 hover:border-neutral-950/20 focus:border-neutral-950/25",
      // Stage 6 / PDF #3 (readability). This variant used to type in #008C9C
      // (4.01:1 on white — the brand teal cannot reach AA as small text at ANY
      // alpha) with a 0.40-alpha placeholder at roughly 1.6:1, which is the
      // "barely readable" field the PDF's p.3 screenshot circles. #005a63 is the
      // one teal in the palette that passes as small text (7.95:1), and the
      // placeholder at 0.85 of it measures 5.5:1. Same visual family, legible.
      form: "bg-[#008C9C]/5 hover:bg-[#008C9C]/8 focus:bg-[#008C9C]/8 border-transparent !text-[#005a63] placeholder:text-[#005a63]/85",
    }[variant];

    const errorClasses = error
      ? "border-red-300 focus:border-red-500 focus:ring-red-500/20"
      : "";

    const sizeClasses = {
      sm: "px-2 py-1 text-xs",
      md: "px-2 py-1.5 text-sm",
      lg: "px-2 py-1.5 text-md",
    }[size];

    return (
      <input
        ref={ref}
        className={`${baseClasses} ${variantClasses} ${errorClasses} ${sizeClasses} ${className} ${
          border ? "border" : ""
        }`}
        {...props}
      />
    );
  }
);

Input.displayName = "Input";

export default Input;
