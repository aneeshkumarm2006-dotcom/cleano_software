import {
  AnnouncementsResponse,
  type MarkAnnouncementsReadRequest,
  MarkAnnouncementsReadResponse,
  type SetReactionRequest,
  SetReactionResponse,
} from "../v1/announcements";
import { json, type Request, seg } from "./request";

export const announcementsApi = (request: Request) => ({
  announcements: (cursor?: string | null) =>
    request(`/api/v1/announcements${cursor ? `?cursor=${seg(cursor)}` : ""}`, AnnouncementsResponse),
  markAnnouncementsRead: (body: MarkAnnouncementsReadRequest) =>
    request("/api/v1/announcements/read", MarkAnnouncementsReadResponse, json("POST", body)),
  setAnnouncementReaction: (id: string, body: SetReactionRequest) =>
    request(`/api/v1/announcements/${seg(id)}/reactions`, SetReactionResponse, json("POST", body, body.clientEventId)),
});
