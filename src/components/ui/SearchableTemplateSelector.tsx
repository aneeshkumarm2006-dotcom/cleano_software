"use client";

import React, { useState, useRef, useEffect } from "react";
import { ChevronDown, Search, X } from "lucide-react";
import Badge from "./Badge";

interface Template {
  id: string;
  name: string;
  template: string;
  additionalInfo?: string | null;
  isDefault?: boolean;
}

interface SearchableTemplateSelectorProps {
  templates: Template[];
  selectedTemplate: Template | null;
  onTemplateChange: (template: Template | null) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}

export default function SearchableTemplateSelector({
  templates,
  selectedTemplate,
  onTemplateChange,
  placeholder = "Search and select a template...",
  disabled = false,
  className = "",
}: SearchableTemplateSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [inputValue, setInputValue] = useState("");
  const dropdownRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Filter templates based on search term
  const filteredTemplates = templates.filter((template) =>
    template.name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  // Update input value when selected template changes
  useEffect(() => {
    if (selectedTemplate) {
      setInputValue(selectedTemplate.name);
      setSearchTerm("");
    } else {
      setInputValue("");
      setSearchTerm("");
    }
  }, [selectedTemplate]);

  // Handle click outside to close dropdown
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
        // Reset search when closing
        if (selectedTemplate) {
          setInputValue(selectedTemplate.name);
          setSearchTerm("");
        } else {
          setInputValue("");
          setSearchTerm("");
        }
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [selectedTemplate]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setInputValue(value);
    setSearchTerm(value);

    // If input is cleared, clear selection
    if (value === "") {
      onTemplateChange(null);
    }

    // Open dropdown when typing
    if (!isOpen) {
      setIsOpen(true);
    }
  };

  const handleTemplateSelect = (template: Template) => {
    onTemplateChange(template);
    setIsOpen(false);
    setSearchTerm("");
    setInputValue(template.name);
  };

  const handleClearSelection = (e: React.MouseEvent) => {
    e.stopPropagation();
    onTemplateChange(null);
    setInputValue("");
    setSearchTerm("");
    inputRef.current?.focus();
  };

  const handleInputFocus = () => {
    setIsOpen(true);
  };

  const handleDropdownToggle = () => {
    if (disabled) return;
    setIsOpen(!isOpen);
    if (!isOpen) {
      inputRef.current?.focus();
    }
  };

  return (
    <div className={`relative w-full ${className}`} ref={dropdownRef}>
      <div className="relative">
        <input
          ref={inputRef}
          type="text"
          value={inputValue}
          onChange={handleInputChange}
          onFocus={handleInputFocus}
          placeholder={placeholder}
          disabled={disabled}
          className={`w-full px-3 py-2 pr-20 text-sm text-neutral-950 border border-gray-300 rounded-2xl focus:outline-none  focus:border-neutral-950 bg-white transition-all duration-200 ${
            disabled
              ? "cursor-not-allowed opacity-50 bg-gray-50"
              : "cursor-text hover:border-neutral-950/50"
          }`}
        />

        {/* Right side buttons */}
        <div className="absolute right-2 top-1/2 transform -translate-y-1/2 flex items-center gap-1">
          {selectedTemplate && !disabled && (
            <button
              onClick={handleClearSelection}
              className="p-1 hover:bg-neutral-950/10 rounded transition-all duration-200"
              type="button">
              <X className="w-3 h-3 text-neutral-950/70" />
            </button>
          )}
          <button
            onClick={handleDropdownToggle}
            disabled={disabled}
            className={`p-1 hover:bg-neutral-950/10 rounded transition-all duration-200 ${
              disabled ? "cursor-not-allowed" : "cursor-pointer"
            }`}
            type="button">
            <ChevronDown
              className={`w-4 h-4 text-neutral-950/70 transition-all duration-200 ${
                isOpen ? "rotate-180" : ""
              }`}
            />
          </button>
        </div>
      </div>

      {/* Dropdown */}
      {isOpen && !disabled && (
        <div className="absolute left-0 right-0 top-full mt-1 bg-white border border-gray-200 rounded-2xl shadow-lg z-50 max-h-64 overflow-hidden">
          {/* Search icon in dropdown header */}
          {searchTerm && (
            <div className="px-3 py-2 border-b border-gray-100 bg-neutral-950/5 flex items-center gap-2">
              <Search className="w-4 h-4 text-neutral-950/70" />
              <span className="text-sm text-neutral-950/70">
                Searching for "{searchTerm}"
              </span>
            </div>
          )}

          <div className="max-h-48 overflow-y-auto">
            {filteredTemplates.length === 0 ? (
              <div className="px-3 py-4 text-sm text-neutral-950/50 text-center">
                {searchTerm
                  ? "No templates match your search"
                  : "No templates available"}
              </div>
            ) : (
              <>
                {/* Clear selection option */}
                <button
                  onClick={() => handleTemplateSelect(null as any)}
                  className="w-full px-3 py-2 text-sm text-neutral-950/70 hover:bg-neutral-950/5 text-left transition-all duration-200 border-b border-gray-100">
                  <em>Clear selection</em>
                </button>

                {/* Template options */}
                {filteredTemplates.map((template) => (
                  <button
                    key={template.id}
                    onClick={() => handleTemplateSelect(template)}
                    className={`w-full px-3 py-2 text-left hover:bg-neutral-950/5 transition-all duration-200 ${
                      selectedTemplate?.id === template.id
                        ? "bg-neutral-950/10"
                        : ""
                    }`}>
                    <div className="flex items-center justify-between">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-sm font-[400] text-neutral-950 truncate">
                            {template.name}
                          </span>
                          {template.isDefault && (
                            <Badge
                              variant="cleano"
                              className="text-xs py-0 px-1">
                              Default
                            </Badge>
                          )}
                        </div>
                        {template.template && (
                          <div className="text-xs text-neutral-950/60 truncate">
                            {template.template.slice(0, 80)}
                            {template.template.length > 80 ? "..." : ""}
                          </div>
                        )}
                      </div>
                    </div>
                  </button>
                ))}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
