// The Better Auth client for one company's address. Its session cookie lives
// in secure storage under a prefix keyed by company, so two companies' sessions
// on one phone can never be confused, and supporting both later is additive.
import { expoClient } from "@better-auth/expo/client";
import { createAuthClient } from "better-auth/react";

import { APP_SCHEME } from "@/config";

import { secureStorage } from "./secure-storage";

export function createCompanyAuthClient(origin: string, orgId: string) {
  return createAuthClient({
    baseURL: origin,
    plugins: [
      expoClient({
        scheme: APP_SCHEME,
        storagePrefix: `bookmopspro.${orgId}`,
        storage: secureStorage,
        // Production names the cookie "__Secure-better-auth.session_token".
        cookiePrefix: ["better-auth", "__Secure-better-auth"],
        // No cached copy of the session on the phone: a switched-off account
        // is signed out on its next request, not whenever a cache expires.
        disableCache: true,
      }),
    ],
  });
}

export type CompanyAuthClient = ReturnType<typeof createCompanyAuthClient>;
