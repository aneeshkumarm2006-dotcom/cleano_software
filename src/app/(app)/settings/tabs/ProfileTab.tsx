"use client";

import { useState } from "react";
import Card from "@/components/ui/Card";
import Input from "@/components/ui/Input";
import Button from "@/components/ui/Button";
import {
  updateUserSettings,
  updateUserPassword,
} from "../../actions/updateUserSettings";
import { SettingsUser } from "../types";

interface ProfileTabProps {
  user: SettingsUser;
}

type Msg = { type: "success" | "error"; text: string } | null;

export default function ProfileTab({ user }: ProfileTabProps) {
  const [name, setName] = useState(user.name);
  const [email, setEmail] = useState(user.email);
  const [phone, setPhone] = useState(user.phone || "");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const [updatingProfile, setUpdatingProfile] = useState(false);
  const [updatingPassword, setUpdatingPassword] = useState(false);
  const [profileMsg, setProfileMsg] = useState<Msg>(null);
  const [passwordMsg, setPasswordMsg] = useState<Msg>(null);

  async function handleProfileUpdate(e: React.FormEvent) {
    e.preventDefault();
    setUpdatingProfile(true);
    setProfileMsg(null);
    try {
      const result = await updateUserSettings({
        name,
        email,
        phone: phone || null,
      });
      if (result.success) {
        setProfileMsg({ type: "success", text: "Profile updated." });
      } else {
        setProfileMsg({
          type: "error",
          text: result.error || "Failed to update profile.",
        });
      }
    } catch {
      setProfileMsg({ type: "error", text: "Unexpected error." });
    } finally {
      setUpdatingProfile(false);
    }
  }

  async function handlePasswordUpdate(e: React.FormEvent) {
    e.preventDefault();
    setUpdatingPassword(true);
    setPasswordMsg(null);

    if (newPassword !== confirmPassword) {
      setPasswordMsg({ type: "error", text: "New passwords do not match." });
      setUpdatingPassword(false);
      return;
    }
    if (newPassword.length < 8) {
      setPasswordMsg({
        type: "error",
        text: "Password must be at least 8 characters.",
      });
      setUpdatingPassword(false);
      return;
    }

    try {
      const result = await updateUserPassword({ currentPassword, newPassword });
      if (result.success) {
        setPasswordMsg({ type: "success", text: "Password updated." });
        setCurrentPassword("");
        setNewPassword("");
        setConfirmPassword("");
      } else {
        setPasswordMsg({
          type: "error",
          text: result.error || "Failed to update password.",
        });
      }
    } catch {
      setPasswordMsg({ type: "error", text: "Unexpected error." });
    } finally {
      setUpdatingPassword(false);
    }
  }

  return (
    <div className="space-y-6">
      <Card variant="white" border>
        <form onSubmit={handleProfileUpdate} className="p-4 space-y-5">
          <h2 className="text-lg font-[550] text-gray-900">
            Profile Information
          </h2>

          <div className="space-y-4">
            <Field label="Full Name">
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Enter your full name"
                required
              />
            </Field>
            <Field label="Email Address">
              <Input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Enter your email"
                required
              />
            </Field>
            <Field label="Phone Number">
              <Input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="Enter your phone number"
              />
            </Field>
            <Field label="Role">
              <div className="px-3 py-2 bg-gray-50 border border-gray-200 rounded-2xl text-sm text-gray-600">
                {user.role}
              </div>
              <p className="text-xs text-gray-500 mt-1">
                Contact an administrator to change your role.
              </p>
            </Field>
          </div>

          {profileMsg && <Feedback msg={profileMsg} />}

          <div className="flex justify-end">
            <Button
              type="submit"
              variant="primary"
              disabled={updatingProfile}>
              {updatingProfile ? "Updating..." : "Update Profile"}
            </Button>
          </div>
        </form>
      </Card>

      <Card variant="white" border>
        <form onSubmit={handlePasswordUpdate} className="p-4 space-y-5">
          <h2 className="text-lg font-[550] text-gray-900">Change Password</h2>

          <div className="space-y-4">
            <Field label="Current Password">
              <Input
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                placeholder="Enter current password"
                required
              />
            </Field>
            <Field label="New Password">
              <Input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="Enter new password"
                required
              />
              <p className="text-xs text-gray-500 mt-1">
                Must be at least 8 characters.
              </p>
            </Field>
            <Field label="Confirm New Password">
              <Input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Confirm new password"
                required
              />
            </Field>
          </div>

          {passwordMsg && <Feedback msg={passwordMsg} />}

          <div className="flex justify-end">
            <Button
              type="submit"
              variant="primary"
              disabled={updatingPassword}>
              {updatingPassword ? "Updating..." : "Update Password"}
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-sm font-[500] text-gray-700 mb-1.5">
        {label}
      </label>
      {children}
    </div>
  );
}

function Feedback({ msg }: { msg: NonNullable<Msg> }) {
  return (
    <div
      className={`px-4 py-3 rounded-xl text-sm ${
        msg.type === "success"
          ? "bg-green-50 text-green-800 border border-green-200"
          : "bg-red-50 text-red-800 border border-red-200"
      }`}>
      {msg.text}
    </div>
  );
}
