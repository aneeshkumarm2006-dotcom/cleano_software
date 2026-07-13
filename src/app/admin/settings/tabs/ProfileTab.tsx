"use client";

import { useEffect, useState } from "react";
import {
  User as UserIcon,
  KeyRound,
  TrendingUp,
  DollarSign,
  Bell,
  Eye,
  EyeOff,
} from "lucide-react";
import {
  updateUserSettings,
  updateUserPassword,
} from "../../actions/updateUserSettings";
import { getPerformanceData } from "../../actions/getPerformanceData";
import { SettingsUser } from "../types";
import { SectionCard, Feedback, Msg } from "./_shared";
import PerformanceSection from "./PerformanceSection";
import IncomeSection from "./IncomeSection";
import NotificationSection from "./NotificationSection";

interface ProfileTabProps {
  user: SettingsUser;
}

type SubTab = "profile" | "performance" | "income" | "notifications";

const SUB_TABS: { id: SubTab; label: string; icon: typeof UserIcon }[] = [
  { id: "profile", label: "Profile", icon: UserIcon },
  { id: "performance", label: "Performance", icon: TrendingUp },
  { id: "income", label: "My Income", icon: DollarSign },
  { id: "notifications", label: "Notifications", icon: Bell },
];


function PerformanceHeader({ employeeId }: { employeeId?: string }) {
  const [rating, setRating] = useState<number | null>(null);
  const [multiplier, setMultiplier] = useState<number | null>(null);
  const [tier, setTier] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const res = await getPerformanceData({ employeeId });
      if (cancelled) return;
      if (res.success) {
        setRating(res.data.rating30Day);
        setMultiplier(res.data.currentMultiplier);
        setTier(res.data.tierLabel);
      }
      setLoading(false);
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [employeeId]);

  if (loading) return null;

  return (
    <div className="cl-perf-hero">
      <div className="cl-perf-hero-tile">
        <div className="label">30-day rating</div>
        <div className="val">{rating !== null ? rating.toFixed(2) : "—"}</div>
      </div>
      <div className="cl-perf-hero-tile">
        <div className="label">Pay multiplier</div>
        <div className="val">{multiplier !== null ? `${multiplier.toFixed(2)}×` : "—"}</div>
      </div>
      <div className="cl-perf-hero-tile">
        <div className="label">Tier</div>
        <div className="val">{tier ?? "—"}</div>
      </div>
    </div>
  );
}

function ProfileForms({ user }: { user: SettingsUser }) {
  const [name, setName] = useState(user.name);
  const [email, setEmail] = useState(user.email);
  const [phone, setPhone] = useState(user.phone || "");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

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
    <>
      <SectionCard
        title="Profile information"
        description="Update your name, email, and contact details."
        icon={UserIcon}>
        <form onSubmit={handleProfileUpdate}>
          <div className="cl-form-row">
            <label className="cl-form-label">Full name</label>
            <input className="cl-form-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Enter your full name" required />
          </div>
          <div className="cl-form-row">
            <label className="cl-form-label">Email address</label>
            <input className="cl-form-input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Enter your email" required />
          </div>
          <div className="cl-form-row">
            <label className="cl-form-label">Phone number</label>
            <input className="cl-form-input" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Enter your phone number" />
          </div>
          <div className="cl-form-row" style={{ marginBottom: 4 }}>
            <label className="cl-form-label">Role</label>
            <input className="cl-form-input" value={user.role} readOnly />
            <div className="cl-form-hint">Contact an administrator to change your role.</div>
          </div>
          {profileMsg && <Feedback msg={profileMsg} />}
          <div className="cl-form-actions">
            <button type="submit" className="cl-form-save" disabled={updatingProfile}>
              {updatingProfile ? "Updating..." : "Update profile"}
            </button>
          </div>
        </form>
      </SectionCard>

      <SectionCard
        title="Change password"
        description="Use a strong password you don't reuse elsewhere."
        icon={KeyRound}>
        <form onSubmit={handlePasswordUpdate}>
          <div className="cl-form-row">
            <label className="cl-form-label">Current password</label>
            <div style={{ position: "relative" }}>
              <input className="cl-form-input" type={showCurrent ? "text" : "password"} value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} placeholder="Enter current password" required style={{ paddingRight: 40 }} />
              <button type="button" onClick={() => setShowCurrent((v) => !v)} style={{ position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)", background: "none", border: 0, cursor: "pointer", color: "var(--primary-50)" }}>
                {showCurrent ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>
          <div className="cl-form-row">
            <label className="cl-form-label">New password</label>
            <div style={{ position: "relative" }}>
              <input className="cl-form-input" type={showNew ? "text" : "password"} value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder="Enter new password" required style={{ paddingRight: 40 }} />
              <button type="button" onClick={() => setShowNew((v) => !v)} style={{ position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)", background: "none", border: 0, cursor: "pointer", color: "var(--primary-50)" }}>
                {showNew ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            <div className="cl-form-hint">Must be at least 8 characters.</div>
          </div>
          <div className="cl-form-row">
            <label className="cl-form-label">Confirm new password</label>
            <div style={{ position: "relative" }}>
              <input className="cl-form-input" type={showConfirm ? "text" : "password"} value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} placeholder="Confirm new password" required style={{ paddingRight: 40 }} />
              <button type="button" onClick={() => setShowConfirm((v) => !v)} style={{ position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)", background: "none", border: 0, cursor: "pointer", color: "var(--primary-50)" }}>
                {showConfirm ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>
          {passwordMsg && <Feedback msg={passwordMsg} />}
          <div className="cl-form-actions">
            <button type="submit" className="cl-form-save" disabled={updatingPassword}>
              {updatingPassword ? "Updating..." : "Update password"}
            </button>
          </div>
        </form>
      </SectionCard>
    </>
  );
}

export default function ProfileTab({ user }: ProfileTabProps) {
  const [subTab, setSubTab] = useState<SubTab>("profile");
  const isEmployee = user.role === "EMPLOYEE";

  if (!isEmployee) {
    return <ProfileForms user={user} />;
  }

  return (
    <div>
      <PerformanceHeader />

      <div className="cl-settings-tabs">
        {SUB_TABS.map((t) => {
          const Icon = t.icon;
          const active = subTab === t.id;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setSubTab(t.id)}
              className={active ? "active" : ""}>
              <Icon className="w-[14px] h-[14px]" />
              {t.label}
            </button>
          );
        })}
      </div>

      {subTab === "profile" && <ProfileForms user={user} />}
      {subTab === "performance" && <PerformanceSection />}
      {subTab === "income" && <IncomeSection />}
      {/* Role drives which toggles are shown: a cleaner never sees admin/ops
          rows (provider low stock, late payment, complaints, overdue invoices). */}
      {subTab === "notifications" && <NotificationSection role={user.role} />}
    </div>
  );
}
