"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Send, Users, Plus, Trash2, MessageCircle } from "lucide-react";
import useSWR from "swr";
import {
  listGroupChannels,
  getGroupMessages,
  sendGroupMessage,
  createGroupChannel,
  deleteGroupMessage,
  type GroupChannelDTO,
  type GroupMessageDTO,
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
    const res = await createGroupChannel(name);
    if (!res.success) {
      setError(res.error);
      return;
    }
    setNewChannelName("");
    setCreating(false);
    await mutateChannels();
    setActiveChannelId(res.data.id);
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
      <div style={{ flexShrink: 0, marginBottom: 20 }}>
        <p className="eyebrow" style={{ textTransform: "uppercase" }}>Cleaner community</p>
        <h1 className="display" style={{ fontSize: "clamp(28px,3vw,40px)", marginTop: 6 }}>
          Group chat.
        </h1>
        <p style={{ fontSize: 14, color: "var(--primary-60)", margin: "6px 0 0" }}>
          Post announcements, manage channels, and moderate crew messages.
        </p>
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
                <Users size={15} />
                <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {c.name}
                </span>
                {c.isDefault && (
                  <span
                    style={{
                      fontSize: 10,
                      fontWeight: 700,
                      padding: "2px 6px",
                      borderRadius: 999,
                      background: active ? "rgba(255,255,255,0.2)" : "rgba(0,140,156,0.1)",
                      color: active ? "#fff" : "var(--primary)",
                    }}>
                    Default
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
                <Users size={20} />
              </div>
            </div>
            <div className="thread-meta">
              <div className="thread-name">
                {activeChannel?.name ?? "Group chat"}
                <span className="chat-role-pill">Moderating</span>
              </div>
              <div className="thread-role">Visible to all cleaners</div>
            </div>
          </div>

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
