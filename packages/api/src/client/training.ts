import {
  type QuizSubmitRequest,
  QuizSubmitResponse,
  TrainingListResponse,
  TrainingModuleDetail,
  TrainingProgress,
  type TrainingProgressRequest,
} from "../v1/training";
import { json, type Request, seg } from "./request";

export const trainingApi = (request: Request) => ({
  training: () => request("/api/v1/training", TrainingListResponse),
  trainingModule: (moduleId: string) => request(`/api/v1/training/${seg(moduleId)}`, TrainingModuleDetail),
  setTrainingProgress: (moduleId: string, body: TrainingProgressRequest) =>
    request(`/api/v1/training/${seg(moduleId)}/progress`, TrainingProgress, json("POST", body, body.clientEventId)),
  /** A retry with the same clientEventId is not a second attempt. */
  submitQuiz: (moduleId: string, body: QuizSubmitRequest) =>
    request(`/api/v1/training/${seg(moduleId)}/quiz`, QuizSubmitResponse, json("POST", body, body.clientEventId)),
});
