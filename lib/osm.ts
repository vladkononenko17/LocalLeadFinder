import { distanceM, type Point } from "./geo.ts";
import type { CategoryDef } from "./categories.ts";
import type { RawPlace } from "./places.ts";

const KNOWN: Record<string, Point> = {
  "киев": { lat: 50.4501, lon: 30.5234 }, "київ": { lat: 50.4501, lon: 30.5234 }, "kyiv": { lat: 50.4501, lon: 30.5234 }, "kiev": { lat: 50.4501, lon: 30.5234 },
  "львов": { lat: 49.8397, lon: 24.0297 }, "львів": { lat: 49.8397, lon: 24.0297 }, "lviv": { lat: 49.8397, lon: 24.0297 },
  "одесса": { lat: 46.4825, lon: 30.7233 }, "одеса": { lat: 46.4825, lon: 30.7233 }, "odesa": { lat: 46.4825, lon: 30.7233 }, "odessa": { lat: 46.4825, lon: 30.7233 },
  "днепр": { lat: 48.4647, lon: 35.0462 }, "дніпро": { lat: 48.4647, lon: 35.0462 }, "dnipro": { lat: 48.4647, lon: 35.0462 },
  "харьков": { lat: 49.9935, lon: 36.2304 }, "харків": { lat: 49.9935, lon: 36.2304 }, "kharkiv": { lat: 49.9935, lon: 36.2304 },
  "запорожье": { lat: 47.8388, lon: 35.1396 }, "запоріжжя": { lat: 47.8388, lon: 35.1396 }, "zaporizhzhia": { lat: 47.8388, lon: 35.1396 },
  "винница": { lat: 49.2331, lon: 28.4682 }, "вінниця": { lat: 49.2331, lon: 28.4682 }, "vinnytsia": { lat: 49.2331, lon: 28.4682 },
  "ивано-франковск": { lat: 48.9226, lon: 24.7111 }, "івано-франківськ": { lat: 48.9226, lon: 24.7111 }, "ivano-frankivsk": { lat: 48.9226, lon: 24.7111 },
};

const OVERPASS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
];
const agent = () => process.env.OSM_USER_AGENT || "LocalLeadFinder personal research";
type Fetcher = typeof fetch;

export async function geocode(city: string, fetcher: Fetcher = fetch): Promise<Point> {
  const k = city.toLowerCase().trim();
  if (KNOWN[k]) return KNOWN[k];
  const q = new URLSearchParams({ q: city, format: "json", limit: "1", countrycodes: "ua" });
  const r = await fetcher(`https://nominatim.openstreetmap.org/search?${q}`, {
    headers: { "User-Agent": agent() },
    signal: AbortSignal.timeout(8_000),
  });
  if (!r.ok) throw new Error("Не удалось найти город через Nominatim");
  const d = await r.json();
  if (!d[0]) throw new Error("Город не найден");
  return { lat: +d[0].lat, lon: +d[0].lon };
}

async function postOverpass(query: string, fetcher: Fetcher) {
  let last = "недоступен";
  for (const endpoint of OVERPASS) {
    try {
      const r = await fetcher(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": agent() },
        body: new URLSearchParams({ data: query }).toString(),
        signal: AbortSignal.timeout(14_000),
      });
      if (r.ok) return r;
      last = String(r.status);
    } catch {
      last = "тайм-аут";
    }
  }
  throw new Error(`Overpass временно недоступен (${last}). Попробуйте позже или уменьшите радиус.`);
}

export function buildOverpassQuery(center: Point, radius: number, categories: Array<{ slug: string } & CategoryDef>): string {
  const around = `(around:${radius},${center.lat},${center.lon})`;
  const sel = categories.flatMap((c) => c.osm.map(([k, v]) => `nwr["name"]["${k}"="${v}"]${around};`));
  // Раньше здесь стоял `out ... 100`: Overpass отдаёт элементы по порядку id, а не по
  // близости, поэтому лимит обрезал выборку случайно. Теперь сортируем и режем у себя.
  return `[out:json][timeout:25];(${[...new Set(sel)].join("")});out center tags 2000;`;
}

const val = (t: Record<string, string>, ...k: string[]) => k.map((x) => t[x]).find(Boolean) || null;

export async function osmDiscover(opts: {
  center: Point;
  radius: number;
  categories: Array<{ slug: string } & CategoryDef>;
  fetcher?: Fetcher;
}): Promise<RawPlace[]> {
  const fetcher = opts.fetcher ?? fetch;
  const r = await postOverpass(buildOverpassQuery(opts.center, opts.radius, opts.categories), fetcher);
  const d = await r.json();
  const slugFor = (t: Record<string, string>) =>
    opts.categories.find((c) => c.osm.some(([k, v]) => t[k] === v))?.slug ??
    val(t, "amenity", "shop", "craft", "leisure", "healthcare", "tourism", "office");
  return (d.elements as any[]).map((e) => {
    const t = e.tags || {};
    return {
      source: "osm" as const,
      sourceId: `${e.type}/${e.id}`,
      name: t.name,
      category: slugFor(t),
      address: [t["addr:street"], t["addr:housenumber"], t["addr:city"]].filter(Boolean).join(", ") || null,
      phone: val(t, "contact:phone", "phone", "contact:mobile"),
      email: val(t, "contact:email", "email"),
      website: val(t, "contact:website", "website", "url", "contact:instagram", "contact:facebook"),
      lat: e.lat ?? e.center?.lat ?? null,
      lon: e.lon ?? e.center?.lon ?? null,
      sourceUrl: `https://www.openstreetmap.org/${e.type}/${e.id}`,
    };
  });
}

/** Ближайшие к центру — первыми. */
export function byDistance<T extends { lat: number | null; lon: number | null }>(center: Point, items: T[]): T[] {
  const d = (x: T) => (x.lat == null || x.lon == null ? Infinity : distanceM(center, { lat: x.lat, lon: x.lon }));
  return [...items].sort((a, b) => d(a) - d(b));
}
