import { describe, expect, it } from "vitest";

import {
  AVATAR_BUCKET,
  AVATAR_MIME_TYPES,
  MAX_AVATAR_FILE_BYTES,
  avatarPathFromPublicUrl,
  avatarStoragePath,
  isSupportedAvatarMime,
} from "@/lib/avatars/paths";

describe("avatarStoragePath", () => {
  it("scopes the object under the user id with the mime extension", () => {
    expect(avatarStoragePath("user-abc", "image/jpeg")).toBe("user-abc/avatar.jpg");
    expect(avatarStoragePath("user-abc", "image/png")).toBe("user-abc/avatar.png");
    expect(avatarStoragePath("user-abc", "image/webp")).toBe("user-abc/avatar.webp");
  });

  it("rejects unsupported mime types", () => {
    expect(() => avatarStoragePath("user-abc", "image/gif")).toThrow(/Unsupported/);
    expect(() => avatarStoragePath("user-abc", "application/pdf")).toThrow(/Unsupported/);
  });
});

describe("avatarPathFromPublicUrl", () => {
  const userId = "173b3ba2-27e2-8f44-e7ed-fb84717f486e";

  it("extracts the path for our public bucket URLs", () => {
    const url = `https://xyz.supabase.co/storage/v1/object/public/${AVATAR_BUCKET}/${userId}/avatar.jpg?v=1`;
    expect(avatarPathFromPublicUrl(url, userId)).toBe(`${userId}/avatar.jpg`);
  });

  it("rejects OAuth or foreign URLs", () => {
    expect(
      avatarPathFromPublicUrl("https://lh3.googleusercontent.com/a/photo", userId)
    ).toBeNull();
    expect(avatarPathFromPublicUrl("not-a-url", userId)).toBeNull();
  });

  it("rejects paths that belong to another user", () => {
    const url = `https://xyz.supabase.co/storage/v1/object/public/${AVATAR_BUCKET}/other-user/avatar.png`;
    expect(avatarPathFromPublicUrl(url, userId)).toBeNull();
  });
});

describe("avatar constraints", () => {
  it("allows jpeg/png/webp only under 5 MB", () => {
    expect(Object.keys(AVATAR_MIME_TYPES).sort()).toEqual([
      "image/jpeg",
      "image/png",
      "image/webp",
    ]);
    expect(MAX_AVATAR_FILE_BYTES).toBe(5 * 1024 * 1024);
    expect(isSupportedAvatarMime("image/jpeg")).toBe(true);
    expect(isSupportedAvatarMime("image/gif")).toBe(false);
  });
});
