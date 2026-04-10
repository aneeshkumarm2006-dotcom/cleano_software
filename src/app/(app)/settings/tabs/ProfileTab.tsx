"use client";

import { useState } from "react";
import { User as UserIcon, KeyRound } from "lucide-react";
import Input from "@/components/ui/Input";
import Button from "@/components/ui/Button";
import {
  updateUserSettings,
  updateUserPassword,
} from "../../actions/updateUserSettings";
import { SettingsUser } from "../types";
import { SectionCard, Field, Feedback, Msg } from "./_shared";

interface ProfileTabProps {
  user: SettingsUser;
}

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
      <SectionCard
        title="Profile Information"
        description="Update your name, email, and contact details."
        icon={UserIcon}>
        <form onSubmit={handleProfileUpdate} className="space-y-4">
          <Field label="Full Name">
            <Input
              variant="form"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Enter your full name"
              required
            />
          </Field>
          <Field label="Email Address">
            <Input
              variant="form"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Enter your email"
              required
            />
          </Field>
          <Field label="Phone Number">
            <Input
              variant="form"
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="Enter your phone number"
            />
          </Field>
          <Field
            label="Role"
            hint="Contact an administrator to change your role.">
            <div className="px-4 py-2.5 bg-[#005F6A]/5 rounded-2xl text-sm text-[#005F6A]">
              {user.role}
            </div>
          </Field>

          {profileMsg && <Feedback msg={profileMsg} />}

          <div className="flex justify-end">
            <Button
              type="submit"
              variant="action"
              border={false}
              disabled={updatingProfile}
              className="rounded-xl px-6 py-2.5">
              {updatingProfile ? "Updating..." : "Update Profile"}
            </Button>
          </div>
        </form>
      </SectionCard>

      <SectionCard
        title="Change Password"
        description="Use a strong password you don't reuse elsewhere."
        icon={KeyRound}>
        <form onSubmit={handlePasswordUpdate} className="space-y-4">
          <Field label="Current Password">
            <Input
              variant="form"
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              placeholder="Enter current password"
              required
            />
          </Field>
          <Field
            label="New Password"
            hint="Must be at least 8 characters.">
            <Input
              variant="form"
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="Enter new password"
              required
            />
          </Field>
          <Field label="Confirm New Password">
            <Input
              variant="form"
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Confirm new password"
              required
            />
          </Field>

          {passwordMsg && <Feedback msg={passwordMsg} />}

          <div className="flex justify-end">
            <Button
              type="submit"
              variant="action"
              border={false}
              disabled={updatingPassword}
              className="rounded-xl px-6 py-2.5">
              {updatingPassword ? "Updating..." : "Update Password"}
            </Button>
          </div>
        </form>
      </SectionCard>
    </div>
  );
}
