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
  /**
   * The follow-up sequence: quiet-day thresholds, ascending. [3, 10, 30]
   * means a lead who has been silent 3 days gets touch one, silent 10 days
   * gets touch two, silent 30 days gets touch three — then the sequence ends
   * (the lead flips to CONTACTED). A reply resets the count: re-engagement
   * restarts the clock. Empty = off, and off is the default: nobody's leads
   * get messaged because we shipped code.
   *
   * (Replaces the earlier single `leadFollowUpDays`; the normalizer migrates
   * a stored single value into a one-touch sequence.)
   */
  followUpSequenceDays: number[];
}

export const DEFAULT_AI_ASSISTANT: AiAssistantConfig = {
  enabled: false,
  smsReplies: true,
  emailReplies: true,
  businessFacts: "",
  dailyMessageCap: 200,
  followUpSequenceDays: [],
};

const SEQUENCE_MAX_TOUCHES = 5;
const SEQUENCE_MAX_DAYS = 365;

/** Parse anything (array, legacy number, "3, 10, 30" string) into a valid sequence. */
export function normalizeFollowUpSequence(v: unknown): number[] {
  const rawList: unknown[] = Array.isArray(v)
    ? v
    : typeof v === "string"
      ? v.split(/[,\s]+/)
      : typeof v === "number"
        ? [v]
        : [];
  const days = rawList
    .map((x) => Math.round(Number(x)))
    .filter((n) => Number.isFinite(n) && n >= 1 && n <= SEQUENCE_MAX_DAYS);
  // ascending + unique keeps the semantics coherent regardless of input order
  const sorted = [...new Set(days)].sort((a, b) => a - b);
  return sorted.slice(0, SEQUENCE_MAX_TOUCHES);
}

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
  // Prefer the sequence; fall back to migrating a stored single-number config
  // from the earlier shape so nobody's setting silently turns off.
  const sequence =
    raw.followUpSequenceDays !== undefined
      ? normalizeFollowUpSequence(raw.followUpSequenceDays)
      : normalizeFollowUpSequence(raw.leadFollowUpDays);
  return {
    enabled: bool(raw.enabled, DEFAULT_AI_ASSISTANT.enabled),
    smsReplies: bool(raw.smsReplies, DEFAULT_AI_ASSISTANT.smsReplies),
    emailReplies: bool(raw.emailReplies, DEFAULT_AI_ASSISTANT.emailReplies),
    businessFacts:
      typeof raw.businessFacts === "string"
        ? raw.businessFacts.slice(0, FACTS_MAX_LEN)
        : DEFAULT_AI_ASSISTANT.businessFacts,
    dailyMessageCap: cap,
    followUpSequenceDays: sequence,
  };
}
