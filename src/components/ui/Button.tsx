"use client";

import React from "react";
import Link from "next/link";
import { Loader } from "lucide-react";

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?:
    | "default"
    | "light"
    | "selected"
    | "primary"
    | "secondary"
    | "ghost"
    | "outline"
    | "destructive"
    | "recorder"
    | "cleano"
    | "simple"
    | "tdo"
    | "dentitek"
    | "none"
    | "pro"
    | "cancel"
    | "action";
  size?: "sm" | "md" | "lg";
  loading?: boolean;
  href?: string;
  as?: React.ElementType; // Add the 'as' prop
  submit?: boolean;
  border?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      children,
      variant = "default",
      size = "md",
      loading = false,
      border = true,
      disabled,
      className = "",
      href,
      as: Comp = "button", // Destructure 'as' with a default of 'button'
      submit = true,
      type,
      ...props
    },
    ref
  ) => {
    const baseClasses =
      "inline-flex items-center justify-center tracking-tight transition-all duration-200 rounded-2xl disabled:opacity-50 !cursor-pointer";

    const variantClasses = {
      default:
        "bg-[#005F6A]/3 text-[#005F6A] hover:bg-[#005F6A]/10 border-[#005F6A]/3",
      light:
        "bg-[#005F6A]/2 text-[#005F6A] hover:bg-[#005F6A]/4 border-[#005F6A]/2",
      selected:
        "bg-[#59B8BC]/15 text-[#005F6A] hover:bg-[#59B8BC]/20 border-[#59B8BC]/5",
      secondary: "bg-gray-100 text-gray-700 hover:bg-gray-200",
      ghost:
        "bg-transparent text-[#005F6A] hover:bg-[#005F6A]/2 border-transparent",
      outline:
        "border-[#005F6A]/10 hover:border-[#005F6A]/20 focus:border-[#77C8CC] text-[#005F6A]",
      destructive: "bg-red-100 text-red-700 hover:bg-red-200 border-red-200/50",
      recorder:
        "bg-red-200/50 text-red-700 hover:bg-red-200 border-red-200/50 backdrop-blur-[3px]",
      blue: "bg-blue-100 text-blue-800 hover:bg-blue-200 border-blue-100",
      simple: "bg-gray-50 text-gray-700 hover:bg-gray-100 border-gray-100",
      primary:
        "bg-[#D7F0F1] text-[#005F6A] hover:bg-[#D7F0F1]/80  border-[#D7F0F1]/5",
      cleano:
        "bg-[#005F6A]/10 text-[#005F6A] hover:bg-[#005F6A]/20 border-[#005F6A]/2 backdrop-blur-[3px]",
      tdo: "bg-purple-100 text-purple-900 hover:bg-purple-200 border-purple-200/20",
      none: "bg-transparent text-gray-700 border-transparent",
      dentitek:
        "bg-[#173f38]/85 text-white hover:bg-[#173f38]/95 border-[#173f38]/20",
      cancel:
        "text-[#005F6A]/80 bg-white hover:bg-gray-50 border-gray-200 backdrop-blur-[3px]",
      action:
        "text-white bg-[#005F6A]/90 hover:bg-[#005F6A] backdrop-blur-[3px] border-transparent",
      pro: "bg-[#b788bf]/40 text-[#59385e] hover:bg-[#b788bf]/60 border-[#b788bf]/2 backdrop-blur-[3px]",
    }[variant];

    const sizeClasses = {
      sm: "px-3 py-2 text-xs !rounded-xl",
      md: "px-2 py-1.5 text-sm",
      lg: "px-2 py-1.5 text-md",
    }[size];

    const combinedClasses = `${baseClasses} ${variantClasses} ${sizeClasses} ${className} ${
      border ? "border" : ""
    }`;

    const commonProps = {
      className: combinedClasses,
      disabled: disabled || loading,
      ...props,
    };

    // If an 'as' component is provided, render it.
    // If href is also present, it's assumed the 'as' component can handle it (like GuardedLink).
    if (Comp && Comp !== "button") {
      return (
        <Comp ref={ref} href={href} {...commonProps}>
          {children}
        </Comp>
      );
    }

    // If href is provided (and 'as' is not), render as a standard Link
    if (href) {
      return (
        <Link
          href={href}
          className={combinedClasses}
          {...(disabled && { "aria-disabled": true, tabIndex: -1 })}
          {...props}>
          {children}
        </Link>
      );
    }

    // Otherwise, render as a standard button
    // Use explicit type prop if provided, otherwise fall back to submit prop
    const buttonType = type ?? (submit ? "submit" : "button");
    return (
      <button type={buttonType} ref={ref} {...commonProps}>
        {loading && <Loader className="w-3.5 h-3.5 animate-spin mr-2" />}
        {children}
      </button>
    );
  }
);

Button.displayName = "Button";

export default Button;
