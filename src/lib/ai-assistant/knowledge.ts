// The assistant's knowledge base for ONE workspace, assembled fresh per reply.
//
// Deliberately built from the same settings the rest of the app obeys —
// services from the catalog, deposits and policies from the registry, FAQs
// from Settings → Website — plus the admin's free-text facts. Nothing is
// copied into a second store, so the assistant can never quote a price or a
// service the admin has since changed: it reads what the app enforces.
//
// Everything here runs inside the caller's org context (runAsOrg or a request
// on the workspace's host), which is what scopes `db` and getSetting.
import "server-only";

import { db } from "@/lib/org-db";
import { platformDb } from "@/lib/platform-db";
import { requireOrgId } from "@/lib/org";
import { getSetting } from "@/lib/settings";
import { getServiceCatalog } from "@/lib/service-catalog.server";
import { originForSlug } from "@/lib/tenant";
import {
  PC_DEPOSIT_SETTING_KEY,
  STANDARD_DEPOSIT_SETTING_KEY,
} from "@/lib/booking-deposit";
import {
  AI_ASSISTANT_KEY,
  normalizeAiAssistantConfig,
  type AiAssistantConfig,
} from "./config";

export interface WorkspaceKnowledge {
  config: AiAssistantConfig;
  businessName: string;
  /** Absolute booking URL, the assistant's main call to action. */
  bookingUrl: string;
  /** The full system-prompt "facts" section, ready to hand to the model. */
  facts: string;
}

/** Read + normalize the assistant config for the current org. */
export async function getAiAssistantConfig(): Promise<AiAssistantConfig> {
  const raw = await getSetting(AI_ASSISTANT_KEY);
  return normalizeAiAssistantConfig(raw);
}

/**
 * Assemble the knowledge base. Each source degrades independently — a failed
 * read drops that section rather than the whole reply (the assistant saying
 * "I'll have a teammate confirm" beats a 500 on Twilio's webhook).
 */
export async function buildWorkspaceKnowledge(): Promise<WorkspaceKnowledge> {
  const orgId = await requireOrgId();

  const [config, businessName, businessPhone, businessEmail, timezone] =
    await Promise.all([
      getAiAssistantConfig(),
      getSetting("general.businessName"),
      getSetting("general.businessPhone"),
      getSetting("general.businessEmail"),
      getSetting("general.timezone"),
    ]);

  const org = await platformDb.organization
    .findUnique({ where: { id: orgId }, select: { slug: true } })
    .catch(() => null);
  const origin = org ? originForSlug(org.slug) : "";
  const bookingUrl = origin ? `${origin}/book` : "";

  const sections: string[] = [];

  sections.push(
    [
      `Business name: ${businessName}`,
      businessPhone ? `Phone: ${businessPhone}` : "",
      businessEmail ? `Email: ${businessEmail}` : "",
      timezone ? `Timezone: ${timezone}` : "",
      bookingUrl ? `Online booking page (share this link): ${bookingUrl}` : "",
    ]
      .filter(Boolean)
      .join("\n"),
  );

  // Services offered — names only. Prices are quoted by the booking page,
  // never by the assistant (see the guardrails in respond.ts).
  try {
    const catalog = await getServiceCatalog();
    const active = catalog.filter((s) => s.isActive).map((s) => s.name);
    if (active.length > 0) {
      sections.push(`Services offered:\n${active.map((n) => `- ${n}`).join("\n")}`);
    }
  } catch {
    /* section dropped */
  }

  // Service areas — where "do you clean in X?" gets a real answer.
  try {
    const areas = await db.serviceArea.findMany({
      where: { isActive: true },
      select: { zoneName: true, prefix: true },
      orderBy: { zoneName: "asc" },
      take: 200,
    });
    if (areas.length > 0) {
      sections.push(
        `Service areas (postal-code prefix — zone):\n${areas
          .map((a) => `- ${a.prefix} — ${a.zoneName}`)
          .join("\n")}`,
      );
    }
  } catch {
    /* section dropped */
  }

  // Booking policies straight from the registry — the same numbers the app
  // enforces when someone actually books or cancels.
  try {
    const [deposit, pcDeposit, cancelFee, cancelWindow, minLeadDays] =
      await Promise.all([
        getSetting(STANDARD_DEPOSIT_SETTING_KEY),
        getSetting(PC_DEPOSIT_SETTING_KEY),
        getSetting("policy.cancellationFeeUsd"),
        getSetting("policy.cancellationFeeWindowHours"),
        getSetting("scheduling.minLeadDays"),
      ]);
    sections.push(
      [
        "Booking policies:",
        `- Booking deposit: $${deposit} (post-construction: $${pcDeposit}), applied toward the total.`,
        `- Cancellation fee: $${cancelFee} when cancelling less than ${cancelWindow} hours before the appointment.`,
        minLeadDays > 0
          ? `- Bookings need at least ${minLeadDays} day(s) of lead time.`
          : "",
      ]
        .filter(Boolean)
        .join("\n"),
    );
  } catch {
    /* section dropped */
  }

  // Admin-written FAQs, verbatim — the closest thing to the company's voice.
  try {
    const faqs = await getSetting("content.faqs");
    if (Array.isArray(faqs) && faqs.length > 0) {
      sections.push(
        `Frequently asked questions:\n${faqs
          .map((f) => `Q: ${f.question}\nA: ${f.answer}`)
          .join("\n\n")}`,
      );
    }
  } catch {
    /* section dropped */
  }

  if (config.businessFacts.trim()) {
    sections.push(`Notes from the team (authoritative):\n${config.businessFacts.trim()}`);
  }

  return {
    config,
    businessName,
    bookingUrl,
    facts: sections.join("\n\n"),
  };
}
