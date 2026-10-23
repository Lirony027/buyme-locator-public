const EARTH_RADIUS_M = 6371000;

const toRadians = (degrees) => (degrees * Math.PI) / 180;

/**
 * Great-circle distance in metres. Straight-line, not travel distance —
 * the page states proximity, never routing.
 */
export function distanceMeters(a, b) {
  const dLat = toRadians(b.lat - a.lat);
  const dLng = toRadians(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(a.lat)) * Math.cos(toRadians(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

/**
 * Locations inside `radiusMeters` of `centre`, nearest first, each carrying
 * the distance that put it there.
 *
 * Runs over the fully preloaded dataset, so changing the radius costs no
 * network request. The boundary is inclusive.
 */
export function withinRadius(locations, centre, radiusMeters) {
  return locations
    .map((location) => ({
      ...location,
      distanceMeters: distanceMeters(centre, location),
    }))
    .filter((location) => location.distanceMeters <= radiusMeters)
    .sort((a, b) => a.distanceMeters - b.distanceMeters);
}
