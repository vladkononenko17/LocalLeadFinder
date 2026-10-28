// Google Places API (New) — Text Search.
// Один запрос возвращает максимум 20 мест на страницу и 60 всего, поэтому круг поиска
// режется на прямоугольники (quadtree): если тайл «упёрся» в 60 результатов, он
// делится на 4 части, пока не кончится бюджет запросов.
import { circleBBox, distanceM, rectTouchesCircle, splitRect, type Point, type Rect } from "./geo.ts";
import type { CategoryDef } from "./categories.ts";
import type { RawPlace } from "./places.ts";

const ENDPOINT = "https://places.googleapis.com/v1/places:searchText";
// websiteUri / телефон / рейтинг относятся к Enterprise SKU — без них Google бесполезен для лидов.
const FIELD_MASK = [
  "places.id", "places.displayName", "places.formattedAddress", "places.location",
  "places.nationalPhoneNumber", "places.websiteUri", "places.rating", "places.userRatingCount",
  "places.businessStatus", "places.primaryType", "places.googleMapsUri", "nextPageToken",
].join(",");

const PAGE_SIZE = 20;
const MAX_PER_QUERY = 60;
const MIN_TILE_M = 400; // мельче дробить нет смысла

type GPlace = {
  id: string;
  displayName?: { text?: string };
  formattedAddress?: string;
  location?: { latitude: number; longitude: number };
  nationalPhoneNumber?: string;
  websiteUri?: string;
  rating?: number;
  userRatingCount?: number;
  businessStatus?: string;
  primaryType?: string;
  googleMapsUri?: string;
};

export type GoogleSearchStats = { requests: number; budgetExhausted: boolean; error?: string };

type Fetcher = typeof fetch;

async function searchPage(apiKey: string, body: object, fetcher: Fetcher): Promise<{ places: GPlace[]; next?: string }> {
  const r = await fetcher(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Goog-Api-Key": apiKey, "X-Goog-FieldMask": FIELD_MASK },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  if (!r.ok) {
    const text = await r.text().catch(() => "");
    throw new Error(`Google Places ${r.status}: ${text.slice(0, 200)}`);
  }
  const d = await r.json();
  return { places: d.places ?? [], next: d.nextPageToken };
}

function rectSizeM(r: Rect): number {
  return distanceM({ lat: r.south, lon: r.west }, { lat: r.north, lon: r.west });
}

export async function googleDiscover(opts: {
  apiKey: string;
  center: Point;
  radius: number;
  categories: Array<{ slug: string } & CategoryDef>;
  maxRequests: number;
  fetcher?: Fetcher;
}): Promise<{ places: RawPlace[]; stats: GoogleSearchStats }> {
  const fetcher = opts.fetcher ?? fetch;
  const stats: GoogleSearchStats = { requests: 0, budgetExhausted: false };
  if (opts.maxRequests <= 0) return { places: [], stats: { ...stats, budgetExhausted: true } };
  const found = new Map<string, RawPlace>();

  // Очередь задач: (запрос, тайл). Обход в ширину, чтобы бюджет распределялся равномерно по площади.
  const queue: Array<{ query: string; includedType?: string; slug: string; rect: Rect }> = [];
  const root = circleBBox(opts.center, opts.radius);
  for (const c of opts.categories) for (const q of c.google.queries) queue.push({ query: q, includedType: c.google.includedType, slug: c.slug, rect: root });

  try {
  while (queue.length) {
    const task = queue.shift()!;
    if (!rectTouchesCircle(task.rect, opts.center, opts.radius)) continue;
    let pageToken: string | undefined;
    let got = 0;
    do {
      if (stats.requests >= opts.maxRequests) { stats.budgetExhausted = true; break; }
      stats.requests++;
      const body: Record<string, unknown> = {
        textQuery: task.query,
        languageCode: "uk",
        regionCode: "UA",
        pageSize: PAGE_SIZE,
        locationRestriction: {
          rectangle: {
            low: { latitude: task.rect.south, longitude: task.rect.west },
            high: { latitude: task.rect.north, longitude: task.rect.east },
          },
        },
      };
      if (task.includedType) body.includedType = task.includedType;
      if (pageToken) body.pageToken = pageToken;
      const { places, next } = await searchPage(opts.apiKey, body, fetcher);
      got += places.length;
      for (const p of places) {
        if (!p.location || p.businessStatus === "CLOSED_PERMANENTLY") continue;
        const pt = { lat: p.location.latitude, lon: p.location.longitude };
        if (distanceM(opts.center, pt) > opts.radius) continue;
        if (found.has(p.id)) continue;
        found.set(p.id, {
          source: "google",
          sourceId: p.id,
          name: p.displayName?.text ?? "",
          category: task.slug,
          address: p.formattedAddress ?? null,
          phone: p.nationalPhoneNumber ?? null,
          email: null,
          website: p.websiteUri ?? null,
          lat: pt.lat,
          lon: pt.lon,
          sourceUrl: p.googleMapsUri ?? `https://www.google.com/maps/place/?q=place_id:${p.id}`,
          rating: p.rating ?? null,
          reviewCount: p.userRatingCount ?? null,
        });
      }
      pageToken = next;
    } while (pageToken);

    // Тайл насыщен — значит, в нём есть ещё места, которые Google не показал. Дробим.
    if (got >= MAX_PER_QUERY && rectSizeM(task.rect) / 2 >= MIN_TILE_M && !stats.budgetExhausted) {
      for (const sub of splitRect(task.rect)) queue.push({ ...task, rect: sub });
    }
    if (stats.budgetExhausted) break;
  }
  } catch (e) {
    // Частичный результат + точный счётчик запросов важнее, чем потерять всё на одной ошибке.
    stats.error = e instanceof Error ? e.message : String(e);
  }
  return { places: [...found.values()], stats };
}
