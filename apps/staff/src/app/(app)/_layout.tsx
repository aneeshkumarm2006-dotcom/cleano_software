import { Button, color, Icon, radius, space, Text } from "@bookmops/ui-native";
import { useQueryClient } from "@tanstack/react-query";
import { Stack } from "expo-router";
import { KeyboardAvoidingView, Platform, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Loading } from "@/components/QueryState";
import { OutboxProvider } from "@/data/outbox";
import { keys, useMe } from "@/data/queries";
import { useStaffRole } from "@/data/role";
import { useSession } from "@/data/session";
import { ChangePasswordForm } from "@/features/account/ChangePasswordForm";
import { useNotificationRouting } from "@/notifications/push";

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
  const { role, side } = useStaffRole();
  useNotificationRouting();
  if (me.data?.mustChangePassword) return <MustChangePassword />;
  // The first open after this build is installed: nothing on record yet, so
  // wait for /me rather than show one side's screens and then swap. With no
  // signal the query is paused, not fetching, and it falls through to the
  // cleaner app, as before.
  if (!role && me.isPending && me.fetchStatus === "fetching") return <Starting />;
  if (role && !side) return <NotForThisApp />;
  return (
    <OutboxProvider>
      {/* (crew) is the cleaner app and sends office roles to /manage; manage/
          is the manager app, each screen guarded by what the role may do.
          account, announcements and team are everyone's. */}
      <Stack screenOptions={{ headerShown: false }} />
    </OutboxProvider>
  );
}

function Starting() {
  return (
    <View style={{ flex: 1, backgroundColor: color.ground, justifyContent: "center" }}>
      <Loading label="Opening Bookmops Pro" />
    </View>
  );
}

/**
 * A client or an applicant who signs in here: Bookmops Pro is for staff, so
 * they're told so and can only sign out (API_V1.md §2). The server refuses
 * them on every endpoint anyway.
 */
function NotForThisApp() {
  const insets = useSafeAreaInsets();
  const { signOut } = useSession();
  return (
    <View style={{ flex: 1, backgroundColor: color.ground, paddingTop: insets.top + space[12], paddingHorizontal: space[6], paddingBottom: insets.bottom + space[6], gap: space[5] }}>
      <View style={{ width: 64, height: 64, borderRadius: radius.xl, backgroundColor: color.accentSoft, alignItems: "center", justifyContent: "center" }}>
        <Icon name="info" size={32} color="accentText" />
      </View>
      <Text variant="title" accessibilityRole="header">
        This app is for staff
      </Text>
      <Text variant="body" color="ink2">
        Bookmops Pro is for cleaners and the office. Your account isn't a staff account, so there is nothing here for it.
        If you book cleanings, use the Bookmops app.
      </Text>
      <View style={{ marginTop: "auto" }}>
        <Button label="Sign out" variant="secondary" icon="signOut" onPress={signOut} />
      </View>
    </View>
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
