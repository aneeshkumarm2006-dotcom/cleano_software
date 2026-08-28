/**
 * Where a company's uploaded files live, as pure string maths.
 *
 * Separate from asset-folder.ts because this half has to be importable from a
 * CLIENT bundle: booking-deposit.ts uses it and the /book review step imports
 * that. asset-folder.ts resolves which company is being served, which needs
 * next/headers, which a browser cannot have.
 */

/** Root for everything this platform stores. Not a customer's name. */
export const ASSET_ROOT = "awer";

/** `awer/<slug>` — everything below belongs to that company. */
export function orgFolderFor(slug: string): string {
  return `${ASSET_ROOT}/${slug}`;
}

/** `awer/<slug>/booking-uploads` — the public booking uploader's folder. */
export function bookingPhotoFolderFor(slug: string): string {
  return `${orgFolderFor(slug)}/booking-uploads`;
}
