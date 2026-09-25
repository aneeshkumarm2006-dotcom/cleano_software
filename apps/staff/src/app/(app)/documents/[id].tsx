import { ApiError } from "@bookmops/api/client";
import { DrawnSignature, type DocumentDetail } from "@bookmops/api/v1";
import { Button, Card, Checkbox, IconButton, SignaturePad, space, Text, type Signature } from "@bookmops/ui-native";
import * as Haptics from "expo-haptics";
import { useLocalSearchParams } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { Linking, View } from "react-native";

import { LoadError, Loading } from "@/components/QueryState";
import { useDocument, useLogDocumentAccess, useMe, useSignDocument } from "@/data/queries";
import { statusTag } from "@/features/documents/display";
import { acknowledgement, ACKNOWLEDGEMENT_POINTS, agreementParts, DRAW_PROMPT, notSignable, RECORDED_NOTE } from "@/features/documents/wording";
import { BackHeader, confirm, errorText, FormError, Notice, Page, SectionTitle, Tag } from "@/features/record/ui";
import { dayMonthYear } from "@/lib/dates";
import { useEventKey } from "@/lib/idempotency";
import { safeWebUrl } from "@/lib/urls";

/**
 * One document: read it, then sign it with a finger, as on the web. Opening
 * it is logged once per visit; signing is confirmed first and sent with an
 * idempotency key, so a retry never signs twice. The signature carries the
 * version and content hash that were on screen, so a document the office
 * changed in the meantime is refused rather than signed unread.
 */
export default function DocumentScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const me = useMe();
  const doc = useDocument(id);
  const log = useLogDocumentAccess(id);
  const tz = me.data?.company.timezone;

  // One OPEN per visit, as the web logs one per page load; a refetch is not a
  // visit. Remembered per document, so a screen reused for another id logs it.
  const logged = useRef<string | null>(null);
  useEffect(() => {
    if (logged.current === id || doc.data?.id !== id) return;
    logged.current = id;
    log("OPEN");
  }, [id, doc.data, log]);

  // Keyed by document, so a half-drawn signature or a tick never carries over to another.
  if (doc.data && tz) return <Reader key={doc.data.id} doc={doc.data} timeZone={tz} onDownload={() => log("DOWNLOAD")} />;
  return (
    <Page header={<BackHeader title="Document" />}>
      {doc.isError ? <LoadError error={doc.error} onRetry={() => doc.refetch()} /> : <Loading label="Loading the document" />}
    </Page>
  );
}

function Reader({ doc, timeZone, onDownload }: { doc: DocumentDetail; timeZone: string; onDownload: () => void }) {
  const sign = useSignDocument(doc.id);
  const key = useEventKey();
  const [signature, setSignature] = useState<Signature | null>(null);
  const [agreed, setAgreed] = useState(false);
  const [drawing, setDrawing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // A tap or a stray line is not a signature: the same rule the server
  // applies, so the button waits for one the server will take.
  const inked = signature && DrawnSignature.safeParse(signature).success ? signature : null;
  const fileUrl = safeWebUrl(doc.fileUrl);
  const signable = doc.status === "PENDING";
  const tag = statusTag(doc.status);
  const [before, title, after] = agreementParts(doc.title);

  async function openFile() {
    if (!fileUrl) return;
    onDownload();
    try {
      await Linking.openURL(fileUrl);
    } catch {
      setError("The file couldn't be opened on your phone.");
    }
  }

  async function submit() {
    if (!inked || !agreed || sign.isPending) return;
    const ok = await confirm({ title: `Sign ${doc.title}?`, message: RECORDED_NOTE, confirmLabel: "Sign" });
    if (!ok) return;
    setError(null);
    const body = { agreed: true as const, version: doc.version, contentSha256: doc.contentSha256, signature: inked };
    sign.mutate(
      { ...body, clientEventId: key.for(body) },
      {
        onSuccess: () => {
          key.done();
          void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        },
        onError: (e) => {
          key.failed(e);
          if (e instanceof ApiError && e.code === "DOCUMENT_CHANGED") {
            // The query refetches the new version; they agree to that one, not this.
            setAgreed(false);
            setError("The office has changed this document since you opened it. Read it again above, then tick to agree and sign.");
            return;
          }
          setError(errorText(e));
        },
      },
    );
  }

  return (
    <Page
      header={
        <BackHeader
          title={doc.title}
          subtitle={`Version ${doc.version} · ${dayMonthYear(doc.publishedAt, timeZone)}`}
          right={fileUrl ? <IconButton icon="download" label="Open the PDF" onPress={openFile} /> : undefined}
        />
      }
      scrollEnabled={!drawing}
      footer={
        signable ? (
          <>
            <FormError message={error} />
            <Button label="Sign document" icon="sign" disabled={!inked || !agreed} loading={sign.isPending} onPress={submit} />
            <Text variant="small" color="ink3" align="center">
              {!inked ? "Sign in the box, then tick to agree." : !agreed ? "Tick the box to agree." : RECORDED_NOTE}
            </Text>
          </>
        ) : undefined
      }
    >
      {doc.status === "PENDING" ? (
        <Notice tone="warn" icon="warning">
          You haven't signed this version yet.
        </Notice>
      ) : doc.status === "SIGNED" ? (
        <Notice tone="ok" icon="check" title="Signed">
          {`Signed on ${doc.signedAt ? dayMonthYear(doc.signedAt, timeZone) : "—"} · v${doc.version}`}
        </Notice>
      ) : (
        <Notice tone="neutral" icon="info">
          {notSignable(doc.status === "UNKNOWN" ? "unavailable" : doc.status)}
        </Notice>
      )}

      <View style={{ flexDirection: "row" }}>
        <Tag label={tag.label} tone={tag.tone} />
      </View>

      <Card padding={5}>
        {fileUrl ? (
          <View style={{ gap: space[3] }}>
            <Text variant="bodyStrong">This document is a PDF</Text>
            <Text variant="body" color="ink2">
              Open it and read it through, then come back here to sign.
            </Text>
            <Button label="Open the PDF" variant="secondary" icon="external" onPress={openFile} />
          </View>
        ) : doc.content ? (
          // Plain text, shown as text: never parsed as HTML or markup.
          <View style={{ gap: space[3] }}>
            {doc.content
              .split(/\n{2,}/)
              .map((p) => p.trim())
              .filter(Boolean)
              .map((para, i) => (
                <Text key={i} variant="body" style={{ lineHeight: 23 }} selectable>
                  {para}
                </Text>
              ))}
          </View>
        ) : (
          <View style={{ gap: space[3] }}>
            {acknowledgement(doc.title, doc.version, doc.description).map((para, i) => (
              <Text key={i} variant="body" style={{ lineHeight: 23 }}>
                {para}
              </Text>
            ))}
            {ACKNOWLEDGEMENT_POINTS.map((point) => (
              <Text key={point} variant="body" style={{ lineHeight: 23, paddingLeft: space[2] }}>
                •  {point}
              </Text>
            ))}
          </View>
        )}
      </Card>

      {signable ? (
        <>
          <SectionTitle>Your signature</SectionTitle>
          <Text variant="body" color="ink2">
            {DRAW_PROMPT}
          </Text>
          <SignaturePad label={`Signature for ${doc.title}`} onChange={setSignature} onDrawingChange={setDrawing} />
          <Checkbox checked={agreed} onChange={setAgreed} accessibilityLabel={`${before}${title}${after}`}>
            <Text variant="small" color="ink" style={{ fontSize: 14, lineHeight: 20 }}>
              {before}
              <Text variant="small" weight="bold" style={{ fontSize: 14, lineHeight: 20 }}>
                {title}
              </Text>
              {after}
            </Text>
          </Checkbox>
        </>
      ) : null}
    </Page>
  );
}
