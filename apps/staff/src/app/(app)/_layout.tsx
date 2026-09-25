import { color, space, Text } from "@bookmops/ui-native";
import { useQueryClient } from "@tanstack/react-query";
import { Stack } from "expo-router";
import { KeyboardAvoidingView, Platform, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { OutboxProvider } from "@/data/outbox";
import { keys, useMe } from "@/data/queries";
import { ChangePasswordForm } from "@/features/account/ChangePasswordForm";

/**
 * Everything behind sign-in. The root layout guards this whole group, so a
 * screen added anywhere under (app)/ is protected by being put here — there is
 * no list of screens to forget to update.
 *
 * A person on a temporary password sees nothing else until they choose their
 * own, as on the web.
 */
export default function SignedInLayout() {
  const me = useMe();
  if (me.data?.mustChangePassword) return <MustChangePassword />;
  return (
    <OutboxProvider>
      <Stack screenOptions={{ headerShown: false }} />
    </OutboxProvider>
  );
}

function MustChangePassword() {
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: color.ground }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingTop: insets.top + space[8], paddingHorizontal: space[6], paddingBottom: insets.bottom + space[6], gap: space[5] }}
      >
        <View style={{ gap: space[1] }}>
          <Text variant="title" accessibilityRole="header">
            Choose your own password
          </Text>
          <Text variant="body" color="ink2">
            Your account was set up with a temporary password. Pick one only you know to carry on.
          </Text>
        </View>
        <ChangePasswordForm onDone={() => qc.invalidateQueries({ queryKey: keys.me })} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
