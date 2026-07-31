"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Send, MessageSquare, Paperclip, X } from "lucide-react";
import useSWR from "swr";
import {
  getJobChatMessages,
  sendJobChatMessage,
  sendJobChatPhoto,
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
  /**
   * One-tap canned messages shown above the composer. Tapping sends straight
   * away — the point is that a cleaner on the move doesn't have to type.
   * Callers pass the list appropriate to their side of the conversation; see
   * CLEANER_QUICK_MESSAGES.
   */
  quickMessages?: string[];
  /** Optional height for the scrollable message area. */
  height?: number;
}

function timeOnly(iso: string) {
  return new Date(iso).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/Toronto",
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

/**
 * The cleaner-side quick messages, worded exactly as specified so the customer
 * sees consistent, predictable updates.
 */
export const CLEANER_QUICK_MESSAGES = [
  "I am on my way",
  "I have arrived",
  "I am having trouble accessing the property",
  "I am running approximately 15 minutes late",
  "Could you confirm the parking instructions?",
];

const ROLE_LABEL: Record<JobChatRole, string> = {
  CLEANER: "Cleaner",
  CLIENT: "Client",
  ADMIN: "Admin",
};

/** Mirrors the server-side gate in sendJobChatPhoto — same cap, same list. */
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
const ALLOWED_ATTACHMENT_TYPES = [
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/heic",
  "image/heif",
  "image/webp",
];

export default function JobChatThread({
  jobId,
  otherLabel,
  userName,
  canSend = true,
  quickMessages,
  height = 360,
}: JobChatThreadProps) {
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  // Photo staged in the composer but not yet sent. `previewUrl` is a local
  // object URL so the thumbnail (and the optimistic bubble) appear instantly.
  const [pendingPhoto, setPendingPhoto] = useState<
    { file: File; previewUrl: string } | null
  >(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  // Release the object URL when the staged photo is replaced or the thread
  // unmounts, so a long chat session doesn't leak every photo it previewed.
  useEffect(() => {
    const url = pendingPhoto?.previewUrl;
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [pendingPhoto]);

  function handlePickPhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    // Let the same photo be chosen again after a cancel/failed send.
    e.target.value = "";
    if (!file) return;
    if (!ALLOWED_ATTACHMENT_TYPES.includes(file.type.toLowerCase())) {
      setSendError("Unsupported file type. Use JPG, PNG, HEIC, or WebP.");
      return;
    }
    if (file.size > MAX_ATTACHMENT_BYTES) {
      setSendError("Photo exceeds the 10MB limit.");
      return;
    }
    setSendError(null);
    setPendingPhoto({ file, previewUrl: URL.createObjectURL(file) });
  }

  async function handleSend(override?: string) {
    const body = (override ?? draft).trim();
    const photo = override === undefined ? pendingPhoto : null;
    // A photo may travel with an empty caption; text alone still can't.
    if ((!body && !photo) || sending) return;
    setSendError(null);
    setSending(true);
    // Only clear the box when sending what's in it — a quick message must not
    // wipe something the user was part-way through typing.
    if (override === undefined) {
      setDraft("");
      setPendingPhoto(null);
    }

    const optimistic: JobChatMessageDTO = {
      id: `optimistic-${Date.now()}`,
      jobId,
      senderId: "me",
      senderRole: data?.viewerRole ?? "CLEANER",
      senderName: userName ?? "You",
      body,
      attachmentUrl: photo?.previewUrl ?? null,
      attachmentWidth: null,
      attachmentHeight: null,
      createdAt: new Date().toISOString(),
      mine: true,
    };
    await mutate(
      (current) =>
        current ? { ...current, messages: [...current.messages, optimistic] } : current,
      { revalidate: false }
    );

    let res: Awaited<ReturnType<typeof sendJobChatMessage>>;
    if (photo) {
      const fd = new FormData();
      fd.append("jobId", jobId);
      fd.append("file", photo.file);
      fd.append("body", body);
      res = await sendJobChatPhoto(fd);
    } else {
      res = await sendJobChatMessage(jobId, body);
    }
    setSending(false);
    if (!res.success) {
      // Restore into the box only if it's still empty, so a failed quick
      // message doesn't clobber typing the user started meanwhile.
      setDraft((current) => (current.trim() ? current : body));
      if (photo) setPendingPhoto(photo);
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
                    {m.attachmentUrl && (
                      <a
                        href={m.attachmentUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="chat-attachment"
                        style={{ marginBottom: m.body ? 6 : 0 }}>
                        {/* width/height give the browser the aspect ratio up
                            front, so a photo decoding mid-poll doesn't shove
                            the thread around under the auto-scroll. */}
                        <img
                          src={m.attachmentUrl}
                          alt={m.body || "Photo shared in this conversation"}
                          width={m.attachmentWidth ?? undefined}
                          height={m.attachmentHeight ?? undefined}
                          loading="lazy"
                        />
                      </a>
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
          {quickMessages && quickMessages.length > 0 && (
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: 6,
                marginBottom: 10,
              }}>
              {quickMessages.map((msg) => (
                <button
                  key={msg}
                  type="button"
                  disabled={sending}
                  onClick={() => handleSend(msg)}
                  title={`Send: ${msg}`}
                  style={{
                    fontSize: 12,
                    padding: "5px 10px",
                    borderRadius: 999,
                    border: "1px solid rgba(0,140,156,0.25)",
                    background: "rgba(0,140,156,0.06)",
                    color: "#00424a",
                    cursor: sending ? "default" : "pointer",
                    opacity: sending ? 0.5 : 1,
                  }}>
                  {msg}
                </button>
              ))}
            </div>
          )}
          {pendingPhoto && (
            <div className="chat-attach-preview">
              <img src={pendingPhoto.previewUrl} alt="" />
              <div className="chat-attach-preview-meta">
                <span className="name">{pendingPhoto.file.name}</span>
                <span className="size">
                  {(pendingPhoto.file.size / (1024 * 1024)).toFixed(1)} MB
                </span>
              </div>
              <button
                type="button"
                onClick={() => setPendingPhoto(null)}
                disabled={sending}
                aria-label="Remove photo">
                <X size={14} />
              </button>
            </div>
          )}
          <div className="chat-composer-row">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/jpg,image/png,image/heic,image/heif,image/webp"
              onChange={handlePickPhoto}
              style={{ display: "none" }}
              tabIndex={-1}
            />
            <button
              type="button"
              className="chat-icon-btn"
              onClick={() => fileInputRef.current?.click()}
              disabled={sending}
              title="Attach a photo"
              aria-label="Attach a photo">
              <Paperclip size={16} />
            </button>
            <textarea
              rows={1}
              value={draft}
              onChange={handleChange}
              onKeyDown={handleKeyDown}
              placeholder={
                pendingPhoto
                  ? "Add a caption (optional)…"
                  : `Message the ${otherLabel.toLowerCase()}…`
              }
            />
            <button
              className="chat-send"
              onClick={() => handleSend()}
              disabled={sending || (draft.trim().length === 0 && !pendingPhoto)}
              aria-label="Send">
              <Send size={14} />
            </button>
          </div>
          <div className="chat-composer-hint">
            {sending && pendingPhoto
              ? "Uploading photo…"
              : "⏎ to send · ⇧⏎ for new line · 📎 photo up to 10MB"}
          </div>
        </div>
      )}
    </div>
  );
}
