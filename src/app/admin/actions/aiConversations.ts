"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/org-db";
import { requireOwnerAdmin } from "@/lib/action-guards";
import { logActivity } from "@/lib/activity-log";
import { sendSms } from "@/lib/sms";

type Result = { success: true } | { success: false; error: string };

/**
 * A staff member answers an AI conversation themselves.
 *
 * Replying IS taking over: the assistant is muted on the thread the moment a
 * human speaks on it, because nothing reads worse to a customer than a bot
 * answering over the person who just introduced themselves. The admin can
 * hand the thread back with setAiConversationEnabled.
 */
export async function replyToAiConversation(
  conversationId: string,
  body: string,
): Promise<Result> {
  const guard = await requireOwnerAdmin();
  if ("error" in guard) return { success: false, error: guard.error };

  const text = body.trim();
  if (!text) return { success: false, error: "Write a message first." };
  if (text.length > 1200)
    return { success: false, error: "Keep replies under 1200 characters." };

  const convo = await db.aiConversation.findUnique({
    where: { id: conversationId },
  });
  if (!convo) return { success: false, error: "Conversation not found." };

  if (convo.channel !== "SMS") {
    // Email conversations arrive with the email leg of the assistant; the
    // staff reply path for them ships with it.
    return { success: false, error: "Replying to email conversations isn't available yet." };
  }

  const sent = await sendSms({ to: convo.customerAddress, body: text });
  if (!sent.sent) {
    return {
      success: false,
      error: "The text couldn't be sent. Check the workspace's SMS number and try again.",
    };
  }

  await db.aiMessage.create({
    data: {
      conversationId: convo.id,
      direction: "OUTBOUND",
      author: "STAFF",
      body: text,
    },
  });
  await db.aiConversation.update({
    where: { id: convo.id },
    data: { aiEnabled: false, needsHuman: false, lastMessageAt: new Date() },
  });

  await logActivity({
    category: "SMS",
    action: "ai_conversation.staff_reply",
    status: "SUCCESS",
    targetType: "aiConversation",
    targetId: convo.id,
    message: text.slice(0, 160),
  });

  revalidatePath(`/admin/conversations/${convo.id}`);
  revalidatePath("/admin/conversations");
  return { success: true };
}

/** Mute or un-mute the assistant on one conversation. */
export async function setAiConversationEnabled(
  conversationId: string,
  enabled: boolean,
): Promise<Result> {
  const guard = await requireOwnerAdmin();
  if ("error" in guard) return { success: false, error: guard.error };

  const convo = await db.aiConversation.findUnique({
    where: { id: conversationId },
    select: { id: true },
  });
  if (!convo) return { success: false, error: "Conversation not found." };

  await db.aiConversation.update({
    where: { id: conversationId },
    data: { aiEnabled: enabled },
  });
  revalidatePath(`/admin/conversations/${conversationId}`);
  revalidatePath("/admin/conversations");
  return { success: true };
}

/** Clear the "needs a human" flag once the team has dealt with the thread. */
export async function resolveAiConversation(
  conversationId: string,
): Promise<Result> {
  const guard = await requireOwnerAdmin();
  if ("error" in guard) return { success: false, error: guard.error };

  const convo = await db.aiConversation.findUnique({
    where: { id: conversationId },
    select: { id: true },
  });
  if (!convo) return { success: false, error: "Conversation not found." };

  await db.aiConversation.update({
    where: { id: conversationId },
    data: { needsHuman: false },
  });
  revalidatePath(`/admin/conversations/${conversationId}`);
  revalidatePath("/admin/conversations");
  return { success: true };
}
