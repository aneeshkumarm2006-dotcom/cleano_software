import {
  type DocumentAccessRequest,
  DocumentAccessResponse,
  DocumentDetail,
  DocumentsListResponse,
  type SignDocumentRequest,
} from "../v1/documents";
import { json, type Request, seg } from "./request";

export const documentsApi = (request: Request) => ({
  documents: () => request("/api/v1/documents", DocumentsListResponse),
  document: (id: string) => request(`/api/v1/documents/${seg(id)}`, DocumentDetail),
  logDocumentAccess: (id: string, body: DocumentAccessRequest) =>
    request(`/api/v1/documents/${seg(id)}/access`, DocumentAccessResponse, json("POST", body)),
  signDocument: (id: string, body: SignDocumentRequest) =>
    request(`/api/v1/documents/${seg(id)}/sign`, DocumentDetail, json("POST", body, body.clientEventId)),
});
