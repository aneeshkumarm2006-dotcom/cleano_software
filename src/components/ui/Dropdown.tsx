"use client";

import React, { useState, useRef, useEffect } from "react";
import { ChevronDown } from "lucide-react";

interface DropdownOption {
  value: string | number;
  label: string;
  color?: string;
}

interface DropdownProps {
  options: DropdownOption[];
  value: string | number;
  onChange: (value: string | number) => void;
  placeholder?: string;
  className?: string;
  zIndex?: number;
}

export default function Dropdown({
  options,
  value,
  onChange,
  placeholder = "Select...",
  className = "",
  zIndex = 50,
}: DropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0, width: 0 });
  const buttonRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const selectedOption = options.find((option) => option.value === value);

  useEffect(() => {
    if (isOpen && buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      setPosition({
        top: rect.bottom + window.scrollY + 4,
        left: rect.left + window.scrollX,
        width: rect.width,
      });
    }
  }, [isOpen]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node) &&
        buttonRef.current &&
        !buttonRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleSelect = (option: DropdownOption) => {
    onChange(option.value);
    setIsOpen(false);
  };

  return (
    <div className={`relative ${className}`}>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="w-full px-3 py-2 text-sm font-[400] text-gray-900 bg-white border border-gray-200 rounded-md hover:border-gray-300 focus:border-blue-500 focus:ring-1 focus:ring-blue-500/20 focus:bg-blue-50/50 transition-all duration-200 outline-none flex items-center justify-between gap-1">
        <span className="text-center flex-1">
          {selectedOption?.label || placeholder}
        </span>
        <ChevronDown
          className={`w-3 h-3 text-gray-400 transition-transform duration-200 ${
            isOpen ? "rotate-180" : ""
          }`}
        />
      </button>

      {isOpen && (
        <div
          ref={dropdownRef}
          className="fixed"
          style={{
            top: position.top,
            left: position.left,
            minWidth: Math.max(position.width, 200),
            zIndex: zIndex,
          }}>
          <div className="bg-white border border-gray-200 rounded-md shadow-lg overflow-hidden">
            {options.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => handleSelect(option)}
                className={`w-full px-3 py-2 text-sm font-[400] text-left hover:bg-gray-50 transition-colors duration-150 ${
                  value === option.value
                    ? "bg-blue-50 text-blue-700"
                    : "text-gray-700"
                } whitespace-nowrap flex items-center justify-between`}>
                <span>{option.label}</span>
                {option.color && (
                  <div
                    className="w-3 h-3 rounded-full border border-gray-300 ml-2 flex-shrink-0"
                    style={{ backgroundColor: option.color }}
                  />
                )}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
