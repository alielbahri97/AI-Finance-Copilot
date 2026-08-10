/**
 * Geometry of the Ballast mark.
 *
 * Kept as raw SVG path data with no framework imports so that both the React
 * component (`components/brand/ballast-mark.tsx`) and the offline icon
 * rasteriser (`scripts/generate-icons.ts`) draw from the same source. Editing
 * the shape here and re-running `npm run icons` keeps the PNGs in step with
 * the inline SVG.
 *
 * The mark is a balance weight: two stacked horizontal bars of decreasing
 * length above a stem and a ballast bulb. Visual weight sits low on purpose —
 * that is the whole idea of ballast.
 */

/**
 * Coordinates are authored on the usual 24×24 icon grid, but the view box is
 * the mark's exact bounding box so a square <svg> letterboxes it dead centre.
 */
export const MARK_BOUNDS = { x: 3.5, y: 5.0, width: 17.0, height: 16.2 } as const;
export const MARK_VIEW_BOX = `${MARK_BOUNDS.x} ${MARK_BOUNDS.y} ${MARK_BOUNDS.width} ${MARK_BOUNDS.height}`;

/**
 * Subpaths of the solid mark, all wound the same way so a nonzero fill unions
 * them. Order is top bar, middle bar, stem, bulb.
 *
 * Horizontal bars are capsules (stadiums): semicircular caps use the usual
 * cubic approximation with k = r × 0.5523.
 */
export const MARK_PATHS: readonly string[] = [
  // Top bar: longest capsule, height 2.2, radius 1.1.
  "M4.6 5 H19.4 C20.0075 5 20.5 5.4925 20.5 6.1 C20.5 6.7075 20.0075 7.2 19.4 7.2 H4.6 C3.9925 7.2 3.5 6.7075 3.5 6.1 C3.5 5.4925 3.9925 5 4.6 5 Z",
  // Middle bar: shorter capsule, same thickness, gap ≈ bar height.
  "M7.6 9.2 H16.4 C17.0075 9.2 17.5 9.6925 17.5 10.3 C17.5 10.9075 17.0075 11.4 16.4 11.4 H7.6 C6.9925 11.4 6.5 10.9075 6.5 10.3 C6.5 9.6925 6.9925 9.2 7.6 9.2 Z",
  // Stem: thin connector into the bulb (overlaps the middle bar so the fill seals).
  "M11.35 11 H12.65 V15.4 H11.35 Z",
  // Ballast bulb: circle of radius 2.9 centred at (12, 18.3).
  "M14.9 18.3 C14.9 19.9017 13.6017 21.2 12 21.2 C10.3983 21.2 9.1 19.9017 9.1 18.3 C9.1 16.6983 10.3983 15.4 12 15.4 C13.6017 15.4 14.9 16.6983 14.9 18.3 Z",
] as const;

/**
 * The mark rendered as a single `d` attribute. Nonzero fill (the SVG default)
 * merges the subpaths into one silhouette.
 */
export const MARK_PATH_DATA = MARK_PATHS.join(" ");
