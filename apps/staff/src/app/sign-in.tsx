import { Button, color, Icon, radius, space, Text, TextField } from "@bookmops/ui-native";
import { useRef, useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, type TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useSession } from "@/data/session";

/**
 * Sign in. The company is found from the work email (docs/architecture/
 * API_V1.md §2), so there is no company field to fill in.
 *
 * Real sign-in lands with the API's auth endpoints. Until then, a development
 * build offers "Explore with sample data" so every screen can be reviewed on a
 * simulator; a release build shows no such button.
 */
export default function SignIn() {
  const insets = useSafeAreaInsets();
  const { startPreview } = useSession();
  const passwordRef = useRef<TextInput>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [notice, setNotice] = useState<string | null>(null);

  function submit() {
    setNotice("Signing in from the app is almost ready. For now, sign in on the web.");
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: color.chrome }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ flexGrow: 1 }}
        showsVerticalScrollIndicator={false}
      >
        <View style={{ paddingTop: insets.top + space[10], paddingHorizontal: space[6], paddingBottom: space[8], gap: space[3] }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: space[3] }}>
            <View
              style={{
                width: 40,
                height: 40,
                borderRadius: radius.md,
                backgroundColor: color.accent,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Icon name="check" size={22} color="onChrome" />
            </View>
            <Text variant="eyebrow" color="onChrome" style={{ fontSize: 15, letterSpacing: 2 }}>
              Bookmops
            </Text>
            <View style={{ paddingHorizontal: space[2], paddingVertical: 2, borderRadius: radius.sm, backgroundColor: "rgba(255,255,255,0.12)" }}>
              <Text variant="eyebrow" color="accentOnChrome">
                Pro
              </Text>
            </View>
          </View>
          <Text variant="body" color="onChrome2">
            Your shifts, your route and your pay, in one place.
          </Text>
        </View>

        <View
          style={{
            flexGrow: 1,
            backgroundColor: color.ground,
            borderTopLeftRadius: 28,
            borderTopRightRadius: 28,
            paddingHorizontal: space[6],
            paddingTop: space[8],
            paddingBottom: insets.bottom + space[6],
            gap: space[5],
          }}
        >
          <Text variant="title" accessibilityRole="header">
            Sign in
          </Text>

          <TextField
            label="Work email"
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            autoComplete="email"
            keyboardType="email-address"
            textContentType="username"
            returnKeyType="next"
            onSubmitEditing={() => passwordRef.current?.focus()}
          />
          <TextField
            ref={passwordRef}
            label="Password"
            value={password}
            onChangeText={setPassword}
            secret
            autoComplete="current-password"
            textContentType="password"
            returnKeyType="go"
            onSubmitEditing={submit}
          />

          <Button label="Sign in" onPress={submit} disabled={!email.trim() || !password} />

          {notice ? (
            <View
              accessibilityLiveRegion="polite"
              style={{ flexDirection: "row", gap: space[2], padding: space[3], borderRadius: radius.md, backgroundColor: color.warningSoft }}
            >
              <Icon name="info" size={18} color="warning" />
              <Text variant="small" color="warning" style={{ flex: 1 }}>
                {notice}
              </Text>
            </View>
          ) : null}

          <Text variant="small" color="ink3" align="center">
            We find your company from your work email, so there is nothing else to type in.
          </Text>

          {/* `__DEV__ &&` first, so a release build drops this branch at compile time. */}
          {__DEV__ && startPreview ? (
            <View style={{ marginTop: "auto", gap: space[2] }}>
              <Button label="Explore with sample data" variant="secondary" size="md" onPress={startPreview} />
              <Text variant="small" color="ink3" align="center">
                Development build only. Nothing here is real, and nothing is saved.
              </Text>
            </View>
          ) : null}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
