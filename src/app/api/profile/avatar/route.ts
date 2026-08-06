import { NextResponse } from "next/server";

import {
  AVATAR_MIME_TYPES,
  MAX_AVATAR_FILE_BYTES,
  avatarStoragePath,
  deleteUserAvatarObjects,
  getAvatarPublicUrl,
  uploadAvatarImage,
} from "@/lib/avatars/storage";
import { enforceRateLimit } from "@/lib/api/rate-limit-guard";
import { apiError } from "@/lib/api/response";
import { getOrCreateProfile } from "@/lib/data";
import { logger, serializeError } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { createClient, getUser } from "@/lib/supabase/server";

/**
 * Upload or replace the authenticated user's profile avatar.
 * Stores the image in the public `avatars` bucket under `{userId}/avatar.{ext}`
 * and persists the public URL on `profiles.avatar_url`.
 */
export async function POST(request: Request) {
  try {
    const user = await getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const limited = await enforceRateLimit("upload", user.id);
    if (limited) return limited;

    const formData = await request.formData().catch(() => null);
    if (!formData) {
      return NextResponse.json(
        { error: "The upload request was malformed. Try again from the profile page." },
        { status: 400 }
      );
    }

    const file = formData.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Attach an image to upload" }, { status: 400 });
    }
    if (!(file.type in AVATAR_MIME_TYPES)) {
      const isHeic = /hei[cf]/i.test(file.type) || /\.hei[cf]$/i.test(file.name);
      return NextResponse.json(
        {
          error: isHeic
            ? "HEIC photos (iPhone default) are not supported. Convert to JPG or PNG, then try again."
            : `"${file.type || file.name}" is not a supported format. Upload a JPG, PNG or WebP image.`,
        },
        { status: 400 }
      );
    }
    if (file.size === 0) {
      return NextResponse.json(
        { error: "The file is empty (0 bytes). Choose another image and try again." },
        { status: 400 }
      );
    }
    if (file.size > MAX_AVATAR_FILE_BYTES) {
      return NextResponse.json(
        {
          error: `The file is ${(file.size / 1024 / 1024).toFixed(1)} MB — the maximum is ${MAX_AVATAR_FILE_BYTES / 1024 / 1024} MB. Compress or downscale the photo and try again.`,
        },
        { status: 400 }
      );
    }

    await getOrCreateProfile(user);
    const supabase = await createClient();
    const path = avatarStoragePath(user.id, file.type);

    // Clear any prior avatar objects (e.g. avatar.jpg → avatar.png) first.
    await deleteUserAvatarObjects(supabase, user.id);

    const { error: uploadError } = await uploadAvatarImage(
      supabase,
      path,
      await file.arrayBuffer(),
      file.type
    );
    if (uploadError) {
      const missingBucket = /bucket .* not found|Bucket 'avatars' not found/i.test(uploadError);
      logger.error("Avatar upload to storage", {
        error: serializeError(new Error(uploadError)),
        missingBucket,
      });
      return NextResponse.json(
        {
          error: missingBucket
            ? "Could not store the image: the public 'avatars' storage bucket is missing in Supabase. Create it and the per-user RLS policy (see README §5b)."
            : "Could not store the image. Make sure the public 'avatars' bucket and its policies exist in Supabase (see README §5b).",
        },
        { status: 502 }
      );
    }

    const avatarUrl = getAvatarPublicUrl(supabase, path);
    // Bust CDN/browser cache after replace (same path can be reused via upsert).
    const cacheBustedUrl = `${avatarUrl}${avatarUrl.includes("?") ? "&" : "?"}v=${Date.now()}`;

    const profile = await prisma.profile.update({
      where: { id: user.id },
      data: { avatarUrl: cacheBustedUrl },
    });

    return NextResponse.json({
      avatarUrl: profile.avatarUrl,
    });
  } catch (error) {
    return apiError("POST /api/profile/avatar", "Failed to upload avatar", error);
  }
}

/**
 * Removes the uploaded avatar from storage and clears `profiles.avatar_url`.
 * OAuth provider pictures are not restored; the UI falls back to initials.
 */
export async function DELETE() {
  try {
    const user = await getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const limited = await enforceRateLimit("upload", user.id);
    if (limited) return limited;

    await getOrCreateProfile(user);
    const supabase = await createClient();
    await deleteUserAvatarObjects(supabase, user.id);

    await prisma.profile.update({
      where: { id: user.id },
      data: { avatarUrl: null },
    });

    return NextResponse.json({ avatarUrl: null });
  } catch (error) {
    return apiError("DELETE /api/profile/avatar", "Failed to remove avatar", error);
  }
}
