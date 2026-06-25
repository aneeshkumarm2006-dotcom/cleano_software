"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import dynamic from "next/dynamic";
import Card from "@/components/ui/Card";
import Badge from "@/components/ui/Badge";
import Button from "@/components/ui/Button";
import { ArrowLeft, CheckCircle2, AlertCircle } from "lucide-react";
import { updateTrainingProgress } from "../../actions/updateTrainingProgress";
import QuizView from "./QuizView";

const ReactPlayer = dynamic(() => import("react-player"), { ssr: false });

type ModuleStatus = "NOT_STARTED" | "IN_PROGRESS" | "COMPLETED" | "FAILED";

interface ModuleData {
  id: string;
  title: string;
  description: string | null;
  videoUrl: string | null;
  duration: number | null;
  isRequired: boolean;
}

interface QuizData {
  id: string;
  question: string;
  options: { text: string }[];
}

interface ProgressData {
  status: ModuleStatus;
  videoProgress: number;
  quizScore: number | null;
  quizAttempts: number;
}

interface ModuleViewProps {
  module: ModuleData;
  quizzes: QuizData[];
  initialProgress: ProgressData | null;
}

export default function ModuleView({
  module: m,
  quizzes,
  initialProgress,
}: ModuleViewProps) {
  const router = useRouter();
  const roleBase = usePathname().startsWith("/cleaners") ? "/cleaners" : "/admin";
  const [progress, setProgress] = useState<ProgressData>(
    initialProgress ?? {
      status: "NOT_STARTED",
      videoProgress: 0,
      quizScore: null,
      quizAttempts: 0,
    }
  );
  const [savingComplete, setSavingComplete] = useState(false);
  const [message, setMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  const lastSavedRef = useRef<number>(initialProgress?.videoProgress ?? 0);
  const lastSaveAtRef = useRef<number>(Date.now());
  const currentProgressRef = useRef<number>(initialProgress?.videoProgress ?? 0);

  useEffect(() => {
    const interval = setInterval(() => {
      const cur = currentProgressRef.current;
      const since = Date.now() - lastSaveAtRef.current;
      if (cur - lastSavedRef.current >= 0.05 && since >= 30000) {
        void persistProgress(cur);
      }
    }, 5000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function persistProgress(value: number) {
    lastSavedRef.current = value;
    lastSaveAtRef.current = Date.now();
    const res = await updateTrainingProgress({
      moduleId: m.id,
      videoProgress: value,
    });
    if (res.success) {
      setProgress((prev) => ({
        ...prev,
        videoProgress: value,
        status: prev.status === "NOT_STARTED" && value > 0 ? "IN_PROGRESS" : prev.status,
      }));
    }
  }

  async function handleMarkWatched() {
    setSavingComplete(true);
    setMessage(null);
    const res = await updateTrainingProgress({
      moduleId: m.id,
      videoProgress: Math.max(0.9, currentProgressRef.current),
      markComplete: quizzes.length === 0,
    });
    if (res.success) {
      const newProgress = res.progress;
      if (newProgress) {
        setProgress({
          status: newProgress.status as ModuleStatus,
          videoProgress: newProgress.videoProgress,
          quizScore: newProgress.quizScore,
          quizAttempts: newProgress.quizAttempts,
        });
      }
      setMessage({
        type: "success",
        text:
          quizzes.length === 0
            ? "Module marked complete."
            : "Video marked watched. Take the quiz to finish.",
      });
      router.refresh();
    } else {
      setMessage({ type: "error", text: res.error || "Failed to update." });
    }
    setSavingComplete(false);
  }

  const watchedPct = Math.round(progress.videoProgress * 100);
  const canMarkWatched = progress.videoProgress >= 0.9 || watchedPct >= 90;

  return (
    <div className="max-w-[80rem] mx-auto space-y-6">
      <Button
        variant="default"
        size="sm"
        border={false}
        onClick={() => router.push(`${roleBase}/training`)}
        className="mb-2 px-6 py-3">
        <ArrowLeft className="w-4 h-4 mr-2" />
        Back to Training
      </Button>

      <div>
        <div className="flex items-center gap-2 flex-wrap">
          <h1 className="text-3xl !font-light tracking-tight text-[#008C9C]">
            {m.title}
          </h1>
          {m.isRequired && (
            <Badge variant="cleano" size="md">
              Required
            </Badge>
          )}
          {progress.status === "COMPLETED" && (
            <Badge variant="success" size="md">
              <CheckCircle2 className="w-3 h-3 mr-1" />
              Completed
            </Badge>
          )}
          {progress.status === "FAILED" && (
            <Badge variant="error" size="md">
              <AlertCircle className="w-3 h-3 mr-1" />
              Quiz Failed
            </Badge>
          )}
        </div>
        {m.description && (
          <p className="text-sm text-[#008C9C]/70 !font-light mt-2 max-w-3xl">
            {m.description}
          </p>
        )}
      </div>

      {m.videoUrl ? (
        <Card variant="default" className="p-4">
          <div className="aspect-video rounded-xl overflow-hidden bg-black">
            <ReactPlayer
              src={m.videoUrl}
              controls
              width="100%"
              height="100%"
              onTimeUpdate={(e: React.SyntheticEvent<HTMLVideoElement>) => {
                const video = e.currentTarget;
                if (video.duration > 0) {
                  const ratio = video.currentTime / video.duration;
                  currentProgressRef.current = ratio;
                }
              }}
              onEnded={() => {
                currentProgressRef.current = 1;
                void persistProgress(1);
              }}
            />
          </div>
          <div className="flex items-center justify-between gap-4 mt-4 flex-wrap">
            <div className="flex-1 min-w-[12rem]">
              <div className="h-2 bg-[#008C9C]/10 rounded-full overflow-hidden">
                <div
                  className="h-full bg-[#008C9C] transition-all duration-300"
                  style={{ width: `${watchedPct}%` }}
                />
              </div>
              <p className="text-xs text-[#008C9C]/70 mt-1">
                {watchedPct}% watched
              </p>
            </div>
            <Button
              variant="primary"
              size="md"
              border={false}
              onClick={handleMarkWatched}
              disabled={!canMarkWatched || savingComplete}
              className="px-6 py-3">
              {savingComplete ? "Saving..." : "Mark as Watched"}
            </Button>
          </div>
        </Card>
      ) : (
        <Card variant="ghost" className="p-8">
          <p className="text-sm text-[#008C9C]/60 text-center">
            No video for this module.
          </p>
        </Card>
      )}

      {message && (
        <div
          className={`p-3 rounded-xl text-sm ${
            message.type === "success"
              ? "bg-green-50 text-green-700 border border-green-200"
              : "bg-red-50 text-red-700 border border-red-200"
          }`}>
          {message.text}
        </div>
      )}

      {quizzes.length > 0 && (
        <QuizView
          moduleId={m.id}
          quizzes={quizzes}
          videoProgress={progress.videoProgress}
          previousScore={progress.quizScore}
          attempts={progress.quizAttempts}
          status={progress.status}
          onResult={(result) => {
            setProgress((prev) => ({
              ...prev,
              quizScore: result.score,
              quizAttempts: prev.quizAttempts + 1,
              status: result.passed
                ? prev.videoProgress >= 0.9
                  ? "COMPLETED"
                  : "IN_PROGRESS"
                : "FAILED",
            }));
            router.refresh();
          }}
        />
      )}
    </div>
  );
}
