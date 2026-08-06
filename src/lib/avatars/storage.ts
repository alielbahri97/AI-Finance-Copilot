import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { AVATAR_BUCKET } from "@/lib/avatars/paths";
import { logger } from "@/lib/logger";

export {
  AVATAR_BUCKET,
  AVATAR_MIME_TYPES,
  MAX_AVATAR_FILE_BYTES,
  avatarPathFromPublicUrl,
  avatarStoragePath,
  isSupportedAvatarMime,
} from "@/lib/avatars/paths";

/**
 * Supabase Storage helpers for profile avatars. The bucket is public so the
 * stored URL can be used directly in the header and profile UI without
 * re-signing. Writes are still scoped to the authenticated user's folder via
 * RLS — see README §5b / ops/storage/avatars-bucket.sql.
 */

export function getAvatarPublicUrl(supabase: SupabaseClient, path: string): string {
  const { data } = supabase.storage.from(AVATAR_BUCKET).getPublicUrl(path);
  return data.publicUrl;
}

export async function uploadAvatarImage(
  supabase: SupabaseClient,
  path: string,
  data: ArrayBuffer,
  contentType: string
): Promise<{ error: string | null }> {
  const { error } = await supabase.storage.from(AVATAR_BUCKET).upload(path, data, {
    contentType,
    upsert: true,
    cacheControl: "3600",
  });
  if (!error) return { error: null };
  const message = error.message ?? "unknown storage error";
  const storageCode = (error as { error?: string }).error ?? "";
  const missingBucket =
    /bucket not found/i.test(message) || storageCode === "Bucket not found";
  return {
    error: missingBucket
      ? `Bucket '${AVATAR_BUCKET}' not found. Create the public bucket and RLS policy (see README §5b).`
      : message,
  };
}

/**
 * Removes every object under the user's avatar folder so a type change
 * (jpg → png) does not leave a stale file behind.
 */
export async function deleteUserAvatarObjects(
  supabase: SupabaseClient,
  userId: string
): Promise<void> {
  const { data: listed, error: listError } = await supabase.storage
    .from(AVATAR_BUCKET)
    .list(userId);
  if (listError) {
    logger.error("failed to list avatar objects", { detail: listError.message });
    return;
  }
  const paths = (listed ?? []).map((entry) => `${userId}/${entry.name}`);
  if (paths.length === 0) return;
  const { error } = await supabase.storage.from(AVATAR_BUCKET).remove(paths);
  if (error) {
    logger.error("failed to delete avatar objects", { detail: error.message });
  }
}
