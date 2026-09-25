import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

import type { DataSource } from "./source";

type Session =
  | { status: "signed-out" }
  /** Development builds only: the app running on sample data. */
  | { status: "preview"; source: DataSource };

interface SessionContextValue {
  session: Session;
  /** Development builds only. Undefined in a release build. */
  startPreview?: () => void;
  signOut: () => void;
}

const SessionContext = createContext<SessionContextValue | null>(null);

/**
 * Development builds only: start straight in sample data when
 * EXPO_PUBLIC_PREVIEW=1, so screens can be opened by deep link on a simulator
 * without tapping through sign-in each time.
 */
function initialSession(): Session {
  if (__DEV__ && process.env.EXPO_PUBLIC_PREVIEW === "1") {
    return { status: "preview", source: require("./preview").previewSource };
  }
  return { status: "signed-out" };
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session>(initialSession);

  const value = useMemo<SessionContextValue>(
    () => ({
      session,
      signOut: () => setSession({ status: "signed-out" }),
      // The preview source is required lazily and only in development, so
      // release bundles never contain the sample data.
      startPreview: __DEV__
        ? () => setSession({ status: "preview", source: require("./preview").previewSource })
        : undefined,
    }),
    [session],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession outside SessionProvider");
  return ctx;
}

/** The data source for a signed-in screen. Screens only render when signed in. */
export function useSource(): DataSource {
  const { session } = useSession();
  if (session.status === "signed-out") throw new Error("useSource while signed out");
  return session.source;
}
