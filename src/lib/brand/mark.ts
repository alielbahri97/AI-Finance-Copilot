/**
 * Geometry of the Ballast mark.
 *
 * Kept as raw SVG path data with no framework imports so that both the React
 * component (`components/brand/ballast-mark.tsx`) and the offline icon
 * rasteriser (`scripts/generate-icons.ts`) draw from the same source. Editing
 * the shape here and re-running `npm run icons` keeps the PNGs in step with
 * the inline SVG.
 *
 * The mark is a keel seen from the side: a flat-topped hull riding a waterline,
 * a fin below it, and a ballast bulb at the bottom. The visual weight sits low
 * on purpose — that is the whole idea of ballast.
 */

/**
 * Coordinates are authored on the usual 24×24 icon grid, but the view box is
 * the mark's exact bounding box: the glyph is wider than it is tall and does
 * not sit in the middle of the grid, so a 0 0 24 24 box would render it low and
 * undersized. With a tight box, a square <svg> letterboxes it dead centre.
 */
export const MARK_BOUNDS = { x: 2.8, y: 5.5, width: 18.4, height: 15.8 } as const;
export const MARK_VIEW_BOX = `${MARK_BOUNDS.x} ${MARK_BOUNDS.y} ${MARK_BOUNDS.width} ${MARK_BOUNDS.height}`;

/**
 * Subpaths of the solid mark, all wound the same way so a nonzero fill unions
 * them. Order is hull, fin, bulb.
 */
export const MARK_PATHS: readonly string[] = [
  // Hull in profile: a sheer line that lifts towards bow and stern, over a
  // curved underside, meeting in a point at each end.
  "M2.8 5.5 C8.1 6.55 15.9 6.55 21.2 5.5 C20.3 10 16.6 12.3 12 12.3 C7.4 12.3 3.7 10 2.8 5.5 Z",
  // Fin: tapers as it descends from the hull into the bulb.
  "M10.25 11.4 H13.75 L13.35 17.8 H10.65 Z",
  // Ballast bulb: a circle of radius 2.45 centred at (12, 18.85).
  "M14.45 18.85 C14.45 20.2 13.35 21.3 12 21.3 C10.65 21.3 9.55 20.2 9.55 18.85 C9.55 17.5 10.65 16.4 12 16.4 C13.35 16.4 14.45 17.5 14.45 18.85 Z",
] as const;

/**
 * The mark rendered as a single `d` attribute. Nonzero fill (the SVG default)
 * merges the subpaths into one silhouette.
 */
export const MARK_PATH_DATA = MARK_PATHS.join(" ");
