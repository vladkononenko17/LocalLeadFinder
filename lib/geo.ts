export type Point = { lat: number; lon: number };
export type Rect = { south: number; west: number; north: number; east: number };

const R = 6_371_000;
const rad = (d: number) => (d * Math.PI) / 180;

export function distanceM(a: Point, b: Point): number {
  const dLat = rad(b.lat - a.lat), dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function circleBBox(c: Point, radiusM: number): Rect {
  const dLat = (radiusM / R) * (180 / Math.PI);
  const dLon = dLat / Math.cos(rad(c.lat));
  return { south: c.lat - dLat, west: c.lon - dLon, north: c.lat + dLat, east: c.lon + dLon };
}

export function splitRect(r: Rect): Rect[] {
  const mLat = (r.south + r.north) / 2, mLon = (r.west + r.east) / 2;
  return [
    { south: r.south, west: r.west, north: mLat, east: mLon },
    { south: r.south, west: mLon, north: mLat, east: r.east },
    { south: mLat, west: r.west, north: r.north, east: mLon },
    { south: mLat, west: mLon, north: r.north, east: r.east },
  ];
}

/** Пересекается ли прямоугольник с кругом (чтобы не тратить запросы на тайлы за пределами радиуса). */
export function rectTouchesCircle(r: Rect, c: Point, radiusM: number): boolean {
  const nearest = { lat: Math.min(Math.max(c.lat, r.south), r.north), lon: Math.min(Math.max(c.lon, r.west), r.east) };
  return distanceM(c, nearest) <= radiusM;
}
