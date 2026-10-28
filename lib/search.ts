import { resolveCategories } from "./categories.ts";
import { googleDiscover, type GoogleSearchStats } from "./google.ts";
import { byDistance, geocode, osmDiscover } from "./osm.ts";
import { leadKey, mergePlaces, websiteKind, type MergedPlace, type RawPlace, type Source } from "./places.ts";
import { scoreLead } from "./scoring.ts";

export type SearchParams = { city: string; radius: number; category: string; limit: number; sources: Source[] };
export type SearchResult = {
  leads: Array<MergedPlace & { key: string; score: number; reason: string; websiteKind: string }>;
  stats: { osm: number; google: number; merged: number; googleRequests: number; googleBudgetExhausted: boolean; warnings: string[] };
};

/** googleBudget — сколько запросов к Google уже зарезервировано под этот поиск (жёсткий лимит). */
export async function runSearch(p: SearchParams, env: { googleApiKey?: string; googleBudget?: number }, fetcher: typeof fetch = fetch): Promise<SearchResult> {
  const categories = resolveCategories(p.category);
  if (!categories.length) throw new UserError("Укажите категорию латиницей, например car_repair");
  let center;
  try {
    center = await geocode(p.city, fetcher);
  } catch (e) {
    // Геокодинг идёт до Google — запросов к Google ещё не было.
    throw new UpstreamError(e instanceof Error ? e.message : String(e), 0);
  }
  const warnings: string[] = [];

  const wantGoogle = p.sources.includes("google");
  const budget = env.googleBudget ?? 0;
  if (wantGoogle && !env.googleApiKey) warnings.push("Google Maps пропущен: на сервере не задан GOOGLE_MAPS_API_KEY");
  else if (wantGoogle && budget <= 0) warnings.push("Бесплатный лимит Google на этот месяц исчерпан — поиск только по OpenStreetMap");
  const useGoogle = wantGoogle && !!env.googleApiKey && budget > 0;

  // Источники опрашиваются параллельно; падение одного не роняет весь поиск.
  const [osmRes, gRes] = await Promise.allSettled([
    p.sources.includes("osm") ? osmDiscover({ center, radius: p.radius, categories, fetcher }) : Promise.resolve([] as RawPlace[]),
    useGoogle
      ? googleDiscover({ apiKey: env.googleApiKey!, center, radius: p.radius, categories, maxRequests: budget, fetcher })
      : Promise.resolve({ places: [] as RawPlace[], stats: { requests: 0, budgetExhausted: false } as GoogleSearchStats }),
  ]);
  const osm = osmRes.status === "fulfilled" ? osmRes.value : (warnings.push(String((osmRes.reason as Error)?.message ?? osmRes.reason)), []);
  const g = gRes.status === "fulfilled" ? gRes.value : (warnings.push(String((gRes.reason as Error)?.message ?? gRes.reason)), { places: [] as RawPlace[], stats: { requests: 0, budgetExhausted: false } as GoogleSearchStats });
  if (g.stats.error) warnings.push(g.stats.error);
  if (!osm.length && !g.places.length && warnings.length) throw new UpstreamError(warnings.join(" · "), g.stats.requests);
  if (useGoogle && g.stats.budgetExhausted) warnings.push("Бюджет Google на этот поиск исчерпан — часть мест могла не попасть, уменьшите радиус или число категорий");

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
/** googleRequests — сколько запросов к Google успели потратить до ошибки (для возврата резерва). */
export class UpstreamError extends Error {
  googleRequests: number;
  constructor(message: string, googleRequests = 0) { super(message); this.googleRequests = googleRequests; }
}
