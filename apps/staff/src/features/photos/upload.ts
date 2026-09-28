// Getting a photo off the phone: pick or take it, shrink it, and send it
// straight to Cloudinary as a signed form POST. Shared by the photos screen
// and the issue report.
//
// Every photo is re-encoded as a JPEG before it leaves the phone. That does
// three jobs at once: it shrinks a 4 MB camera photo to a few hundred KB (the
// difference between sending and giving up on site wifi), it turns HEIC into
// something every browser in the office can show, and it drops the EXIF block,
// GPS position included, which a photo of a client's home has no need to carry.
import type { UploadTicket } from "@bookmops/api/v1";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import * as ImagePicker from "expo-image-picker";
import { Alert, Linking } from "react-native";

/** The longest edge a photo is sent at: plenty for a record, far less data. */
const MAX_EDGE = 1920;
const JPEG_QUALITY = 0.75;
const UPLOAD_TIMEOUT_MS = 120_000;

/**
 * The only place a photo is ever sent: Cloudinary's image upload API, for
 * whichever cloud the server names. A ticket pointing anywhere else is
 * refused, so a bad answer can't send a client's home somewhere new.
 */
const CLOUDINARY_UPLOAD = /^https:\/\/api\.cloudinary\.com\/v1_1\/[A-Za-z0-9_-]+\/image\/upload$/;

/**
 * Development builds only: the sample data's tickets point here, and the
 * uploader simulates the transfer instead of sending anything.
 */
export const PREVIEW_UPLOAD_ORIGIN = __DEV__ ? "https://preview.invalid/upload" : "";

/** A photo ready to send. */
export interface PreparedPhoto {
  /** The shrunk copy on the phone, for showing before the server has it. */
  uri: string;
  blob: Blob;
  byteSize: number;
  contentType: "image/jpeg";
}

/** Something went wrong on the way; `message` is written for the cleaner. */
export class UploadError extends Error {
  constructor(
    message: string,
    /** Worth trying again as is (a dropped connection) rather than starting over. */
    readonly retryable: boolean,
    /** The signature is no good any more; ask for a new ticket before retrying. */
    readonly needsNewTicket = false,
  ) {
    super(message);
    this.name = "UploadError";
  }
}

// ── Picking ─────────────────────────────────────────────────────────────────

/**
 * Take a photo, or choose some from the library. Returns null if the person
 * backed out. Asks for the camera only when the camera is used; the library
 * uses the system picker, which needs no permission and shows the app only
 * the photos chosen.
 */
export async function pickPhotos(from: "camera" | "library", limit: number): Promise<ImagePicker.ImagePickerAsset[] | null> {
  const options: ImagePicker.ImagePickerOptions = {
    mediaTypes: ["images"],
    // Re-encoded in prepare(); asking the picker to compress too would do it twice.
    quality: 1,
    exif: false,
  };

  if (from === "camera") {
    if (!(await ensureCamera())) return null;
    const res = await ImagePicker.launchCameraAsync(options);
    return res.canceled ? null : res.assets;
  }

  const res = await ImagePicker.launchImageLibraryAsync({
    ...options,
    allowsMultipleSelection: limit > 1,
    selectionLimit: Math.max(1, limit),
    orderedSelection: true,
  });
  return res.canceled ? null : res.assets.slice(0, Math.max(1, limit));
}

async function ensureCamera(): Promise<boolean> {
  const current = await ImagePicker.getCameraPermissionsAsync();
  if (current.granted) return true;
  if (current.canAskAgain) {
    const asked = await ImagePicker.requestCameraPermissionsAsync();
    if (asked.granted) return true;
    if (asked.canAskAgain) return false;
  }
  // Refused before, and the phone won't ask again: say where to change it.
  Alert.alert(
    "Camera is off for Bookmops Pro",
    "To take job photos, turn on the camera for Bookmops Pro in Settings. You can still choose photos from your library.",
    [
      { text: "Not now", style: "cancel" },
      { text: "Open Settings", onPress: () => void Linking.openSettings() },
    ],
  );
  return false;
}

// ── Preparing ───────────────────────────────────────────────────────────────

/** Shrink and re-encode a picked photo. Never keeps EXIF. */
export async function preparePhoto(asset: Pick<ImagePicker.ImagePickerAsset, "uri" | "width" | "height">): Promise<PreparedPhoto> {
  const context = ImageManipulator.manipulate(asset.uri);
  let image: Awaited<ReturnType<typeof context.renderAsync>> | null = null;
  try {
    const long = Math.max(asset.width, asset.height);
    if (long > MAX_EDGE) context.resize(asset.width >= asset.height ? { width: MAX_EDGE } : { height: MAX_EDGE });
    image = await context.renderAsync();
    const saved = await image.saveAsync({ compress: JPEG_QUALITY, format: SaveFormat.JPEG });
    const blob = await (await fetch(saved.uri)).blob();
    return { uri: saved.uri, blob, byteSize: blob.size, contentType: "image/jpeg" };
  } catch {
    throw new UploadError("This photo couldn't be read. Try taking it again.", false);
  } finally {
    image?.release();
    context.release();
  }
}

// ── Sending ─────────────────────────────────────────────────────────────────

/** What Cloudinary answers an upload with; only these parts are read. */
interface CloudinaryReply {
  public_id?: unknown;
  error?: { message?: unknown };
}

/**
 * Send the photo to Cloudinary as the ticket's signed form, reporting progress
 * from 0 to 1, and resolve with the stored asset's public_id. The form carries
 * the ticket's fields exactly as given, then the file, and nothing else: the
 * session is never sent to Cloudinary, no cookies, no auth header.
 */
export function uploadPhoto(ticket: UploadTicket, photo: PreparedPhoto, onProgress: (fraction: number) => void): Promise<string> {
  if (ticket.method !== "MULTIPART_POST") {
    return Promise.reject(new UploadError("This version of the app can't send photos any more. Please update it.", false));
  }
  // Expiry isn't judged here: the phone's clock may be wrong. The queue ages a
  // ticket on the monotonic clock, and Cloudinary's own refusal is the final word.
  if (__DEV__ && PREVIEW_UPLOAD_ORIGIN && ticket.uploadUrl.startsWith(PREVIEW_UPLOAD_ORIGIN)) {
    return simulateUpload(ticket.key, onProgress);
  }
  if (!CLOUDINARY_UPLOAD.test(ticket.uploadUrl)) {
    return Promise.reject(new UploadError("The photo couldn't be sent: the upload address wasn't one the app uses. Try again later.", false));
  }

  const form = new FormData();
  for (const [name, value] of Object.entries(ticket.fields)) form.append(name, value);
  // React Native's FormData reads the file from disk by its uri as it sends.
  form.append(ticket.fileField, { uri: photo.uri, name: "photo.jpg", type: photo.contentType } as unknown as Blob);

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", ticket.uploadUrl);
    xhr.withCredentials = false;
    xhr.timeout = UPLOAD_TIMEOUT_MS;
    // No headers of our own: the form sets its own Content-Type and boundary.

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && e.total > 0) onProgress(Math.min(1, e.loaded / e.total));
    };
    xhr.onload = () => {
      const reply = readReply(xhr.responseText);
      if (xhr.status >= 200 && xhr.status < 300) {
        if (typeof reply?.public_id !== "string" || reply.public_id !== ticket.key) {
          reject(new UploadError("The photo was sent, but storage didn't confirm it. Try again.", true, true));
          return;
        }
        onProgress(1);
        resolve(reply.public_id);
        return;
      }
      reject(refusal(xhr.status, reply));
    };
    xhr.onerror = () => reject(new UploadError("The photo didn't send. Check your signal and try again.", true));
    xhr.ontimeout = () => reject(new UploadError("Sending took too long. Check your signal and try again.", true));
    xhr.send(form);
  });
}

function readReply(text: string): CloudinaryReply | null {
  try {
    const parsed: unknown = JSON.parse(text);
    return parsed && typeof parsed === "object" ? (parsed as CloudinaryReply) : null;
  } catch {
    return null;
  }
}

/** Cloudinary's refusal, as something the cleaner can act on. */
function refusal(status: number, reply: CloudinaryReply | null): UploadError {
  const said = typeof reply?.error?.message === "string" ? reply.error.message.slice(0, 160) : "";
  // A signature that no longer holds: over an hour old ("Stale request"), or
  // the clock drifted. A new ticket fixes it.
  if (status === 401 || /stale request|signature/i.test(said)) {
    return new UploadError("The upload link ran out. Trying again gets a new one.", true, true);
  }
  if (status === 400 || status === 413) {
    const why = said ? ` Storage said: ${said.replace(/\.?$/, ".")}` : "";
    return new UploadError(`Storage wouldn't take this photo.${why} Try a different one.`, false);
  }
  if (status === 420 || status === 429) {
    return new UploadError("Storage is busy right now. Try again in a minute.", true);
  }
  return new UploadError("The photo didn't send. Try again in a moment.", true);
}

let simulated = 0;
/** Development only: a believable transfer, and every fourth one fails once. */
function simulateUpload(publicId: string, onProgress: (fraction: number) => void): Promise<string> {
  const n = ++simulated;
  return new Promise((resolve, reject) => {
    let f = 0;
    const id = setInterval(() => {
      f = Math.min(1, f + 0.12);
      onProgress(f);
      if (n % 4 === 0 && f >= 0.6) {
        clearInterval(id);
        reject(new UploadError("The photo didn't send. Check your signal and try again.", true));
      } else if (f >= 1) {
        clearInterval(id);
        resolve(publicId);
      }
    }, 180);
  });
}
