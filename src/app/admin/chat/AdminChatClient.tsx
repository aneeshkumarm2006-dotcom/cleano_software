"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { fmtTime } from "@/lib/time";
import { Send, Search, Phone, MoreHorizontal, Paperclip, Smile, User as UserIcon, MessageCircle } from "lucide-react";
import useSWR from "swr";
import imageCompression from "browser-image-compression";
import { getAdminChat, getAdminChatList, sendChatMessage, uploadChatAttachment } from "./actions";
import type { AdminChatPayload, AdminConversationSummary } from "./types";
import Receipt from "./Receipt";
import { avatarColor } from "@/lib/avatar";

interface AdminChatClientProps {
  initialList: AdminConversationSummary[];
}

// Chat-specific initials: first + last word (canonical lib takes first two words).
function initials(name: string) {
  const parts = name.trim().split(/\s+/);
  return parts.length >= 2
    ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
    : name.slice(0, 2).toUpperCase();
}

function formatRelative(iso: string | null) {
  if (!iso) return "";
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.round(ms / 60000);
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  const days = Math.round(hrs / 24);
  if (days < 7) return `${days}d`;
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function timeOnly(iso: string) {
  return fmtTime(iso);
}

function dayLabel(d: Date) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const t = new Date(d); t.setHours(0, 0, 0, 0);
  const diff = Math.round((today.getTime() - t.getTime()) / 86400000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Yesterday";
  if (diff < 7) return d.toLocaleDateString("en-US", { weekday: "long" });
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function groupByDay(messages: AdminChatPayload["messages"]) {
  const groups: { label: string; messages: AdminChatPayload["messages"] }[] = [];
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

export default function AdminChatClient({ initialList }: AdminChatClientProps) {
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string | null>(
    initialList[0]?.employeeId ?? null
  );
  const [search, setSearch] = useState("");
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: list, mutate: mutateList } = useSWR<AdminConversationSummary[]>(
    "admin-chat-list",
    async () => {
      const res = await getAdminChatList();
      if (!res.success) throw new Error(res.error);
      return res.data;
    },
    { fallbackData: initialList, refreshInterval: 5000, revalidateOnFocus: true }
  );

  const { data: chat, mutate: mutateChat } = useSWR<AdminChatPayload | null>(
    selectedEmployeeId ? ["admin-chat", selectedEmployeeId] : null,
    async () => {
      if (!selectedEmployeeId) return null;
      const res = await getAdminChat(selectedEmployeeId);
      if (!res.success) throw new Error(res.error);
      return res.data;
    },
    { refreshInterval: 3000, revalidateOnFocus: true }
  );

  const filteredList = useMemo(() => {
    const q = search.trim().toLowerCase();
    const items = list ?? [];
    if (!q) return items;
    return items.filter(s => s.employeeName.toLowerCase().includes(q));
  }, [list, search]);

  const grouped = useMemo(() => groupByDay(chat?.messages ?? []), [chat?.messages]);

  // Pin the active conversation to the most recent message. Runs in rAF so
  // images / attachments that change scrollHeight after first paint don't
  // leave the view stuck near the top.
  useEffect(() => {
    function scrollToBottom() {
      const el = scrollRef.current;
      if (!el) return;
      el.scrollTop = el.scrollHeight;
      bottomRef.current?.scrollIntoView({ block: "end" });
    }
    requestAnimationFrame(() => {
      scrollToBottom();
      requestAnimationFrame(scrollToBottom);
    });
  }, [chat?.messages.length, selectedEmployeeId]);

  async function handleSend() {
    const body = draft.trim();
    if (!body || !chat?.conversationId || sending) return;
    setSendError(null);
    setSending(true);
    setDraft("");

    // Optimistic update
    const optimisticMsg = {
      id: `optimistic-${Date.now()}`,
      conversationId: chat.conversationId,
      senderId: "me",
      senderName: "You",
      senderRole: "ADMIN" as const,
      body,
      attachmentUrl: null,
      attachmentType: null,
      attachmentName: null,
      createdAt: new Date().toISOString(),
      readByAdminAt: new Date().toISOString(),
      readByEmployeeAt: null,
      deliveredAt: null,
      receipt: "SENT" as const,
    };
    await mutateChat(
      (current) => current
        ? { ...current, messages: [...current.messages, optimisticMsg] }
        : current,
      { revalidate: false }
    );

    const res = await sendChatMessage(chat.conversationId, body);
    setSending(false);
    if (!res.success) {
      setDraft(body);
      setSendError(res.error);
      await mutateChat();
      return;
    }
    await Promise.all([mutateChat(), mutateList()]);
  }

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-selecting the same file later
    if (!file || !chat?.conversationId || uploading || sending) return;
    setSendError(null);
    setUploading(true);
    try {
      let toUpload: File = file;
      if (file.type.startsWith("image/")) {
        try {
          toUpload = await imageCompression(file, {
            maxSizeMB: 1.5,
            maxWidthOrHeight: 1920,
            useWebWorker: true,
          });
        } catch {
          toUpload = file; // fall back to original if compression fails
        }
      }
      const fd = new FormData();
      fd.append("file", toUpload, file.name);
      const up = await uploadChatAttachment(fd);
      if (!up.success) {
        setSendError(up.error);
        return;
      }
      const res = await sendChatMessage(chat.conversationId, "", {
        url: up.url,
        type: up.type,
        name: up.name,
      });
      if (!res.success) {
        setSendError(res.error);
        return;
      }
      await Promise.all([mutateChat(), mutateList()]);
    } finally {
      setUploading(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); }
  }

  function handleChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    setDraft(e.target.value);
    const t = e.target;
    t.style.height = "auto";
    t.style.height = Math.min(t.scrollHeight, 120) + "px";
  }

  const selectedConv = (list ?? []).find(s => s.employeeId === selectedEmployeeId);

  return (
    <div className="h-full flex flex-col admin-font">
      {/* Page header */}
      <div style={{ padding: "32px 32px 24px", flexShrink: 0 }}>
        <div className="row-between" style={{ alignItems: "flex-end", gap: 16 }}>
          <div className="stack-8">
            <p className="eyebrow">Communication</p>
            <h1 className="display" style={{ fontSize: "clamp(34px,4vw,48px)" }}>
              Team <em style={{ fontStyle: "normal", color: "var(--primary)" }}>chat.</em>
            </h1>
            <p style={{ fontSize: 14, color: "var(--primary-60)", margin: 0 }}>
              Direct messages with cleaners. Coordinate jobs, share notes, and stay in touch.
            </p>
          </div>
        </div>
      </div>

      {/* Chat shell */}
      <div style={{ flex: 1, minHeight: 0, padding: "0 32px 32px" }}>
        <div className="chat-shell">
          {/* Conversation list */}
          <aside className="chat-list">
            <div className="chat-list-head">
              <div className="chat-list-title">
                <span>Conversations · {(list ?? []).length}</span>
              </div>
              <div className="chat-list-search">
                <span className="chat-list-search-icon"><Search size={14} /></span>
                <input
                  className="input"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder="Search employees…"
                />
              </div>
            </div>

            <div className="chat-list-body">
              {filteredList.length === 0 ? (
                <div className="chat-list-empty">No conversations found.</div>
              ) : filteredList.map(s => {
                const active = s.employeeId === selectedEmployeeId;
                const preview = s.lastMessageBody
                  ? `${s.lastSenderRole === "ADMIN" ? "You: " : ""}${s.lastMessageBody}`
                  : "No messages yet";
                const isUnread = s.unreadFromEmployee > 0;
                const color = avatarColor(s.employeeName);
                const inits = initials(s.employeeName);

                return (
                  <div
                    key={s.conversationId}
                    className={`chat-row${active ? " active" : ""}`}
                    onClick={() => setSelectedEmployeeId(s.employeeId)}>
                    <div className="chat-avatar-wrap">
                      <span style={{
                        width: 40, height: 40, borderRadius: "50%",
                        background: color, color: "#fff",
                        display: "inline-flex", alignItems: "center", justifyContent: "center",
                        fontSize: 14, fontWeight: 600, flexShrink: 0,
                      }}>
                        {inits}
                      </span>
                      <span className="chat-status-dot offline" />
                    </div>
                    <div className="chat-row-meta">
                      <div className="chat-row-name">{s.employeeName}</div>
                      <div className={`chat-row-preview${isUnread ? " unread" : ""}`}>
                        {preview}
                      </div>
                    </div>
                    <div className="chat-row-right">
                      {s.lastMessageAt && (
                        <span className="chat-row-time">{formatRelative(s.lastMessageAt)}</span>
                      )}
                      {isUnread && (
                        <span className="chat-row-badge">{s.unreadFromEmployee}</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </aside>

          {/* Thread */}
          <section className="chat-thread">
            {!chat || !selectedConv ? (
              <div className="chat-thread-empty" style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", flex: 1 }}>
                <div style={{
                  width: 56, height: 56, borderRadius: "50%",
                  background: "rgba(0,140,156,0.06)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  marginBottom: 14,
                }}>
                  <MessageCircle size={24} color="var(--primary-40)" />
                </div>
                <p style={{ fontSize: 14, color: "var(--primary-60)", margin: 0, fontWeight: 500 }}>
                  Select an employee to start chatting.
                </p>
              </div>
            ) : (
              <>
                {/* Thread header */}
                <div className="chat-thread-head">
                  <div className="chat-avatar-wrap">
                    <span style={{
                      width: 44, height: 44, borderRadius: "50%",
                      background: avatarColor(selectedConv.employeeName), color: "#fff",
                      display: "inline-flex", alignItems: "center", justifyContent: "center",
                      fontSize: 15, fontWeight: 600, flexShrink: 0,
                    }}>
                      {selectedConv.employeeImage
                        ? <img src={selectedConv.employeeImage} alt={selectedConv.employeeName} style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: "50%" }} />
                        : initials(selectedConv.employeeName)
                      }
                    </span>
                    <span
                      className={`chat-status-dot ${chat?.otherOnline ? "online" : "offline"}`}
                      style={{ width: 12, height: 12 }}
                    />
                  </div>
                  <div className="thread-meta">
                    <div className="thread-name">{selectedConv.employeeName}</div>
                    <div className="thread-role">
                      Employee
                      {chat?.otherOnline ? (
                        <span style={{ color: "#059669", marginLeft: 8 }}>· Active now</span>
                      ) : (
                        <span style={{ color: "var(--primary-50)", marginLeft: 8 }}>· Offline</span>
                      )}
                    </div>
                  </div>
                  <div className="thread-actions">
                    <button className="chat-icon-btn" aria-label="More options">
                      <MoreHorizontal size={16} />
                    </button>
                  </div>
                </div>

                {/* Messages */}
                <div ref={scrollRef} className="chat-thread-body">
                  {grouped.length === 0 ? (
                    <div style={{ margin: "auto", textAlign: "center", color: "var(--primary-50)" }}>
                      <p style={{ fontSize: 13 }}>No messages yet. Send the first one.</p>
                    </div>
                  ) : (
                    grouped.map((group, gi) => (
                      <div key={gi}>
                        <div className="chat-day-divider">{group.label}</div>
                        {group.messages.map((m) => {
                          const mine = m.senderRole === "ADMIN";
                          return (
                            <div key={m.id} className={`chat-msg ${mine ? "mine" : "theirs"}`} style={{ marginTop: 4 }}>
                              <div className="chat-msg-bubble">
                                {m.attachmentUrl && m.attachmentType === "image" && (
                                  <a href={m.attachmentUrl} target="_blank" rel="noopener noreferrer">
                                    <img
                                      src={m.attachmentUrl}
                                      alt={m.attachmentName ?? "image"}
                                      style={{ maxWidth: 220, maxHeight: 220, borderRadius: 10, display: "block", marginBottom: m.body ? 6 : 0 }}
                                    />
                                  </a>
                                )}
                                {m.attachmentUrl && m.attachmentType !== "image" && (
                                  <a
                                    href={m.attachmentUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", borderRadius: 10, background: "rgba(0,0,0,0.06)", color: "inherit", textDecoration: "none", marginBottom: m.body ? 6 : 0 }}>
                                    <Paperclip size={14} />
                                    <span style={{ fontSize: 13, wordBreak: "break-all" }}>{m.attachmentName ?? "Attachment"}</span>
                                  </a>
                                )}
                                {m.body && <div>{m.body}</div>}
                                <div className="chat-msg-time">
                                  {timeOnly(m.createdAt)}
                                  {mine && <Receipt state={m.receipt} />}
                                </div>
                              </div>
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
                  {sendError && (
                    <div style={{
                      fontSize: 12, color: "#dc2626",
                      background: "#fef2f2", border: "1px solid #fecaca",
                      borderRadius: 8, padding: "6px 12px", marginBottom: 10,
                    }}>
                      Failed to send: {sendError}
                    </div>
                  )}
                  <div className="chat-composer-row">
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/*,application/pdf"
                      style={{ display: "none" }}
                      onChange={handleFile}
                    />
                    <button
                      className="chat-icon-btn"
                      aria-label="Attach file"
                      style={{ padding: "6px" }}
                      onClick={() => fileInputRef.current?.click()}
                      disabled={uploading || sending}>
                      <Paperclip size={17} />
                    </button>
                    <textarea
                      ref={textareaRef}
                      rows={1}
                      value={draft}
                      onChange={handleChange}
                      onKeyDown={handleKeyDown}
                      placeholder={`Message ${selectedConv.employeeName}…`}
                    />
                    <button className="chat-icon-btn" aria-label="Emoji" style={{ padding: "6px" }}>
                      <Smile size={17} />
                    </button>
                    <button
                      className="chat-send"
                      onClick={handleSend}
                      disabled={sending || draft.trim().length === 0}
                      aria-label="Send">
                      <Send size={14} />
                    </button>
                  </div>
                  <div className="chat-composer-hint">
                    {uploading ? "Uploading attachment…" : "⏎ to send · ⇧⏎ for new line"}
                  </div>
                </div>
              </>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
