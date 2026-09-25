import { ApiError } from "@bookmops/api/client";
import type { AvailableJobSummary } from "@bookmops/api/v1";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import { Alert } from "react-native";

import { useClaimJob } from "@/data/queries";
import { clockTime } from "@/lib/format";

import { dayLabel, payText } from "./words";

/** Refusals after which the job is gone from the board for good. */
const GONE = new Set(["FULLY_STAFFED", "NOT_AVAILABLE", "NOT_FOUND", "ALREADY_STARTED"]);

/** A refused claim, in the words a cleaner needs. The server's message covers any code this build doesn't know. */
export function claimRefusal(error: unknown): { title: string; message: string; gone: boolean } {
  if (!(error instanceof ApiError)) {
    return { title: "Couldn't claim this job", message: "Something went wrong. Try again.", gone: false };
  }
  const gone = GONE.has(error.code);
  switch (error.code) {
    case "FULLY_STAFFED":
      return { title: "Just missed it", message: "Someone else took the last spot on this job.", gone };
    case "NOT_AVAILABLE":
    case "NOT_FOUND":
      return { title: "No longer available", message: "This job isn't open any more.", gone };
    case "ALREADY_STARTED":
      return { title: "Already started", message: "This job has started, so it can't be claimed now.", gone };
    case "ON_HOLD":
      return { title: "On hold", message: "The office has put this job on hold. You can claim it once they release it.", gone };
    case "CATEGORY_NOT_ALLOWED":
      return {
        title: "Not one of your services",
        message: "You're not approved for this kind of job yet. Ask the office if you'd like to do this work.",
        gone,
      };
    case "TRAINEE_NEEDS_CREW":
      return {
        title: "Needs an approved cleaner first",
        message: "Trainees can't take a job alone. You can claim it once an approved cleaner is on it.",
        gone,
      };
    case "NETWORK":
      return {
        title: "No connection",
        message: "We couldn't reach the office. Try again when you have signal. You won't claim it twice.",
        gone,
      };
    default:
      return { title: "Couldn't claim this job", message: error.message, gone };
  }
}

/**
 * Claim with a confirmation first: one tap commits the cleaner to turning up,
 * so it's asked for plainly. On success the job opens in My jobs, where the
 * full address now shows.
 */
export function useClaimFlow({ timeZone, currency, from }: { timeZone: string; currency: string; from: "list" | "detail" }) {
  const claim = useClaimJob();

  function openJob(jobId: string) {
    const to = { pathname: "/jobs/[id]", params: { id: jobId } } as const;
    if (from === "detail") router.replace(to);
    else router.push(to);
  }

  function send(job: AvailableJobSummary) {
    claim.mutate(job.id, {
      onSuccess: (res) => {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        openJob(res.job.id);
        Alert.alert("It's yours", "The job is in My jobs now, with the full address.");
      },
      onError: (error) => {
        // Already on it (a retry after the first claim landed): that's a win.
        if (error instanceof ApiError && error.code === "ALREADY_CLAIMED") {
          openJob(job.id);
          return;
        }
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
        const r = claimRefusal(error);
        Alert.alert(r.title, r.message, [
          { text: "OK", onPress: () => (r.gone && from === "detail" && router.canGoBack() ? router.back() : undefined) },
        ]);
      },
    });
  }

  function ask(job: AvailableJobSummary) {
    const pay = payText(job.pay, currency);
    const when = `${dayLabel(job.startsAt, timeZone, new Date())} at ${clockTime(job.startsAt, timeZone)}`;
    Alert.alert(
      "Claim this job?",
      [`${when}${job.area ? `, ${job.area}` : ""}.`, pay ? `Your pay: ${pay}.` : null, "You're committing to turn up."]
        .filter(Boolean)
        .join(" "),
      [
        { text: "Cancel", style: "cancel" },
        { text: "Claim", onPress: () => send(job) },
      ],
    );
  }

  return {
    ask,
    /** The job being claimed right now, to show its button as busy. */
    claimingId: claim.isPending ? claim.variables : null,
  };
}
