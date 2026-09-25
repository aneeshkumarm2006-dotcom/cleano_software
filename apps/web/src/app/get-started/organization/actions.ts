"use server";

/**
 * The Organization tier request form.
 *
 * Unauthenticated, like signup, and written the same way: everything the browser
 * sends is re-validated here, and the response never says more than it should.
 */
import { headers } from "next/headers";

import { platformDb } from "@/lib/platform-db";
import { slugify } from "@/lib/provisioning";

export type RequestResult =
  | { ok: true }
  | {
      ok: false;
      field: "company" | "contact" | "email" | "phone" | "message" | "form";
      message: string;
    };

const MAX_SHORT = 120;
const MAX_MESSAGE = 2_000;

const WINDOW_MS = 60 * 60 * 1000;
const PER_ADDRESS_PER_HOUR = 3;

const attempts = new Map<string, number[]>();

function tooMany(key: string): boolean {
  const now = Date.now();
  const recent = (attempts.get(key) ?? []).filter((t) => now - t < WINDOW_MS);
  recent.push(now);
  attempts.set(key, recent);
  if (attempts.size > 5_000) {
    for (const [k, times] of attempts) {
      if (times.every((t) => now - t >= WINDOW_MS)) attempts.delete(k);
    }
  }
  return recent.length > PER_ADDRESS_PER_HOUR;
}

export async function submitAccessRequest(input: {
  companyName: string;
  contactName: string;
  email: string;
  phone: string;
  fleetSize: string;
  wantedSlug: string;
  message: string;
  /** Left empty by people and filled in by scripts. */
  website?: string;
}): Promise<RequestResult> {
  // A field hidden from people and irresistible to form-filling bots. Answering
  // "thanks, we'll be in touch" rather than "rejected" means a script has no
  // signal to tune against.
  if (input.website && input.website.trim() !== "") return { ok: true };

  const companyName = String(input.companyName ?? "").trim().slice(0, MAX_SHORT);
  const contactName = String(input.contactName ?? "").trim().slice(0, MAX_SHORT);
  const email = String(input.email ?? "").trim().toLowerCase().slice(0, MAX_SHORT);
  const phone = String(input.phone ?? "").trim().slice(0, 40);
  const fleetSize = String(input.fleetSize ?? "").trim().slice(0, 60);
  const wantedSlug = slugify(String(input.wantedSlug ?? "")).slice(0, 40);
  const message = String(input.message ?? "").trim().slice(0, MAX_MESSAGE);

  if (companyName.length < 2) {
    return { ok: false, field: "company", message: "Tell us the company's name." };
  }
  if (contactName.length < 2) {
    return { ok: false, field: "contact", message: "Tell us who we should reply to." };
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { ok: false, field: "email", message: "We need a working email to reply to." };
  }

  const h = await headers();
  const from = (h.get("x-forwarded-for")?.split(",")[0] ?? h.get("x-real-ip") ?? "unknown").trim();

  if (tooMany(from)) {
    return {
      ok: false,
      field: "form",
      message: "You have already sent this a few times. We have it — we will reply.",
    };
  }

  try {
    // No duplicate check. Someone chasing a reply by sending it twice should not
    // be told off by a form; two rows are cheap and the console shows both.
    await platformDb.accessRequest.create({
      data: {
        companyName,
        contactName,
        email,
        phone: phone || null,
        fleetSize: fleetSize || null,
        wantedSlug: wantedSlug || null,
        message: message || null,
        submittedFrom: from,
      },
    });
    return { ok: true };
  } catch (e) {
    console.error("access request failed", e);
    return {
      ok: false,
      field: "form",
      message: "Something went wrong sending that. Please try again in a moment.",
    };
  }
}
