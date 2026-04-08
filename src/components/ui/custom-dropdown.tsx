"use client";

import React, { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";

interface DropdownOption {
  label: string;
  icon?: React.ReactNode;
  onClick: () => void;
}

interface CustomDropdownProps {
  size?: "sm" | "md" | "lg";
  variant?: "default" | "ghost";
  trigger: React.ReactNode;
  options: DropdownOption[];
  className?: string;
  maxHeight?: string;
  /** Horizontal alignment of the dropdown relative to the trigger */
  align?: "left" | "right" | "center";
  /** Vertical position of the dropdown relative to the trigger */
  position?: "bottom" | "top";
  /** Distance in pixels between the trigger and dropdown */
  offset?: number;
}

export default function CustomDropdown({
  size = "sm",
  variant = "default",
  trigger,
  options,
  className = "",
  maxHeight = "12rem",
  align = "left",
  position = "bottom",
  offset = 4,
}: CustomDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [dropdownPosition, setDropdownPosition] = useState({
    top: 0,
    left: 0,
    width: 0,
  });
  const dropdownRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLDivElement>(null);

  // Update dropdown position based on trigger position
  const updateDropdownPosition = () => {
    if (triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();

      // Calculate vertical position (fixed positioning uses viewport coordinates)
      const top = position === "top" ? rect.top - offset : rect.bottom + offset;

      // Calculate horizontal position based on alignment
      let left = rect.left;
      if (align === "right") {
        left = rect.right;
      } else if (align === "center") {
        left = rect.left + rect.width / 2;
      }

      setDropdownPosition({
        top,
        left,
        width: rect.width,
      });
    }
  };

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node) &&
        triggerRef.current &&
        !triggerRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

  useEffect(() => {
    if (isOpen) {
      updateDropdownPosition();

      // Update position on scroll and resize
      const handleScrollOrResize = () => {
        updateDropdownPosition();
      };

      // Listen to all scroll events in capture phase to catch scrolls in any container
      document.addEventListener("scroll", handleScrollOrResize, true);
      window.addEventListener("resize", handleScrollOrResize);

      return () => {
        document.removeEventListener("scroll", handleScrollOrResize, true);
        window.removeEventListener("resize", handleScrollOrResize);
      };
    }
  }, [isOpen, align, position, offset]);

  const handleOptionClick = (option: DropdownOption) => {
    option.onClick();
    setIsOpen(false);
  };

  const dropdownContent = isOpen && (
    <div
      ref={dropdownRef}
      className="fixed min-w-40 bg-white border border-[#005F6A]/10 rounded-2xl !overflow-hidden shadow-lg z-[9999]"
      style={{
        top: `${dropdownPosition.top}px`,
        left: `${dropdownPosition.left}px`,
        width: align === "left" ? `${dropdownPosition.width}px` : undefined,
        minWidth: align !== "left" ? `${dropdownPosition.width}px` : undefined,
        transform:
          `${position === "top" ? "translateY(-100%)" : ""} ${
            align === "right"
              ? "translateX(-100%)"
              : align === "center"
              ? "translateX(-50%)"
              : ""
          }`.trim() || "none",
        transformOrigin: position === "top" ? "bottom" : "top",
      }}>
      <div className=" overflow-y-auto " style={{ maxHeight }}>
        {options.map((option, index) => (
          <button
            key={index}
            onClick={() => handleOptionClick(option)}
            className="w-full px-4 py-3 text-sm text-[#005F6A] hover:bg-[#005F6A]/5 flex items-center gap-2 transition-colors">
            {option.icon}
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );

  return (
    <div className={`w-full ${className}`}>
      <div
        ref={triggerRef}
        onClick={() => setIsOpen(!isOpen)}
        className="cursor-pointer">
        {trigger}
      </div>
      {typeof document !== "undefined" &&
        createPortal(dropdownContent, document.body)}
    </div>
  );
}
