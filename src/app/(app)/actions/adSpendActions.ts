"use server";

import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { db } from "@/db";
import { revalidatePath } from "next/cache";
import { CHANNELS } from "@/lib/cpa-meta";

type Result = { success: true } | { error: string };

const CHANNEL_IDS = new Set(CHANNELS.filter((c) => c.paid).map((c) => c.id));

export async function addAdSpend(input: {
  channel: string;
  date: string;
  amount: number;
  source?: string;
}): Promise<Result> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return { error: "Unauthorized" };
  const role = (session.user as { role?: string }).role;
  if (role !== "OWNER" && role !== "ADMIN") return { error: "Forbidden" };

  if (!CHANNEL_IDS.has(input.channel)) return { error: "Pick a paid channel" };
  const amount = Number(input.amount);
  if (!Number.isFinite(amount) || amount <= 0) return { error: "Amount must be greater than 0" };
  const date = new Date(input.date);
  if (isNaN(date.getTime())) return { error: "Invalid date" };

  try {
    await db.adSpendImport.create({
      data: {
        channel: input.channel,
        date,
        amount,
        source: input.source?.trim() || "Manual",
        importedById: session.user.id,
      },
    });
    revalidatePath("/reports");
    return { success: true };
  } catch (e) {
    console.error("addAdSpend", e);
    return { error: "Failed to record spend" };
  }
}
