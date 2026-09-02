// Minimal Claude API client for the AI assistant.
//
// Raw fetch on purpose, matching how this codebase talks to Twilio: one
// endpoint, one shape, no SDK dependency to version-chase. Everything here is
// platform-level — ONE Anthropic key for the whole platform (set by Awer, not
// per tenant), the same way Twilio credentials work. Per-tenant spend control
// lives in the daily message cap, not in per-tenant keys.
//
// Env:
//   ANTHROPIC_API_KEY     required for the assistant to run at all. Absent →
//                         isAiConfigured() is false and every caller declines
//                         to answer rather than erroring. The feature ships
//                         dark until the key lands.
//   AI_ASSISTANT_MODEL    optional model override.
import "server-only";

const API_URL = "https://api.anthropic.com/v1/messages";
const API_VERSION = "2023-06-01";
const DEFAULT_MODEL = "claude-sonnet-5";

/** One turn of a conversation, oldest first. */
export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

export function isAiConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

/**
 * One model call. Returns the text of the reply, or null on ANY failure —
 * a missing key, a 429, a network blip. Callers treat null as "stay silent
 * and hand off to a human", which is always a safe answer for a receptionist.
 */
export async function callClaude(opts: {
  system: string;
  turns: ChatTurn[];
  maxTokens?: number;
  /** Seed the assistant's reply (e.g. "{") to steer it into JSON. */
  prefill?: string;
}): Promise<string | null> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return null;

  const messages: { role: string; content: string }[] = opts.turns.map((t) => ({
    role: t.role,
    content: t.content,
  }));
  if (opts.prefill) messages.push({ role: "assistant", content: opts.prefill });

  try {
    const res = await fetch(API_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": key,
        "anthropic-version": API_VERSION,
      },
      body: JSON.stringify({
        model: process.env.AI_ASSISTANT_MODEL || DEFAULT_MODEL,
        max_tokens: opts.maxTokens ?? 600,
        system: opts.system,
        messages,
      }),
      // A receptionist that answers in 40s answered too late. Fail, log, hand off.
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) {
      console.error(`[ai-assistant] Claude API ${res.status}: ${(await res.text()).slice(0, 300)}`);
      return null;
    }
    const data = (await res.json()) as {
      content?: { type: string; text?: string }[];
    };
    const text = (data.content ?? [])
      .filter((b) => b.type === "text" && typeof b.text === "string")
      .map((b) => b.text)
      .join("");
    return (opts.prefill ?? "") + text;
  } catch (err) {
    console.error("[ai-assistant] Claude API call failed:", err);
    return null;
  }
}
