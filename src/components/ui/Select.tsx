"use client";

import React from "react";

interface SelectOption {
  value: string;
  label: string;
}

interface SelectProps
  extends Omit<React.SelectHTMLAttributes<HTMLSelectElement>, "onChange"> {
  options: SelectOption[];
  variant?: "default" | "minimal" | "ghost" | "outline";
  error?: boolean;
  size?: "sm" | "md" | "lg";
  onChange?: (value: string) => void;
}

const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
  (
    {
      options,
      variant = "default",
      error = false,
      className = "",
      size = "md",
      onChange,
      ...props
    },
    ref
  ) => {
    const baseClasses =
      "w-full text-left text-sm transition-all duration-200 text-black rounded-2xl outline-none appearance-none bg-no-repeat bg-right";

    const variantClasses = {
      default:
        "border border-gray-200 rounded-md hover:border-gray-300 focus:border-neutral-950/70 bg-white",
      minimal:
        "bg-transparent border-0 border-b border-gray-200 rounded-none hover:border-gray-400 focus:border-neutral-950/70",
      ghost:
        "bg-transparent border-0 hover:bg-gray-50 focus:bg-white focus:border focus:border-neutral-950/70 rounded-md",
      outline:
        "bg-white border border-gray-300 rounded-md hover:border-gray-400 focus:border-neutral-950/70",
    }[variant];

    const errorClasses = error
      ? "border-red-300 focus:border-red-500 focus:ring-red-500/20"
      : "";

    const sizeClasses = {
      sm: "px-2 py-1 text-sm",
      md: "px-3 py-2 text-sm",
      lg: "px-4 py-3 text-base",
    }[size];

    const handleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
      if (onChange) {
        onChange(e.target.value);
      }
    };

    return (
      <div className="relative">
        <select
          ref={ref}
          className={`${baseClasses} ${variantClasses} ${errorClasses} ${sizeClasses} ${className}`}
          style={{
            backgroundImage: `url("data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 20 20'%3e%3cpath stroke='%236b7280' stroke-linecap='round' stroke-linejoin='round' stroke-width='1.5' d='m6 8 4 4 4-4'/%3e%3c/svg%3e")`,
            backgroundPosition: "right 0.5rem center",
            backgroundSize: "1.5em 1.5em",
            paddingRight: "2.5rem",
          }}
          onChange={handleChange}
          {...props}>
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>
    );
  }
);

Select.displayName = "Select";

export default Select;
