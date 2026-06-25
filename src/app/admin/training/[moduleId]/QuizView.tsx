"use client";

import { useState } from "react";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import Badge from "@/components/ui/Badge";
import { CheckCircle2, AlertCircle, RotateCw } from "lucide-react";
import { submitQuiz } from "../../actions/submitQuiz";

type ModuleStatus = "NOT_STARTED" | "IN_PROGRESS" | "COMPLETED" | "FAILED";

interface QuizData {
  id: string;
  question: string;
  options: { text: string }[];
}

interface QuizViewProps {
  moduleId: string;
  quizzes: QuizData[];
  videoProgress: number;
  previousScore: number | null;
  attempts: number;
  status: ModuleStatus;
  onResult: (result: { score: number; passed: boolean }) => void;
}

const PASS_THRESHOLD = 0.8;

export default function QuizView({
  moduleId,
  quizzes,
  videoProgress,
  previousScore,
  attempts,
  status,
  onResult,
}: QuizViewProps) {
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{
    score: number;
    passed: boolean;
    correct: number;
    total: number;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const allAnswered = quizzes.every((q) => answers[q.id] !== undefined);
  const videoOk = videoProgress >= 0.9;

  async function handleSubmit() {
    if (!allAnswered) {
      setError("Please answer all questions.");
      return;
    }
    setSubmitting(true);
    setError(null);

    const res = await submitQuiz({
      moduleId,
      answers: Object.entries(answers).map(([quizId, selectedIndex]) => ({
        quizId,
        selectedIndex,
      })),
    });

    if (res.success) {
      setResult({
        score: res.score,
        passed: res.passed,
        correct: res.correct,
        total: res.total,
      });
      onResult({ score: res.score, passed: res.passed });
    } else {
      setError(res.error || "Failed to submit quiz.");
    }
    setSubmitting(false);
  }

  function handleRetry() {
    setAnswers({});
    setResult(null);
    setError(null);
  }

  return (
    <Card variant="default" className="p-6">
      <div className="space-y-5">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h2 className="text-lg font-[400] text-[#008C9C]">Quiz</h2>
            <p className="text-xs text-[#008C9C]/60 mt-1">
              Pass with {Math.round(PASS_THRESHOLD * 100)}% or higher to complete this module.
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {attempts > 0 && (
              <Badge variant="default" size="sm">
                {attempts} attempt{attempts === 1 ? "" : "s"}
              </Badge>
            )}
            {previousScore != null && !result && (
              <Badge
                variant={previousScore >= PASS_THRESHOLD ? "success" : "error"}
                size="sm">
                Last: {Math.round(previousScore * 100)}%
              </Badge>
            )}
          </div>
        </div>

        {!videoOk && status !== "COMPLETED" && (
          <div className="p-3 rounded-xl bg-amber-50 text-amber-700 border border-amber-200 text-sm">
            Watch at least 90% of the video before taking the quiz.
          </div>
        )}

        {result ? (
          <div className="space-y-4">
            <div
              className={`p-4 rounded-xl border ${
                result.passed
                  ? "bg-green-50 border-green-200 text-green-700"
                  : "bg-red-50 border-red-200 text-red-700"
              }`}>
              <div className="flex items-center gap-2">
                {result.passed ? (
                  <CheckCircle2 className="w-5 h-5" />
                ) : (
                  <AlertCircle className="w-5 h-5" />
                )}
                <p className="font-[400]">
                  {result.passed ? "Passed!" : "Did not pass"}
                </p>
              </div>
              <p className="text-sm mt-1">
                Score: {Math.round(result.score * 100)}% ({result.correct} of{" "}
                {result.total} correct)
              </p>
            </div>
            {!result.passed && (
              <Button
                variant="primary"
                size="md"
                border={false}
                onClick={handleRetry}
                className="px-6 py-3">
                <RotateCw className="w-4 h-4 mr-2" />
                Try Again
              </Button>
            )}
          </div>
        ) : (
          <>
            <ol className="space-y-4">
              {quizzes.map((q, qIdx) => (
                <li key={q.id} className="space-y-2">
                  <p className="text-sm font-[400] text-[#008C9C]">
                    {qIdx + 1}. {q.question}
                  </p>
                  <div className="space-y-1.5">
                    {q.options.map((opt, oIdx) => {
                      const selected = answers[q.id] === oIdx;
                      return (
                        <label
                          key={oIdx}
                          className={`flex items-center gap-3 px-4 py-2.5 rounded-xl border cursor-pointer transition-colors ${
                            selected
                              ? "bg-[#008C9C]/10 border-[#008C9C]/30"
                              : "bg-white border-[#008C9C]/10 hover:bg-[#008C9C]/3"
                          }`}>
                          <input
                            type="radio"
                            name={q.id}
                            checked={selected}
                            onChange={() =>
                              setAnswers((prev) => ({ ...prev, [q.id]: oIdx }))
                            }
                            className="accent-[#008C9C]"
                            disabled={!videoOk && status !== "COMPLETED"}
                          />
                          <span className="text-sm text-[#008C9C]">
                            {opt.text}
                          </span>
                        </label>
                      );
                    })}
                  </div>
                </li>
              ))}
            </ol>

            {error && (
              <div className="p-3 rounded-xl text-sm bg-red-50 text-red-700 border border-red-200">
                {error}
              </div>
            )}

            <div className="flex justify-end">
              <Button
                variant="primary"
                size="md"
                border={false}
                onClick={handleSubmit}
                disabled={
                  submitting ||
                  !allAnswered ||
                  (!videoOk && status !== "COMPLETED")
                }
                className="px-6 py-3">
                {submitting ? "Submitting..." : "Submit Quiz"}
              </Button>
            </div>
          </>
        )}
      </div>
    </Card>
  );
}
