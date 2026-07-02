"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Send, Users, MessageCircle } from "lucide-react";
import useSWR from "swr";
import {
  listGroupChannels,
  getGroupMessages,
  sendGroupMessage,
  type GroupChannelDTO,
  type GroupMessageDTO,
} from "./groupChat";

interface GroupChatClientProps {
  initialChannels: GroupChannelDTO[];
  initialChannelId: string | null;
  initialMessages: GroupMessageDTO[];
  currentUserId: string;
  userName?: string;
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

export default function GroupChatClient({
  initialChannels,
  initialChannelId,
  initialMessages,
  currentUserId,
  userName,
}: GroupChatClientProps) {
  const [activeChannelId, setActiveChannelId] = useState<string | null>(
    initialChannelId
  );
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const { data: channels } = useSWR<GroupChannelDTO[]>(
    "group-channels",
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
              const active = c.id === activeChannel?.id;
              return (
                <button
                  key={c.id}
                  onClick={() => setActiveChannelId(c.id)}
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
                  <Users size={14} />
                  {c.name}
                </button>
              );
            })}
          </div>

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
                <span className="chat-role-pill">Crew</span>
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
        </div>
      </div>
    </div>
  );
}
