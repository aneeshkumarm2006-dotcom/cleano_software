import {
  DirectoryResponse,
  MarkChannelReadResponse,
  MarkReadResponse,
  OfficeChatResponse,
  OfficeMessagesResponse,
  type OpenDirectRequest,
  OpenDirectResponse,
  type SendMessageRequest,
  SendOfficeMessageResponse,
  SendTeamMessageResponse,
  TeamChannelResponse,
  TeamChannelsResponse,
  TeamMessagesResponse,
} from "../v1/messages";
import { json, type Request, seg } from "./request";

const cursorQuery = (cursor?: string | null) => (cursor ? `?cursor=${seg(cursor)}` : "");

export const messagesApi = (request: Request) => ({
  // The office
  officeChat: () => request("/api/v1/chat", OfficeChatResponse),
  officeMessages: (cursor?: string | null) => request(`/api/v1/chat/messages${cursorQuery(cursor)}`, OfficeMessagesResponse),
  sendOfficeMessage: (body: SendMessageRequest) =>
    request("/api/v1/chat/messages", SendOfficeMessageResponse, json("POST", body, body.clientEventId)),
  markOfficeRead: () => request("/api/v1/chat/read", MarkReadResponse, json("POST", {})),

  // The team
  teamChannels: () => request("/api/v1/team/channels", TeamChannelsResponse),
  teamChannel: (channelId: string) => request(`/api/v1/team/channels/${seg(channelId)}`, TeamChannelResponse),
  teamMessages: (channelId: string, cursor?: string | null) =>
    request(`/api/v1/team/channels/${seg(channelId)}/messages${cursorQuery(cursor)}`, TeamMessagesResponse),
  sendTeamMessage: (channelId: string, body: SendMessageRequest) =>
    request(
      `/api/v1/team/channels/${seg(channelId)}/messages`,
      SendTeamMessageResponse,
      json("POST", body, body.clientEventId),
    ),
  markChannelRead: (channelId: string) =>
    request(`/api/v1/team/channels/${seg(channelId)}/read`, MarkChannelReadResponse, json("POST", {})),
  teamDirectory: () => request("/api/v1/team/directory", DirectoryResponse),
  openDirect: (body: OpenDirectRequest) => request("/api/v1/team/direct", OpenDirectResponse, json("POST", body)),
});
