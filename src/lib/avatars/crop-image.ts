import type { Area } from "react-easy-crop";

const DEFAULT_OUTPUT_SIZE = 512;
const DEFAULT_MIME = "image/jpeg";
const DEFAULT_QUALITY = 0.92;

/**
 * Loads an image from a blob URL / data URL. Rejects if the browser cannot
 * decode it (corrupt file, unsupported format).
 */
function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.addEventListener("load", () => resolve(image));
    image.addEventListener("error", () => reject(new Error("Could not load image")));
    image.src = src;
  });
}

/**
 * Crops `imageSrc` to `pixelCrop` (from react-easy-crop) and returns a square
 * JPEG/WebP blob sized for avatar upload. Output is scaled to `maxSize` so
 * large phone photos don't blow past the 5 MB API limit.
 */
export async function getCroppedImageBlob(
  imageSrc: string,
  pixelCrop: Area,
  options?: {
    mimeType?: string;
    quality?: number;
    maxSize?: number;
  }
): Promise<Blob> {
  const mimeType = options?.mimeType ?? DEFAULT_MIME;
  const quality = options?.quality ?? DEFAULT_QUALITY;
  const maxSize = options?.maxSize ?? DEFAULT_OUTPUT_SIZE;

  const image = await loadImage(imageSrc);
  const canvas = document.createElement("canvas");
  const size = Math.min(Math.max(Math.round(pixelCrop.width), 1), maxSize);
  canvas.width = size;
  canvas.height = size;

  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("Canvas is not available in this browser");
  }

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(
    image,
    pixelCrop.x,
    pixelCrop.y,
    pixelCrop.width,
    pixelCrop.height,
    0,
    0,
    size,
    size
  );

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error("Failed to encode cropped image"));
          return;
        }
        resolve(blob);
      },
      mimeType,
      quality
    );
  });
}
