// The manager side: the team's day, one job, crews, approvals, alerts,
// problems and the office inbox. Each hook asks only when the role may (the
// `enabled` flag), so a field lead's phone never asks for a queue it can't
// see and gets a 403 back.
import { ApiError } from "@bookmops/api/client";
import type {
  AddCleanerRequest,
  CrewChangeResponse,
  IssueStatusRequest,
  KitDecisionRequest,
  SetCrewRequest,
  TimeDecisionRequest,
  WithdrawalDecisionRequest,
} from "@bookmops/api/v1";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useStaffRole } from "../role";
import { useSource } from "../session";

/** How often the team's day refreshes while it's on screen: the live states move. */
export const TEAM_POLL_MS = 60_000;

export const managerKeys = {
  all: ["manager"] as const,
  day: (date: string | null) => ["manager", "day", date ?? "today"] as const,
  job: (id: string) => ["manager", "job", id] as const,
  candidates: (id: string) => ["manager", "job", id, "candidates"] as const,
  approvals: ["manager", "approvals"] as const,
  summary: ["manager", "approvals", "summary"] as const,
  time: (status: "pending" | "decided") => ["manager", "approvals", "time", status] as const,
  timeItem: (id: string) => ["manager", "approvals", "time-item", id] as const,
  withdrawals: (status: "open" | "handled") => ["manager", "approvals", "withdrawals", status] as const,
  withdrawal: (id: string) => ["manager", "approvals", "withdrawal", id] as const,
  kit: ["manager", "approvals", "kit"] as const,
  alerts: ["manager", "alerts"] as const,
  late: ["manager", "late"] as const,
  issues: (status: "open" | "resolved") => ["manager", "issues", status] as const,
  issue: (id: string) => ["manager", "issue", id] as const,
  inbox: ["manager", "inbox"] as const,
  conversation: (cleanerId: string) => ["manager", "inbox", cleanerId, "summary"] as const,
  conversationMessages: (cleanerId: string) => ["manager", "inbox", cleanerId, "messages"] as const,
};

const pages = { initialPageParam: null as string | null, getNextPageParam: (last: { nextCursor: string | null }) => last.nextCursor };

/** A mutation that is worth trying again: a dropped connection, not a refusal. */
const retryable = (failures: number, error: unknown) => failures < 2 && error instanceof ApiError && error.retryable;

// ---- The team's day and one job ------------------------------------------------------

export function useTeamDay(date: string | null, live = false) {
  const source = useSource();
  const role = useStaffRole();
  return useQuery({
    queryKey: managerKeys.day(date),
    queryFn: () => source.teamDay(date),
    enabled: role.can("TEAM_VIEW"),
    refetchInterval: live ? TEAM_POLL_MS : false,
  });
}

export function useManagerJob(id: string) {
  const source = useSource();
  return useQuery({ queryKey: managerKeys.job(id), queryFn: () => source.managerJob(id) });
}

export function useCrewCandidates(jobId: string) {
  const source = useSource();
  return useQuery({ queryKey: managerKeys.candidates(jobId), queryFn: () => source.crewCandidates(jobId), staleTime: 0 });
}

function useCrewSettled() {
  const qc = useQueryClient();
  return (res: CrewChangeResponse) => {
    qc.setQueryData(managerKeys.job(res.job.id), res.job);
    void qc.invalidateQueries({ queryKey: ["manager", "day"] });
    void qc.invalidateQueries({ queryKey: managerKeys.candidates(res.job.id) });
  };
}

/** Set the whole crew. The caller keeps `clientEventId` for as long as the outcome is unknown. */
export function useSetCrew(jobId: string) {
  const source = useSource();
  const settled = useCrewSettled();
  return useMutation({ mutationFn: (body: SetCrewRequest) => source.setCrew(jobId, body), retry: retryable, onSuccess: settled });
}

export function useAddCleaner(jobId: string) {
  const source = useSource();
  const settled = useCrewSettled();
  return useMutation({ mutationFn: (body: AddCleanerRequest) => source.addCleaner(jobId, body), retry: retryable, onSuccess: settled });
}

// ---- Approvals ---------------------------------------------------------------------------

export function useApprovalsSummary() {
  const source = useSource();
  const role = useStaffRole();
  return useQuery({
    queryKey: managerKeys.summary,
    queryFn: () => source.approvalsSummary(),
    enabled: role.can("TIME_APPROVE") || role.can("WITHDRAWALS") || role.can("KIT_REQUESTS"),
  });
}

export function useTimeItems(status: "pending" | "decided") {
  const source = useSource();
  const role = useStaffRole();
  return useInfiniteQuery({
    queryKey: managerKeys.time(status),
    queryFn: ({ pageParam }) => source.timeItems(status, pageParam),
    enabled: role.can("TIME_APPROVE"),
    ...pages,
  });
}

export function useTimeItem(id: string) {
  const source = useSource();
  return useQuery({ queryKey: managerKeys.timeItem(id), queryFn: () => source.timeItem(id) });
}

function useApprovalsChanged() {
  const qc = useQueryClient();
  return () => void qc.invalidateQueries({ queryKey: managerKeys.approvals });
}

export function useDecideTime(id: string) {
  const source = useSource();
  const qc = useQueryClient();
  const changed = useApprovalsChanged();
  return useMutation({
    mutationFn: (body: TimeDecisionRequest) => source.decideTime(id, body),
    retry: retryable,
    onSuccess: (item) => {
      qc.setQueryData(managerKeys.timeItem(id), item);
      changed();
      void qc.invalidateQueries({ queryKey: ["manager", "job", item.job.id] });
    },
  });
}

export function useWithdrawalsQueue(status: "open" | "handled") {
  const source = useSource();
  const role = useStaffRole();
  return useInfiniteQuery({
    queryKey: managerKeys.withdrawals(status),
    queryFn: ({ pageParam }) => source.withdrawalsQueue(status, pageParam),
    enabled: role.can("WITHDRAWALS"),
    ...pages,
  });
}

export function useManagedWithdrawal(id: string) {
  const source = useSource();
  return useQuery({ queryKey: managerKeys.withdrawal(id), queryFn: () => source.withdrawal(id) });
}

export function useDecideWithdrawal(id: string) {
  const source = useSource();
  const qc = useQueryClient();
  const changed = useApprovalsChanged();
  return useMutation({
    mutationFn: (body: WithdrawalDecisionRequest) => source.decideWithdrawal(id, body),
    retry: retryable,
    onSuccess: (w) => qc.setQueryData(managerKeys.withdrawal(id), w),
    onSettled: changed,
  });
}

export function useKitRequests() {
  const source = useSource();
  const role = useStaffRole();
  return useInfiniteQuery({
    queryKey: managerKeys.kit,
    queryFn: ({ pageParam }) => source.kitRequests(pageParam),
    enabled: role.can("KIT_REQUESTS"),
    ...pages,
  });
}

export function useDecideKitRequest() {
  const source = useSource();
  const changed = useApprovalsChanged();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: KitDecisionRequest }) => source.decideKitRequest(id, body),
    retry: retryable,
    onSettled: changed,
  });
}

// ---- Alerts and problems ---------------------------------------------------------------

export function useAlerts() {
  const source = useSource();
  const role = useStaffRole();
  return useInfiniteQuery({
    queryKey: managerKeys.alerts,
    queryFn: ({ pageParam }) => source.alerts(pageParam),
    enabled: role.can("ALERTS"),
    ...pages,
  });
}

export function useMarkAlertsRead() {
  const source = useSource();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (ids: string[]) => source.markAlertsRead({ ids }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: managerKeys.alerts }),
  });
}

export function useLateArrivals() {
  const source = useSource();
  const role = useStaffRole();
  return useInfiniteQuery({
    queryKey: managerKeys.late,
    queryFn: ({ pageParam }) => source.lateArrivals(pageParam),
    enabled: role.can("ALERTS"),
    ...pages,
  });
}

export function useIssues(status: "open" | "resolved") {
  const source = useSource();
  const role = useStaffRole();
  return useInfiniteQuery({
    queryKey: managerKeys.issues(status),
    queryFn: ({ pageParam }) => source.issues(status, pageParam),
    enabled: role.can("ISSUES"),
    ...pages,
  });
}

export function useIssue(id: string) {
  const source = useSource();
  return useQuery({ queryKey: managerKeys.issue(id), queryFn: () => source.issue(id) });
}

export function useSetIssueStatus(id: string) {
  const source = useSource();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: IssueStatusRequest) => source.setIssueStatus(id, body),
    retry: retryable,
    onSuccess: (issue) => {
      qc.setQueryData(managerKeys.issue(id), issue);
      void qc.invalidateQueries({ queryKey: ["manager", "issues"] });
      void qc.invalidateQueries({ queryKey: managerKeys.job(issue.job.id) });
      void qc.invalidateQueries({ queryKey: ["manager", "day"] });
    },
  });
}

// ---- The office inbox ----------------------------------------------------------------

export function useOfficeInbox(live = false) {
  const source = useSource();
  const role = useStaffRole();
  return useInfiniteQuery({
    queryKey: managerKeys.inbox,
    queryFn: ({ pageParam }) => source.officeConversations(pageParam),
    enabled: role.can("OFFICE_INBOX"),
    refetchInterval: live ? 15_000 : false,
    ...pages,
  });
}

export function useOfficeConversation(cleanerId: string) {
  const source = useSource();
  return useQuery({ queryKey: managerKeys.conversation(cleanerId), queryFn: () => source.officeConversation(cleanerId) });
}

export function useConversationMessages(cleanerId: string, live: boolean) {
  const source = useSource();
  return useInfiniteQuery({
    queryKey: managerKeys.conversationMessages(cleanerId),
    queryFn: ({ pageParam }) => source.conversationMessages(cleanerId, pageParam),
    refetchInterval: live ? 5_000 : false,
    ...pages,
  });
}

export function useMarkConversationRead(cleanerId: string) {
  const source = useSource();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => source.markConversationRead(cleanerId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: managerKeys.inbox, exact: true });
      void qc.invalidateQueries({ queryKey: managerKeys.conversation(cleanerId) });
    },
  });
}
