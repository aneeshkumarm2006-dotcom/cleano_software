"use server";

import { db } from "@/lib/org-db";

interface SaveLeadInput {
  email: string;
  name?: string;
  phone?: string;
  postalCode?: string;
  dropOffStep?: number;
  serviceType?: string;
  bedCount?: number;
  bathCount?: number;
  halfBathCount?: number;
  squareFootage?: number;
  preferredDate?: string | null;
  isFlexible?: boolean;
  preferredSlot?: string;
  payload?: Record<string, unknown>;
  source?: string;
  outOfArea?: boolean;
}

// Public action — upsert a Lead as the visitor moves through the booking form.
// Called incrementally with debounce from the wizard.
export async function saveLead(input: SaveLeadInput) {
  try {
    const email = input.email?.trim().toLowerCase();
    if (!email) return { success: false, error: "Email is required" };

    const existing = await db.lead.findFirst({
      where: { email, status: { in: ["NEW", "CONTACTED"] } },
      orderBy: { createdAt: "desc" },
    });

    const data = {
      email,
      name: input.name?.trim() || null,
      phone: input.phone?.trim() || null,
      postalCode: input.postalCode?.trim().toUpperCase() || null,
      dropOffStep: input.dropOffStep ?? null,
      serviceType: input.serviceType || null,
      bedCount: input.bedCount ?? null,
      bathCount: input.bathCount ?? null,
      halfBathCount: input.halfBathCount ?? null,
      squareFootage: input.squareFootage ?? null,
      preferredDate: input.preferredDate ? new Date(input.preferredDate) : null,
      isFlexible: input.isFlexible ?? false,
      preferredSlot: input.preferredSlot || null,
      payload: (input.payload as never) ?? undefined,
      source: input.source || "web",
      status: input.outOfArea ? ("OUT_OF_AREA" as const) : ("NEW" as const),
      lastActivityAt: new Date(),
    };

    if (existing) {
      await db.lead.update({ where: { id: existing.id }, data });
      return { success: true, leadId: existing.id };
    }

    const created = await db.lead.create({ data });
    return { success: true, leadId: created.id };
  } catch (error) {
    console.error("Error saving lead:", error);
    return { success: false, error: "Failed to save lead" };
  }
}
