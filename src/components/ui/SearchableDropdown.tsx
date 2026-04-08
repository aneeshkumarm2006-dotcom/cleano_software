"use client";

import React, { useState, useRef, useEffect } from "react";
import { ChevronDown, Search } from "lucide-react";

interface SearchableDropdownOption {
  label: string;
  value: any;
  onClick: () => void;
}

interface SearchableDropdownProps {
  options: SearchableDropdownOption[];
  value?: string;
  placeholder?: string;
  className?: string;
  maxHeight?: string;
  disabled?: boolean;
  error?: boolean;
  onSearchChange?: (search: string) => void;
}

export default function SearchableDropdown({
  options,
  value = "",
  placeholder = "Search or select...",
  className = "",
  maxHeight = "10rem",
  disabled = false,
  error = false,
  onSearchChange,
}: SearchableDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [isFocused, setIsFocused] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Filter options based on search term
  const filteredOptions = options.filter((option) =>
    option.label.toLowerCase().includes(searchTerm.toLowerCase())
  );

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
        setIsFocused(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

  // Update search term when external search changes
  useEffect(() => {
    if (onSearchChange) {
      onSearchChange(searchTerm);
    }
  }, [searchTerm, onSearchChange]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value;
    setSearchTerm(newValue);
    if (!isOpen) {
      setIsOpen(true);
    }
  };

  const handleInputFocus = () => {
    setIsFocused(true);
    setIsOpen(true);
  };

  const handleOptionClick = (option: SearchableDropdownOption) => {
    option.onClick();
    setSearchTerm("");
    setIsOpen(false);
    setIsFocused(false);
    inputRef.current?.blur();
  };

  const handleDropdownToggle = () => {
    if (disabled) return;

    if (!isOpen) {
      setIsOpen(true);
      setIsFocused(true);
      inputRef.current?.focus();
    } else {
      setIsOpen(false);
      setIsFocused(false);
    }
  };

  // Show placeholder or selected value when not focused/searching
  const displayValue = isFocused || isOpen ? searchTerm : value || "";
  const showPlaceholder = !isFocused && !value;

  return (
    <div className={`relative ${className}`} ref={dropdownRef}>
      <div className="relative">
        <input
          ref={inputRef}
          type="text"
          value={displayValue}
          onChange={handleInputChange}
          onFocus={handleInputFocus}
          placeholder={showPlaceholder ? placeholder : ""}
          disabled={disabled}
          className={`w-full pl-10 pr-10 py-2 border rounded-2xl text-xs transition-colors
            ${
              error
                ? "border-red-300 focus:border-red-500 "
                : "border-gray-300 focus:border-neutral-950/20 "
            }
            ${
              disabled
                ? "bg-gray-50 text-gray-500 cursor-not-allowed"
                : "bg-white hover:bg-gray-50 text-gray-900"
            }
            focus:outline-none
          `}
        />

        {/* Search Icon */}
        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />

        {/* Dropdown Toggle */}
        <button
          type="button"
          onClick={handleDropdownToggle}
          disabled={disabled}
          className={`absolute right-2 top-1/2 transform -translate-y-1/2 p-1 rounded transition-colors
            ${
              disabled
                ? "text-gray-400 cursor-not-allowed"
                : "text-gray-400 hover:text-neutral-950"
            }
          `}>
          <ChevronDown
            className={`w-4 h-4 transition-transform ${
              isOpen ? "rotate-180" : ""
            }`}
          />
        </button>
      </div>

      {/* Dropdown */}
      {isOpen && (
        <div className="absolute left-0 right-0 top-full mt-1 bg-white border border-gray-200 rounded-2xl shadow-lg z-50">
          <div className="py-1 overflow-y-auto" style={{ maxHeight }}>
            {filteredOptions.length === 0 ? (
              <div className="px-3 py-2 text-xs text-gray-500 text-center">
                {searchTerm ? "No results found" : "No options available"}
              </div>
            ) : (
              filteredOptions.map((option, index) => (
                <button
                  key={index}
                  onClick={() => handleOptionClick(option)}
                  className="w-full px-3 py-2 text-xs text-gray-700 hover:bg-gray-100 flex items-center transition-colors text-left">
                  {option.label}
                </button>
              ))
            )}
          </div>

          {/* Results counter */}
          {searchTerm && filteredOptions.length > 0 && (
            <div className="px-3 py-1 border-t border-gray-100 bg-gray-50">
              <span className="text-xxs text-gray-500">
                {filteredOptions.length} result
                {filteredOptions.length !== 1 ? "s" : ""}
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
