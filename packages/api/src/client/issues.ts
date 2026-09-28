import { JobIssue, JobIssuesResponse, type ReportIssueRequest } from "../v1/issues";
import { json, type Request, seg } from "./request";

export const issuesApi = (request: Request) => ({
  jobIssues: (jobId: string, cursor?: string | null) =>
    request(`/api/v1/jobs/${seg(jobId)}/issues${cursor ? `?cursor=${seg(cursor)}` : ""}`, JobIssuesResponse),
  reportJobIssue: (jobId: string, body: ReportIssueRequest) =>
    request(`/api/v1/jobs/${seg(jobId)}/issues`, JobIssue, json("POST", body, body.clientEventId)),
});
