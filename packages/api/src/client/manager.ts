// The manager side of the app: the team's day, crews, approvals, alerts and
// the office inbox. Every mutation carries the clientEventId made when the
// person confirmed, as its idempotency key (manager-access.ts rule 5).
import {
  ApprovalsSummaryResponse,
  type KitDecisionRequest,
  KitRequestItem,
  KitRequestsResponse,
  ManagedWithdrawal,
  type TimeDecisionRequest,
  TimeItemResponse,
  TimeItemsResponse,
  type WithdrawalDecisionRequest,
  WithdrawalsQueueResponse,
} from "../v1/manager-approvals";
import {
  AlertsResponse,
  IssueResponse,
  IssuesResponse,
  type IssueStatusRequest,
  LateArrivalsResponse,
  type MarkAlertsReadRequest,
  MarkAlertsReadResponse,
} from "../v1/manager-inbox";
import {
  ManagerMarkReadResponse,
  ManagerMessagesResponse,
  ModerateTeamMessageResponse,
  OfficeConversationResponse,
  OfficeConversationsResponse,
  SendManagerMessageResponse,
} from "../v1/manager-messages";
import {
  type AddCleanerRequest,
  CandidatesResponse,
  CrewChangeResponse,
  ManagerJobResponse,
  type SetCrewRequest,
  TeamDayResponse,
} from "../v1/manager-team";
import type { SendMessageRequest } from "../v1/messages";
import { json, type Request, seg } from "./request";

/** "?a=1&cursor=…", leaving out what isn't set. */
function query(params: Record<string, string | null | undefined>): string {
  const parts = Object.entries(params)
    .filter((e): e is [string, string] => typeof e[1] === "string" && e[1] !== "")
    .map(([k, v]) => `${k}=${seg(v)}`);
  return parts.length ? `?${parts.join("&")}` : "";
}

const M = "/api/v1/manager";

export const managerApi = (request: Request) => ({
  // The team's day and one job
  teamDay: (date?: string | null) => request(`${M}/team/day${query({ date })}`, TeamDayResponse),
  managerJob: (jobId: string) => request(`${M}/jobs/${seg(jobId)}`, ManagerJobResponse),
  crewCandidates: (jobId: string) => request(`${M}/jobs/${seg(jobId)}/candidates`, CandidatesResponse),
  setCrew: (jobId: string, body: SetCrewRequest) =>
    request(`${M}/jobs/${seg(jobId)}/crew`, CrewChangeResponse, json("PUT", body, body.clientEventId)),
  addCleaner: (jobId: string, body: AddCleanerRequest) =>
    request(`${M}/jobs/${seg(jobId)}/cleaners`, CrewChangeResponse, json("POST", body, body.clientEventId)),

  // Approvals
  approvalsSummary: () => request(`${M}/approvals/summary`, ApprovalsSummaryResponse),
  timeItems: (status: "pending" | "decided", cursor?: string | null) =>
    request(`${M}/approvals/time${query({ status, cursor })}`, TimeItemsResponse),
  timeItem: (id: string) => request(`${M}/approvals/time/${seg(id)}`, TimeItemResponse),
  decideTime: (id: string, body: TimeDecisionRequest) =>
    request(`${M}/approvals/time/${seg(id)}/decision`, TimeItemResponse, json("POST", body, body.clientEventId)),
  withdrawalsQueue: (status: "open" | "handled", cursor?: string | null) =>
    request(`${M}/withdrawals${query({ status, cursor })}`, WithdrawalsQueueResponse),
  decideWithdrawal: (id: string, body: WithdrawalDecisionRequest) =>
    request(`${M}/withdrawals/${seg(id)}/decision`, ManagedWithdrawal, json("POST", body, body.clientEventId)),
  kitRequests: (cursor?: string | null) => request(`${M}/kit-requests${query({ cursor })}`, KitRequestsResponse),
  decideKitRequest: (id: string, body: KitDecisionRequest) =>
    request(`${M}/kit-requests/${seg(id)}/decision`, KitRequestItem, json("POST", body, body.clientEventId)),

  // Alerts and problems
  alerts: (cursor?: string | null) => request(`${M}/alerts${query({ cursor })}`, AlertsResponse),
  markAlertsRead: (body: MarkAlertsReadRequest) => request(`${M}/alerts/read`, MarkAlertsReadResponse, json("POST", body)),
  lateArrivals: (cursor?: string | null) => request(`${M}/late-arrivals${query({ cursor })}`, LateArrivalsResponse),
  issues: (status: "open" | "resolved", cursor?: string | null) =>
    request(`${M}/issues${query({ status, cursor })}`, IssuesResponse),
  issue: (id: string) => request(`${M}/issues/${seg(id)}`, IssueResponse),
  setIssueStatus: (id: string, body: IssueStatusRequest) =>
    request(`${M}/issues/${seg(id)}/status`, IssueResponse, json("POST", body, body.clientEventId)),

  // The office inbox
  officeConversations: (cursor?: string | null) =>
    request(`${M}/chat/conversations${query({ cursor })}`, OfficeConversationsResponse),
  officeConversation: (cleanerId: string) =>
    request(`${M}/chat/conversations/${seg(cleanerId)}`, OfficeConversationResponse),
  conversationMessages: (cleanerId: string, cursor?: string | null) =>
    request(`${M}/chat/conversations/${seg(cleanerId)}/messages${query({ cursor })}`, ManagerMessagesResponse),
  replyAsOffice: (cleanerId: string, body: SendMessageRequest) =>
    request(
      `${M}/chat/conversations/${seg(cleanerId)}/messages`,
      SendManagerMessageResponse,
      json("POST", body, body.clientEventId),
    ),
  markConversationRead: (cleanerId: string) =>
    request(`${M}/chat/conversations/${seg(cleanerId)}/read`, ManagerMarkReadResponse, json("POST", {})),

  // Moderating team chat
  moderateTeamMessage: (channelId: string, messageId: string) =>
    request(
      `${M}/team/channels/${seg(channelId)}/messages/${seg(messageId)}`,
      ModerateTeamMessageResponse,
      json("DELETE"),
    ),
});
