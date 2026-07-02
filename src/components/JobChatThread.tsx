"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Send, MessageSquare } from "lucide-react";
import useSWR from "swr";
import {
  getJobChatMessages,
  sendJobChatMessage,
  type JobChatPayload,
  type JobChatMessageDTO,
  type JobChatRole,
} from "@/lib/jobChatActions";

interface JobChatThreadProps {
  jobId: string;
  /** Who the current viewer is talking to, e.g. "Client" or "Cleaner". */
  otherLabel: string;
  /** Current user's display name (for optimistic messages). */
  userName?: string;
  /** When false, the composer is hidden (read-only). Defaults to true. */
  canSend?: boolean;
  /** Optional height for the scrollable message area. */
  height?: number;
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

function groupByDay(messages: JobChatMessageDTO[]) {
  const groups: { label: string; messages: JobChatMessageDTO[] }[] = [];
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

const ROLE_LABEL: Record<JobChatRole, string> = {
  CLEANER: "Cleaner",
  CLIENT: "Client",
  ADMIN: "Admin",
};

export default function JobChatThread({
  jobId,
  otherLabel,
  userName,
  canSend = true,
  height = 360,
}: JobChatThreadProps) {
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const { data, mutate } = useSWR<JobChatPayload>(
    ["job-chat", jobId],
    async () => {
      const res = await getJobChatMessages(jobId);
      if (!res.success) throw new Error(res.error);
      return res.data;
    },
    { refreshInterval: 4000, revalidateOnFocus: true }
  );

  const messages = useMemo(() => data?.messages ?? [], [data]);
  const grouped = useMemo(() => groupByDay(messages), [messages]);

  // Keep the thread pinned to the newest message.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    requestAnimationFrame(() => {
      el.scrollTop = el.scrollHeight;
      bottomRef.current?.scrollIntoView({ block: "end" });
    });
  }, [messages.length]);

  async function handleSend() {
    const body = draft.trim();
    if (!body || sending) return;
    setSendError(null);
    setSending(true);
    setDraft("");

    const optimistic: JobChatMessageDTO = {
      id: `optimistic-${Date.now()}`,
      jobId,
      senderId: "me",
      senderRole: data?.viewerRole ?? "CLEANER",
      senderName: userName ?? "You",
      body,
      createdAt: new Date().toISOString(),
      mine: true,
    };
    await mutate(
      (current) =>
        current ? { ...current, messages: [...current.messages, optimistic] } : current,
      { revalidate: false }
    );

    const res = await sendJobChatMessage(jobId, body);
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

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        border: "1px solid rgba(0,140,156,0.12)",
        borderRadius: 14,
        overflow: "hidden",
        background: "#fff",
      }}>
      {/* Messages */}
      <div
        ref={scrollRef}
        style={{
          height,
          overflowY: "auto",
          padding: "16px 18px",
          display: "flex",
          flexDirection: "column",
          gap: 3,
          background: "var(--cream)",
        }}>
        {grouped.length === 0 ? (
          <div
            style={{
              margin: "auto",
              textAlign: "center",
              color: "var(--primary-50)",
            }}>
            <div
              style={{
                width: 52,
                height: 52,
                borderRadius: "50%",
                background: "rgba(0,140,156,0.06)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                margin: "0 auto 12px",
              }}>
              <MessageSquare size={20} color="var(--primary-40)" />
            </div>
            <p
              style={{
                fontSize: 13.5,
                fontWeight: 500,
                color: "var(--primary-70)",
                margin: "0 0 4px",
              }}>
              No messages yet
            </p>
            <p style={{ fontSize: 12, color: "var(--primary-50)", margin: 0 }}>
              {canSend
                ? `Send a message about this job to the ${otherLabel.toLowerCase()}.`
                : "No messages have been exchanged for this job."}
            </p>
          </div>
        ) : (
          grouped.map((group, gi) => (
            <div key={gi}>
              <div className="chat-day-divider">{group.label}</div>
              {group.messages.map((m) => (
                <div
                  key={m.id}
                  className={`chat-msg ${m.mine ? "mine" : "theirs"}`}
                  style={{ marginTop: 4 }}>
                  <div className="chat-msg-bubble">
                    {!m.mine && (
                      <div
                        style={{
                          fontSize: 10.5,
                          fontWeight: 600,
                          opacity: 0.7,
                          marginBottom: 2,
                        }}>
                        {m.senderName}
                        <span
                          className="chat-role-pill"
                          style={{ marginLeft: 6 }}>
                          {ROLE_LABEL[m.senderRole]}
                        </span>
                      </div>
                    )}
                    {m.body && <div>{m.body}</div>}
                    <div className="chat-msg-time">{timeOnly(m.createdAt)}</div>
                  </div>
                </div>
              ))}
            </div>
          ))
        )}
        <div ref={bottomRef} aria-hidden="true" />
      </div>

      {/* Composer */}
      {canSend && (
        <div className="chat-composer" style={{ padding: "12px 16px 14px" }}>
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
              placeholder={`Message the ${otherLabel.toLowerCase()}…`}
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
      )}
    </div>
  );
}
