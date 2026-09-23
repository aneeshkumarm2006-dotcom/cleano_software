"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Bot, Check, Mail, MessageSquare } from "lucide-react";
import Button from "@/components/ui/Button";
import {
  assignAiConversation,
  replyToAiConversation,
  resolveAiConversation,
  setAiConversationEnabled,
  setAiConversationStatus,
} from "../../actions/aiConversations";

interface Message {
  id: string;
  author: "CUSTOMER" | "ASSISTANT" | "STAFF";
  body: string;
  internalNote: string | null;
  createdAt: string;
}

interface Conversation {
  id: string;
  channel: "SMS" | "EMAIL";
  customerAddress: string;
  aiEnabled: boolean;
  needsHuman: boolean;
  subject: string | null;
  clientId: string | null;
  clientName: string | null;
  assignedToId: string | null;
  status: "OPEN" | "CLOSED";
}

export default function ConversationThread({
  conversation,
  messages,
  staff,
  meId,
}: {
  conversation: Conversation;
  messages: Message[];
  /** Who can own a conversation in this workspace. */
  staff: { id: string; name: string | null }[];
  meId: string;
}) {
  const router = useRouter();
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const who = conversation.clientName ?? conversation.customerAddress;

  async function run(action: () => Promise<{ success: boolean; error?: string }>) {
    setBusy(true);
    setError(null);
    const res = await action();
    if (!res.success) setError(res.error ?? "Something went wrong.");
    setBusy(false);
    router.refresh();
    return res.success;
  }

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    const text = reply.trim();
    if (!text) return;
    const ok = await run(() => replyToAiConversation(conversation.id, text));
    if (ok) setReply("");
  }

  const fmt = new Intl.DateTimeFormat("en-CA", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

  return (
    <div className="cv-thread">
      {/* header */}
      <div className="cv-thread-head">
        <div className="flex items-center gap-2 min-w-0">
          {conversation.channel === "SMS" ? (
            <MessageSquare size={16} className="text-gray-500 shrink-0" />
          ) : (
            <Mail size={16} className="text-gray-500 shrink-0" />
          )}
          <div className="min-w-0">
            <div className="text-sm font-semibold text-gray-900 truncate">{who}</div>
            <div className="text-xs text-gray-500 truncate">
              {conversation.subject && <>{conversation.subject} · </>}
              {conversation.customerAddress}
              {conversation.clientId && (
                <>
                  {" · "}
                  <Link
                    href={`/admin/clients/${conversation.clientId}`}
                    className="text-[#008C9C] hover:underline">
                    View client
                  </Link>
                </>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {/* Who owns answering this.
              `needsHuman` said a person was needed and nothing said WHICH, so
              two admins could answer the same customer or both assume the
              other had. */}
          <label className="cv-assign">
            <span className="sr-only">Assign this conversation</span>
            <select
              id="cv-assign"
              value={conversation.assignedToId ?? ""}
              disabled={busy}
              onChange={(e) =>
                run(() => assignAiConversation(conversation.id, e.target.value || null))
              }>
              <option value="">Unassigned</option>
              {staff.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.id === meId ? `${u.name ?? "You"} (you)` : u.name ?? "Unnamed"}
                </option>
              ))}
            </select>
          </label>

          {conversation.assignedToId !== meId && (
            <button
              type="button"
              disabled={busy}
              className="cv-hdr-btn"
              onClick={() => run(() => assignAiConversation(conversation.id, meId))}>
              Take it
            </button>
          )}

          {/* Open until somebody says otherwise. Without this a handled
              conversation looked identical to a live one forever. */}
          <button
            type="button"
            disabled={busy}
            className={`cv-hdr-btn ${conversation.status === "CLOSED" ? "" : "primary"}`}
            onClick={() =>
              run(() =>
                setAiConversationStatus(
                  conversation.id,
                  conversation.status === "CLOSED" ? "OPEN" : "CLOSED",
                ),
              )
            }>
            {conversation.status === "CLOSED" ? "Reopen" : "Close"}
          </button>

          {conversation.needsHuman && conversation.status === "OPEN" && (
            <button
              type="button"
              disabled={busy}
              onClick={() => run(() => resolveAiConversation(conversation.id))}
              className="inline-flex items-center gap-1 text-xs font-semibold text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-2.5 py-1 hover:bg-amber-100 disabled:opacity-50">
              <Check size={13} /> Mark handled
            </button>
          )}
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              run(() => setAiConversationEnabled(conversation.id, !conversation.aiEnabled))
            }
            className={`inline-flex items-center gap-1 text-xs font-semibold rounded-full px-2.5 py-1 border disabled:opacity-50 ${
              conversation.aiEnabled
                ? "text-[#008C9C] bg-[#008C9C]/5 border-[#008C9C]/30 hover:bg-[#008C9C]/10"
                : "text-gray-500 bg-gray-100 border-gray-200 hover:bg-gray-200"
            }`}>
            <Bot size={13} />
            {conversation.aiEnabled ? "AI replies on" : "AI muted"}
          </button>
        </div>
      </div>

      {/* thread */}
      {/* One card for every message.
          These were three different materials — grey fill, teal tint, solid
          teal — for one conversation. Who sent it is carried by the label above
          the card and by which side it sits on, which is something you read
          rather than a colour you have to learn. */}
      <div className="cv-msgs">
        {messages.map((m) => (
          <div
            key={m.id}
            className={`cv-m ${m.author === "CUSTOMER" ? "in" : "out"}`}>
            <div className="cv-m-meta">
              {m.author === "ASSISTANT" && (
                <span className="cv-botchip">
                  <Bot size={10} aria-hidden="true" /> AI replied
                </span>
              )}
              <span>
                {m.author === "CUSTOMER" ? who : m.author === "ASSISTANT" ? "" : "You"}
                {m.author === "ASSISTANT" ? "" : " · "}
                {fmt.format(new Date(m.createdAt))}
              </span>
            </div>
            <div className="cv-bub">
              {m.body}
              {m.internalNote && (
                <div className="cv-m-note">Internal note: {m.internalNote}</div>
              )}
            </div>
          </div>
        ))}
        {messages.length === 0 && <p className="cv-none">No messages yet.</p>}
      </div>

      {/* reply box */}
      <form onSubmit={handleSend} className="cv-composer">
        <textarea
          value={reply}
          onChange={(e) => setReply(e.target.value)}
          rows={3}
          maxLength={1200}
          placeholder={`Reply to ${who} as your team…`}
          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[#008C9C]"
        />
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-gray-500">
            Sending a reply mutes the AI on this conversation until you turn it
            back on.
          </p>
          <Button type="submit" disabled={busy || !reply.trim()}>
            {busy ? "Sending…" : "Send"}
          </Button>
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
      </form>
    </div>
  );
}
