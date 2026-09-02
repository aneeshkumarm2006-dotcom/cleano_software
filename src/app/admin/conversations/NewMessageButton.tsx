"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { MessageSquarePlus, X } from "lucide-react";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import { startAiConversation } from "../actions/aiConversations";

/**
 * Staff starts a conversation. The assistant stays on for the thread (that is
 * the point: open the door, let it handle whoever walks through), which the
 * dialog says out loud so nobody is surprised.
 */
export default function NewMessageButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [channel, setChannel] = useState<"SMS" | "EMAIL">("SMS");
  const [to, setTo] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await startAiConversation({ channel, to, subject, body });
    setBusy(false);
    if (res.success) {
      setOpen(false);
      setTo("");
      setSubject("");
      setBody("");
      router.push(`/admin/conversations/${res.conversationId}`);
    } else {
      setError(res.error);
    }
  }

  return (
    <>
      <Button type="button" onClick={() => setOpen(true)}>
        <MessageSquarePlus size={16} className="mr-1.5" />
        New message
      </Button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-semibold text-gray-900">New message</h2>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="text-gray-400 hover:text-gray-600">
                <X size={18} />
              </button>
            </div>
            <form onSubmit={handleSend} className="space-y-3">
              <div className="flex gap-2">
                {(["SMS", "EMAIL"] as const).map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setChannel(c)}
                    className={`px-3 py-1.5 rounded-lg text-sm font-medium border ${
                      channel === c
                        ? "border-[#008C9C] text-[#008C9C] bg-[#008C9C]/5"
                        : "border-gray-200 text-gray-500 hover:bg-gray-50"
                    }`}>
                    {c === "SMS" ? "Text message" : "Email"}
                  </button>
                ))}
              </div>
              <Input
                variant="form"
                type={channel === "SMS" ? "tel" : "email"}
                placeholder={channel === "SMS" ? "Phone number" : "Email address"}
                value={to}
                onChange={(e) => setTo(e.target.value)}
                required
              />
              {channel === "EMAIL" && (
                <Input
                  variant="form"
                  type="text"
                  placeholder="Subject"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                />
              )}
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={4}
                maxLength={1200}
                placeholder="Your message…"
                required
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[#008C9C]"
              />
              <p className="text-xs text-gray-500">
                If they reply, the AI assistant will answer for you (when it's
                turned on). You can mute it on the conversation any time.
              </p>
              {error && <p className="text-sm text-red-600">{error}</p>}
              <div className="flex justify-end gap-2">
                <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={busy || !to.trim() || !body.trim()}>
                  {busy ? "Sending…" : "Send"}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
