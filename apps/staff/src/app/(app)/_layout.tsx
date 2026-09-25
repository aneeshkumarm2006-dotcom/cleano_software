import { Stack } from "expo-router";

import { OutboxProvider } from "@/data/outbox";

/**
 * Everything behind sign-in. The root layout guards this whole group, so a
 * screen added anywhere under (app)/ is protected by being put here — there is
 * no list of screens to forget to update.
 */
export default function SignedInLayout() {
  return (
    <OutboxProvider>
      <Stack screenOptions={{ headerShown: false }} />
    </OutboxProvider>
  );
}
