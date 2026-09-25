import { type OnMyWayRequest, OnMyWayResponse, OnMyWayState } from "../v1/on-my-way";
import { json, type Request, seg } from "./request";

export const onMyWayApi = (request: Request) => ({
  onMyWayState: (jobId: string) => request(`/api/v1/jobs/${seg(jobId)}/on-my-way`, OnMyWayState),
  markOnMyWay: (jobId: string, body: OnMyWayRequest) =>
    request(`/api/v1/jobs/${seg(jobId)}/on-my-way`, OnMyWayResponse, json("POST", body, body.clientEventId)),
});
