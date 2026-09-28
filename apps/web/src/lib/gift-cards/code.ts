import { randomBytes } from "crypto";

/**
 * Generate a human-friendly gift card code like `CLNO-3J7K-9PXR-4QM2`.
 * Letters/digits only, uppercase, no easily-confused chars (no 0/O/1/I).
 */
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function pickGroup(): string {
  const bytes = randomBytes(4);
  let out = "";
  for (let i = 0; i < 4; i++) {
    out += ALPHABET[bytes[i] % ALPHABET.length];
  }
  return out;
}

export function generateGiftCardCode(): string {
  return `CLNO-${pickGroup()}-${pickGroup()}-${pickGroup()}`;
}
