import { fonts } from "@bookmops/ui-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useFonts } from "expo-font";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { useEffect, useState } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { ApiError } from "@bookmops/api/client";

import { UpdateRequired } from "@/components/UpdateRequired";
import { SessionProvider, useSession } from "@/data/session";

// Hold the splash until the font is ready, so no screen ever draws in the
// fallback face first and then jumps.
SplashScreen.preventAutoHideAsync();

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // Retry what might succeed on a second try (a dropped connection, a
        // 503), never what won't (signed out, too old, not found).
        retry: (failures, error) => failures < 2 && (!(error instanceof ApiError) || error.retryable),
        staleTime: 30_000,
      },
    },
  });
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts(fonts);
  const [queryClient] = useState(makeQueryClient);

  useEffect(() => {
    if (fontsLoaded || fontError) SplashScreen.hideAsync();
  }, [fontsLoaded, fontError]);

  // A font that fails to load is not a reason to show nothing: the system
  // face takes over and the app still works.
  if (!fontsLoaded && !fontError) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <QueryClientProvider client={queryClient}>
          <SessionProvider>
            <StatusBar style="dark" />
            <Routes />
          </SessionProvider>
        </QueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

function Routes() {
  const { session, updateRequired } = useSession();
  const signedIn = session.status !== "signed-out";
  if (updateRequired) return <UpdateRequired />;
  return (
    <Stack screenOptions={{ headerShown: false }}>
      {/* A route that is not allowed simply doesn't exist: no screen can link
          past sign-in, and signing out takes every signed-in screen away.
          Every signed-in screen lives under (app)/, guarded as one. */}
      <Stack.Protected guard={!signedIn}>
        <Stack.Screen name="sign-in" />
        <Stack.Screen name="forgot-password" />
      </Stack.Protected>
      <Stack.Protected guard={signedIn}>
        <Stack.Screen name="(app)" />
      </Stack.Protected>
    </Stack>
  );
}
