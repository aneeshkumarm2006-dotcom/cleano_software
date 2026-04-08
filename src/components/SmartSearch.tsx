"use client";

import { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { Search as SearchIcon, X } from "lucide-react";
import Input from "@/components/ui/Input";
import Badge from "@/components/ui/Badge";

interface SmartSearchItem {
  id: string;
  name: string;
}

interface SmartSearchProps<T extends SmartSearchItem> {
  items: T[];
  selectedIds: string[];
  onToggleItem: (itemId: string) => void;
  disabled?: boolean;
  placeholder?: string;
  selectedLabel?: string;
  emptyMessage?: string;
  className?: string;
  size?: "sm" | "md" | "lg";
  filterFn?: (item: T, query: string) => boolean;
  renderItem?: (item: T, isSelected: boolean) => React.ReactNode;
  renderSelectedItem?: (item: T) => React.ReactNode;
}

export default function SmartSearch<T extends SmartSearchItem>({
  items,
  selectedIds,
  onToggleItem,
  disabled = false,
  placeholder = "Search...",
  selectedLabel = "Selected:",
  emptyMessage = "No results found",
  className = "",
  size = "md",
  filterFn,
  renderItem,
  renderSelectedItem,
}: SmartSearchProps<T>) {
  const [searchQuery, setSearchQuery] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const [dropdownPosition, setDropdownPosition] = useState<{
    top: number;
    left: number;
    width: number;
  } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Size-based classes
  const sizeClasses = {
    icon: {
      sm: "w-3 h-3 left-3",
      md: "w-4 h-4 left-4",
      lg: "w-5 h-5 left-4",
    }[size],
    input: {
      sm: "pl-9",
      md: "pl-11",
      lg: "pl-12",
    }[size],
    dropdownItem: {
      sm: "p-2 text-xs",
      md: "p-4 text-sm",
      lg: "p-5 text-base",
    }[size],
    selectedBadge: {
      sm: "px-2 py-1.5 text-xs",
      md: "px-3 py-3 text-sm",
      lg: "px-4 py-3.5 text-base",
    }[size],
    label: {
      sm: "text-[10px]",
      md: "text-xs",
      lg: "text-sm",
    }[size],
  };

  // Default filter function
  const defaultFilterFn = (item: T, query: string) =>
    item.name.toLowerCase().includes(query.toLowerCase());

  // Filter items based on search query
  const filteredItems = searchQuery.trim()
    ? items.filter((item) =>
        filterFn
          ? filterFn(item, searchQuery)
          : defaultFilterFn(item, searchQuery)
      )
    : [];

  // Update dropdown position
  const updateDropdownPosition = () => {
    if (containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      setDropdownPosition({
        top: rect.bottom + window.scrollY + 4, // 4px gap (mt-1)
        left: rect.left + window.scrollX,
        width: rect.width,
      });
    }
  };

  // Update position when dropdown opens or on scroll/resize
  useEffect(() => {
    if (isOpen && searchQuery.trim()) {
      updateDropdownPosition();

      const handleScroll = () => updateDropdownPosition();
      const handleResize = () => updateDropdownPosition();

      window.addEventListener("scroll", handleScroll, true);
      window.addEventListener("resize", handleResize);

      return () => {
        window.removeEventListener("scroll", handleScroll, true);
        window.removeEventListener("resize", handleResize);
      };
    }
  }, [isOpen, searchQuery]);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      // Check if click is outside both the container and the dropdown
      if (
        containerRef.current &&
        !containerRef.current.contains(target) &&
        dropdownRef.current &&
        !dropdownRef.current.contains(target)
      ) {
        setIsOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

  const handleItemClick = (itemId: string) => {
    onToggleItem(itemId);
    setSearchQuery("");
    setIsOpen(false);
    inputRef.current?.focus();
  };

  const handleRemoveItem = (itemId: string) => {
    onToggleItem(itemId);
  };

  // Default item renderer
  const defaultRenderItem = (item: T, isSelected: boolean) => {
    const itemTextSize = {
      sm: "text-xs",
      md: "text-sm",
      lg: "text-base",
    }[size];

    return (
      <>
        <span className={`${itemTextSize} font-[350] text-[#005F6A]`}>
          {item.name}
        </span>
        {isSelected && (
          <Badge variant="cleano" className="text-xs">
            Selected
          </Badge>
        )}
      </>
    );
  };

  // Default selected item renderer
  const defaultRenderSelectedItem = (item: T) => {
    const itemTextSize = {
      sm: "text-xs",
      md: "text-sm",
      lg: "text-base",
    }[size];

    return (
      <span className={`${itemTextSize} font-[350] text-[#005F6A]`}>
        {item.name}
      </span>
    );
  };

  // Render dropdown content
  const dropdownContent =
    isOpen && searchQuery.trim() && dropdownPosition ? (
      <div
        ref={dropdownRef}
        className="fixed max-h-60 overflow-y-auto rounded-2xl bg-white border border-[#005F6A]/10 shadow-lg z-[9999]"
        style={{
          top: `${dropdownPosition.top}px`,
          left: `${dropdownPosition.left}px`,
          width: `${dropdownPosition.width}px`,
        }}>
        {filteredItems.length > 0 ? (
          filteredItems.map((item) => {
            const isSelected = selectedIds.includes(item.id);
            return (
              <div
                key={item.id}
                className={`flex items-center justify-between gap-2 ${
                  sizeClasses.dropdownItem
                } cursor-pointer transition-colors border-b border-[#005F6A]/5 last:border-b-0 ${
                  isSelected ? "bg-[#005F6A]/5" : "hover:bg-[#005F6A]/3"
                }`}
                onClick={() => handleItemClick(item.id)}>
                {renderItem
                  ? renderItem(item, isSelected)
                  : defaultRenderItem(item, isSelected)}
              </div>
            );
          })
        ) : (
          <div className={`${sizeClasses.dropdownItem} text-center`}>
            <p
              className={`${
                sizeClasses.dropdownItem.split(" ")[1]
              } text-[#005F6A]/60`}>
              {emptyMessage}
            </p>
          </div>
        )}
      </div>
    ) : null;

  return (
    <div className={`space-y-3 ${className}`}>
      {/* Search Input */}
      <div ref={containerRef} className="relative">
        <SearchIcon
          className={`absolute ${sizeClasses.icon} top-1/2 -translate-y-1/2 z-10 text-[#005F6A]/50`}
        />
        <Input
          ref={inputRef}
          variant="form"
          size={size}
          type="text"
          value={searchQuery}
          onChange={(e) => {
            setSearchQuery(e.target.value);
            setIsOpen(true);
          }}
          onFocus={() => searchQuery.trim() && setIsOpen(true)}
          disabled={disabled}
          className={`w-full ${sizeClasses.input} px-4 py-2.5`}
          placeholder={placeholder}
          border={false}
        />

        {/* Portal dropdown to document body */}
        {typeof document !== "undefined" &&
          dropdownContent &&
          createPortal(dropdownContent, document.body)}
      </div>

      {/* Selected Items */}
      {selectedIds.length > 0 && (
        <div className="space-y-2">
          <p className={`${sizeClasses.label} font-[350] text-[#005F6A]/70`}>
            {selectedLabel}
          </p>
          <div className="flex flex-wrap gap-2">
            {selectedIds.map((itemId) => {
              const item = items.find((i) => i.id === itemId);
              if (!item) return null;
              return (
                <div
                  key={itemId}
                  className={`flex items-center gap-2 ${sizeClasses.selectedBadge} rounded-2xl bg-[#005F6A]/10`}>
                  {renderSelectedItem
                    ? renderSelectedItem(item)
                    : defaultRenderSelectedItem(item)}
                  <button
                    type="button"
                    onClick={() => handleRemoveItem(itemId)}
                    disabled={disabled}
                    className="text-[#005F6A]/60 hover:text-[#005F6A] transition-colors disabled:opacity-50 cursor-pointer">
                    <X
                      className={sizeClasses.icon
                        .split(" ")
                        .slice(0, 2)
                        .join(" ")}
                    />
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
