// Reporting a team chat message to the company's moderators (App Store
// guideline 1.2; POST /api/v1/team/messages/:messageId/report).
//
// Anyone on the staff can report someone else's message in a channel they can
// see. One report per person per message: reporting it again answers with the
// first report and raises nothing. A new report is an entry in the admin
// notification feed (the web's sidebar, the manager app's Alerts), which
// office roles see and field leads don't. Reporting hides and removes
// nothing; the moderators decide (moderateTeamMessage).
import "server-only";

import { Prisma } from "@prisma/client";
import type { MessageReportReason, ReportMessageResponse } from "@bookmops/api/v1";

import { recordAdminNotification } from "@/lib/admin-notifications";
import { db } from "@/lib/org-db";

import type { Actor } from "../actor";
import { effect } from "../effects";
import { failure, notFound, ok, type Result } from "../result";
import { accessibleChannel } from "./team-chat";

const MESSAGE_NOT_FOUND = "This message isn't available.";

const REASON_TEXT: Record<MessageReportReason, string> = {
  HARASSMENT: "Harassment or bullying",
  INAPPROPRIATE: "Inappropriate content",
  SPAM: "Spam",
  OTHER: "Something else",
};

/** How much of the reported message the alert quotes. */
const EXCERPT = 300;

export async function reportTeamMessage(
  actor: Actor,
  messageId: string,
  input: { reason: MessageReportReason; note?: string; clientEventId: string },
): Promise<Result<ReportMessageResponse>> {
  if (typeof messageId !== "string" || !messageId) return notFound(MESSAGE_NOT_FOUND);
  const message = await db.groupMessage.findFirst({
    where: { id: messageId },
    select: { id: true, channelId: true, senderId: true, senderName: true, body: true },
  });
  if (!message) return notFound(MESSAGE_NOT_FOUND);
  // Not in a channel the caller can see: the same answer as no message.
  if (!(await accessibleChannel(actor, message.channelId))) return notFound(MESSAGE_NOT_FOUND);
  if (message.senderId === actor.userId) {
    return failure(400, "CANNOT_REPORT_OWN", "You can't report your own message. Edit or delete it instead.");
  }

  const answer = (r: { id: string; createdAt: Date }) =>
    ({ id: r.id, messageId: message.id, reportedAt: r.createdAt.toISOString() }) satisfies ReportMessageResponse;
  const prior = () =>
    db.teamMessageReport.findFirst({
      where: { reporterId: actor.userId, messageId: message.id },
      select: { id: true, createdAt: true },
    });

  const existing = await prior();
  if (existing) return ok(answer(existing));

  const note = input.note?.trim() || null;
  let row: { id: string; createdAt: Date };
  try {
    row = await db.teamMessageReport.create({
      data: {
        messageId: message.id,
        reporterId: actor.userId,
        senderId: message.senderId,
        reason: input.reason,
        note,
        clientEventId: input.clientEventId,
      },
      select: { id: true, createdAt: true },
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      const again = await prior();
      if (again) return ok(answer(again));
    }
    throw e;
  }

  const reporter = actor.name?.trim() || "Someone";
  const quoted = message.body.length > EXCERPT ? `${message.body.slice(0, EXCERPT)}…` : message.body;
  return ok(answer(row), [
    effect("team message report alert", () =>
      recordAdminNotification({
        key: "admin.chat.message_reported",
        title: `Team chat message from ${message.senderName} reported`,
        body:
          `${reporter} reported it: ${REASON_TEXT[input.reason]}.` +
          (note ? ` Their note: ${note}` : "") +
          (quoted ? ` The message: "${quoted}"` : ""),
        href: "/admin/group-chat",
        severity: input.reason === "HARASSMENT" ? "ERROR" : "WARN",
      }),
    ),
  ]);
}
