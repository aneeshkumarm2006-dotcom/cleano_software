"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

interface InstallContextValue {
  /** Chrome/Android captured a `beforeinstallprompt` we can fire. */
  canInstall: boolean;
  /** App is already running as an installed PWA. */
  isStandalone: boolean;
  /** iOS Safari — install must be done manually via Share → Add to Home Screen. */
  isIOSSafari: boolean;
  /** Triggers the native install prompt. Resolves true if the user accepted. */
  install: () => Promise<boolean>;
}

const InstallContext = createContext<InstallContextValue>({
  canInstall: false,
  isStandalone: false,
  isIOSSafari: false,
  install: async () => false,
});

/**
 * Wrap once near the app root. Listens for `beforeinstallprompt` and exposes
 * `install()` so any descendant (drawer item, banner, settings page) can
 * trigger the native install dialog on demand — not just on first visit.
 */
export function InstallProvider({ children }: { children: ReactNode }) {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [isStandalone, setIsStandalone] = useState(false);
  const [isIOSSafari, setIsIOSSafari] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;

    setIsStandalone(
      window.matchMedia("(display-mode: standalone)").matches ||
        (window.navigator as unknown as { standalone?: boolean }).standalone === true
    );

    const ua = navigator.userAgent;
    setIsIOSSafari(
      /iPad|iPhone|iPod/.test(ua) && !/CriOS|FxiOS|EdgiOS/.test(ua)
    );

    // `beforeinstallprompt` usually fires before React hydrates, so the root
    // layout stashes it at parse time. Pick that up first, then keep listening
    // for a later one (Chrome can re-fire it on navigation).
    const stashed = (window as unknown as {
      __cleanoInstallEvent?: BeforeInstallPromptEvent | null;
    }).__cleanoInstallEvent;
    if (stashed) setDeferred(stashed);

    const handler = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", handler);

    const installedHandler = () => {
      setDeferred(null);
      setIsStandalone(true);
    };
    window.addEventListener("appinstalled", installedHandler);

    return () => {
      window.removeEventListener("beforeinstallprompt", handler);
      window.removeEventListener("appinstalled", installedHandler);
    };
  }, []);

  const install = useCallback(async () => {
    if (!deferred) return false;
    await deferred.prompt();
    try {
      const choice = await deferred.userChoice;
      setDeferred(null);
      return choice.outcome === "accepted";
    } catch {
      return false;
    }
  }, [deferred]);

  return (
    <InstallContext.Provider
      value={{ canInstall: !!deferred, isStandalone, isIOSSafari, install }}>
      {children}
    </InstallContext.Provider>
  );
}

export function useInstall() {
  return useContext(InstallContext);
}
