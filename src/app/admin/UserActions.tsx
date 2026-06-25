"use client";

import { useState } from "react";
import Link from "next/link";
import { Settings, LogOut } from "lucide-react";

interface User {
  id: string;
  name: string;
  email: string;
  phone?: string | null;
  role: string;
}

interface UserActionsProps {
  user: User;
  signOutAction: () => Promise<void>;
  expanded?: boolean;
}

export default function UserActions({
  signOutAction,
  expanded = false,
}: UserActionsProps) {
  const [isSigningOut, setIsSigningOut] = useState(false);

  const handleSignOut = async () => {
    setIsSigningOut(true);
    try {
      await signOutAction();
    } catch (error) {
      console.error("Failed to sign out:", error);
      setIsSigningOut(false);
    }
  };

  if (expanded) {
    return (
      <div className="flex flex-col items-stretch gap-1 w-full">
        <Link
          href="/admin/settings"
          className="flex items-center gap-3 h-12 px-3 rounded-xl text-sm font-[350] text-[#008C9C] hover:bg-[#008C9C]/10 transition-colors">
          <Settings className="w-5 h-5 shrink-0" />
          <span className="truncate">Settings</span>
        </Link>
        <button
          type="button"
          onClick={handleSignOut}
          disabled={isSigningOut}
          className="flex items-center gap-3 h-12 px-3 rounded-xl text-sm font-[350] text-[#008C9C] hover:bg-[#008C9C]/10 transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
          <LogOut className="w-5 h-5 shrink-0" />
          <span className="truncate">
            {isSigningOut ? "Signing out..." : "Logout"}
          </span>
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-2">
      <Link
        href="/admin/settings"
        className="p-2.5 rounded-xl text-[#008C9C]/70 hover:text-[#008C9C] hover:bg-[#008C9C]/10 transition-colors"
        title="Settings">
        <Settings className="w-5 h-5" />
      </Link>
      <button
        onClick={handleSignOut}
        disabled={isSigningOut}
        className="p-2.5 rounded-xl text-[#008C9C]/70 hover:text-[#008C9C] hover:bg-[#008C9C]/10 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        title="Sign Out">
        <LogOut className="w-5 h-5" />
      </button>
    </div>
  );
}
