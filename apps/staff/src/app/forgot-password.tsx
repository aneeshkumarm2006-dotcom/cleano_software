import { Button, color, Icon, IconButton, radius, space, Text, TextField } from "@bookmops/ui-native";
import { useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { goBackOr } from "@/components/BackButton";
import { useSession } from "@/data/session";

/**
 * Forgot password. Reset links go out for every company the address belongs
 * to, and the screen says "check your email" whatever happened, so it can't be
 * used to find out whether an address has an account.
 */
export default function ForgotPassword() {
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ email?: string }>();
  const { forgotPassword } = useSession();
  const [email, setEmail] = useState(params.email ?? "");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  async function submit() {
    if (!email.trim() || busy) return;
    setBusy(true);
    await forgotPassword(email);
    setBusy(false);
    setSent(true);
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: color.ground }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingTop: insets.top + space[2], paddingHorizontal: space[6], paddingBottom: insets.bottom + space[6], gap: space[5] }}
      >
        <IconButton icon="back" label="Back to sign in" onPress={() => goBackOr("/sign-in")} />
        <View style={{ gap: space[1] }}>
          <Text variant="title" accessibilityRole="header">
            Reset your password
          </Text>
          <Text variant="body" color="ink2">
            Enter your work email. We'll send a link to choose a new password.
          </Text>
        </View>

        {sent ? (
          <View accessibilityLiveRegion="polite" style={{ flexDirection: "row", gap: space[3], padding: space[4], borderRadius: radius.lg, backgroundColor: color.successSoft }}>
            <Icon name="mail" size={22} color="success" />
            <Text variant="body" style={{ flex: 1 }}>
              If that address has an account, a reset link is on its way. Check your email, including the spam folder.
            </Text>
          </View>
        ) : (
          <>
            <TextField
              label="Work email"
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              autoComplete="email"
              keyboardType="email-address"
              textContentType="username"
              returnKeyType="send"
              onSubmitEditing={submit}
            />
            <Button label="Send reset link" onPress={submit} loading={busy} disabled={!email.trim()} />
          </>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
