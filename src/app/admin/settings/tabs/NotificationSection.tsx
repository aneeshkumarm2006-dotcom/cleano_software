"use client";

import { useEffect, useState } from "react";
import { Bell } from "lucide-react";
import {
  getNotificationPrefs,
  updateNotificationPrefs,
} from "../../actions/updateNotificationPrefs";
import {
  DEFAULT_NOTIFICATION_PREFS,
  type NotificationPrefs,
} from "../../actions/notificationPrefsConstants";
import { SectionCard, Feedback, Msg } from "./_shared";

interface ToggleRow {
  key: keyof NotificationPrefs;
  label: string;
  description: string;
}

const ROWS: ToggleRow[] = [
  {
    key: "newJob",
    label: "New job assigned",
    description: "When a new job is assigned to you.",
  },
  {
    key: "jobReminder",
    label: "Job reminders",
    description: "Reminder before an upcoming job.",
  },
  {
    key: "payProcessed",
    label: "Pay processed",
    description: "When a payout is approved or paid.",
  },
  {
    key: "ratingReceived",
    label: "Rating received",
    description: "When a client or admin rates your work.",
  },
  {
    key: "documentToSign",
    label: "Document to sign",
    description: "When you have a new document awaiting signature.",
  },
  {
    key: "trainingAssigned",
    label: "Training assigned",
    description: "When a new training module is required.",
  },
  {
    key: "multiplierChange",
    label: "Multiplier change",
    description: "When your pay rate multiplier changes tiers.",
  },
  {
    key: "lowInventory",
    label: "Low inventory",
    description: "When your assigned supplies run low.",
  },
  {
    key: "providerLowStock",
    label: "Provider low stock",
    description: "When a cleaner's product stock crosses the refill threshold.",
  },
  {
    key: "cleanerPayment",
    label: "Cleaner payment scheduled or completed",
    description: "When a regular payout is scheduled, approved, or paid out.",
  },
  {
    key: "immediatePayout",
    label: "Immediate payout",
    description: "When an immediate payout / withdrawal is requested or sent.",
  },
  {
    key: "latePayment",
    label: "Late payment",
    description: "When an invoice becomes overdue and escalates.",
  },
  {
    key: "clientComplaint",
    label: "Client complaint",
    description: "When a new client complaint is filed.",
  },
  {
    key: "ratingDecrease",
    label: "Rating decrease",
    description: "When your 30-day rating tier drops to a lower multiplier.",
  },
  {
    key: "overdueCommercial",
    label: "Overdue commercial invoice",
    description: "When a commercial client invoice passes its due date.",
  },
];

interface NotificationSectionProps {
  employeeId?: string;
}

export default function NotificationSection({
  employeeId,
}: NotificationSectionProps) {
  const [prefs, setPrefs] = useState<NotificationPrefs>(
    DEFAULT_NOTIFICATION_PREFS
  );
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      const res = await getNotificationPrefs(employeeId);
      if (cancelled) return;
      if (res.success) {
        setPrefs(res.prefs);
      } else {
        setMsg({ type: "error", text: res.error });
      }
      setLoading(false);
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [employeeId]);

  async function handleSave() {
    setSaving(true);
    setMsg(null);
    const res = await updateNotificationPrefs({ employeeId, prefs });
    if (res.success) {
      setMsg({ type: "success", text: "Notification preferences saved." });
    } else {
      setMsg({ type: "error", text: res.error || "Failed to save." });
    }
    setSaving(false);
  }

  function toggle(key: keyof NotificationPrefs) {
    setPrefs((p) => ({ ...p, [key]: !p[key] }));
  }

  return (
    <SectionCard
      title="Notification Preferences"
      description="Choose which notifications you want to receive."
      icon={Bell}>
      {loading ? (
        <p style={{ fontSize: 13, color: "var(--primary-60)" }}>Loading preferences...</p>
      ) : (
        <>
          {ROWS.map((row) => (
            <div className="cl-notif-row" key={row.key}>
              <div className="meta">
                <div className="name">{row.label}</div>
                <div className="desc">{row.description}</div>
              </div>
              <input
                type="checkbox"
                className="cl-checkbox"
                checked={prefs[row.key]}
                onChange={() => toggle(row.key)}
                aria-label={row.label}
              />
            </div>
          ))}
          {msg && <Feedback msg={msg} />}
          <div className="cl-form-actions" style={{ marginTop: 14 }}>
            <button type="button" className="cl-form-save" disabled={saving} onClick={handleSave}>
              {saving ? "Saving..." : "Save preferences"}
            </button>
          </div>
        </>
      )}
    </SectionCard>
  );
}
