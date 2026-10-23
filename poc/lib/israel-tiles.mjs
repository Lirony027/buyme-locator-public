/**
 * Israel's bounding box, matching the guard the geocoding pipeline already
 * uses to reject out-of-country hits.
 */
export const ISRAEL_BOUNDS = { south: 29.4, north: 33.4, west: 34.2, east: 35.9 };

/**
 * Rectangles covering Israel, shaped for Places `locationRestriction.rectangle`.
 *
 * Text Search (New) returns at most 60 results across all pages, so a single
 * national query silently truncates exactly the chains worth having —
 * McDonald's has roughly 180 branches in Israel, super-pharm roughly 290.
 * Splitting the country and querying each tile is what gets past that cap.
 *
 * Tiles are contiguous and non-overlapping. A branch sitting exactly on a
 * shared edge can be returned by both neighbours, so callers must deduplicate
 * on coordinates — they already do, for the unrelated reason that OSM and
 * Places both hold duplicates of their own.
 */
export function israelTiles(rows, cols) {
  if (!Number.isInteger(rows) || !Number.isInteger(cols) || rows < 1 || cols < 1) {
    throw new Error(`israelTiles needs positive integer rows and cols, got ${rows}x${cols}`);
  }

  const latStep = (ISRAEL_BOUNDS.north - ISRAEL_BOUNDS.south) / rows;
  const lngStep = (ISRAEL_BOUNDS.east - ISRAEL_BOUNDS.west) / cols;
  const tiles = [];

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      tiles.push({
        low: {
          latitude: ISRAEL_BOUNDS.south + row * latStep,
          longitude: ISRAEL_BOUNDS.west + col * lngStep,
        },
        high: {
          latitude: row === rows - 1 ? ISRAEL_BOUNDS.north : ISRAEL_BOUNDS.south + (row + 1) * latStep,
          longitude: col === cols - 1 ? ISRAEL_BOUNDS.east : ISRAEL_BOUNDS.west + (col + 1) * lngStep,
        },
      });
    }
  }

  return tiles;
}
