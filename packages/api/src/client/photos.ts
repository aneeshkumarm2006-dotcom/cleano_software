import {
  type AttachPhotoRequest,
  DeletePhotoResponse,
  JobPhoto,
  JobPhotosResponse,
  type UploadRequest,
  UploadTicket,
} from "../v1/photos";
import { json, type Request, seg } from "./request";

export const photosApi = (request: Request) => ({
  /** Sign an upload for a job photo. The file itself goes straight to storage. */
  createJobPhotoUpload: (body: UploadRequest) => request("/api/v1/uploads", UploadTicket, json("POST", body)),
  jobPhotos: (jobId: string, cursor?: string | null) =>
    request(`/api/v1/jobs/${seg(jobId)}/photos${cursor ? `?cursor=${seg(cursor)}` : ""}`, JobPhotosResponse),
  attachJobPhoto: (jobId: string, body: AttachPhotoRequest) =>
    request(`/api/v1/jobs/${seg(jobId)}/photos`, JobPhoto, json("POST", body, body.clientEventId)),
  deleteJobPhoto: (jobId: string, photoId: string) =>
    request(`/api/v1/jobs/${seg(jobId)}/photos/${seg(photoId)}`, DeletePhotoResponse, json("DELETE")),
});
