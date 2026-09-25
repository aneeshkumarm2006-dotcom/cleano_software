import type { JobPhoto, PhotoPhase, PhotoPolicy } from "@bookmops/api/v1";
import { JOB_PHOTO_KIND_HINT } from "@bookmops/core/jobs";
import { Button, color, Icon, IconButton, radius, Segmented, space, Text } from "@bookmops/ui-native";
import { useQueryClient } from "@tanstack/react-query";
import * as Haptics from "expo-haptics";
import { router, useLocalSearchParams } from "expo-router";
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

const PHASES = [
  { value: "BEFORE", label: "Before" },
  { value: "AFTER", label: "After" },
] as const;

/** One pick from the library at a time; a job's worth, not a camera roll. */
const MAX_PER_PICK = 20;

/**
 * Before and after photos for a job. Take or choose them, watch them send,
 * and delete your own. Photos go straight to storage from the phone; a failed
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
      <View style={{ paddingTop: insets.top + space[2], paddingHorizontal: space[4], flexDirection: "row", alignItems: "center", gap: space[3] }}>
        <IconButton icon="back" label="Back" onPress={() => (router.canGoBack() ? router.back() : router.replace("/"))} />
        <Text variant="eyebrow" color="ink3" style={{ flex: 1 }} numberOfLines={1}>
          {job.data?.address.line1 ?? ""}
        </Text>
      </View>

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

  // After-photos off: everything is filed as before, and the choice isn't offered.
  const effectivePhase: PhotoPhase = policy.afterPhotosAllowed ? phase : "BEFORE";
  const room = Math.max(0, policy.maxPhotos - total - uploads.items.length);
  const failed = uploads.items.filter((i) => i.step === "failed" && i.canRetry).length;

  async function add(from: "camera" | "library") {
    if (picking || room === 0) return;
    setPicking(true);
    try {
      const assets = await pickPhotos(from, Math.min(room, MAX_PER_PICK));
      if (assets?.length) {
        uploads.add(assets, effectivePhase, policy.maxBytes);
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

  const takeLabel = effectivePhase === "AFTER" ? "Take an after photo" : "Take a before photo";

  return (
    <>
      <ScrollView contentContainerStyle={{ padding: space[4], gap: space[5], paddingBottom: (policy.canAdd ? 120 : space[6]) + bottom }} showsVerticalScrollIndicator={false}>
        <View style={{ gap: space[1] }}>
          <Text variant="title" accessibilityRole="header">
            Photos
          </Text>
          <Text variant="body" color="ink2" numeral>
            {total} of {policy.maxPhotos} on this job
          </Text>
        </View>

        {!policy.afterPhotosAllowed ? (
          <Notice icon="info" text="After photos are off for this job. An admin turned them off, so just take before photos." />
        ) : null}

        {policy.canAdd ? (
          policy.afterPhotosAllowed ? (
            <View style={{ gap: space[2] }}>
              <Segmented label="What these photos show" options={PHASES} value={phase} onChange={setPhase} />
              <Text variant="small" color="ink2">
                {JOB_PHOTO_KIND_HINT[effectivePhase]}
              </Text>
            </View>
          ) : null
        ) : (
          <Notice icon="lock" text={policy.closedReason ?? "Photos can't be added to this job any more."} />
        )}

        {uploads.items.length > 0 ? (
          <View style={{ gap: space[2] }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: space[3] }}>
              <Text variant="eyebrow" color="chrome" accessibilityRole="header" style={{ flex: 1 }}>
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
            detail={policy.canAdd ? "Take before photos when you arrive, and after photos when you're done." : undefined}
          />
        ) : (
          <PhotoGrid photos={items} timeZone={timeZone} onOpen={setOpen} />
        )}

        {hasMore ? <Button label="Show more photos" variant="secondary" size="md" loading={loadingMore} onPress={onLoadMore} /> : null}
      </ScrollView>

      {policy.canAdd ? (
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
