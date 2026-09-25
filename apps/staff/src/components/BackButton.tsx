import { IconButton } from "@bookmops/ui-native";
import { router, type Href } from "expo-router";

/**
 * Back to where the person came from. A screen opened from a notification or
 * a link has nowhere to go back to, so it goes to `fallback` instead: the
 * screen it would normally have been opened from.
 */
export function goBackOr(fallback: Href) {
  if (router.canGoBack()) router.back();
  else router.replace(fallback);
}

/** The back arrow at the top left of a screen that isn't a tab. */
export function BackButton({ fallback, label }: { fallback: Href; label?: string }) {
  return <IconButton icon="back" label={label ?? "Back"} onPress={() => goBackOr(fallback)} />;
}
