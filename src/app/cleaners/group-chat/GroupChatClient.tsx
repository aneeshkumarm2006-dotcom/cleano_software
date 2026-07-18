"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { fmtTime } from "@/lib/time";
import { Send, Users, MessageCircle, Plus, X, Phone, Mail } from "lucide-react";
import useSWR from "swr";
import { initials } from "@/lib/avatar";
import {
  listGroupChannels,
  getGroupMessages,
  sendGroupMessage,
  listCleanerDirectory,
  getOrCreateDirectChannel,
  markChannelRead,
  type GroupChannelDTO,
  type GroupMessageDTO,
  type CleanerDirectoryEntryDTO,
} from "./groupChat";

interface GroupChatClientProps {
  initialChannels: GroupChannelDTO[];
  initialChannelId: string | null;
  initialMessages: GroupMessageDTO[];
  currentUserId: string;
  userName?: string;
  dmEnabled: boolean;
}

function timeOnly(iso: string) {
  return fmtTime(iso);
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

export default function GroupChatClient({
  initialChannels,
  initialChannelId,
  initialMessages,
  currentUserId,
  userName,
  dmEnabled,
}: GroupChatClientProps) {
  const [activeChannelId, setActiveChannelId] = useState<string | null>(
    initialChannelId
  );
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [directoryOpen, setDirectoryOpen] = useState(false);
  const [startingDmId, setStartingDmId] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const { data: channels, mutate: mutateChannels } = useSWR<GroupChannelDTO[]>(
    "group-channels",
    async () => {
      const res = await listGroupChannels();
      if (!res.success) throw new Error(res.error);
      return res.data;
    },
    { fallbackData: initialChannels, refreshInterval: 15000 }
  );

  // Directory of other cleaners — fetched lazily when the panel opens.
  const { data: directory } = useSWR(
    dmEnabled && directoryOpen ? "cleaner-directory" : null,
    async () => {
      const res = await listCleanerDirectory();
      if (!res.success) throw new Error(res.error);
      return res.data;
    }
  );

  const channelList = channels ?? initialChannels;
  const activeChannel =
    channelList.find((c) => c.id === activeChannelId) ?? channelList[0] ?? null;

  const { data: messages, mutate } = useSWR<GroupMessageDTO[]>(
    activeChannel ? ["group-messages", activeChannel.id] : null,
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

  // Mark the open channel read (clears its unread badge) on open and whenever
  // new messages arrive while it is focused. Team-chat read state is separate
  // from job chat and 1:1 admin chat.
  useEffect(() => {
    if (!activeChannel || directoryOpen) return;
    let cancelled = false;
    markChannelRead(activeChannel.id).then((res) => {
      if (!cancelled && res.success) mutateChannels();
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeChannel?.id, msgs.length, directoryOpen]);

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
  }, [msgs.length, activeChannel?.id]);

  async function handleSend() {
    const body = draft.trim();
    if (!body || !activeChannel || sending) return;
    setSendError(null);
    setSending(true);
    setDraft("");

    const optimistic: GroupMessageDTO = {
      id: `optimistic-${Date.now()}`,
      channelId: activeChannel.id,
      senderId: currentUserId,
      senderName: userName ?? "You",
      body,
      createdAt: new Date().toISOString(),
    };
    await mutate((cur) => (cur ? [...cur, optimistic] : [optimistic]), {
      revalidate: false,
    });

    const res = await sendGroupMessage(activeChannel.id, body);
    setSending(false);
    if (!res.success) {
      setDraft(body);
      setSendError(res.error);
      await mutate();
      return;
    }
    await mutate();
  }

  async function handleStartDm(otherUserId: string) {
    if (startingDmId) return;
    setSendError(null);
    setStartingDmId(otherUserId);
    const res = await getOrCreateDirectChannel(otherUserId);
    setStartingDmId(null);
    if (!res.success) {
      setSendError(res.error);
      return;
    }
    await mutateChannels();
    setActiveChannelId(res.data.id);
    setDirectoryOpen(false);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
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
          Group chat.
        </h1>
        <p style={{ fontSize: 14, color: "var(--primary-60)", margin: "6px 0 0" }}>
          Chat with the whole crew across channels.
        </p>
      </div>

      {/* Chat shell */}
      <div style={{ flex: 1, minHeight: 0, padding: "0 clamp(16px,5vw,32px) clamp(16px,4vw,32px)" }}>
        <div
          style={{
            height: "100%",
            background: "#fff",
            borderRadius: 18,
            boxShadow: "0 2px 24px rgba(0,140,156,0.08), 0 1px 4px rgba(0,0,0,0.04)",
            border: "1px solid rgba(0,140,156,0.08)",
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
          }}>
          {/* Channel tabs */}
          <div
            style={{
              display: "flex",
              gap: 6,
              padding: "10px 12px",
              borderBottom: "1px solid rgba(0,140,156,0.10)",
              overflowX: "auto",
              flexShrink: 0,
            }}>
            {channelList.map((c) => {
              const active = c.id === activeChannel?.id && !directoryOpen;
              return (
                <button
                  key={c.id}
                  onClick={() => {
                    setDirectoryOpen(false);
                    setActiveChannelId(c.id);
                  }}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    padding: "7px 14px",
                    borderRadius: 999,
                    border: "none",
                    cursor: "pointer",
                    whiteSpace: "nowrap",
                    fontSize: 13,
                    fontWeight: 600,
                    background: active ? "var(--primary)" : "rgba(0,140,156,0.07)",
                    color: active ? "#fff" : "var(--primary-70)",
                    transition: "background 0.15s",
                  }}>
                  {c.isDirect ? <MessageCircle size={14} /> : <Users size={14} />}
                  {c.name}
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
                </button>
              );
            })}
            {dmEnabled && (
              <button
                onClick={() => setDirectoryOpen((o) => !o)}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "7px 14px",
                  borderRadius: 999,
                  border: "1px dashed rgba(0,140,156,0.35)",
                  cursor: "pointer",
                  whiteSpace: "nowrap",
                  fontSize: 13,
                  fontWeight: 600,
                  background: directoryOpen ? "var(--primary)" : "transparent",
                  color: directoryOpen ? "#fff" : "var(--primary)",
                  transition: "background 0.15s",
                }}>
                <Plus size={14} />
                New chat
              </button>
            )}
          </div>

          {directoryOpen ? (
            /* Cleaner directory — pick someone to start a 1:1 chat with. */
            <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
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
                    <Plus size={20} />
                  </div>
                </div>
                <div className="thread-meta">
                  <div className="thread-name">Start a chat</div>
                  <div className="thread-role">Message another cleaner directly</div>
                </div>
                <button
                  onClick={() => setDirectoryOpen(false)}
                  aria-label="Close directory"
                  style={{
                    marginLeft: "auto",
                    background: "none",
                    border: "none",
                    cursor: "pointer",
                    color: "var(--primary-50)",
                    padding: 6,
                    display: "flex",
                  }}>
                  <X size={18} />
                </button>
              </div>
              <div
                style={{
                  flex: 1,
                  overflowY: "auto",
                  padding: "16px 20px",
                  background: "var(--cream)",
                  display: "flex",
                  flexDirection: "column",
                  gap: 8,
                }}>
                {sendError && (
                  <div
                    style={{
                      fontSize: 12,
                      color: "#dc2626",
                      background: "#fef2f2",
                      border: "1px solid #fecaca",
                      borderRadius: 8,
                      padding: "6px 12px",
                    }}>
                    {sendError}
                  </div>
                )}
                {!directory ? (
                  <p style={{ fontSize: 13, color: "var(--primary-50)", textAlign: "center", margin: "auto" }}>
                    Loading cleaners…
                  </p>
                ) : directory.cleaners.length === 0 ? (
                  <p style={{ fontSize: 13, color: "var(--primary-50)", textAlign: "center", margin: "auto" }}>
                    No other cleaners to message right now.
                  </p>
                ) : (
                  directory.cleaners.map((c: CleanerDirectoryEntryDTO) => (
                    <div
                      key={c.id}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 12,
                        background: "#fff",
                        border: "1px solid rgba(0,140,156,0.10)",
                        borderRadius: 12,
                        padding: "10px 14px",
                      }}>
                      <div
                        style={{
                          width: 38,
                          height: 38,
                          borderRadius: "50%",
                          background: "var(--primary)",
                          color: "#fff",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          fontSize: 13,
                          fontWeight: 700,
                          flexShrink: 0,
                        }}>
                        {initials(c.name)}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div
                          style={{
                            fontSize: 14,
                            fontWeight: 600,
                            color: "var(--ink)",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}>
                          {c.name}
                        </div>
                        {directory.showContactInfo && (c.phone || c.email) && (
                          <div
                            style={{
                              display: "flex",
                              gap: 12,
                              fontSize: 12,
                              color: "var(--primary-50)",
                              marginTop: 2,
                              flexWrap: "wrap",
                            }}>
                            {c.phone && (
                              <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                                <Phone size={11} /> {c.phone}
                              </span>
                            )}
                            {c.email && (
                              <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                                <Mail size={11} /> {c.email}
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                      <button
                        onClick={() => handleStartDm(c.id)}
                        disabled={startingDmId !== null}
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 6,
                          padding: "7px 14px",
                          borderRadius: 999,
                          border: "none",
                          cursor: "pointer",
                          fontSize: 13,
                          fontWeight: 600,
                          background: "var(--primary)",
                          color: "#fff",
                          opacity: startingDmId && startingDmId !== c.id ? 0.5 : 1,
                          flexShrink: 0,
                        }}>
                        <MessageCircle size={13} />
                        {startingDmId === c.id ? "Opening…" : "Message"}
                      </button>
                    </div>
                  ))
                )}
              </div>
            </div>
          ) : (
            <>
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
                <span className="chat-role-pill">
                  {activeChannel?.isDirect ? "Direct" : "Crew"}
                </span>
              </div>
              <div className="thread-role">
                {activeChannel?.isDirect
                  ? "Private conversation"
                  : activeChannel?.isDefault
                    ? "Visible to all cleaners"
                    : "Private channel"}
              </div>
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
                <p style={{ fontSize: 14, fontWeight: 500, color: "var(--primary-70)", margin: "0 0 4px" }}>
                  No messages yet
                </p>
                <p style={{ fontSize: 12, color: "var(--primary-50)", margin: 0 }}>
                  Start the conversation with your crew.
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
                        style={{ marginTop: 4 }}>
                        <div className="chat-msg-bubble">
                          {!mine && (
                            <div className="chat-msg-author">{m.senderName}</div>
                          )}
                          {m.body && <div>{m.body}</div>}
                          <div className="chat-msg-time">{timeOnly(m.createdAt)}</div>
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
              <div
                style={{
                  fontSize: 12,
                  color: "#dc2626",
                  background: "#fef2f2",
                  border: "1px solid #fecaca",
                  borderRadius: 8,
                  padding: "6px 12px",
                  marginBottom: 10,
                }}>
                Failed to send: {sendError}
              </div>
            )}
            <div className="chat-composer-row">
              <textarea
                rows={1}
                value={draft}
                onChange={handleChange}
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
            </>
          )}
        </div>
      </div>
    </div>
  );
}
