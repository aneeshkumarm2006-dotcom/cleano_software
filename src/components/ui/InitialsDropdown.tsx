"use client";

import React, { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { Settings, LogOut } from "lucide-react";
import { useRouter } from "next/navigation";

interface InitialsDropdownProps {
  userName: string;
  signOutAction: () => Promise<void>;
}

export default function InitialsDropdown({
  userName,
  signOutAction,
}: InitialsDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [dropdownPosition, setDropdownPosition] = useState({
    top: 0,
    left: 0,
  });
  const dropdownRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const router = useRouter();
  const [isSigningOut, setIsSigningOut] = useState(false);

  // Get initials from user name
  const getInitials = (name: string) => {
    const parts = name.trim().split(" ");
    if (parts.length === 1) {
      return parts[0].substring(0, 2).toUpperCase();
    }
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  };

  const initials = getInitials(userName);

  // Update dropdown position based on trigger position
  const updateDropdownPosition = () => {
    if (triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      setDropdownPosition({
        top: rect.bottom + 8,
        left: rect.right,
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
  }, [isOpen]);

  const handleAccountSettings = () => {
    setIsOpen(false);
    router.push("/settings");
  };

  const handleSignOut = async () => {
    setIsOpen(false);
    setIsSigningOut(true);
    try {
      await signOutAction();
    } catch (error) {
      console.error("Failed to sign out:", error);
      setIsSigningOut(false);
    }
  };

  const dropdownContent = isOpen && (
    <div
      ref={dropdownRef}
      className="fixed min-w-48 bg-white border border-gray-200 rounded-xl shadow-lg z-[9999] overflow-hidden"
      style={{
        top: `${dropdownPosition.top}px`,
        left: `${dropdownPosition.left}px`,
        transform: "translateX(-100%)",
      }}>
      <div className="py-1">
        <button
          onClick={handleAccountSettings}
          className="w-full px-4 py-2.5 text-sm font-[400] text-gray-700 hover:bg-gray-50 flex items-center gap-3 transition-colors">
          <Settings className="w-4 h-4" />
          Account Settings
        </button>
        <button
          onClick={handleSignOut}
          className="w-full px-4 py-2.5 text-sm font-[400] text-gray-700 hover:bg-gray-50 flex items-center gap-3 transition-colors border-t border-gray-100">
          <LogOut className="w-4 h-4" />
          Sign Out
        </button>
      </div>
    </div>
  );

  return (
    <>
      <button
        ref={triggerRef}
        onClick={() => setIsOpen(!isOpen)}
        disabled={isSigningOut}
        className="w-10 h-10 rounded-full bg-blue-600 text-white font-[500] text-sm hover:bg-blue-700 transition-colors flex items-center justify-center focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed">
        {isSigningOut ? "..." : initials}
      </button>
      {typeof document !== "undefined" &&
        createPortal(dropdownContent, document.body)}
    </>
  );
}
