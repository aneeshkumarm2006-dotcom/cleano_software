// Sample strike record for development builds: one active, two in the past.
import type { StrikesResponse } from "@bookmops/api/v1";

import type { DataSource } from "../source";
import { delay } from "./delay";

const daysFromNow = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString();

const record: StrikesResponse = {
  activeCount: 1,
  threshold: 3,
  windowDays: 30,
  level: "WARNING",
  items: [
    {
      id: "s1",
      title: "45+ minutes late without approved notice",
      reason: "45+ minutes late without approved notice — arrived 52 minutes after the start of the window",
      status: "ACTIVE",
      givenAt: daysFromNow(-9),
      expiresAt: daysFromNow(21),
      job: { id: "p2", number: 1432 },
    },
    {
      id: "s2",
      title: "Repeated failure to complete checklist / photos",
      reason: "Repeated failure to complete checklist / photos",
      status: "EXPIRED",
      givenAt: daysFromNow(-120),
      expiresAt: daysFromNow(-90),
      job: null,
    },
    {
      id: "s3",
      title: "No-show",
      reason: "No-show — job #1210",
      status: "EXCUSED",
      givenAt: daysFromNow(-160),
      expiresAt: daysFromNow(-130),
      job: { id: "p1", number: 1210 },
    },
  ],
};

export const previewStrikesApi = {
  strikes: () => delay(record),
} satisfies Pick<DataSource, "strikes">;
