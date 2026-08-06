/**
 * Pure path / URL helpers for profile avatars (no Supabase client).
 * Storage I/O lives in `./storage`.
 */

export const AVATAR_BUCKET = "avatars";

export const AVATAR_MIME_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

export const MAX_AVATAR_FILE_BYTES = 5 * 1024 * 1024; // 5 MB

/** Canonical object path: {userId}/avatar.{ext} inside the avatars bucket. */
export function avatarStoragePath(userId: string, mimeType: string): string {
  const ext = AVATAR_MIME_TYPES[mimeType];
  if (!ext) {
    throw new Error(`Unsupported avatar mime type: ${mimeType}`);
  }
  return `${userId}/avatar.${ext}`;
}

/**
 * Extracts the storage object path from a public avatar URL when it belongs
 * to this app's avatars bucket and this user. Returns null for OAuth / foreign URLs.
 */
export function avatarPathFromPublicUrl(url: string, userId: string): string | null {
  try {
    const parsed = new URL(url);
    const marker = `/storage/v1/object/public/${AVATAR_BUCKET}/`;
    const index = parsed.pathname.indexOf(marker);
    if (index < 0) return null;
    const path = decodeURIComponent(parsed.pathname.slice(index + marker.length));
    if (!path.startsWith(`${userId}/`)) return null;
    return path;
  } catch {
    return null;
  }
}

export function isSupportedAvatarMime(mimeType: string): mimeType is keyof typeof AVATAR_MIME_TYPES {
  return mimeType in AVATAR_MIME_TYPES;
}
