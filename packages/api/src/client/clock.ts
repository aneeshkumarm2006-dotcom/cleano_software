import {
  ChecklistItem,
  ChecklistResponse,
  type ClockEvent,
  type ClockOutRequest,
  ClockOutResponse,
  ClockStateResponse,
  KitReportResponse,
} from "../v1/clock";
import { json, type Request, seg } from "./request";

export const clockApi = (request: Request) => ({
  clockState: (jobId: string) => request(`/api/v1/jobs/${seg(jobId)}/clock`, ClockStateResponse),
  clockIn: (jobId: string, event: ClockEvent) =>
    request(`/api/v1/jobs/${seg(jobId)}/clock-in`, ClockStateResponse, json("POST", event, event.clientEventId)),
  startBreak: (jobId: string, event: ClockEvent) =>
    request(`/api/v1/jobs/${seg(jobId)}/breaks`, ClockStateResponse, json("POST", event, event.clientEventId)),
  endBreak: (jobId: string, event: ClockEvent) =>
    request(`/api/v1/jobs/${seg(jobId)}/breaks/current/end`, ClockStateResponse, json("POST", event, event.clientEventId)),
  kitReport: (jobId: string) => request(`/api/v1/jobs/${seg(jobId)}/kit-report`, KitReportResponse),
  clockOut: (jobId: string, body: ClockOutRequest) =>
    request(`/api/v1/jobs/${seg(jobId)}/clock-out`, ClockOutResponse, json("POST", body, body.clientEventId)),
  checklist: (jobId: string) => request(`/api/v1/jobs/${seg(jobId)}/checklist`, ChecklistResponse),
  setChecklistItem: (jobId: string, itemId: string, done: boolean, clientEventId: string) =>
    request(
      `/api/v1/jobs/${seg(jobId)}/checklist/${seg(itemId)}`,
      ChecklistItem,
      json("PUT", { done, clientEventId }, clientEventId),
    ),
});
