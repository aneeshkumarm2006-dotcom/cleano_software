import type { QuizSubmitRequest, TrainingModuleDetail, TrainingProgressRequest } from "@bookmops/api/v1";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useSource } from "../session";

export const trainingKeys = {
  list: ["training"] as const,
  module: (id: string) => ["training", id] as const,
};

export function useTraining() {
  const source = useSource();
  return useQuery({ queryKey: trainingKeys.list, queryFn: () => source.training() });
}

export function useTrainingModule(id: string) {
  const source = useSource();
  return useQuery({ queryKey: trainingKeys.module(id), queryFn: () => source.trainingModule(id) });
}

export function useSetTrainingProgress(id: string) {
  const source = useSource();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: TrainingProgressRequest) => source.setTrainingProgress(id, body),
    onSuccess: (progress) => {
      qc.setQueryData<TrainingModuleDetail>(trainingKeys.module(id), (prev) => (prev ? { ...prev, progress } : prev));
      void qc.invalidateQueries({ queryKey: trainingKeys.list, exact: true });
    },
  });
}

export function useSubmitQuiz(id: string) {
  const source = useSource();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: QuizSubmitRequest) => source.submitQuiz(id, body),
    onSuccess: (result) => {
      qc.setQueryData<TrainingModuleDetail>(trainingKeys.module(id), (prev) => (prev ? { ...prev, progress: result.progress } : prev));
      void qc.invalidateQueries({ queryKey: trainingKeys.list, exact: true });
    },
  });
}
