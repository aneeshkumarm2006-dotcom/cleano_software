import type { Workspace } from "@bookmops/api/v1";
import { Button, Card, ChoiceChips, color, Icon, radius, space, Text, TextField } from "@bookmops/ui-native";
import { Link } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, type TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { PREVIEW_ROLES, type PreviewRole } from "@/data/preview-roles";
import { useSession } from "@/data/session";

/**
 * Development builds only: an account to sign in as without typing, for a
 * simulator run against a local server (README, "Running against a real
 * server"). `__DEV__ &&` comes first, so a release build folds each to ""
 * and neither string is in its bundle.
 */
const DEV_EMAIL = (__DEV__ && process.env.EXPO_PUBLIC_DEV_SIGNIN_EMAIL) || "";
const DEV_PASSWORD = (__DEV__ && process.env.EXPO_PUBLIC_DEV_SIGNIN_PASSWORD) || "";
/** Signed in with them once per launch, so signing out leaves the person on this screen. */
let devSignInTried = false;

/**
 * Sign in. The company is found from the work email (docs/architecture/
 * API_V1.md §2), so there is no company field. Someone who works for more
 * than one company picks which one after their password is checked.
 */
export default function SignIn() {
  const insets = useSafeAreaInsets();
  const { signIn, signInTo, startPreview } = useSession();
  const passwordRef = useRef<TextInput>(null);
  const [email, setEmail] = useState(DEV_EMAIL);
  const [password, setPassword] = useState(DEV_PASSWORD);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [choices, setChoices] = useState<Workspace[] | null>(null);
  const [previewAs, setPreviewAs] = useState<PreviewRole>("EMPLOYEE");

  async function submit() {
    if (busy || !email.trim() || !password) return;
    setBusy(true);
    setError(null);
    const result = await signIn(email, password);
    setBusy(false);
    if (result.ok) return;
    if ("choose" in result) setChoices(result.choose);
    else setError(result.error);
  }

  useEffect(() => {
    if (!__DEV__ || !DEV_EMAIL || !DEV_PASSWORD || devSignInTried) return;
    devSignInTried = true;
    void submit();
    // Once, on the first mount of a launch; nothing it reads changes.
  }, []);

  async function choose(workspace: Workspace) {
    setBusy(true);
    setError(null);
    const result = await signInTo(workspace, email.trim().toLowerCase(), password);
    setBusy(false);
    if (!result.ok && "error" in result) setError(result.error);
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: color.chrome }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ flexGrow: 1 }} showsVerticalScrollIndicator={false}>
        <View style={{ paddingTop: insets.top + space[10], paddingHorizontal: space[6], paddingBottom: space[8], gap: space[3] }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: space[3] }}>
            <View style={{ width: 40, height: 40, borderRadius: radius.md, backgroundColor: color.accent, alignItems: "center", justifyContent: "center" }}>
              <Text variant="heading" color="onChrome">
                B
              </Text>
            </View>
            <Text variant="eyebrow" color="onChrome" style={{ fontSize: 15, letterSpacing: 2 }}>
              Bookmops
            </Text>
            <View style={{ paddingHorizontal: space[2], paddingVertical: 2, borderRadius: radius.sm, backgroundColor: color.tagOnChrome }}>
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
          {choices ? (
            <>
              <View style={{ gap: space[1] }}>
                <Text variant="title" accessibilityRole="header">
                  Which company?
                </Text>
                <Text variant="body" color="ink2">
                  You work for more than one. Pick the one you're working for now.
                </Text>
              </View>
              {choices.map((w) => (
                <Card key={w.orgId} padding={4} onPress={busy ? undefined : () => choose(w)} accessibilityLabel={`Sign in to ${w.name}`}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: space[3] }}>
                    <Icon name="team" size={22} color="accentText" />
                    <Text variant="subheading" style={{ flex: 1 }}>
                      {w.name}
                    </Text>
                    <Icon name="forward" size={18} color="ink3" />
                  </View>
                </Card>
              ))}
              <Button label="Back" variant="secondary" size="md" onPress={() => setChoices(null)} disabled={busy} />
            </>
          ) : (
            <>
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
                editable={!busy}
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
                editable={!busy}
                onSubmitEditing={submit}
              />
              <Button label="Sign in" onPress={submit} loading={busy} disabled={!email.trim() || !password} />
              <Link href={{ pathname: "/forgot-password", params: { email } }} asChild>
                <Text variant="bodyStrong" color="accentText" align="center" accessibilityRole="link" style={{ paddingVertical: space[2] }}>
                  Forgot your password?
                </Text>
              </Link>
            </>
          )}

          {error ? (
            <View
              accessibilityLiveRegion="assertive"
              style={{ flexDirection: "row", gap: space[2], padding: space[3], borderRadius: radius.md, backgroundColor: color.dangerSoft }}
            >
              <Icon name="warning" size={18} color="danger" />
              <Text variant="small" color="danger" style={{ flex: 1 }}>
                {error}
              </Text>
            </View>
          ) : null}

          {!choices ? (
            <Text variant="small" color="ink3" align="center">
              We find your company from your work email, so there is nothing else to type in.
            </Text>
          ) : null}

          {/* `__DEV__ &&` first, so a release build drops this branch at compile time. */}
          {__DEV__ && startPreview ? (
            <View style={{ marginTop: "auto", gap: space[2] }}>
              <ChoiceChips label="Explore as" options={PREVIEW_ROLES} value={previewAs} onChange={setPreviewAs} />
              <Button label="Explore with sample data" variant="secondary" size="md" onPress={() => startPreview(previewAs)} />
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
