import {
  JobPayResponse,
  PayoutsResponse,
  PayPeriodDetailResponse,
  PayResponse,
  type WithdrawalRequest,
  WithdrawalResponse,
  WithdrawalsResponse,
} from "../v1/pay";
import { json, type Request, seg } from "./request";

const withCursor = (path: string, cursor?: string | null) => (cursor ? `${path}?cursor=${seg(cursor)}` : path);

export const payApi = (request: Request) => ({
  pay: () => request("/api/v1/pay", PayResponse),
  payouts: (cursor?: string | null) => request(withCursor("/api/v1/pay/payouts", cursor), PayoutsResponse),
  withdrawals: (cursor?: string | null) => request(withCursor("/api/v1/pay/withdrawals", cursor), WithdrawalsResponse),
  payPeriod: (id: string) => request(`/api/v1/pay/periods/${seg(id)}`, PayPeriodDetailResponse),
  jobPay: (jobId: string) => request(`/api/v1/pay/jobs/${seg(jobId)}`, JobPayResponse),
  /** Moves money: `clientEventId` is made once per confirmed request and reused on a retry. */
  requestWithdrawal: (body: WithdrawalRequest) =>
    request("/api/v1/pay/withdrawals", WithdrawalResponse, json("POST", body, body.clientEventId)),
});
