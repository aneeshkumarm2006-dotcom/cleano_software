"use server";

import { db } from "@/lib/org-db";

export async function joinWaitlist(formData: FormData) {
  const email = (formData.get("email") as string)?.trim();
  const name = (formData.get("name") as string)?.trim() || null;
  const phone = (formData.get("phone") as string)?.trim() || null;
  const preferredDate = formData.get("preferredDate") as string;
  const serviceType = (formData.get("serviceType") as string) || null;
  const bedCountRaw = formData.get("bedCount") as string;
  const bathCountRaw = formData.get("bathCount") as string;
  const notes = (formData.get("notes") as string)?.trim() || null;

  if (!email || !preferredDate) {
    return { error: "Email and preferred date are required." };
  }

  const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRe.test(email)) {
    return { error: "Please enter a valid email address." };
  }

  const date = new Date(preferredDate);
  if (isNaN(date.getTime()) || date < new Date()) {
    return { error: "Please choose a future date." };
  }

  const bedCount = bedCountRaw ? parseInt(bedCountRaw, 10) : null;
  const bathCount = bathCountRaw ? parseInt(bathCountRaw, 10) : null;

  await db.waitlist.create({
    data: {
      email,
      name,
      phone,
      preferredDate: date,
      serviceType,
      bedCount: bedCount && !isNaN(bedCount) ? bedCount : null,
      bathCount: bathCount && !isNaN(bathCount) ? bathCount : null,
      notes,
      status: "WAITING",
    },
  });

  return { success: true };
}
