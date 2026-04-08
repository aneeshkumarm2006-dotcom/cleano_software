"use client";

import { useState, useMemo, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import Input from "@/components/ui/Input";
import { X, Search, Users } from "lucide-react";
import Badge from "@/components/ui/Badge";

interface User {
  id: string;
  name: string;
  email: string;
}

interface CleanerSelectorProps {
  users: User[];
  initialSelectedIds?: string[];
}

export default function CleanerSelector({
  users,
  initialSelectedIds = [],
}: CleanerSelectorProps) {
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedCleaners, setSelectedCleaners] = useState<User[]>(() => {
    return users.filter((user) => initialSelectedIds.includes(user.id));
  });
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [dropdownPosition, setDropdownPosition] = useState({
    top: 0,
    left: 0,
    width: 0,
  });
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const inputContainerRef = useRef<HTMLDivElement>(null);

  // Update dropdown position based on input position
  const updateDropdownPosition = () => {
    if (inputContainerRef.current) {
      const rect = inputContainerRef.current.getBoundingClientRect();
      setDropdownPosition({
        top: rect.bottom + 4, // 4px offset
        left: rect.left,
        width: rect.width,
      });
    }
  };

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node) &&
        inputContainerRef.current &&
        !inputContainerRef.current.contains(event.target as Node)
      ) {
        setIsDropdownOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Filter users based on search term
  const filteredUsers = useMemo(() => {
    const search = searchTerm.toLowerCase().trim();
    if (!search) return users;

    return users.filter(
      (user) =>
        user.name.toLowerCase().includes(search) ||
        user.email.toLowerCase().includes(search)
    );
  }, [searchTerm, users]);

  // Get users that haven't been selected yet
  const availableUsers = useMemo(() => {
    const selectedIds = new Set(selectedCleaners.map((c) => c.id));
    return filteredUsers.filter((user) => !selectedIds.has(user.id));
  }, [filteredUsers, selectedCleaners]);

  // Update position when dropdown opens and on scroll/resize
  useEffect(() => {
    if (isDropdownOpen) {
      updateDropdownPosition();
      setHighlightedIndex(0); // Reset highlighted index when dropdown opens

      const handleScrollOrResize = () => {
        updateDropdownPosition();
      };

      document.addEventListener("scroll", handleScrollOrResize, true);
      window.addEventListener("resize", handleScrollOrResize);

      return () => {
        document.removeEventListener("scroll", handleScrollOrResize, true);
        window.removeEventListener("resize", handleScrollOrResize);
      };
    }
  }, [isDropdownOpen]);

  // Reset highlighted index when available users change
  useEffect(() => {
    setHighlightedIndex(0);
  }, [availableUsers.length]);

  // Auto-scroll to highlighted item
  useEffect(() => {
    if (isDropdownOpen && dropdownRef.current) {
      const highlightedElement = dropdownRef.current.querySelector(
        `button:nth-child(${highlightedIndex + 1})`
      ) as HTMLElement;
      if (highlightedElement) {
        highlightedElement.scrollIntoView({
          block: "nearest",
          behavior: "smooth",
        });
      }
    }
  }, [highlightedIndex, isDropdownOpen]);

  const handleSelectCleaner = (user: User) => {
    if (!selectedCleaners.find((c) => c.id === user.id)) {
      setSelectedCleaners([...selectedCleaners, user]);
    }
    setSearchTerm("");
    setIsDropdownOpen(false);
  };

  const handleRemoveCleaner = (userId: string) => {
    setSelectedCleaners(selectedCleaners.filter((c) => c.id !== userId));
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!isDropdownOpen) return;

    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setHighlightedIndex((prev) =>
          prev < availableUsers.length - 1 ? prev + 1 : prev
        );
        break;
      case "ArrowUp":
        e.preventDefault();
        setHighlightedIndex((prev) => (prev > 0 ? prev - 1 : 0));
        break;
      case "Enter":
        e.preventDefault();
        if (
          availableUsers.length > 0 &&
          highlightedIndex < availableUsers.length
        ) {
          handleSelectCleaner(availableUsers[highlightedIndex]);
        }
        break;
      case "Escape":
        e.preventDefault();
        setIsDropdownOpen(false);
        break;
    }
  };

  // Dropdown content with portal
  const dropdownContent = isDropdownOpen && (
    <div
      ref={dropdownRef}
      className="fixed min-w-40 bg-white border border-gray-200 rounded-2xl !overflow-hidden shadow-lg z-[9999]"
      style={{
        top: `${dropdownPosition.top}px`,
        left: `${dropdownPosition.left}px`,
        width: `${dropdownPosition.width}px`,
      }}>
      {availableUsers.length > 0 ? (
        <div className="py-1 overflow-y-auto max-h-60">
          {availableUsers.map((user, index) => (
            <button
              key={user.id}
              type="button"
              onClick={() => handleSelectCleaner(user)}
              onMouseEnter={() => setHighlightedIndex(index)}
              className={`w-full px-3 py-2 text-left focus:outline-none transition-colors ${
                index === highlightedIndex ? "bg-gray-100" : "hover:bg-gray-50"
              }`}>
              <div className="font-[400] text-sm text-gray-900">
                {user.name}
              </div>
              <div className="text-xs text-gray-500 mt-0.5">{user.email}</div>
            </button>
          ))}
        </div>
      ) : (
        <div className="px-4 py-8 text-center text-sm text-gray-500">
          {searchTerm
            ? `No users found matching "${searchTerm}"`
            : "All users have been selected"}
        </div>
      )}
    </div>
  );

  return (
    <div className="space-y-3">
      {/* Search Input */}
      <div className="relative" ref={inputContainerRef}>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <Input
            id="cleaner-search"
            type="text"
            value={searchTerm}
            onChange={(e) => {
              setSearchTerm(e.target.value);
              setIsDropdownOpen(true);
            }}
            onFocus={() => setIsDropdownOpen(true)}
            onKeyDown={handleKeyDown}
            placeholder="Search by name or email..."
            className="pl-10"
          />
        </div>
      </div>

      {/* Portal for dropdown */}
      {typeof document !== "undefined" &&
        createPortal(dropdownContent, document.body)}

      {/* Selected Cleaners - Chip Style */}
      {selectedCleaners.length > 0 && (
        <div>
          <p className="text-sm text-gray-600 mb-2">
            Selected: {selectedCleaners.length}
          </p>
          <div className="flex flex-wrap gap-2">
            {selectedCleaners.map((cleaner) => (
              <Badge
                key={cleaner.id}
                className="inline-flex items-center gap-2 !px-3 !py-1.5"
                variant="cleano"
                size="md">
                <span>{cleaner.name}</span>
                <button
                  type="button"
                  onClick={() => handleRemoveCleaner(cleaner.id)}
                  className="hover:bg-neutral-950/10 rounded-full p-0.5 transition-colors"
                  aria-label={`Remove ${cleaner.name}`}>
                  <X className="w-3.5 h-3.5" />
                </button>
              </Badge>
            ))}
          </div>
        </div>
      )}

      {/* No selection state */}
      {selectedCleaners.length === 0 && (
        <div className="text-sm text-gray-500 flex items-center gap-2 bg-gray-50 px-4 py-3 rounded-2xl border border-gray-200">
          <Users className="w-4 h-4" />
          <span>No team members selected yet</span>
        </div>
      )}

      {/* Hidden inputs for form submission */}
      {selectedCleaners.map((cleaner) => (
        <input
          key={cleaner.id}
          type="hidden"
          name="cleaners"
          value={cleaner.id}
        />
      ))}
    </div>
  );
}
