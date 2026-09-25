import { color, IconButton, space, Text } from "@bookmops/ui-native";
import { router } from "expo-router";
import { KeyboardAvoidingView, Platform, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ChangePasswordForm } from "@/features/account/ChangePasswordForm";

/** Change password, from More. */
export default function ChangePassword() {
  const insets = useSafeAreaInsets();
  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: color.ground }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingTop: insets.top + space[2], paddingHorizontal: space[4], paddingBottom: insets.bottom + space[6], gap: space[5] }}
      >
        <IconButton icon="back" label="Back" onPress={() => router.back()} />
        <View style={{ gap: space[1] }}>
          <Text variant="title" accessibilityRole="header">
            Change password
          </Text>
          <Text variant="body" color="ink2">
            Every other phone or browser signed in as you will be signed out.
          </Text>
        </View>
        <ChangePasswordForm onDone={() => router.back()} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
