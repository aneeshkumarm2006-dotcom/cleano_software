"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Send,
  Users,
  Plus,
  Trash2,
  MessageCircle,
  Settings2,
  UserPlus,
  X,
} from "lucide-react";
import useSWR from "swr";
import {
  listGroupChannels,
  getGroupMessages,
  sendGroupMessage,
  createGroupChannel,
  deleteGroupMessage,
  listCleanersForChannel,
  getChannelMembers,
  addChannelMember,
  removeChannelMember,
  getTeamChatSettings,
  updateTeamChatSettings,
  markChannelRead,
  type GroupChannelDTO,
  type GroupMessageDTO,
  type TeamChatSettingsDTO,
} from "@/app/cleaners/group-chat/groupChat";

interface AdminGroupChatClientProps {
  initialChannels: GroupChannelDTO[];
  initialChannelId: string | null;
  initialMessages: GroupMessageDTO[];
  currentUserId: string;
}

function timeOnly(iso: string) {
  return new Date(iso).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
}

function dayLabel(d: Date) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const t = new Date(d);
  t.setHours(0, 0, 0, 0);
  const diff = Math.round((today.getTime() - t.getTime()) / 86400000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Yesterday";
  if (diff < 7) return d.toLocaleDateString("en-US", { weekday: "long" });
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function groupByDay(messages: GroupMessageDTO[]) {
  const groups: { label: string; messages: GroupMessageDTO[] }[] = [];
  let currentKey = "";
  for (const m of messages) {
    const d = new Date(m.createdAt);
    const key = d.toDateString();
    if (key !== currentKey) {
      currentKey = key;
      groups.push({ label: dayLabel(d), messages: [m] });
    } else {
      groups[groups.length - 1].messages.push(m);
    }
  }
  return groups;
}

export default function AdminGroupChatClient({
  initialChannels,
  initialChannelId,
  initialMessages,
  currentUserId,
}: AdminGroupChatClientProps) {
  const [activeChannelId, setActiveChannelId] = useState<string | null>(
    initialChannelId
  );
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [newChannelName, setNewChannelName] = useState("");
  const [newChannelMemberIds, setNewChannelMemberIds] = useState<string[]>([]);
  const [membersOpen, setMembersOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const { data: channels, mutate: mutateChannels } = useSWR<GroupChannelDTO[]>(
    "admin-group-channels",
    async () => {
      const res = await listGroupChannels();
      if (!res.success) throw new Error(res.error);
      return res.data;
    },
    { fallbackData: initialChannels, refreshInterval: 15000 }
  );

  const channelList = channels ?? initialChannels;
  const activeChannel =
    channelList.find((c) => c.id === activeChannelId) ?? channelList[0] ?? null;
  const isCustomChannel =
    !!activeChannel && !activeChannel.isDefault && !activeChannel.isDirect;

  // Active cleaners — candidates for the create picker and member editor.
  const { data: candidates } = useSWR(
    creating || membersOpen ? "chat-cleaner-candidates" : null,
    async () => {
      const res = await listCleanersForChannel();
      if (!res.success) throw new Error(res.error);
      return res.data;
    }
  );

  // Member list of the active custom channel (member editor).
  const { data: channelMembers, mutate: mutateMembers } = useSWR(
    membersOpen && isCustomChannel
      ? ["channel-members", activeChannel!.id]
      : null,
    async () => {
      const res = await getChannelMembers(activeChannel!.id);
      if (!res.success) throw new Error(res.error);
      return res.data;
    }
  );

  // Team-chat settings (DM toggle + contact-info visibility).
  const { data: chatSettings, mutate: mutateSettings } =
    useSWR<TeamChatSettingsDTO>("team-chat-settings", async () => {
      const res = await getTeamChatSettings();
      if (!res.success) throw new Error(res.error);
      return res.data;
    });

  const { data: messages, mutate } = useSWR<GroupMessageDTO[]>(
    activeChannel ? ["admin-group-messages", activeChannel.id] : null,
    async () => {
      const res = await getGroupMessages(activeChannel!.id);
      if (!res.success) throw new Error(res.error);
      return res.data;
    },
    {
      fallbackData:
        activeChannel?.id === initialChannelId ? initialMessages : undefined,
      refreshInterval: 3000,
      revalidateOnFocus: true,
    }
  );

  const msgs = messages ?? [];
  const grouped = useMemo(() => groupByDay(msgs), [msgs]);

  useEffect(() => {
    function scrollToBottom() {
      const el = scrollRef.current;
      if (!el) return;
      el.scrollTop = el.scrollHeight;
      bottomRef.current?.scrollIntoView({ block: "end" });
    }
    requestAnimationFrame(scrollToBottom);
  }, [msgs.length, activeChannel?.id]);

  // Close the member editor when switching channels.
  useEffect(() => {
    setMembersOpen(false);
  }, [activeChannel?.id]);

  // Mark the open channel read (clears its unread badge) on open and as new
  // messages arrive. Team-chat read state is tracked separately from job chat.
  useEffect(() => {
    if (!activeChannel) return;
    let cancelled = false;
    markChannelRead(activeChannel.id).then((res) => {
      if (!cancelled && res.success) mutateChannels();
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeChannel?.id, msgs.length]);

  async function handleSend() {
    const body = draft.trim();
    if (!body || !activeChannel || sending) return;
    setError(null);
    setSending(true);
    setDraft("");
    const res = await sendGroupMessage(activeChannel.id, body);
    setSending(false);
    if (!res.success) {
      setDraft(body);
      setError(res.error);
      return;
    }
    await mutate();
  }

  async function handleCreateChannel() {
    const name = newChannelName.trim();
    if (!name) return;
    setError(null);
    const res = await createGroupChannel(name, newChannelMemberIds);
    if (!res.success) {
      setError(res.error);
      return;
    }
    setNewChannelName("");
    setNewChannelMemberIds([]);
    setCreating(false);
    await mutateChannels();
    setActiveChannelId(res.data.id);
  }

  function toggleNewChannelMember(userId: string) {
    setNewChannelMemberIds((prev) =>
      prev.includes(userId)
        ? prev.filter((id) => id !== userId)
        : [...prev, userId]
    );
  }

  async function handleAddMember(userId: string) {
    if (!activeChannel) return;
    setError(null);
    const res = await addChannelMember(activeChannel.id, userId);
    if (!res.success) {
      setError(res.error);
      return;
    }
    await mutateMembers();
  }

  async function handleRemoveMember(userId: string) {
    if (!activeChannel) return;
    setError(null);
    const res = await removeChannelMember(activeChannel.id, userId);
    if (!res.success) {
      setError(res.error);
      return;
    }
    await mutateMembers();
  }

  async function handleToggleSetting(key: keyof TeamChatSettingsDTO) {
    if (!chatSettings || savingSettings) return;
    setError(null);
    setSavingSettings(true);
    const res = await updateTeamChatSettings({ [key]: !chatSettings[key] });
    setSavingSettings(false);
    if (!res.success) {
      setError(res.error);
      return;
    }
    await mutateSettings(res.data, { revalidate: false });
  }

  async function handleDelete(messageId: string) {
    if (!confirm("Delete this message? Cleaners will no longer see it.")) return;
    setError(null);
    // Optimistic removal
    await mutate((cur) => (cur ? cur.filter((m) => m.id !== messageId) : cur), {
      revalidate: false,
    });
    const res = await deleteGroupMessage(messageId);
    if (!res.success) {
      setError(res.error);
    }
    await mutate();
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  return (
    <div style={{ padding: "clamp(20px,4vw,32px)", height: "100%", display: "flex", flexDirection: "column" }}>
      {/* Header */}
      <div style={{ flexShrink: 0, marginBottom: 20, display: "flex", alignItems: "flex-end", gap: 16, flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 240 }}>
          <p className="eyebrow" style={{ textTransform: "uppercase" }}>Cleaner community</p>
          <h1 className="display" style={{ fontSize: "clamp(28px,3vw,40px)", marginTop: 6 }}>
            Group chat.
          </h1>
          <p style={{ fontSize: 14, color: "var(--primary-60)", margin: "6px 0 0" }}>
            Post announcements, manage channels, and moderate crew messages.
          </p>
        </div>

        {/* Team-chat settings (inline popover, not a Settings tab) */}
        <div style={{ position: "relative" }}>
          <button
            onClick={() => setSettingsOpen((o) => !o)}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              padding: "9px 14px",
              borderRadius: 10,
              border: "1px solid rgba(0,140,156,0.2)",
              cursor: "pointer",
              background: settingsOpen ? "var(--primary)" : "#fff",
              color: settingsOpen ? "#fff" : "var(--primary-70)",
              fontSize: 13,
              fontWeight: 600,
            }}>
            <Settings2 size={15} />
            Chat settings
          </button>
          {settingsOpen && (
            <div
              style={{
                position: "absolute",
                right: 0,
                top: "calc(100% + 8px)",
                zIndex: 20,
                width: 280,
                background: "#fff",
                border: "1px solid rgba(0,140,156,0.15)",
                borderRadius: 12,
                boxShadow: "0 8px 32px rgba(0,140,156,0.15)",
                padding: 14,
                display: "flex",
                flexDirection: "column",
                gap: 12,
              }}>
              {(
                [
                  {
                    key: "dmEnabled" as const,
                    label: "Cleaner-to-cleaner DMs",
                    hint: "Cleaners can start private 1:1 chats.",
                  },
                  {
                    key: "showContactInfo" as const,
                    label: "Show contact info",
                    hint: "Phone/email visible in the cleaner directory.",
                  },
                ]
              ).map((s) => {
                const on = chatSettings ? chatSettings[s.key] : null;
                return (
                  <label
                    key={s.key}
                    style={{ display: "flex", alignItems: "flex-start", gap: 10, cursor: chatSettings ? "pointer" : "default" }}>
                    <button
                      onClick={() => handleToggleSetting(s.key)}
                      disabled={!chatSettings || savingSettings}
                      aria-label={s.label}
                      style={{
                        width: 36,
                        height: 20,
                        borderRadius: 999,
                        border: "none",
                        cursor: "pointer",
                        flexShrink: 0,
                        marginTop: 2,
                        position: "relative",
                        background: on ? "var(--primary)" : "rgba(0,140,156,0.18)",
                        opacity: chatSettings ? 1 : 0.5,
                        transition: "background 0.15s",
                      }}>
                      <span
                        style={{
                          position: "absolute",
                          top: 2,
                          left: on ? 18 : 2,
                          width: 16,
                          height: 16,
                          borderRadius: "50%",
                          background: "#fff",
                          transition: "left 0.15s",
                        }}
                      />
                    </button>
                    <span>
                      <span style={{ display: "block", fontSize: 13, fontWeight: 600, color: "var(--ink)" }}>
                        {s.label}
                      </span>
                      <span style={{ display: "block", fontSize: 12, color: "var(--primary-50)" }}>
                        {s.hint}
                      </span>
                    </span>
                  </label>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {error && (
        <div
          style={{
            fontSize: 13,
            color: "#dc2626",
            background: "#fef2f2",
            border: "1px solid #fecaca",
            borderRadius: 8,
            padding: "8px 12px",
            marginBottom: 12,
            flexShrink: 0,
          }}>
          {error}
        </div>
      )}

      <div
        className="stack-mobile"
        style={{
          flex: 1,
          minHeight: 0,
          display: "grid",
          gridTemplateColumns: "minmax(200px, 260px) 1fr",
          gap: 16,
        }}>
        {/* Channel list */}
        <div
          style={{
            background: "#fff",
            borderRadius: 16,
            border: "1px solid rgba(0,140,156,0.10)",
            padding: 12,
            display: "flex",
            flexDirection: "column",
            gap: 6,
            overflowY: "auto",
          }}>
          <div
            style={{
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: "0.05em",
              textTransform: "uppercase",
              color: "var(--primary-50)",
              padding: "4px 8px",
            }}>
            Channels
          </div>
          {channelList.map((c) => {
            const active = c.id === activeChannel?.id;
            return (
              <button
                key={c.id}
                onClick={() => setActiveChannelId(c.id)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "9px 12px",
                  borderRadius: 10,
                  border: "none",
                  cursor: "pointer",
                  textAlign: "left",
                  fontSize: 14,
                  fontWeight: 600,
                  background: active ? "var(--primary)" : "transparent",
                  color: active ? "#fff" : "var(--primary-70)",
                }}>
                {c.isDirect ? <MessageCircle size={15} /> : <Users size={15} />}
                <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {c.name}
                </span>
                {!active && c.unreadCount > 0 && (
                  <span
                    aria-label={`${c.unreadCount} unread`}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      minWidth: 18,
                      height: 18,
                      padding: "0 5px",
                      borderRadius: 999,
                      background: "#ef4444",
                      color: "#fff",
                      fontSize: 11,
                      fontWeight: 700,
                    }}>
                    {c.unreadCount > 99 ? "99+" : c.unreadCount}
                  </span>
                )}
                {(c.isDefault || c.isDirect) && (
                  <span
                    style={{
                      fontSize: 10,
                      fontWeight: 700,
                      padding: "2px 6px",
                      borderRadius: 999,
                      background: active ? "rgba(255,255,255,0.2)" : "rgba(0,140,156,0.1)",
                      color: active ? "#fff" : "var(--primary)",
                    }}>
                    {c.isDefault ? "Default" : "DM"}
                  </span>
                )}
              </button>
            );
          })}

          {/* Create channel */}
          {creating ? (
            <div style={{ padding: "8px 4px", display: "flex", flexDirection: "column", gap: 8 }}>
              <input
                autoFocus
                value={newChannelName}
                onChange={(e) => setNewChannelName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleCreateChannel();
                  if (e.key === "Escape") {
                    setCreating(false);
                    setNewChannelName("");
                    setNewChannelMemberIds([]);
                  }
                }}
                placeholder="Channel name"
                maxLength={60}
                style={{
                  padding: "8px 10px",
                  borderRadius: 8,
                  border: "1px solid rgba(0,140,156,0.25)",
                  fontSize: 13,
                  outline: "none",
                }}
              />
              {/* Member picker — cleaners who can see this channel */}
              <div
                style={{
                  border: "1px solid rgba(0,140,156,0.15)",
                  borderRadius: 8,
                  maxHeight: 160,
                  overflowY: "auto",
                  padding: 6,
                  display: "flex",
                  flexDirection: "column",
                  gap: 2,
                }}>
                <div
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    letterSpacing: "0.04em",
                    textTransform: "uppercase",
                    color: "var(--primary-50)",
                    padding: "2px 6px 4px",
                  }}>
                  Members ({newChannelMemberIds.length})
                </div>
                {!candidates ? (
                  <div style={{ fontSize: 12, color: "var(--primary-50)", padding: "2px 6px" }}>
                    Loading cleaners…
                  </div>
                ) : candidates.length === 0 ? (
                  <div style={{ fontSize: 12, color: "var(--primary-50)", padding: "2px 6px" }}>
                    No active cleaners.
                  </div>
                ) : (
                  candidates.map((u) => (
                    <label
                      key={u.userId}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        padding: "5px 6px",
                        borderRadius: 6,
                        cursor: "pointer",
                        fontSize: 13,
                        color: "var(--primary-70)",
                      }}>
                      <input
                        type="checkbox"
                        checked={newChannelMemberIds.includes(u.userId)}
                        onChange={() => toggleNewChannelMember(u.userId)}
                      />
                      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {u.name}
                      </span>
                    </label>
                  ))
                )}
              </div>
              <div style={{ display: "flex", gap: 6 }}>
                <button
                  onClick={handleCreateChannel}
                  disabled={!newChannelName.trim()}
                  style={{
                    flex: 1,
                    padding: "7px 10px",
                    borderRadius: 8,
                    border: "none",
                    cursor: "pointer",
                    background: "var(--primary)",
                    color: "#fff",
                    fontSize: 13,
                    fontWeight: 600,
                    opacity: newChannelName.trim() ? 1 : 0.5,
                  }}>
                  Create
                </button>
                <button
                  onClick={() => {
                    setCreating(false);
                    setNewChannelName("");
                    setNewChannelMemberIds([]);
                  }}
                  style={{
                    padding: "7px 10px",
                    borderRadius: 8,
                    border: "1px solid rgba(0,140,156,0.2)",
                    cursor: "pointer",
                    background: "#fff",
                    color: "var(--primary-70)",
                    fontSize: 13,
                  }}>
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setCreating(true)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "9px 12px",
                borderRadius: 10,
                border: "1px dashed rgba(0,140,156,0.3)",
                cursor: "pointer",
                background: "transparent",
                color: "var(--primary)",
                fontSize: 13,
                fontWeight: 600,
                marginTop: 4,
              }}>
              <Plus size={15} />
              New channel
            </button>
          )}
        </div>

        {/* Messages panel */}
        <div
          style={{
            background: "#fff",
            borderRadius: 16,
            border: "1px solid rgba(0,140,156,0.10)",
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
            minHeight: 0,
          }}>
          {/* Thread header */}
          <div className="chat-thread-head">
            <div className="chat-avatar-wrap">
              <div
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: "50%",
                  background: "var(--primary)",
                  color: "#fff",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                }}>
                {activeChannel?.isDirect ? <MessageCircle size={20} /> : <Users size={20} />}
              </div>
            </div>
            <div className="thread-meta">
              <div className="thread-name">
                {activeChannel?.name ?? "Group chat"}
                <span className="chat-role-pill">Moderating</span>
              </div>
              <div className="thread-role">
                {activeChannel?.isDirect
                  ? "Private 1:1 conversation"
                  : activeChannel?.isDefault
                    ? "Visible to all cleaners"
                    : "Visible to members only"}
              </div>
            </div>
            {isCustomChannel && (
              <button
                onClick={() => setMembersOpen((o) => !o)}
                style={{
                  marginLeft: "auto",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "7px 12px",
                  borderRadius: 999,
                  border: "1px solid rgba(0,140,156,0.2)",
                  cursor: "pointer",
                  background: membersOpen ? "var(--primary)" : "#fff",
                  color: membersOpen ? "#fff" : "var(--primary-70)",
                  fontSize: 12.5,
                  fontWeight: 600,
                  flexShrink: 0,
                }}>
                <UserPlus size={14} />
                Members
              </button>
            )}
          </div>

          {/* Member editor for custom channels */}
          {membersOpen && isCustomChannel && (
            <div
              style={{
                borderBottom: "1px solid rgba(0,140,156,0.10)",
                padding: "12px 24px",
                display: "flex",
                flexDirection: "column",
                gap: 10,
                background: "rgba(0,140,156,0.03)",
                flexShrink: 0,
              }}>
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  letterSpacing: "0.05em",
                  textTransform: "uppercase",
                  color: "var(--primary-50)",
                }}>
                Channel members
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {!channelMembers ? (
                  <span style={{ fontSize: 12, color: "var(--primary-50)" }}>Loading…</span>
                ) : channelMembers.length === 0 ? (
                  <span style={{ fontSize: 12, color: "var(--primary-50)" }}>
                    No members yet — only admins can see this channel.
                  </span>
                ) : (
                  channelMembers.map((m) => (
                    <span
                      key={m.userId}
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 6,
                        padding: "4px 8px 4px 12px",
                        borderRadius: 999,
                        background: "#fff",
                        border: "1px solid rgba(0,140,156,0.18)",
                        fontSize: 12.5,
                        fontWeight: 600,
                        color: "var(--primary-70)",
                      }}>
                      {m.name}
                      <button
                        onClick={() => handleRemoveMember(m.userId)}
                        title={`Remove ${m.name}`}
                        style={{
                          background: "none",
                          border: "none",
                          cursor: "pointer",
                          color: "var(--primary-40)",
                          padding: 2,
                          display: "flex",
                        }}>
                        <X size={13} />
                      </button>
                    </span>
                  ))
                )}
              </div>
              <select
                value=""
                onChange={(e) => {
                  if (e.target.value) handleAddMember(e.target.value);
                }}
                style={{
                  alignSelf: "flex-start",
                  padding: "7px 10px",
                  borderRadius: 8,
                  border: "1px solid rgba(0,140,156,0.25)",
                  fontSize: 13,
                  color: "var(--primary-70)",
                  background: "#fff",
                  outline: "none",
                }}>
                <option value="">Add a cleaner…</option>
                {(candidates ?? [])
                  .filter(
                    (u) => !(channelMembers ?? []).some((m) => m.userId === u.userId)
                  )
                  .map((u) => (
                    <option key={u.userId} value={u.userId}>
                      {u.name}
                    </option>
                  ))}
              </select>
            </div>
          )}

          {/* Messages */}
          <div
            ref={scrollRef}
            style={{
              flex: 1,
              overflowY: "auto",
              padding: "20px 24px",
              display: "flex",
              flexDirection: "column",
              gap: 3,
              background: "var(--cream)",
            }}>
            {grouped.length === 0 ? (
              <div style={{ margin: "auto", textAlign: "center", color: "var(--primary-50)" }}>
                <div
                  style={{
                    width: 56,
                    height: 56,
                    borderRadius: "50%",
                    background: "rgba(0,140,156,0.06)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    margin: "0 auto 14px",
                  }}>
                  <MessageCircle size={22} color="var(--primary-40)" />
                </div>
                <p style={{ fontSize: 14, fontWeight: 500, color: "var(--primary-70)", margin: 0 }}>
                  No messages yet
                </p>
              </div>
            ) : (
              grouped.map((group, gi) => (
                <div key={gi}>
                  <div className="chat-day-divider">{group.label}</div>
                  {group.messages.map((m) => {
                    const mine = m.senderId === currentUserId;
                    return (
                      <div
                        key={m.id}
                        className={`chat-msg ${mine ? "mine" : "theirs"}`}
                        style={{ marginTop: 4, alignItems: "center", gap: 6 }}>
                        {mine && (
                          <button
                            onClick={() => handleDelete(m.id)}
                            title="Delete message"
                            style={{
                              order: -1,
                              background: "none",
                              border: "none",
                              cursor: "pointer",
                              color: "var(--primary-40)",
                              padding: 4,
                              display: "flex",
                            }}>
                            <Trash2 size={14} />
                          </button>
                        )}
                        <div className="chat-msg-bubble">
                          {!mine && <div className="chat-msg-author">{m.senderName}</div>}
                          {m.body && <div>{m.body}</div>}
                          <div className="chat-msg-time">{timeOnly(m.createdAt)}</div>
                        </div>
                        {!mine && (
                          <button
                            onClick={() => handleDelete(m.id)}
                            title="Delete message"
                            style={{
                              background: "none",
                              border: "none",
                              cursor: "pointer",
                              color: "var(--primary-40)",
                              padding: 4,
                              display: "flex",
                            }}>
                            <Trash2 size={14} />
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              ))
            )}
            <div ref={bottomRef} aria-hidden="true" />
          </div>

          {/* Composer */}
          <div className="chat-composer">
            <div className="chat-composer-row">
              <textarea
                rows={1}
                value={draft}
                onChange={(e) => {
                  setDraft(e.target.value);
                  const t = e.target;
                  t.style.height = "auto";
                  t.style.height = Math.min(t.scrollHeight, 120) + "px";
                }}
                onKeyDown={handleKeyDown}
                placeholder={`Message ${activeChannel?.name ?? "the crew"}…`}
              />
              <button
                className="chat-send"
                onClick={handleSend}
                disabled={sending || draft.trim().length === 0}
                aria-label="Send">
                <Send size={14} />
              </button>
            </div>
            <div className="chat-composer-hint">⏎ to send · ⇧⏎ for new line</div>
          </div>
        </div>
      </div>
    </div>
  );
}
