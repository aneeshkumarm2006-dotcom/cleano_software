"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Bot, Check, Mail, MessageSquare } from "lucide-react";
import Button from "@/components/ui/Button";
import {
  replyToAiConversation,
  resolveAiConversation,
  setAiConversationEnabled,
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
  clientId: string | null;
  clientName: string | null;
}

export default function ConversationThread({
  conversation,
  messages,
}: {
  conversation: Conversation;
  messages: Message[];
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
    <div className="space-y-4">
      {/* header */}
      <div className="bg-white border border-gray-200 rounded-xl px-4 py-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          {conversation.channel === "SMS" ? (
            <MessageSquare size={16} className="text-gray-400 shrink-0" />
          ) : (
            <Mail size={16} className="text-gray-400 shrink-0" />
          )}
          <div className="min-w-0">
            <div className="text-sm font-semibold text-gray-900 truncate">{who}</div>
            <div className="text-xs text-gray-500 truncate">
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
        <div className="flex items-center gap-2">
          {conversation.needsHuman && (
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
      <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-3">
        {messages.map((m) => (
          <div
            key={m.id}
            className={`flex ${m.author === "CUSTOMER" ? "justify-start" : "justify-end"}`}>
            <div
              className={`max-w-[80%] rounded-2xl px-3.5 py-2 text-sm whitespace-pre-wrap ${
                m.author === "CUSTOMER"
                  ? "bg-gray-100 text-gray-900"
                  : m.author === "ASSISTANT"
                    ? "bg-[#008C9C]/10 text-gray-900"
                    : "bg-[#008C9C] text-white"
              }`}>
              <div className="text-[11px] font-semibold opacity-70 mb-0.5">
                {m.author === "CUSTOMER" ? who : m.author === "ASSISTANT" ? "AI assistant" : "You"}
                {" · "}
                {fmt.format(new Date(m.createdAt))}
              </div>
              {m.body}
              {m.internalNote && (
                <div className="text-[11px] italic opacity-60 mt-1">
                  Internal note: {m.internalNote}
                </div>
              )}
            </div>
          </div>
        ))}
        {messages.length === 0 && (
          <p className="text-sm text-gray-500 text-center py-6">No messages yet.</p>
        )}
      </div>

      {/* reply box */}
      <form
        onSubmit={handleSend}
        className="bg-white border border-gray-200 rounded-xl p-4 space-y-2">
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
