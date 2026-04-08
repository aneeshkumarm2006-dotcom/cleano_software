"use client";

import React from "react";

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
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
      form: "bg-[#005F6A]/3 hover:bg-[#005F6A]/5 focus:bg-[#005F6A]/6 !text-[#005F6A] placeholder:text-[#005F6A]/40",
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
