import { deflateSync } from "node:zlib";

/**
 * Minimal pure-JS PNG encoder for raw pixel data (as returned by unpdf's
 * extractImages). Supports grayscale (1 channel), RGB (3) and RGBA (4).
 * No native dependencies — IDAT is compressed with node:zlib.
 */

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(data: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    crc = CRC_TABLE[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const typeAndData = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData));
  return Buffer.concat([length, typeAndData, crc]);
}

/** PNG color type per channel count. */
const COLOR_TYPES: Record<number, number> = { 1: 0, 3: 2, 4: 6 };

export function encodePng(
  pixels: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
  channels: 1 | 3 | 4
): Buffer {
  const colorType = COLOR_TYPES[channels];
  if (colorType === undefined) {
    throw new Error(`Unsupported channel count: ${channels}`);
  }
  if (pixels.length < width * height * channels) {
    throw new Error("Pixel buffer is smaller than width × height × channels");
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.writeUInt8(8, 8); // bit depth
  ihdr.writeUInt8(colorType, 9);
  ihdr.writeUInt8(0, 10); // compression
  ihdr.writeUInt8(0, 11); // filter
  ihdr.writeUInt8(0, 12); // no interlace

  // Filter type 0 (None) prepended to every scanline.
  const stride = width * channels;
  const filtered = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    filtered[y * (stride + 1)] = 0;
    filtered.set(pixels.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  }

  return Buffer.concat([
    PNG_SIGNATURE,
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(filtered, { level: 6 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
