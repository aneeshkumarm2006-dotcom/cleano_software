// AI assistant per-workspace configuration — the pure model half.
//
// Client-safe on purpose (no server imports): the Settings tab renders and
// edits this shape, while server code reads it through the settings registry.
// The registry rule applies: the default keeps the assistant OFF, so shipping
// this changes nothing for any workspace until an admin turns it on.

export const AI_ASSISTANT_KEY = "ai.assistant";
export const AI_ASSISTANT_CATEGORY = "ai";

export interface AiAssistantConfig {
  /** Master switch. OFF by default — the assistant ships dark. */
  enabled: boolean;
  /** Answer inbound SMS that aren't part of an active job's chat thread. */
  smsReplies: boolean;
  /** Answer inbound customer emails. */
  emailReplies: boolean;
  /**
   * Free-text business facts the admin wants the assistant to know — service
   * area quirks, "we don't do carpets", parking policy, anything not already
   * in Settings. This is the editable half of the knowledge base; services,
   * prices, hours and FAQs are injected live from their own settings so they
   * can never go stale here.
   */
  businessFacts: string;
  /**
   * Hard ceiling on AI-sent messages per workspace per day, across channels.
   * A runaway conversation (or a hostile texter) stops costing money here.
   */
  dailyMessageCap: number;
}

export const DEFAULT_AI_ASSISTANT: AiAssistantConfig = {
  enabled: false,
  smsReplies: true,
  emailReplies: true,
  businessFacts: "",
  dailyMessageCap: 200,
};

const CAP_MIN = 10;
const CAP_MAX = 2000;
const FACTS_MAX_LEN = 8000;

/**
 * Total normalizer — any stored or incoming value becomes a valid config, so
 * (like the booking-page config) there is no invalid value to reject.
 */
export function normalizeAiAssistantConfig(v: unknown): AiAssistantConfig {
  const raw = (v && typeof v === "object" && !Array.isArray(v) ? v : {}) as Record<
    string,
    unknown
  >;
  const bool = (x: unknown, fallback: boolean) =>
    typeof x === "boolean" ? x : x === "true" ? true : x === "false" ? false : fallback;
  const capRaw = Number(raw.dailyMessageCap);
  const cap = Number.isFinite(capRaw)
    ? Math.min(CAP_MAX, Math.max(CAP_MIN, Math.round(capRaw)))
    : DEFAULT_AI_ASSISTANT.dailyMessageCap;
  return {
    enabled: bool(raw.enabled, DEFAULT_AI_ASSISTANT.enabled),
    smsReplies: bool(raw.smsReplies, DEFAULT_AI_ASSISTANT.smsReplies),
    emailReplies: bool(raw.emailReplies, DEFAULT_AI_ASSISTANT.emailReplies),
    businessFacts:
      typeof raw.businessFacts === "string"
        ? raw.businessFacts.slice(0, FACTS_MAX_LEN)
        : DEFAULT_AI_ASSISTANT.businessFacts,
    dailyMessageCap: cap,
  };
}
