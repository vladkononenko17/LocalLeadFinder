import { resolveCategories } from "./categories.ts";
import { googleDiscover } from "./google.ts";
import { byDistance, geocode, osmDiscover } from "./osm.ts";
import { leadKey, mergePlaces, websiteKind, type MergedPlace, type RawPlace, type Source } from "./places.ts";
import { scoreLead } from "./scoring.ts";

export type SearchParams = { city: string; radius: number; category: string; limit: number; sources: Source[] };
export type SearchResult = {
  leads: Array<MergedPlace & { key: string; score: number; reason: string; websiteKind: string }>;
  stats: { osm: number; google: number; merged: number; googleRequests: number; googleBudgetExhausted: boolean; warnings: string[] };
};

export async function runSearch(p: SearchParams, env: { googleApiKey?: string; googleMaxRequests?: number }, fetcher: typeof fetch = fetch): Promise<SearchResult> {
  const categories = resolveCategories(p.category);
  if (!categories.length) throw new UserError("Укажите категорию латиницей, например car_repair");
  const center = await geocode(p.city, fetcher);
  const warnings: string[] = [];

  const wantGoogle = p.sources.includes("google");
  if (wantGoogle && !env.googleApiKey) warnings.push("Google Maps пропущен: на сервере не задан GOOGLE_MAPS_API_KEY");

  // Источники опрашиваются параллельно; падение одного не роняет весь поиск.
  const [osmRes, gRes] = await Promise.allSettled([
    p.sources.includes("osm") ? osmDiscover({ center, radius: p.radius, categories, fetcher }) : Promise.resolve([] as RawPlace[]),
    wantGoogle && env.googleApiKey
      ? googleDiscover({ apiKey: env.googleApiKey, center, radius: p.radius, categories, maxRequests: env.googleMaxRequests ?? 40, fetcher })
      : Promise.resolve({ places: [] as RawPlace[], stats: { requests: 0, budgetExhausted: false } }),
  ]);
  const osm = osmRes.status === "fulfilled" ? osmRes.value : (warnings.push(String((osmRes.reason as Error)?.message ?? osmRes.reason)), []);
  const g = gRes.status === "fulfilled" ? gRes.value : (warnings.push(String((gRes.reason as Error)?.message ?? gRes.reason)), { places: [], stats: { requests: 0, budgetExhausted: false } });
  if (!osm.length && !g.places.length && warnings.length) throw new UpstreamError(warnings.join(" · "));
  if (g.stats.budgetExhausted) warnings.push("Лимит запросов к Google исчерпан — уменьшите радиус или увеличьте GOOGLE_MAX_REQUESTS");

  const merged = mergePlaces([...osm, ...g.places]).map((m) => {
    const s = scoreLead({ ...m, websiteStatus: m.website ? "unverified" : "unknown" });
    return { ...m, key: leadKey(m), score: s.score, reason: s.reason, websiteKind: websiteKind(m.website) };
  });
  // Сначала по score, при равенстве — ближе к центру.
  const ordered = byDistance(center, merged).sort((a, b) => b.score - a.score).slice(0, p.limit);

  return {
    leads: ordered,
    stats: { osm: osm.length, google: g.places.length, merged: merged.length, googleRequests: g.stats.requests, googleBudgetExhausted: g.stats.budgetExhausted, warnings },
  };
}

export class UserError extends Error {}
export class UpstreamError extends Error {}
