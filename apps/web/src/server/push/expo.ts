// The Expo Push API sender (https://docs.expo.dev/push-notifications/sending-notifications/).
//
// A fixed URL, never one from input. EXPO_ACCESS_TOKEN, when set, is sent as
// a bearer token: that is Expo's "enhanced security for push notifications",
// which the owner should switch on for the project before release. The token
// and the push tokens are never logged.
import "server-only";

import { EXPO_BATCH_MAX, PushSendError, type PushMessage, type PushSender, type PushTicket } from "./core";

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
const TIMEOUT_MS = 10_000;

export const expoSender: PushSender = {
  async send(messages: PushMessage[]): Promise<PushTicket[]> {
    if (messages.length === 0) return [];
    if (messages.length > EXPO_BATCH_MAX) throw new PushSendError("batch too large", false);

    const headers: Record<string, string> = {
      Accept: "application/json",
      "Accept-Encoding": "gzip, deflate",
      "Content-Type": "application/json",
    };
    const accessToken = process.env.EXPO_ACCESS_TOKEN?.trim();
    if (accessToken) headers.Authorization = `Bearer ${accessToken}`;

    let res: Response;
    try {
      res = await fetch(EXPO_PUSH_URL, {
        method: "POST",
        headers,
        body: JSON.stringify(messages),
        signal: AbortSignal.timeout(TIMEOUT_MS),
        redirect: "error",
        cache: "no-store",
      });
    } catch {
      throw new PushSendError("network", true);
    }

    if (res.status === 429 || res.status >= 500) throw new PushSendError(`http ${res.status}`, true);
    if (!res.ok) throw new PushSendError(`http ${res.status}`, false);

    let body: unknown;
    try {
      body = await res.json();
    } catch {
      throw new PushSendError("unreadable response", true);
    }
    const data = (body as { data?: unknown } | null)?.data;
    if (!Array.isArray(data)) throw new PushSendError("no tickets", false);
    return data.map((t): PushTicket => {
      const ticket = t as { status?: unknown; id?: unknown; message?: unknown; details?: { error?: unknown } };
      if (ticket?.status === "ok") return { status: "ok", id: typeof ticket.id === "string" ? ticket.id : undefined };
      const error = typeof ticket?.details?.error === "string" ? ticket.details.error : undefined;
      return { status: "error", details: error ? { error } : undefined };
    });
  },
};
