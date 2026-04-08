"use client";

import { useState } from "react";
import { Settings, LogOut } from "lucide-react";
import SettingsModal from "@/components/ui/SettingsModal";

interface User {
  id: string;
  name: string;
  email: string;
  phone?: string | null;
  role: "OWNER" | "ADMIN" | "EMPLOYEE";
}

interface UserActionsProps {
  user: User;
  signOutAction: () => Promise<void>;
}

export default function UserActions({ user, signOutAction }: UserActionsProps) {
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
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

  return (
    <>
      <div className="flex flex-col items-center gap-2">
        <button
          onClick={() => setIsSettingsOpen(true)}
          className="p-2.5 rounded-xl text-[#005F6A]/70 hover:text-[#005F6A] hover:bg-[#005F6A]/10 transition-colors"
          title="Settings">
          <Settings className="w-5 h-5" />
        </button>
        <button
          onClick={handleSignOut}
          disabled={isSigningOut}
          className="p-2.5 rounded-xl text-[#005F6A]/70 hover:text-[#005F6A] hover:bg-[#005F6A]/10 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          title="Sign Out">
          <LogOut className="w-5 h-5" />
        </button>
      </div>

      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        user={user}
      />
    </>
  );
}
