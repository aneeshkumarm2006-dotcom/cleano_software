"use client";

import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { X, User as UserIcon, Mail, Phone, Lock, Loader } from "lucide-react";
import Input from "./Input";
import Button from "./Button";
import {
  updateUserSettings,
  updateUserPassword,
} from "@/app/(app)/actions/updateUserSettings";

interface User {
  id: string;
  name: string;
  email: string;
  phone?: string | null;
  role: "OWNER" | "ADMIN" | "EMPLOYEE";
}

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  user: User;
}

type SettingsTab = "general" | "security";

export default function SettingsModal({
  isOpen,
  onClose,
  user,
}: SettingsModalProps) {
  const [activeTab, setActiveTab] = useState<SettingsTab>("general");
  const [name, setName] = useState(user.name);
  const [email, setEmail] = useState(user.email);
  const [phone, setPhone] = useState(user.phone || "");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const [isUpdatingProfile, setIsUpdatingProfile] = useState(false);
  const [isUpdatingPassword, setIsUpdatingPassword] = useState(false);
  const [profileMessage, setProfileMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);
  const [passwordMessage, setPasswordMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  // Reset form when modal opens
  useEffect(() => {
    if (isOpen) {
      setActiveTab("general");
      setName(user.name);
      setEmail(user.email);
      setPhone(user.phone || "");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setProfileMessage(null);
      setPasswordMessage(null);
    }
  }, [isOpen, user]);

  const disableForm = isUpdatingProfile || isUpdatingPassword;

  const handleProfileUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsUpdatingProfile(true);
    setProfileMessage(null);

    try {
      const result = await updateUserSettings({
        name,
        email,
        phone: phone || null,
      });

      if (result.success) {
        setProfileMessage({
          type: "success",
          text: "Profile updated successfully!",
        });
      } else {
        setProfileMessage({
          type: "error",
          text: result.error || "Failed to update profile",
        });
      }
    } catch (error) {
      setProfileMessage({
        type: "error",
        text: "An unexpected error occurred",
      });
    } finally {
      setIsUpdatingProfile(false);
    }
  };

  const handleClose = () => {
    if (!disableForm) {
      onClose();
    }
  };

  const handlePasswordUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsUpdatingPassword(true);
    setPasswordMessage(null);

    if (newPassword !== confirmPassword) {
      setPasswordMessage({ type: "error", text: "New passwords do not match" });
      setIsUpdatingPassword(false);
      return;
    }

    if (newPassword.length < 8) {
      setPasswordMessage({
        type: "error",
        text: "Password must be at least 8 characters",
      });
      setIsUpdatingPassword(false);
      return;
    }

    try {
      const result = await updateUserPassword({ currentPassword, newPassword });

      if (result.success) {
        setPasswordMessage({
          type: "success",
          text: "Password updated successfully!",
        });
        setCurrentPassword("");
        setNewPassword("");
        setConfirmPassword("");
      } else {
        setPasswordMessage({
          type: "error",
          text: result.error || "Failed to update password",
        });
      }
    } catch (error) {
      setPasswordMessage({
        type: "error",
        text: "An unexpected error occurred",
      });
    } finally {
      setIsUpdatingPassword(false);
    }
  };

  if (!isOpen) return null;

  const modalContent = (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4">
      {/* Blurred backdrop */}
      <div
        className="absolute inset-0"
        style={{
          backdropFilter: "blur(2px)",
          backgroundColor: "rgba(175, 175, 175, 0.1)",
        }}
        onClick={handleClose}
      />

      {/* Modal Container - Large Layout */}
      <div className="relative z-[10000] w-full max-w-[95vw] h-[90vh] gap-0 bg-white rounded-3xl overflow-hidden flex">
        {/* Sidebar */}
        <aside className="w-64 bg-white border-r border-[#005F6A]/10 flex flex-col">
          {/* Header */}
          <div className="p-6 ">
            <div className="flex items-start justify-between gap-2">
              <div>
                <h1 className="text-2xl font-[350] tracking-tight text-[#005F6A]">
                  Settings
                </h1>
                <p className="text-xs text-[#005F6A]/70 mt-1">
                  Manage your account
                </p>
              </div>
            </div>
          </div>

          {/* Navigation */}
          <nav className="flex-1 p-3">
            <button
              onClick={() => setActiveTab("general")}
              className={`w-full text-left px-4 py-3 rounded-xl text-sm font-[400] transition-colors ${
                activeTab === "general"
                  ? "bg-[#005F6A] text-white"
                  : "text-[#005F6A]/70 hover:bg-[#005F6A]/10 hover:text-[#005F6A]"
              }`}>
              General Settings
            </button>
            <button
              onClick={() => setActiveTab("security")}
              className={`w-full text-left px-4 py-3 rounded-xl text-sm font-[400] transition-colors mt-1 ${
                activeTab === "security"
                  ? "bg-[#005F6A] text-white"
                  : "text-[#005F6A]/70 hover:bg-[#005F6A]/10 hover:text-[#005F6A]"
              }`}>
              Security
            </button>
          </nav>
        </aside>

        {/* Main Content Area */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Content Header */}
          <div className="flex items-center justify-between p-6">
            <div className="">
              <h2 className="text-2xl font-[350] text-[#005F6A]">
                {activeTab === "general" ? "General Settings" : "Security"}
              </h2>
              <p className="text-sm text-[#005F6A]/70 mt-1">
                {activeTab === "general"
                  ? "Update your personal information"
                  : "Manage your password and security settings"}
              </p>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleClose}
              disabled={disableForm}
              className="!p-2 -mt-1">
              <X className="w-5 h-5" />
            </Button>
          </div>

          {/* Scrollable Content */}
          <div className="flex-1 overflow-y-auto px-8 py-6">
            {/* General Settings Tab */}
            {activeTab === "general" && (
              <form
                onSubmit={handleProfileUpdate}
                className="space-y-6 max-w-2xl">
                <div>
                  {/* Success/Error Message */}
                  {profileMessage && (
                    <div
                      className={`rounded-2xl p-4 flex items-start gap-3 mb-6 ${
                        profileMessage.type === "success"
                          ? "bg-green-50 border border-green-200"
                          : "bg-red-50 border border-red-200"
                      }`}>
                      <p
                        className={`text-sm font-[400] ${
                          profileMessage.type === "success"
                            ? "text-green-700"
                            : "text-red-700"
                        }`}>
                        {profileMessage.text}
                      </p>
                    </div>
                  )}

                  <div className="space-y-4">
                    {/* Full Name */}
                    <div>
                      <label className="input-label">
                        Full Name <span className="text-red-500 ml-1">*</span>
                      </label>
                      <div className="relative">
                        <UserIcon className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 z-10 text-[#005F6A]/50" />
                        <Input
                          variant="form"
                          type="text"
                          size="md"
                          value={name}
                          onChange={(e) => setName(e.target.value)}
                          disabled={disableForm}
                          className="w-full pl-11 px-4 py-3"
                          placeholder="Enter your full name"
                          border={false}
                          required
                        />
                      </div>
                    </div>

                    {/* Email */}
                    <div>
                      <label className="input-label">
                        Email Address{" "}
                        <span className="text-red-500 ml-1">*</span>
                      </label>
                      <div className="relative">
                        <Mail className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 z-10 text-[#005F6A]/50" />
                        <Input
                          variant="form"
                          type="email"
                          size="md"
                          value={email}
                          onChange={(e) => setEmail(e.target.value)}
                          disabled={disableForm}
                          className="w-full pl-11 px-4 py-3"
                          placeholder="Enter your email"
                          border={false}
                          required
                        />
                      </div>
                    </div>

                    {/* Phone */}
                    <div>
                      <label className="input-label">Phone Number</label>
                      <div className="relative">
                        <Phone className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 z-10 text-[#005F6A]/50" />
                        <Input
                          variant="form"
                          type="tel"
                          size="md"
                          value={phone}
                          onChange={(e) => setPhone(e.target.value)}
                          disabled={disableForm}
                          className="w-full pl-11 px-4 py-3"
                          placeholder="(555) 123-4567"
                          border={false}
                        />
                      </div>
                      <p className="text-xs text-[#005F6A]/60 mt-1">
                        Optional contact number
                      </p>
                    </div>

                    {/* Role (Read-only) */}
                    <div>
                      <label className="input-label">Role</label>
                      <div className="px-4 py-3 bg-[#005F6A]/5 border border-[#005F6A]/10 rounded-xl text-sm text-[#005F6A] font-[400]">
                        {user.role}
                      </div>
                      <p className="text-xs text-[#005F6A]/60 mt-1">
                        Contact an administrator to change your role
                      </p>
                    </div>
                  </div>
                </div>

                {/* Submit Button */}
                <div className="flex justify-end pt-4">
                  <Button
                    variant="primary"
                    size="md"
                    type="submit"
                    disabled={disableForm}
                    className="px-6 py-3">
                    {isUpdatingProfile ? (
                      <>
                        <Loader className="w-4 h-4 mr-2 animate-spin" />
                        Updating...
                      </>
                    ) : (
                      "Save Changes"
                    )}
                  </Button>
                </div>
              </form>
            )}

            {/* Security Tab */}
            {activeTab === "security" && (
              <form
                onSubmit={handlePasswordUpdate}
                className="space-y-6 max-w-2xl">
                <div>
                  {/* Success/Error Message */}
                  {passwordMessage && (
                    <div
                      className={`rounded-2xl p-4 flex items-start gap-3 mb-6 ${
                        passwordMessage.type === "success"
                          ? "bg-green-50 border border-green-200"
                          : "bg-red-50 border border-red-200"
                      }`}>
                      <p
                        className={`text-sm font-[400] ${
                          passwordMessage.type === "success"
                            ? "text-green-700"
                            : "text-red-700"
                        }`}>
                        {passwordMessage.text}
                      </p>
                    </div>
                  )}

                  <div className="space-y-4">
                    {/* Current Password */}
                    <div>
                      <label className="input-label">
                        Current Password{" "}
                        <span className="text-red-500 ml-1">*</span>
                      </label>
                      <div className="relative">
                        <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 z-10 text-[#005F6A]/50" />
                        <Input
                          variant="form"
                          type="password"
                          size="md"
                          value={currentPassword}
                          onChange={(e) => setCurrentPassword(e.target.value)}
                          disabled={disableForm}
                          className="w-full pl-11 px-4 py-3"
                          placeholder="Enter current password"
                          border={false}
                          required
                        />
                      </div>
                    </div>

                    {/* New Password */}
                    <div>
                      <label className="input-label">
                        New Password{" "}
                        <span className="text-red-500 ml-1">*</span>
                      </label>
                      <div className="relative">
                        <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 z-10 text-[#005F6A]/50" />
                        <Input
                          variant="form"
                          type="password"
                          size="md"
                          value={newPassword}
                          onChange={(e) => setNewPassword(e.target.value)}
                          disabled={disableForm}
                          className="w-full pl-11 px-4 py-3"
                          placeholder="Enter new password"
                          border={false}
                          required
                        />
                      </div>
                      <p className="text-xs text-[#005F6A]/60 mt-1">
                        Must be at least 8 characters
                      </p>
                    </div>

                    {/* Confirm New Password */}
                    <div>
                      <label className="input-label">
                        Confirm New Password{" "}
                        <span className="text-red-500 ml-1">*</span>
                      </label>
                      <div className="relative">
                        <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 z-10 text-[#005F6A]/50" />
                        <Input
                          variant="form"
                          type="password"
                          size="md"
                          value={confirmPassword}
                          onChange={(e) => setConfirmPassword(e.target.value)}
                          disabled={disableForm}
                          className="w-full pl-11 px-4 py-3"
                          placeholder="Confirm new password"
                          border={false}
                          required
                        />
                      </div>
                    </div>
                  </div>
                </div>

                {/* Submit Button */}
                <div className="flex justify-end pt-4">
                  <Button
                    variant="primary"
                    size="md"
                    type="submit"
                    disabled={disableForm}
                    className="px-6 py-3">
                    {isUpdatingPassword ? (
                      <>
                        <Loader className="w-4 h-4 mr-2 animate-spin" />
                        Updating...
                      </>
                    ) : (
                      "Update Password"
                    )}
                  </Button>
                </div>
              </form>
            )}
          </div>
        </div>
      </div>
    </div>
  );

  return typeof document !== "undefined"
    ? createPortal(modalContent, document.body)
    : null;
}
