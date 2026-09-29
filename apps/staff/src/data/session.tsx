import { ApiError, createClient, createPlatformClient } from "@bookmops/api/client";
import type { Workspace } from "@bookmops/api/v1";
import { useQueryClient } from "@tanstack/react-query";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

import { createCompanyAuthClient, type CompanyAuthClient } from "@/auth/auth-client";
import { workspaceStore } from "@/auth/workspace-store";
import { APP_VERSION, isAllowedOrigin, PLATFORM, PLATFORM_URL } from "@/config";
import { disablePush } from "@/notifications/push";

import type { PreviewRole } from "./preview-roles";
import { runSignOutTasks } from "./sign-out";
import type { DataSource } from "./source";
import { recordServerDate } from "./trusted-time";

type Session =
  | { status: "signed-out" }
  /** Signed in to a company: the real API. */
  | { status: "live"; workspace: Workspace; auth: CompanyAuthClient; source: DataSource }
  /** Development builds only: the app running on sample data. */
  | { status: "preview"; source: DataSource };

/** What signing in can come back with. */
export type SignInResult =
  | { ok: true }
  /** The email belongs to several companies: the person picks one. */
  | { ok: false; choose: Workspace[] }
  | { ok: false; error: string };

interface SessionContextValue {
  session: Session;
  /** The server said this build is too old (426): the app shows only the update screen. */
  updateRequired: boolean;
  /** Step one: find the person's company (or companies) and sign in. */
  signIn: (email: string, password: string) => Promise<SignInResult>;
  /** Step two, when there was a choice: sign in to the one they picked. */
  signInTo: (workspace: Workspace, email: string, password: string) => Promise<SignInResult>;
  forgotPassword: (email: string) => Promise<void>;
  signOut: () => Promise<void>;
  /** Development builds only, signed in as `role`. Undefined in a release build. */
  startPreview?: (role: PreviewRole) => void;
}

const SessionContext = createContext<SessionContextValue | null>(null);

const platform = createPlatformClient({ baseUrl: PLATFORM_URL, appVersion: APP_VERSION, platform: PLATFORM });

function liveSession(workspace: Workspace): Extract<Session, { status: "live" }> {
  const auth = createCompanyAuthClient(workspace.apiOrigin, workspace.orgId);
  const source = createClient({
    baseUrl: workspace.apiOrigin,
    appVersion: APP_VERSION,
    platform: PLATFORM,
    getCookie: () => auth.getCookie(),
    onServerDate: recordServerDate,
  });
  return { status: "live", workspace, auth, source };
}

/**
 * Where the app starts. A stored company and a stored session cookie mean the
 * person is signed in — even with no signal, which is exactly when a cleaner
 * opens the app in a basement. The server still checks every request; a
 * session it no longer accepts sends them back here (a 401 from any call).
 */
function initialSession(): Session {
  if (__DEV__ && process.env.EXPO_PUBLIC_PREVIEW === "1") {
    const preview = require("./preview");
    // EXPO_PUBLIC_PREVIEW_ROLE=OPS_MANAGER (or FIELD_LEAD, ADMIN) opens the preview as that person.
    const role = process.env.EXPO_PUBLIC_PREVIEW_ROLE;
    if (role) preview.setPreviewRole(role);
    return { status: "preview", source: preview.previewSource };
  }
  const workspace = workspaceStore.load();
  if (workspace && isAllowedOrigin(workspace.apiOrigin)) {
    const live = liveSession(workspace);
    if (live.auth.getCookie()) return live;
  }
  return { status: "signed-out" };
}

const WRONG = "Email or password is incorrect.";
const TROUBLE = "We couldn't sign you in just now. Try again in a minute.";

export function SessionProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [session, setSession] = useState<Session>(initialSession);
  const [updateRequired, setUpdateRequired] = useState(false);

  const signInTo = useCallback(
    async (workspace: Workspace, email: string, password: string): Promise<SignInResult> => {
      if (!isAllowedOrigin(workspace.apiOrigin)) {
        return { ok: false, error: "That company's address isn't one this app can use. Contact your office." };
      }
      const live = liveSession(workspace);
      const res = await live.auth.signIn.email({ email, password });
      if (res.error) {
        // A 403 carries the company's own "switched off" wording; show it as is.
        if (res.error.status === 403 && res.error.message) return { ok: false, error: res.error.message };
        // The password was already accepted to get here, so anything but a
        // 401 is our fault, not theirs: don't send them hunting for another one.
        if (res.error.status !== 401) return { ok: false, error: TROUBLE };
        return { ok: false, error: WRONG };
      }
      workspaceStore.save(workspace);
      queryClient.clear();
      setSession(live);
      return { ok: true };
    },
    [queryClient],
  );

  const signIn = useCallback(
    async (email: string, password: string): Promise<SignInResult> => {
      const normalised = email.trim().toLowerCase();
      let workspaces: Workspace[];
      try {
        workspaces = (await platform.workspaces(normalised, password)).workspaces;
      } catch (e) {
        if (e instanceof ApiError && e.status === 429) return { ok: false, error: "Too many attempts. Wait a minute and try again." };
        if (e instanceof ApiError && e.code === "NETWORK") return { ok: false, error: "You're offline. Connect to sign in." };
        return { ok: false, error: WRONG };
      }
      if (workspaces.length === 0) return { ok: false, error: WRONG };
      if (workspaces.length > 1) return { ok: false, choose: workspaces };
      return signInTo(workspaces[0], normalised, password);
    },
    [signInTo],
  );

  const forgotPassword = useCallback(async (email: string) => {
    // Always "sent", whatever happened: the answer must not reveal whether
    // the address has an account.
    await platform.forgotPassword(email.trim().toLowerCase()).catch(() => undefined);
  }, []);

  const signOut = useCallback(async () => {
    if (session.status === "live") {
      // Best effort: stop this phone's notifications and end the session on
      // the server. The local sign-out happens either way, so a phone with no
      // signal still signs out.
      await disablePush(session.source);
      await session.auth.signOut().catch(() => undefined);
      await workspaceStore.clear();
    }
    // Queued clock events stay (they're owned, and sent when that person
    // signs in again); everything else read into memory goes, including
    // photos still waiting to upload, which would otherwise go out under the
    // next person's session.
    runSignOutTasks();
    queryClient.clear();
    setSession({ status: "signed-out" });
  }, [session, queryClient]);

  // Any request the server answers "signed out" (401) — a revoked session, a
  // switched-off account — sends the person back to sign in, rather than
  // leaving every screen to fail one by one.
  useEffect(() => {
    if (session.status !== "live") return;
    return queryClient.getQueryCache().subscribe((event) => {
      const error = event.query.state.error;
      if (event.type !== "updated" || !(error instanceof ApiError)) return;
      if (error.signedOut) void signOut();
      else if (error.updateRequired) setUpdateRequired(true);
    });
  }, [session.status, queryClient, signOut]);

  const value = useMemo<SessionContextValue>(
    () => ({
      session,
      updateRequired,
      signIn,
      signInTo,
      forgotPassword,
      signOut,
      // The preview source is required lazily and only in development, so
      // release bundles never contain the sample data.
      startPreview: __DEV__
        ? (role: PreviewRole) => {
            const preview = require("./preview");
            preview.setPreviewRole(role);
            // Nothing read as the last person may show as this one.
            queryClient.clear();
            setSession({ status: "preview", source: preview.previewSource });
          }
        : undefined,
    }),
    [session, updateRequired, signIn, signInTo, forgotPassword, signOut, queryClient],
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
