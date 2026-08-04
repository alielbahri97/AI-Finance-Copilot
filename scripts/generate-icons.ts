/**
 * Regenerates every app icon from the Ballast mark in `src/lib/brand/mark.ts`.
 *
 *   npm run icons
 *
 * Deliberately dependency-free: the corporate proxy makes native image
 * toolchains (sharp, canvas, resvg) impractical to install, and adding one
 * would rewrite package-lock.json's resolved URLs to the internal mirror. So
 * this file carries a small SVG-path rasteriser — parse, flatten, scanline
 * fill with analytic horizontal coverage and 16× vertical supersampling — and
 * hands the pixels to the PNG encoder already used for invoice rasterisation.
 */

import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { encodePng } from "../src/lib/invoices/png";
import { MARK_BOUNDS, MARK_PATHS } from "../src/lib/brand/mark";

/* ------------------------------------------------------------------ */
/* Path parsing and flattening                                         */
/* ------------------------------------------------------------------ */

type Point = readonly [number, number];
type Polygon = Point[];

/** Segments per curve. 64 is well under a pixel of error at 512×512. */
const CURVE_SEGMENTS = 64;

function tokenize(d: string): (string | number)[] {
  const tokens: (string | number)[] = [];
  const pattern = /([MmLlHhVvCcQqZz])|(-?\d*\.?\d+(?:e[-+]?\d+)?)/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(d)) !== null) {
    tokens.push(match[1] ? match[1] : Number(match[2]));
  }
  return tokens;
}

function cubicPoint(p0: Point, p1: Point, p2: Point, p3: Point, t: number): Point {
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const c = 3 * u * t * t;
  const e = t * t * t;
  return [
    a * p0[0] + b * p1[0] + c * p2[0] + e * p3[0],
    a * p0[1] + b * p1[1] + c * p2[1] + e * p3[1],
  ];
}

/** Turns SVG path data into closed polygons. Supports M L H V C Q Z. */
export function flattenPath(d: string): Polygon[] {
  const tokens = tokenize(d);
  const polygons: Polygon[] = [];
  let current: Point[] = [];
  let cursor: Point = [0, 0];
  let start: Point = [0, 0];
  let command = "";
  let index = 0;

  const nextNumber = (): number => {
    const token = tokens[index++];
    if (typeof token !== "number") {
      throw new Error(`Expected a number in path data, got ${String(token)}`);
    }
    return token;
  };

  const closeCurrent = () => {
    if (current.length > 1) polygons.push(current);
    current = [];
  };

  while (index < tokens.length) {
    const token = tokens[index];
    if (typeof token === "string") {
      command = token;
      index++;
      if (command === "Z" || command === "z") {
        closeCurrent();
        cursor = start;
        continue;
      }
    }

    const relative = command === command.toLowerCase();
    const base: Point = relative ? cursor : [0, 0];

    switch (command.toUpperCase()) {
      case "M": {
        closeCurrent();
        cursor = [base[0] + nextNumber(), base[1] + nextNumber()];
        start = cursor;
        current = [cursor];
        // Subsequent coordinate pairs after an M are implicit line-tos.
        command = relative ? "l" : "L";
        break;
      }
      case "L": {
        cursor = [base[0] + nextNumber(), base[1] + nextNumber()];
        current.push(cursor);
        break;
      }
      case "H": {
        cursor = [base[0] + nextNumber(), cursor[1]];
        current.push(cursor);
        break;
      }
      case "V": {
        cursor = [cursor[0], base[1] + nextNumber()];
        current.push(cursor);
        break;
      }
      case "C": {
        const c1: Point = [base[0] + nextNumber(), base[1] + nextNumber()];
        const c2: Point = [base[0] + nextNumber(), base[1] + nextNumber()];
        const end: Point = [base[0] + nextNumber(), base[1] + nextNumber()];
        for (let step = 1; step <= CURVE_SEGMENTS; step++) {
          current.push(cubicPoint(cursor, c1, c2, end, step / CURVE_SEGMENTS));
        }
        cursor = end;
        break;
      }
      case "Q": {
        const c: Point = [base[0] + nextNumber(), base[1] + nextNumber()];
        const end: Point = [base[0] + nextNumber(), base[1] + nextNumber()];
        // Raise the quadratic to an equivalent cubic.
        const c1: Point = [cursor[0] + (2 / 3) * (c[0] - cursor[0]), cursor[1] + (2 / 3) * (c[1] - cursor[1])];
        const c2: Point = [end[0] + (2 / 3) * (c[0] - end[0]), end[1] + (2 / 3) * (c[1] - end[1])];
        for (let step = 1; step <= CURVE_SEGMENTS; step++) {
          current.push(cubicPoint(cursor, c1, c2, end, step / CURVE_SEGMENTS));
        }
        cursor = end;
        break;
      }
      default:
        throw new Error(`Unsupported path command: ${command}`);
    }
  }

  closeCurrent();
  return polygons;
}

interface Box {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

function boundingBox(polygons: Polygon[]): Box {
  const box: Box = {
    minX: Number.POSITIVE_INFINITY,
    minY: Number.POSITIVE_INFINITY,
    maxX: Number.NEGATIVE_INFINITY,
    maxY: Number.NEGATIVE_INFINITY,
  };
  for (const polygon of polygons) {
    for (const [x, y] of polygon) {
      if (x < box.minX) box.minX = x;
      if (y < box.minY) box.minY = y;
      if (x > box.maxX) box.maxX = x;
      if (y > box.maxY) box.maxY = y;
    }
  }
  return box;
}

function transform(polygons: Polygon[], scale: number, dx: number, dy: number): Polygon[] {
  return polygons.map((polygon) => polygon.map(([x, y]): Point => [x * scale + dx, y * scale + dy]));
}

/* ------------------------------------------------------------------ */
/* Rasteriser                                                          */
/* ------------------------------------------------------------------ */

/** Vertical subsamples per pixel row. Horizontal coverage is exact. */
const SUBSAMPLES = 16;

interface Edge {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

function edgesOf(polygons: Polygon[]): Edge[] {
  const edges: Edge[] = [];
  for (const polygon of polygons) {
    for (let i = 0; i < polygon.length; i++) {
      const [x0, y0] = polygon[i];
      const [x1, y1] = polygon[(i + 1) % polygon.length];
      if (y0 !== y1) edges.push({ x0, y0, x1, y1 });
    }
  }
  return edges;
}

function addSpan(
  coverage: Float32Array,
  width: number,
  row: number,
  from: number,
  to: number,
  weight: number
): void {
  const left = Math.max(0, from);
  const right = Math.min(width, to);
  if (right <= left) return;

  const firstPixel = Math.floor(left);
  const lastPixel = Math.min(width - 1, Math.ceil(right) - 1);
  const offset = row * width;

  if (firstPixel === lastPixel) {
    coverage[offset + firstPixel] += (right - left) * weight;
    return;
  }
  coverage[offset + firstPixel] += (firstPixel + 1 - left) * weight;
  for (let x = firstPixel + 1; x < lastPixel; x++) coverage[offset + x] += weight;
  coverage[offset + lastPixel] += (right - lastPixel) * weight;
}

/** Anti-aliased nonzero-winding fill. Returns per-pixel coverage in 0…1. */
export function rasterize(polygons: Polygon[], width: number, height: number): Float32Array {
  const coverage = new Float32Array(width * height);
  const edges = edgesOf(polygons);
  const weight = 1 / SUBSAMPLES;
  const crossings: { x: number; winding: number }[] = [];

  for (let row = 0; row < height; row++) {
    for (let sub = 0; sub < SUBSAMPLES; sub++) {
      const y = row + (sub + 0.5) / SUBSAMPLES;
      crossings.length = 0;
      for (const edge of edges) {
        const downward = edge.y1 > edge.y0;
        const top = downward ? edge.y0 : edge.y1;
        const bottom = downward ? edge.y1 : edge.y0;
        if (y < top || y >= bottom) continue;
        const t = (y - edge.y0) / (edge.y1 - edge.y0);
        crossings.push({ x: edge.x0 + t * (edge.x1 - edge.x0), winding: downward ? 1 : -1 });
      }
      if (crossings.length < 2) continue;
      crossings.sort((a, b) => a.x - b.x);

      let winding = 0;
      for (let i = 0; i < crossings.length - 1; i++) {
        winding += crossings[i].winding;
        if (winding !== 0) addSpan(coverage, width, row, crossings[i].x, crossings[i + 1].x, weight);
      }
    }
  }
  return coverage;
}

/* ------------------------------------------------------------------ */
/* Compositing                                                         */
/* ------------------------------------------------------------------ */

interface Rgb {
  r: number;
  g: number;
  b: number;
}

function hexToRgb(hex: string): Rgb {
  const value = Number.parseInt(hex.replace("#", ""), 16);
  return { r: (value >> 16) & 0xff, g: (value >> 8) & 0xff, b: value & 0xff };
}

class Canvas {
  readonly pixels: Uint8Array;

  constructor(
    readonly width: number,
    readonly height: number
  ) {
    this.pixels = new Uint8Array(width * height * 4);
  }

  /** Source-over composite of a solid colour through a coverage mask. */
  fill(polygons: Polygon[], color: string): void {
    const { r, g, b } = hexToRgb(color);
    const coverage = rasterize(polygons, this.width, this.height);
    for (let i = 0; i < coverage.length; i++) {
      const alpha = Math.min(1, coverage[i]);
      if (alpha <= 0) continue;
      const p = i * 4;
      const existing = this.pixels[p + 3] / 255;
      const out = alpha + existing * (1 - alpha);
      // Un-premultiplied source-over; `out` is never 0 here because alpha > 0.
      this.pixels[p] = Math.round((r * alpha + this.pixels[p] * existing * (1 - alpha)) / out);
      this.pixels[p + 1] = Math.round((g * alpha + this.pixels[p + 1] * existing * (1 - alpha)) / out);
      this.pixels[p + 2] = Math.round((b * alpha + this.pixels[p + 2] * existing * (1 - alpha)) / out);
      this.pixels[p + 3] = Math.round(out * 255);
    }
  }

  toPng(): Buffer {
    return encodePng(this.pixels, this.width, this.height, 4);
  }
}

/** Rounded-rectangle path data. `radius` is clamped to half the short side. */
function roundedRectPath(x: number, y: number, width: number, height: number, radius: number): string {
  const r = Math.min(radius, width / 2, height / 2);
  const k = r * 0.5523; // circular-arc control-point offset
  const right = x + width;
  const bottom = y + height;
  return [
    `M${x + r} ${y}`,
    `H${right - r}`,
    `C${right - r + k} ${y} ${right} ${y + r - k} ${right} ${y + r}`,
    `V${bottom - r}`,
    `C${right} ${bottom - r + k} ${right - r + k} ${bottom} ${right - r} ${bottom}`,
    `H${x + r}`,
    `C${x + r - k} ${bottom} ${x} ${bottom - r + k} ${x} ${bottom - r}`,
    `V${y + r}`,
    `C${x} ${y + r - k} ${x + r - k} ${y} ${x + r} ${y}`,
    "Z",
  ].join(" ");
}

/* ------------------------------------------------------------------ */
/* Icon composition                                                    */
/* ------------------------------------------------------------------ */

/** Brand indigo, matching `theme_color` in the manifest and the viewport. */
const BRAND_COLOR = "#4F46E5";
const MARK_COLOR = "#FFFFFF";

const MARK_POLYGONS = MARK_PATHS.flatMap((d) => flattenPath(d));
const MARK_BOX = boundingBox(MARK_POLYGONS);

// The React component relies on MARK_BOUNDS being the true bounding box to
// centre the glyph in its view box. Catch drift here rather than in the UI.
const BOUNDS_TOLERANCE = 0.02;
for (const [label, declared, measured] of [
  ["x", MARK_BOUNDS.x, MARK_BOX.minX],
  ["y", MARK_BOUNDS.y, MARK_BOX.minY],
  ["width", MARK_BOUNDS.width, MARK_BOX.maxX - MARK_BOX.minX],
  ["height", MARK_BOUNDS.height, MARK_BOX.maxY - MARK_BOX.minY],
] as const) {
  if (Math.abs(declared - measured) > BOUNDS_TOLERANCE) {
    throw new Error(
      `MARK_BOUNDS.${label} is ${declared} but the paths measure ${measured.toFixed(3)}. ` +
        "Update MARK_BOUNDS in src/lib/brand/mark.ts."
    );
  }
}

/** Centres the mark in a square canvas at the requested fraction of its side. */
function placedMark(size: number, fraction: number): Polygon[] {
  const markWidth = MARK_BOX.maxX - MARK_BOX.minX;
  const markHeight = MARK_BOX.maxY - MARK_BOX.minY;
  const scale = (size * fraction) / Math.max(markWidth, markHeight);
  const dx = (size - markWidth * scale) / 2 - MARK_BOX.minX * scale;
  const dy = (size - markHeight * scale) / 2 - MARK_BOX.minY * scale;
  return transform(MARK_POLYGONS, scale, dx, dy);
}

interface IconSpec {
  /** Transparent border as a fraction of the canvas, 0 for full bleed. */
  inset: number;
  /** Tile corner radius as a fraction of the tile side. */
  cornerRadius: number;
  /** Mark height/width as a fraction of the canvas. */
  markFraction: number;
}

/** Home-screen and browser icon: rounded tile with a little breathing room. */
const STANDARD: IconSpec = { inset: 0.045, cornerRadius: 0.225, markFraction: 0.56 };

/**
 * Maskable icon: full bleed, because the platform crops it. Content must stay
 * inside the inner 80% safe circle, so the mark is kept well under that.
 */
const MASKABLE: IconSpec = { inset: 0, cornerRadius: 0, markFraction: 0.52 };

/** iOS applies its own mask to an opaque square. */
const APPLE: IconSpec = { inset: 0, cornerRadius: 0, markFraction: 0.58 };

/** Favicons are tiny: less rounding and a bigger mark keep it readable. */
const FAVICON: IconSpec = { inset: 0.02, cornerRadius: 0.18, markFraction: 0.66 };

function renderIcon(size: number, spec: IconSpec): Canvas {
  const canvas = new Canvas(size, size);
  const inset = Math.round(size * spec.inset);
  const tile = size - inset * 2;
  canvas.fill(flattenPath(roundedRectPath(inset, inset, tile, tile, tile * spec.cornerRadius)), BRAND_COLOR);
  canvas.fill(placedMark(size, spec.markFraction), MARK_COLOR);
  return canvas;
}

/* ------------------------------------------------------------------ */
/* ICO container                                                       */
/* ------------------------------------------------------------------ */

/** Packs PNG images into an .ico. Every consumer since IE11 reads PNG entries. */
function buildIco(images: { size: number; png: Buffer }[]): Buffer {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // 1 = icon
  header.writeUInt16LE(images.length, 4);

  let offset = header.length + images.length * 16;
  const entries = images.map(({ size, png }) => {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(size >= 256 ? 0 : size, 0);
    entry.writeUInt8(size >= 256 ? 0 : size, 1);
    entry.writeUInt8(0, 2); // palette size
    entry.writeUInt8(0, 3); // reserved
    entry.writeUInt16LE(1, 4); // colour planes
    entry.writeUInt16LE(32, 6); // bits per pixel
    entry.writeUInt32LE(png.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += png.length;
    return entry;
  });

  return Buffer.concat([header, ...entries, ...images.map((image) => image.png)]);
}

/* ------------------------------------------------------------------ */
/* Entry point                                                         */
/* ------------------------------------------------------------------ */

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function write(relativePath: string, data: Buffer): void {
  writeFileSync(join(root, relativePath), data);
  console.log(`  ${relativePath.padEnd(38)} ${String(data.length).padStart(7)} bytes`);
}

console.log("Rendering the Ballast mark into app icons:");

write("public/icons/icon-192.png", renderIcon(192, STANDARD).toPng());
write("public/icons/icon-512.png", renderIcon(512, STANDARD).toPng());
write("public/icons/icon-192-maskable.png", renderIcon(192, MASKABLE).toPng());
write("public/icons/icon-512-maskable.png", renderIcon(512, MASKABLE).toPng());
write("public/icons/apple-touch-icon.png", renderIcon(180, APPLE).toPng());
write(
  "src/app/favicon.ico",
  buildIco([16, 32, 48].map((size) => ({ size, png: renderIcon(size, FAVICON).toPng() })))
);
