import type { DocumentSummary, VoidChequeOnFile } from "@bookmops/api/v1";
import { Card, color, Icon, Pill, radius, space, Text } from "@bookmops/ui-native";
import { router } from "expo-router";
import { View } from "react-native";

import { Empty, LoadError, Loading } from "@/components/QueryState";
import { useDocuments, useMe } from "@/data/queries";
import { dueLine, statusTag } from "@/features/documents/display";
import { BackHeader, Page, pillTone, SectionTitle } from "@/features/record/ui";
import { dayMonthYear } from "@/lib/dates";
import { useNow } from "@/lib/use-now";

/** Documents: what's waiting to be signed, what's signed, and payroll paperwork on file. */
export default function Documents() {
  const me = useMe();
  const docs = useDocuments();
  const now = useNow(60_000);
  const tz = me.data?.company.timezone;
  const items = docs.data?.items ?? [];
  const pending = items.filter((d) => d.status === "PENDING");
  const signed = items.filter((d) => d.status === "SIGNED");
  const other = items.filter((d) => d.status !== "PENDING" && d.status !== "SIGNED");

  return (
    <Page header={<BackHeader title="Documents" />} refreshing={docs.isRefetching} onRefresh={() => docs.refetch()}>
      {docs.isPending || !tz ? (
        <Loading label="Loading documents" />
      ) : docs.isError ? (
        <LoadError error={docs.error} onRetry={() => docs.refetch()} />
      ) : (
        <>
          <SectionTitle>To sign</SectionTitle>
          {pending.length === 0 ? (
            <Text variant="body" color="ink2" style={{ paddingLeft: space[1] }}>
              Nothing waiting on you.
            </Text>
          ) : (
            pending.map((d) => <DocCard key={d.id} doc={d} now={now} timeZone={tz} />)
          )}

          {signed.length > 0 ? (
            <>
              <SectionTitle>Signed</SectionTitle>
              {signed.map((d) => (
                <DocCard key={d.id} doc={d} now={now} timeZone={tz} />
              ))}
            </>
          ) : null}

          {other.length > 0 ? (
            <>
              <SectionTitle>No longer to sign</SectionTitle>
              {other.map((d) => (
                <DocCard key={d.id} doc={d} now={now} timeZone={tz} />
              ))}
            </>
          ) : null}

          {items.length === 0 ? <Empty icon="document" title="No documents yet" detail="Policies the office asks you to sign show up here." /> : null}

          <SectionTitle>Payroll</SectionTitle>
          <VoidCheque onFile={docs.data.voidCheque} timeZone={tz} />
        </>
      )}
    </Page>
  );
}

function DocCard({ doc, now, timeZone }: { doc: DocumentSummary; now: Date; timeZone: string }) {
  const tag = statusTag(doc.status);
  const due = dueLine(doc, now, timeZone);
  const detail =
    doc.status === "SIGNED" && doc.signedAt
      ? `Signed ${dayMonthYear(doc.signedAt, timeZone)} · version ${doc.version}`
      : `Version ${doc.version}${doc.hasFile ? " · PDF" : ""}`;
  return (
    <Card
      padding={4}
      onPress={() => router.push({ pathname: "/documents/[id]", params: { id: doc.id } })}
      accessibilityLabel={[doc.title, tag.label, detail, due?.text].filter(Boolean).join(", ")}
      style={due?.tone === "danger" ? { backgroundColor: color.dangerSoft, borderColor: color.dangerSoft } : undefined}
    >
      <View style={{ flexDirection: "row", alignItems: "flex-start", gap: space[3] }}>
        <View style={{ width: 40, height: 40, borderRadius: radius.md, backgroundColor: color.accentSoft, alignItems: "center", justifyContent: "center" }}>
          <Icon name="document" size={21} color="accentText" />
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <Text variant="bodyStrong">{doc.title}</Text>
          <Text variant="small" color="ink2" numeral>
            {detail}
          </Text>
          {due ? (
            <Text variant="small" weight="bold" color={due.tone} numeral>
              {due.text}
            </Text>
          ) : null}
        </View>
        <Pill label={tag.label} tone={pillTone(tag.tone)} />
      </View>
    </Card>
  );
}

function VoidCheque({ onFile, timeZone }: { onFile: VoidChequeOnFile | null; timeZone: string }) {
  return (
    <Card padding={4}>
      <View style={{ flexDirection: "row", alignItems: "flex-start", gap: space[3] }}>
        <Icon name={onFile ? "check" : "info"} size={22} color={onFile ? "success" : "warning"} />
        <View style={{ flex: 1, gap: 2 }}>
          <Text variant="bodyStrong">Void cheque / direct deposit</Text>
          {onFile ? (
            <Text variant="small" color="ink2" numeral>
              On file: {onFile.fileName}, uploaded {dayMonthYear(onFile.uploadedAt, timeZone)}. Only the office can open it.
            </Text>
          ) : (
            <Text variant="small" color="ink2">
              Not on file yet. The office needs it to pay you by direct deposit. Upload it from Documents on the web.
            </Text>
          )}
        </View>
      </View>
    </Card>
  );
}
