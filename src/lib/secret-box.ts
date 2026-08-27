/*
 * Not marked "server-only", matching org.ts and org-url.ts beside it.
 *
 * That marker is aliased away by Next at build time and does not exist as a
 * real package, so importing it makes this module unreachable from the
 * verification scripts — and this is precisely the module whose behaviour most
 * needs verifying. The protection is not lost: this reads node:crypto and process.env, which a client bundle cannot
 * resolve, so a client component importing this still fails to build.
 */
import { createCipheriv, createDecipheriv, randomBytes, createHash } from "node:crypto";

/**
 * Encrypting the secrets a customer hands us.
 *
 * A cleaning company pastes its own Stripe secret key into its settings. That
 * key can move money out of their account, so it must not sit in the database
 * in plain text, where every backup, every read replica, every console query
 * and every future export carries it.
 *
 * AES-256-GCM: it authenticates as well as encrypts, so a value tampered with
 * in the database fails to decrypt rather than decrypting into something else.
 *
 * The key comes from SECRETS_KEY and never from the database — the whole point
 * is that a copy of the data is not enough. 32 bytes, given as hex or base64.
 * A passphrase is accepted and hashed to 32 bytes rather than rejected, because
 * the alternative is somebody "fixing" the error by turning encryption off.
 */

const VERSION = "v1";

export class SecretsKeyMissing extends Error {
  constructor() {
    super(
      "SECRETS_KEY is not set, so credentials cannot be stored. Generate one with: openssl rand -hex 32",
    );
    this.name = "SecretsKeyMissing";
  }
}

function keyBytes(): Buffer {
  const raw = process.env.SECRETS_KEY?.trim();
  if (!raw) throw new SecretsKeyMissing();

  if (/^[0-9a-fA-F]{64}$/.test(raw)) return Buffer.from(raw, "hex");

  const b64 = Buffer.from(raw, "base64");
  if (b64.length === 32) return b64;

  // Anything else is treated as a passphrase. Weaker than a real random key,
  // and better than the deployment that would otherwise store keys in clear.
  return createHash("sha256").update(raw, "utf8").digest();
}

/** Is this deployment able to store secrets at all? */
export function canStoreSecrets(): boolean {
  try {
    keyBytes();
    return true;
  } catch {
    return false;
  }
}

/** `v1.<iv>.<tag>.<ciphertext>`, all base64url. */
export function seal(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyBytes(), iv);
  const body = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString("base64url"), tag.toString("base64url"), body.toString("base64url")].join(".");
}

/**
 * Returns null rather than throwing when a value cannot be opened.
 *
 * A rotated SECRETS_KEY, a truncated column, a row copied between environments
 * — the caller's correct response to all of them is the same as to "not
 * configured": refuse to take a payment. An exception here would instead turn a
 * settings page into a 500 and hide the reason.
 */
export function open(sealed: string | null | undefined): string | null {
  if (!sealed) return null;
  const parts = sealed.split(".");
  if (parts.length !== 4 || parts[0] !== VERSION) return null;
  try {
    const [, iv, tag, body] = parts;
    const decipher = createDecipheriv("aes-256-gcm", keyBytes(), Buffer.from(iv, "base64url"));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([
      decipher.update(Buffer.from(body, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    return null;
  }
}

/**
 * The tail of a secret, for showing someone which key is saved without showing
 * them the key. Stripe's own dashboard does the same.
 */
export function hint(secret: string): string {
  const tail = secret.slice(-4);
  return tail.length === 4 ? `••••${tail}` : "••••";
}
