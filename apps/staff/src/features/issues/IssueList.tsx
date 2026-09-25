import type { JobIssue } from "@bookmops/api/v1";
import { JOB_ISSUE_CATEGORY_LABEL } from "@bookmops/core/jobs";
import { Card, color, Icon, radius, space, Text } from "@bookmops/ui-native";
import { View } from "react-native";

import { clockTime, shortDate } from "@/lib/format";

const STATUS: Record<JobIssue["status"], { label: string; fg: "accentText" | "warning" | "success" | "ink2"; bg: string }> = {
  OPEN: { label: "Sent", fg: "accentText", bg: color.accentSoft },
  ACKNOWLEDGED: { label: "Seen by office", fg: "warning", bg: color.warningSoft },
  RESOLVED: { label: "Resolved", fg: "success", bg: color.successSoft },
  UNKNOWN: { label: "Sent", fg: "ink2", bg: color.groundDeep },
};

export const categoryLabel = (c: JobIssue["category"]) => (c === "UNKNOWN" ? "Something else" : JOB_ISSUE_CATEGORY_LABEL[c]);

/** A cleaner's own reports on a job, and where each has got to with the office. */
export function IssueList({ issues, timeZone }: { issues: readonly JobIssue[]; timeZone: string }) {
  return (
    <View style={{ gap: space[2] }}>
      {issues.map((issue) => {
        const s = STATUS[issue.status];
        return (
          <Card key={issue.id} padding={4}>
            <View style={{ gap: space[2] }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: space[2] }}>
                <Text variant="bodyStrong" style={{ flex: 1 }} numberOfLines={1}>
                  {categoryLabel(issue.category)}
                </Text>
                <View style={{ paddingHorizontal: space[2] + 2, paddingVertical: space[1], borderRadius: radius.pill, backgroundColor: s.bg }}>
                  <Text variant="eyebrow" color={s.fg} style={{ fontSize: 10 }}>
                    {s.label}
                  </Text>
                </View>
              </View>
              <Text variant="small" color="ink3" numeral>
                {shortDate(issue.reportedAt, timeZone)} · {clockTime(issue.reportedAt, timeZone)}
                {issue.urgency === "URGENT" ? " · Urgent" : ""}
                {issue.hasPhoto ? " · Photo" : ""}
              </Text>
              <Text variant="body" color="ink2" numberOfLines={3}>
                {issue.note}
              </Text>
              {issue.status === "RESOLVED" && issue.resolutionNote ? (
                <View style={{ flexDirection: "row", gap: space[2], padding: space[3], borderRadius: radius.md, backgroundColor: color.successSoft }}>
                  <Icon name="check" size={18} color="success" />
                  <Text variant="small" style={{ flex: 1 }}>
                    {issue.resolutionNote}
                  </Text>
                </View>
              ) : null}
            </View>
          </Card>
        );
      })}
    </View>
  );
}
