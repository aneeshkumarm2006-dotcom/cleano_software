"use client";

import { useMemo, useState, useTransition } from "react";
import { Bell, Mail, MessageSquare, Smartphone, RefreshCw } from "lucide-react";
import {
  toggleNotificationSetting,
  bulkSetNotificationCategory,
  reseedNotificationCatalog,
} from "../../actions/notificationSettings";

type Recipient = "ADMIN" | "CUSTOMER" | "PROVIDER";
type Channel = "EMAIL" | "SMS" | "APP_PUSH";

export interface NotificationSettingRow {
  id: string;
  recipient: Recipient;
  category: string;
  key: string;
  label: string;
  trigger: string;
  channel: Channel;
  enabled: boolean;
  isProposed: boolean;
  sortOrder: number;
}

interface NotificationsTabProps {
  settings: NotificationSettingRow[];
}

const RECIPIENT_LABELS: Record<Recipient, string> = {
  ADMIN: "Admin",
  CUSTOMER: "Customer",
  PROVIDER: "Provider",
};

const CHANNEL_ICON: Record<Channel, typeof Mail> = {
  EMAIL: Mail,
  SMS: MessageSquare,
  APP_PUSH: Smartphone,
};

const CHANNEL_LABEL: Record<Channel, string> = {
  EMAIL: "Email",
  SMS: "SMS",
  APP_PUSH: "App / Push",
};

export default function NotificationsTab({ settings }: NotificationsTabProps) {
  const [rows, setRows] = useState(settings);
  const [reseeding, startReseeding] = useTransition();
  const [reseedMsg, setReseedMsg] = useState<string | null>(null);
  const [activeRecipient, setActiveRecipient] = useState<Recipient>("ADMIN");

  // Group by recipient → category → notification key.
  const grouped = useMemo(() => {
    type Notification = {
      key: string;
      label: string;
      trigger: string;
      isProposed: boolean;
      sortOrder: number;
      channels: Partial<Record<Channel, NotificationSettingRow>>;
    };
    const byRecipient = new Map<Recipient, Map<string, Map<string, Notification>>>();
    for (const row of rows) {
      if (!byRecipient.has(row.recipient)) byRecipient.set(row.recipient, new Map());
      const cats = byRecipient.get(row.recipient)!;
      if (!cats.has(row.category)) cats.set(row.category, new Map());
      const notifs = cats.get(row.category)!;
      const existing = notifs.get(row.key);
      const n: Notification = existing ?? {
        key: row.key,
        label: row.label,
        trigger: row.trigger,
        isProposed: row.isProposed,
        sortOrder: row.sortOrder,
        channels: {},
      };
      n.channels[row.channel] = row;
      notifs.set(row.key, n);
    }
    return byRecipient;
  }, [rows]);

  function setRowEnabled(id: string, enabled: boolean) {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, enabled } : r)));
  }

  async function handleToggle(row: NotificationSettingRow, next: boolean) {
    setRowEnabled(row.id, next);
    const res = await toggleNotificationSetting(row.id, next);
    if (!("success" in res) || !res.success) {
      // revert on failure
      setRowEnabled(row.id, !next);
    }
  }

  async function handleBulkCategory(
    recipient: Recipient,
    category: string,
    channel: Channel,
    enabled: boolean
  ) {
    // Optimistic update
    setRows((prev) =>
      prev.map((r) =>
        r.recipient === recipient && r.category === category && r.channel === channel
          ? { ...r, enabled }
          : r
      )
    );
    await bulkSetNotificationCategory(recipient, category, channel, enabled);
  }

  function handleReseed() {
    startReseeding(async () => {
      setReseedMsg(null);
      const res = await reseedNotificationCatalog();
      if ("success" in res && res.success) {
        setReseedMsg(`Catalog refreshed — ${res.inserted} new, ${res.total} total.`);
        // Soft reload to refresh
        window.location.reload();
      } else {
        setReseedMsg(("error" in res && res.error) || "Failed to reseed");
      }
    });
  }

  const recipients: Recipient[] = ["ADMIN", "CUSTOMER", "PROVIDER"];
  const categoriesForActive = grouped.get(activeRecipient);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="rounded-2xl border border-[#008C9C]/10 bg-white p-5 shadow-sm">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-[#008C9C]/8 flex items-center justify-center flex-shrink-0">
            <Bell className="w-5 h-5 text-[#008C9C]" />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-base font-semibold text-[#003C46]">Notifications</h2>
            <p className="text-sm text-[#008C9C]/70 mt-1">
              Decide who gets notified, on which channel, for every event in the system.
              Changes save automatically.
            </p>
          </div>
          <button
            type="button"
            onClick={handleReseed}
            disabled={reseeding}
            className="inline-flex items-center gap-2 text-xs font-semibold text-[#008C9C] bg-[#008C9C]/8 hover:bg-[#008C9C]/14 px-3 py-2 rounded-lg disabled:opacity-50">
            <RefreshCw className={`w-3.5 h-3.5 ${reseeding ? "animate-spin" : ""}`} />
            {reseeding ? "Refreshing…" : "Refresh catalog"}
          </button>
        </div>
        {reseedMsg && (
          <p className="text-xs text-[#008C9C]/70 mt-3">{reseedMsg}</p>
        )}
      </div>

      {/* Recipient tabs */}
      <div className="flex gap-2 border-b border-[#008C9C]/10">
        {recipients.map((r) => {
          const count = grouped.get(r) ? Array.from(grouped.get(r)!.values()).reduce((s, m) => s + m.size, 0) : 0;
          const active = activeRecipient === r;
          return (
            <button
              key={r}
              type="button"
              onClick={() => setActiveRecipient(r)}
              className={`px-4 py-2.5 text-sm font-semibold border-b-2 transition-colors ${
                active
                  ? "border-[#008C9C] text-[#008C9C]"
                  : "border-transparent text-[#008C9C]/55 hover:text-[#008C9C]"
              }`}>
              {RECIPIENT_LABELS[r]}
              <span
                className={`ml-1.5 text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
                  active ? "bg-[#008C9C] text-white" : "bg-[#008C9C]/8 text-[#008C9C]/70"
                }`}>
                {count}
              </span>
            </button>
          );
        })}
      </div>

      {/* Categories */}
      {!categoriesForActive || categoriesForActive.size === 0 ? (
        <div className="text-sm text-[#008C9C]/60 p-6 text-center">
          No notifications seeded yet. Click <strong>Refresh catalog</strong> above to seed defaults.
        </div>
      ) : (
        Array.from(categoriesForActive.entries())
          .sort(
            ([, a], [, b]) =>
              Math.min(...Array.from(a.values()).map((n) => n.sortOrder)) -
              Math.min(...Array.from(b.values()).map((n) => n.sortOrder))
          )
          .map(([category, notifs]) => {
            const notifsArr = Array.from(notifs.values()).sort(
              (a, b) => a.sortOrder - b.sortOrder
            );
            const channelsPresent: Channel[] = ["EMAIL", "SMS", "APP_PUSH"].filter((c) =>
              notifsArr.some((n) => n.channels[c as Channel])
            ) as Channel[];
            return (
              <div
                key={category}
                className="rounded-2xl border border-[#008C9C]/10 bg-white overflow-hidden shadow-sm">
                <div className="px-5 py-3 bg-[#008C9C]/4 border-b border-[#008C9C]/10 flex items-center justify-between gap-3">
                  <h3 className="text-sm font-semibold text-[#003C46]">{category}</h3>
                  <div className="flex items-center gap-1.5">
                    {channelsPresent.map((channel) => {
                      const allOn = notifsArr.every(
                        (n) => n.channels[channel]?.enabled
                      );
                      return (
                        <button
                          key={channel}
                          type="button"
                          onClick={() =>
                            handleBulkCategory(activeRecipient, category, channel, !allOn)
                          }
                          className="text-[10px] font-semibold text-[#008C9C]/70 hover:text-[#008C9C] px-2 py-1 rounded-md hover:bg-[#008C9C]/8">
                          {allOn ? "Disable all" : "Enable all"} {CHANNEL_LABEL[channel]}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <ul className="divide-y divide-[#008C9C]/8">
                  {notifsArr.map((n) => (
                    <li key={n.key} className="px-5 py-3.5 flex items-start gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-medium text-[#003C46]">{n.label}</p>
                          {n.isProposed && (
                            <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-amber-100 text-amber-700">
                              PROPOSED
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-[#008C9C]/60 mt-0.5">{n.trigger}</p>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0 mt-0.5">
                        {(["EMAIL", "SMS", "APP_PUSH"] as Channel[]).map((channel) => {
                          const row = n.channels[channel];
                          if (!row) {
                            return (
                              <div
                                key={channel}
                                className="w-[88px] text-center text-[10px] text-[#008C9C]/30 py-1.5"
                                title="Channel not applicable">
                                —
                              </div>
                            );
                          }
                          const Icon = CHANNEL_ICON[channel];
                          return (
                            <button
                              key={channel}
                              type="button"
                              onClick={() => handleToggle(row, !row.enabled)}
                              className={`inline-flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1.5 rounded-lg border transition-colors min-w-[88px] justify-center ${
                                row.enabled
                                  ? "bg-emerald-50 border-emerald-200 text-emerald-700 hover:bg-emerald-100"
                                  : "bg-white border-[#008C9C]/15 text-[#008C9C]/45 hover:border-[#008C9C]/30"
                              }`}
                              title={`${CHANNEL_LABEL[channel]} — ${row.enabled ? "On" : "Off"}`}>
                              <Icon className="w-3.5 h-3.5" />
                              {row.enabled ? "On" : "Off"}
                            </button>
                          );
                        })}
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })
      )}
    </div>
  );
}
