// The Cloudinary calls job media needs, behind one small interface so the
// services never touch the SDK directly (and a test can stand a fake in).
//
// The API secret is used here to sign and to call the Admin API. It never
// appears in anything returned to a client: a ticket carries `api_key`,
// `timestamp`, the signed parameters and the signature, nothing else.
import "server-only";

import { cloudinary, cloudinaryConfigured } from "@/lib/cloudinary";

import { deliveryPrefix } from "./keys";

export interface StoredAsset {
  publicId: string;
  format: string;
  bytes: number;
  secureUrl: string;
}

export type AssetLookup = { kind: "found"; asset: StoredAsset } | { kind: "missing" } | { kind: "unavailable" };

export interface MediaStore {
  configured(): boolean;
  cloudName(): string;
  apiKey(): string;
  /** The signature Cloudinary checks for exactly these parameters. */
  sign(params: Record<string, string | number>): string;
  /** The stored asset, by public_id, from the Admin API. */
  lookup(publicId: string): Promise<AssetLookup>;
  /** The first `n` bytes of a stored original, or null if they can't be read. */
  readHead(secureUrl: string, n: number): Promise<Uint8Array | null>;
  /** Remove an asset. Never throws; a failure is logged. */
  destroy(publicId: string): Promise<void>;
}

const HEAD_TIMEOUT_MS = 8_000;

function httpCodeOf(err: unknown): number | null {
  const e = err as { http_code?: unknown; error?: { http_code?: unknown } } | null;
  const code = e?.error?.http_code ?? e?.http_code;
  return typeof code === "number" ? code : null;
}

export const cloudinaryStore: MediaStore = {
  configured: cloudinaryConfigured,
  cloudName: () => process.env.CLOUDINARY_CLOUD_NAME ?? "",
  apiKey: () => process.env.CLOUDINARY_API_KEY ?? "",

  sign(params) {
    return cloudinary.utils.api_sign_request(params, process.env.CLOUDINARY_API_SECRET ?? "");
  },

  async lookup(publicId) {
    try {
      const r = (await cloudinary.api.resource(publicId, { resource_type: "image", type: "upload" })) as {
        public_id?: unknown;
        format?: unknown;
        bytes?: unknown;
        secure_url?: unknown;
      };
      if (
        typeof r?.public_id !== "string" ||
        typeof r.format !== "string" ||
        typeof r.bytes !== "number" ||
        typeof r.secure_url !== "string"
      ) {
        return { kind: "unavailable" };
      }
      return { kind: "found", asset: { publicId: r.public_id, format: r.format, bytes: r.bytes, secureUrl: r.secure_url } };
    } catch (err) {
      if (httpCodeOf(err) === 404) return { kind: "missing" };
      console.error("media lookup failed", httpCodeOf(err));
      return { kind: "unavailable" };
    }
  },

  async readHead(secureUrl, n) {
    // Only ever our own cloud's original: the URL comes from the Admin API, and
    // is checked again here so this can never become a fetch of anything else.
    const prefix = deliveryPrefix(this.cloudName());
    if (!this.cloudName() || !secureUrl.startsWith(prefix)) return null;
    try {
      const res = await fetch(secureUrl, {
        headers: { Range: `bytes=0-${n - 1}` },
        redirect: "error",
        signal: AbortSignal.timeout(HEAD_TIMEOUT_MS),
        cache: "no-store",
      });
      if (!res.ok || !res.body) return null;
      const reader = res.body.getReader();
      const out = new Uint8Array(n);
      let got = 0;
      while (got < n) {
        const { done, value } = await reader.read();
        if (done || !value) break;
        const take = Math.min(value.length, n - got);
        out.set(value.subarray(0, take), got);
        got += take;
      }
      await reader.cancel().catch(() => {});
      return out.subarray(0, got);
    } catch (err) {
      console.error("media head read failed", (err as Error)?.name);
      return null;
    }
  },

  async destroy(publicId) {
    try {
      await cloudinary.uploader.destroy(publicId, { resource_type: "image", invalidate: true });
    } catch (err) {
      console.error("media destroy failed (continuing)", httpCodeOf(err));
    }
  },
};

let current: MediaStore = cloudinaryStore;

/** The store the services use. */
export function mediaStore(): MediaStore {
  return current;
}

/** For tests only: stand another store in. Returns a function that restores the real one. */
export function useMediaStoreForTests(store: MediaStore): () => void {
  current = store;
  return () => {
    current = cloudinaryStore;
  };
}
