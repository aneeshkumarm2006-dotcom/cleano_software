import type { JobPhoto, PhotoPhase, PhotoPolicy } from "@bookmops/api/v1";
import { JOB_PHOTO_KIND_HINT } from "@bookmops/core/jobs";
import { Button, color, Icon, radius, Segmented, space, Text } from "@bookmops/ui-native";
import { useQueryClient } from "@tanstack/react-query";
import * as Haptics from "expo-haptics";
import { useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { Alert, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Empty, LoadError, Loading } from "@/components/QueryState";
import { useDeletePhoto, useJob, useJobPhotos, useMe } from "@/data/queries";
import { useSource } from "@/data/session";
import { PhotoGrid } from "@/features/photos/PhotoGrid";
import { PhotoViewer } from "@/features/photos/PhotoViewer";
import { forgetLocalPhoto, usePhotoUploads } from "@/features/photos/queue";
import { pickPhotos } from "@/features/photos/upload";
import { UploadRow } from "@/features/photos/UploadRow";
import { BackHeader } from "@/features/record/ui";

const PHASES = [
  { value: "BEFORE", label: "Before" },
  { value: "AFTER", label: "After" },
] as const;

/** One pick from the library at a time; a job's worth, not a camera roll. */
const MAX_PER_PICK = 20;

/**
 * Before and after photos for a job. Take or choose them, watch them send,
 * and delete your own. When the office has turned photos off for the job,
 * the photos already on it are still shown, and nothing can be added. Photos go straight to Cloudinary from the phone; a failed
 * one stays here with its reason until it's sent or removed.
 */
export default function Photos() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const me = useMe();
  const job = useJob(id);
  const photos = useJobPhotos(id);
  const tz = me.data?.company.timezone;

  return (
    <View style={{ flex: 1, backgroundColor: color.ground }}>
      <BackHeader safeTop title="Photos" subtitle={job.data?.address.line1} fallback={{ pathname: "/jobs/[id]", params: { id } }} />

      {photos.isPending || !tz ? (
        <Loading label="Loading photos" />
      ) : photos.isError ? (
        <View style={{ padding: space[4] }}>
          <LoadError error={photos.error} onRetry={() => photos.refetch()} />
        </View>
      ) : (
        <PhotosBody
          jobId={id}
          owner={me.data ? `${me.data.company.id}:${me.data.person.id}` : null}
          timeZone={tz}
          items={photos.data.pages.flatMap((p) => p.items)}
          total={photos.data.pages[0]?.total ?? 0}
          policy={photos.data.pages[0]!.policy}
          hasMore={photos.hasNextPage}
          loadingMore={photos.isFetchingNextPage}
          onLoadMore={() => photos.fetchNextPage()}
          bottom={insets.bottom}
        />
      )}
    </View>
  );
}

function PhotosBody({
  jobId,
  owner,
  timeZone,
  items,
  total,
  policy,
  hasMore,
  loadingMore,
  onLoadMore,
  bottom,
}: {
  jobId: string;
  owner: string | null;
  timeZone: string;
  items: JobPhoto[];
  total: number;
  policy: PhotoPolicy;
  hasMore: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
  bottom: number;
}) {
  const source = useSource();
  const qc = useQueryClient();
  const uploads = usePhotoUploads(jobId, owner, source, qc);
  const del = useDeletePhoto(jobId);
  const [phase, setPhase] = useState<PhotoPhase>("BEFORE");
  const [open, setOpen] = useState<JobPhoto | null>(null);
  const [picking, setPicking] = useState(false);

  // Photos off for this job: nothing is offered, before or after.
  const adding = policy.canAdd && policy.photosAllowed;
  const room = Math.max(0, policy.maxPhotos - total - uploads.items.length);
  const failed = uploads.items.filter((i) => i.step === "failed" && i.canRetry).length;

  async function add(from: "camera" | "library") {
    if (!adding || picking || room === 0) return;
    setPicking(true);
    try {
      const assets = await pickPhotos(from, Math.min(room, MAX_PER_PICK));
      if (assets?.length) {
        uploads.add(assets, phase, policy.maxBytes);
        void Haptics.selectionAsync().catch(() => {});
      }
    } catch {
      Alert.alert("Couldn't open the camera", "Close the app and try again. If it keeps happening, choose from your library instead.");
    } finally {
      setPicking(false);
    }
  }

  function confirmDelete(photo: JobPhoto) {
    Alert.alert("Delete this photo?", "It's removed from the job for the office and your crew too.", [
      { text: "Keep it", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: () =>
          del.mutate(photo.id, {
            onSuccess: () => {
              forgetLocalPhoto(photo.id);
              setOpen(null);
            },
            onError: (e) => Alert.alert("Couldn't delete it", e instanceof Error ? e.message : "Try again in a moment."),
          }),
      },
    ]);
  }

  const takeLabel = phase === "AFTER" ? "Take an after photo" : "Take a before photo";

  return (
    <>
      <ScrollView contentContainerStyle={{ padding: space[4], paddingTop: space[1], gap: space[5], paddingBottom: (adding ? 120 : space[6]) + bottom }} showsVerticalScrollIndicator={false}>
        <Text variant="body" color="ink2" numeral>
          {total} of {policy.maxPhotos} on this job
        </Text>

        {!policy.photosAllowed ? (
          <Notice icon="info" text="The office has turned photos off for this job. To show them a problem, use Something wrong? on the job, which can take a photo." />
        ) : policy.canAdd ? (
          <View style={{ gap: space[2] }}>
            <Segmented label="What these photos show" options={PHASES} value={phase} onChange={setPhase} />
            <Text variant="small" color="ink2">
              {JOB_PHOTO_KIND_HINT[phase]}
            </Text>
          </View>
        ) : (
          <Notice icon="lock" text={policy.closedReason ?? "Photos can't be added to this job any more."} />
        )}

        {uploads.items.length > 0 ? (
          <View style={{ gap: space[2] }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: space[3], paddingLeft: space[1] }}>
              <Text variant="eyebrow" color="ink3" accessibilityRole="header" style={{ flex: 1 }}>
                Sending {uploads.items.length}
              </Text>
              {failed > 1 ? <Button label="Try all again" icon="retry" variant="secondary" size="md" onPress={() => uploads.retry()} /> : null}
            </View>
            {uploads.items.map((item) => (
              <UploadRow key={item.id} item={item} onRetry={() => uploads.retry(item.id)} onRemove={() => uploads.remove(item.id)} />
            ))}
          </View>
        ) : null}

        {items.length === 0 && uploads.items.length === 0 ? (
          <Empty
            icon="camera"
            title="No photos yet"
            detail={adding ? "Take before photos when you arrive, and after photos when you're done." : undefined}
          />
        ) : (
          <PhotoGrid photos={items} timeZone={timeZone} onOpen={setOpen} />
        )}

        {hasMore ? <Button label="Show more photos" variant="secondary" size="md" loading={loadingMore} onPress={onLoadMore} /> : null}
      </ScrollView>

      {adding ? (
        <View
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            bottom: 0,
            paddingHorizontal: space[4],
            paddingTop: space[3],
            paddingBottom: bottom + space[3],
            backgroundColor: color.surface,
            borderTopWidth: 1,
            borderTopColor: color.line,
            gap: space[2],
          }}
        >
          {room === 0 ? (
            <Text variant="small" color="ink2" align="center">
              This job has {policy.maxPhotos} photos, the most it can take. Ask the office before adding more.
            </Text>
          ) : null}
          <View style={{ flexDirection: "row", gap: space[2] }}>
            <Button
              label="Library"
              icon="library"
              variant="secondary"
              accessibilityHint="Choose photos you've already taken"
              disabled={picking || room === 0}
              onPress={() => add("library")}
            />
            <Button label={takeLabel} icon="camera" style={{ flex: 1 }} disabled={picking || room === 0} onPress={() => add("camera")} />
          </View>
        </View>
      ) : null}

      <PhotoViewer photo={open} timeZone={timeZone} deleting={del.isPending} onClose={() => setOpen(null)} onDelete={confirmDelete} />
    </>
  );
}

function Notice({ icon, text }: { icon: "info" | "lock"; text: string }) {
  return (
    <View style={{ flexDirection: "row", gap: space[3], padding: space[4], borderRadius: radius.lg, backgroundColor: color.groundDeep }}>
      <Icon name={icon} size={20} color="ink2" />
      <Text variant="small" color="ink2" style={{ flex: 1 }}>
        {text}
      </Text>
    </View>
  );
}
