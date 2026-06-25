"use client";

import { useEffect, useRef, useState, useMemo } from "react";
import { Send, Paperclip, Smile, Phone, MoreHorizontal, Shield, Briefcase } from "lucide-react";
import useSWR from "swr";
import imageCompression from "browser-image-compression";
import { getEmployeeChat, sendChatMessage, uploadChatAttachment } from "./actions";
import type { EmployeeChatPayload } from "./types";
import Receipt from "./Receipt";

interface EmployeeChatClientProps {
  initial: EmployeeChatPayload;
  userName?: string;
}

function timeOnly(iso: string) {
  return new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
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

function groupByDay(messages: EmployeeChatPayload["messages"]) {
  const groups: { label: string; messages: EmployeeChatPayload["messages"] }[] = [];
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

export default function EmployeeChatClient({ initial, userName }: EmployeeChatClientProps) {
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data, mutate } = useSWR<EmployeeChatPayload>(
    "employee-chat",
    async () => {
      const res = await getEmployeeChat();
      if (!res.success) throw new Error(res.error);
      return res.data;
    },
    { fallbackData: initial, refreshInterval: 3000, revalidateOnFocus: true }
  );

  const messages = data?.messages ?? [];
  const conversationId = data?.conversationId ?? initial.conversationId;
  const grouped = useMemo(() => groupByDay(messages), [messages]);

  // Pin the thread to the newest message. Runs in rAF so layout has settled
  // (covers initial mount + every new message). Also re-runs on visibility
  // change so re-opening the tab snaps back to the bottom.
  useEffect(() => {
    function scrollToBottom() {
      const el = scrollRef.current;
      if (!el) return;
      el.scrollTop = el.scrollHeight;
      bottomRef.current?.scrollIntoView({ block: "end" });
    }
    requestAnimationFrame(() => {
      scrollToBottom();
      // Second rAF — covers layouts that include images/attachments that
      // mutate scrollHeight after the first paint.
      requestAnimationFrame(scrollToBottom);
    });
  }, [messages.length, data?.conversationId]);

  async function handleSend() {
    const body = draft.trim();
    if (!body || !conversationId || sending) return;
    setSendError(null);
    setSending(true);
    setDraft("");

    // Optimistic update — append message immediately so the UI doesn't feel slow
    const optimisticMsg = {
      id: `optimistic-${Date.now()}`,
      conversationId,
      senderId: "me",
      senderName: userName ?? "You",
      senderRole: "EMPLOYEE" as const,
      body,
      attachmentUrl: null,
      attachmentType: null,
      attachmentName: null,
      createdAt: new Date().toISOString(),
      readByAdminAt: null,
      readByEmployeeAt: new Date().toISOString(),
      deliveredAt: null,
      receipt: "SENT" as const,
    };
    await mutate(
      (current) => current
        ? { ...current, messages: [...current.messages, optimisticMsg] }
        : current,
      { revalidate: false }
    );

    const res = await sendChatMessage(conversationId, body);
    setSending(false);
    if (!res.success) {
      setDraft(body);
      setSendError(res.error);
      // Roll back optimistic update
      await mutate();
      return;
    }
    // Confirm with real data from server
    await mutate();
  }

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-selecting the same file later
    if (!file || !conversationId || uploading || sending) return;
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
      const res = await sendChatMessage(conversationId, "", {
        url: up.url,
        type: up.type,
        name: up.name,
      });
      if (!res.success) {
        setSendError(res.error);
        return;
      }
      await mutate();
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

  const firstName = userName ? userName.split(" ")[0] : "there";

  return (
    <div className="h-full flex flex-col admin-font">
      {/* Page header */}
      <div style={{ padding: "clamp(20px,5vw,32px) clamp(16px,5vw,32px) 20px", flexShrink: 0 }}>
        <p className="eyebrow" style={{ textTransform: "uppercase" }}>
          Hi, {firstName.toUpperCase()}
        </p>
        <h1 className="display" style={{ fontSize: "clamp(34px,4vw,48px)", marginTop: 6 }}>
          Messages.
        </h1>
        <p style={{ fontSize: 14, color: "var(--primary-60)", margin: "6px 0 0" }}>
          Stay in touch with dispatch and your crew.
        </p>
      </div>

      {/* Chat shell — single conversation, no list panel */}
      <div style={{ flex: 1, minHeight: 0, padding: "0 clamp(16px,5vw,32px) clamp(16px,4vw,32px)" }}>
        <div style={{
          height: "100%",
          background: "#fff",
          borderRadius: 18,
          boxShadow: "0 2px 24px rgba(0,140,156,0.08), 0 1px 4px rgba(0,0,0,0.04)",
          border: "1px solid rgba(0,140,156,0.08)",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}>
          {/* Thread header */}
          <div className="chat-thread-head">
            <div className="chat-avatar-wrap">
              <div style={{
                width: 44, height: 44, borderRadius: "50%",
                background: "var(--primary)", color: "#fff",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 15, fontWeight: 600, flexShrink: 0,
              }}>
                <Shield size={20} />
              </div>
              <span
                className={`chat-status-dot ${data?.otherOnline ? "online" : "offline"}`}
                style={{ width: 12, height: 12 }}
              />
            </div>
            <div className="thread-meta">
              <div className="thread-name">
                Admin
                <span className="chat-role-pill">Dispatch</span>
              </div>
              <div className="thread-role">
                Operations · Dispatch
                {data?.otherOnline ? (
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
          <div
            ref={scrollRef}
            style={{
              flex: 1, overflowY: "auto",
              padding: "20px 24px",
              display: "flex", flexDirection: "column", gap: 3,
              background: "var(--cream)",
            }}>
            {grouped.length === 0 ? (
              <div style={{ margin: "auto", textAlign: "center", color: "var(--primary-50)" }}>
                <div style={{
                  width: 56, height: 56, borderRadius: "50%",
                  background: "rgba(0,140,156,0.06)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  margin: "0 auto 14px",
                }}>
                  <Briefcase size={22} color="var(--primary-40)" />
                </div>
                <p style={{ fontSize: 14, fontWeight: 500, color: "var(--primary-70)", margin: "0 0 4px" }}>
                  No messages yet
                </p>
                <p style={{ fontSize: 12, color: "var(--primary-50)", margin: 0 }}>
                  Say hi to your admin.
                </p>
              </div>
            ) : (
              grouped.map((group, gi) => (
                <div key={gi}>
                  <div className="chat-day-divider">{group.label}</div>
                  {group.messages.map(m => {
                    const mine = m.senderRole === "EMPLOYEE";
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
                placeholder="Message Admin…"
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
        </div>
      </div>
    </div>
  );
}
