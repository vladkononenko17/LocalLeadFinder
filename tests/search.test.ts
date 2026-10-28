import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveCategories } from "../lib/categories.ts";
import { buildOverpassQuery } from "../lib/osm.ts";
import { googleDiscover } from "../lib/google.ts";
import { mergePlaces, phoneKey, websiteKind, type RawPlace } from "../lib/places.ts";
import { scoreLead } from "../lib/scoring.ts";
import { runSearch } from "../lib/search.ts";
import { distanceM } from "../lib/geo.ts";

const KYIV = { lat: 50.4501, lon: 30.5234 };

// ---- детерминированная «карта Google» на 400 кафе в радиусе 3 км ----
function rng(seed: number) { return () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32); }
const rand = rng(42);
const FAKE = Array.from({ length: 400 }, (_, i) => {
  const r = 3000 * Math.sqrt(rand()), a = 2 * Math.PI * rand();
  const lat = KYIV.lat + (r * Math.cos(a)) / 111_320, lon = KYIV.lon + (r * Math.sin(a)) / (111_320 * Math.cos((KYIV.lat * Math.PI) / 180));
  return {
    id: `g${i}`, displayName: { text: `Кава ${i}` }, location: { latitude: lat, longitude: lon },
    nationalPhoneNumber: `044 ${String(1000000 + i).slice(1)}`,
    websiteUri: i % 3 === 0 ? undefined : i % 3 === 1 ? `https://kava${i}.com.ua` : `https://instagram.com/kava${i}`,
    userRatingCount: i % 100, rating: 4.5, businessStatus: i === 5 ? "CLOSED_PERMANENTLY" : "OPERATIONAL",
    googleMapsUri: `https://maps.google.com/?cid=${i}`,
  };
});

function googleMock(log: any[]): typeof fetch {
  return (async (_url: string, init: any) => {
    const body = JSON.parse(init.body);
    log.push(body);
    const { low, high } = body.locationRestriction.rectangle;
    const inRect = FAKE.filter((p) => p.location.latitude >= low.latitude && p.location.latitude < high.latitude && p.location.longitude >= low.longitude && p.location.longitude < high.longitude).slice(0, 60);
    const page = Number(body.pageToken ?? 0);
    const slice = inRect.slice(page * 20, page * 20 + 20);
    const next = page * 20 + 20 < inRect.length ? String(page + 1) : undefined;
    return new Response(JSON.stringify({ places: slice, nextPageToken: next }));
  }) as any;
}

test("OSM-запрос включает leisure=fitness_centre и healthcare=dentist", () => {
  const q = buildOverpassQuery(KYIV, 5000, resolveCategories("fitness_centre|dentist"));
  assert.match(q, /"leisure"="fitness_centre"/);
  assert.match(q, /"healthcare"="dentist"/);
  assert.doesNotMatch(q, /out center tags 100;/);
});

test("Google: один запрос упирается в 60, разбиение на тайлы находит почти всё", async () => {
  const cafe = resolveCategories("cafe");
  const single = await googleDiscover({ apiKey: "k", center: KYIV, radius: 3000, categories: cafe, maxRequests: 3, fetcher: googleMock([]) });
  const log: any[] = [];
  const tiled = await googleDiscover({ apiKey: "k", center: KYIV, radius: 3000, categories: cafe, maxRequests: 80, fetcher: googleMock(log) });
  console.log(`  один запрос: ${single.places.length} мест · тайлы: ${tiled.places.length} мест за ${tiled.stats.requests} запросов (всего на карте 399 открытых)`);
  assert.ok(single.places.length <= 60);
  assert.ok(tiled.places.length >= 350, `нашли ${tiled.places.length}`);
  assert.ok(!tiled.places.some((p) => p.sourceId === "g5"), "закрытое место отфильтровано");
  assert.ok(tiled.places.every((p) => distanceM(KYIV, { lat: p.lat!, lon: p.lon! }) <= 3000));
  assert.ok(log.every((b) => b.languageCode === "uk" && b.regionCode === "UA" && b.includedType === "cafe"));
});

test("Google: бюджет запросов соблюдается", async () => {
  const r = await googleDiscover({ apiKey: "k", center: KYIV, radius: 3000, categories: resolveCategories("cafe"), maxRequests: 10, fetcher: googleMock([]) });
  assert.equal(r.stats.requests, 10);
  assert.equal(r.stats.budgetExhausted, true);
});

test("Телефоны в разных форматах дают один ключ", () => {
  assert.equal(phoneKey("+380 44 123 45 67"), phoneKey("044-123-45-67"));
  assert.equal(phoneKey("380441234567; +380501112233"), "441234567");
  assert.equal(phoneKey("123"), null);
});

test("Соцсети не считаются сайтом", () => {
  assert.equal(websiteKind("instagram.com/barber"), "social");
  assert.equal(websiteKind("https://www.facebook.com/x"), "social");
  assert.equal(websiteKind("https://linktr.ee/x"), "social");
  assert.equal(websiteKind("barber.com.ua"), "site");
  assert.equal(websiteKind(null), "none");
});

const osm = (o: Partial<RawPlace>): RawPlace => ({ source: "osm", sourceId: "node/1", name: "X", category: "cafe", address: null, phone: null, email: null, website: null, lat: 50.45, lon: 30.52, sourceUrl: "https://osm/1", ...o });
const goo = (o: Partial<RawPlace>): RawPlace => ({ ...osm({}), source: "google", sourceId: "gX", sourceUrl: "https://maps/x", ...o });

test("Слияние: тот же бизнес из OSM и Google склеивается", () => {
  const m = mergePlaces([
    osm({ sourceId: "node/1", name: "Кав'ярня «Зерно»", phone: "+380 44 123 45 67" }),
    goo({ sourceId: "g1", name: "Зерно", phone: "044 123 4567", website: "https://zerno.ua", reviewCount: 120, rating: 4.7 }),
    osm({ sourceId: "node/2", name: "Барбершоп Борода", lat: 50.4600, lon: 30.5300 }),
    goo({ sourceId: "g2", name: "Борода Barbershop", lat: 50.4601, lon: 30.5301 }), // ~13 м
    goo({ sourceId: "g3", name: "Борода Barbershop", lat: 50.4700, lon: 30.5300 }), // другая точка сети, 1.1 км
  ]);
  assert.equal(m.length, 3);
  const zerno = m.find((x) => x.osmId === "node/1")!;
  assert.deepEqual(zerno.sources, ["osm", "google"]);
  assert.equal(zerno.website, "https://zerno.ua");
  assert.equal(zerno.reviewCount, 120);
  assert.equal(zerno.googlePlaceId, "g1");
});

test("Скоринг: подтверждённое отсутствие сайта в Google важнее неизвестности в OSM", () => {
  const googleNone = scoreLead({ website: null, phone: "x", websiteCheckedInGoogle: true, reviewCount: 80 });
  const osmNone = scoreLead({ website: null, phone: "x" });
  const social = scoreLead({ website: "instagram.com/x", phone: "x", websiteCheckedInGoogle: true, reviewCount: 80 });
  const site = scoreLead({ website: "https://x.ua", phone: "x", websiteCheckedInGoogle: true, reviewCount: 80 });
  console.log(`  Google без сайта: ${googleNone.score} · соцсеть: ${social.score} · OSM без URL: ${osmNone.score} · есть сайт: ${site.score}`);
  assert.ok(googleNone.score > osmNone.score);
  assert.ok(social.score > site.score + 25);
});

test("runSearch: Overpass упал — Google всё равно отдаёт лиды и предупреждение", async () => {
  const gm = googleMock([]);
  const fetcher = (async (url: string, init: any) => {
    if (String(url).includes("overpass")) throw new Error("timeout");
    return gm(url as any, init);
  }) as any;
  const r = await runSearch({ city: "Київ", radius: 1500, category: "cafe", limit: 50, sources: ["osm", "google"] }, { googleApiKey: "k", googleBudget: 30 }, fetcher);
  assert.equal(r.leads.length, 50);
  assert.ok(r.stats.warnings.some((w) => w.includes("Overpass")));
  for (let i = 1; i < r.leads.length; i++) assert.ok(r.leads[i - 1].score >= r.leads[i].score);
});

test("runSearch: без ключа Google — понятное предупреждение, а не ошибка", async () => {
  const fetcher = (async () => new Response(JSON.stringify({ elements: [{ type: "node", id: 7, lat: 50.45, lon: 30.52, tags: { name: "Фітнес Атлант", leisure: "fitness_centre", phone: "0671234567" } }] }))) as any;
  const r = await runSearch({ city: "Kyiv", radius: 2000, category: "fitness_centre", limit: 10, sources: ["osm", "google"] }, {}, fetcher);
  assert.equal(r.leads.length, 1);
  assert.equal(r.leads[0].category, "fitness_centre");
  assert.ok(r.stats.warnings[0].includes("GOOGLE_MAPS_API_KEY"));
});

test("Лимит: нулевой бюджет — Google не вызывается вообще", async () => {
  let googleCalls = 0;
  const fetcher = (async (url: string) => {
    if (String(url).includes("googleapis")) googleCalls++;
    return new Response(JSON.stringify({ elements: [{ type: "node", id: 1, lat: 50.45, lon: 30.52, tags: { name: "Кава", amenity: "cafe" } }] }));
  }) as any;
  const r = await runSearch({ city: "Kyiv", radius: 1000, category: "cafe", limit: 10, sources: ["osm", "google"] }, { googleApiKey: "k", googleBudget: 0 }, fetcher);
  assert.equal(googleCalls, 0);
  assert.equal(r.stats.googleRequests, 0);
  assert.ok(r.stats.warnings.some((w) => w.includes("лимит Google на этот месяц исчерпан")));
});

test("Лимит: Google никогда не получает больше запросов, чем зарезервировано", async () => {
  for (const budget of [1, 7, 25]) {
    const log: any[] = [];
    const r = await googleDiscover({ apiKey: "k", center: KYIV, radius: 3000, categories: resolveCategories("cafe|restaurant|hairdresser"), maxRequests: budget, fetcher: googleMock(log) });
    assert.equal(log.length, r.stats.requests);
    assert.ok(log.length <= budget, `budget ${budget}, sent ${log.length}`);
  }
});

test("Лимит: при ошибке Google посреди поиска счётчик запросов точный", async () => {
  const gm = googleMock([]);
  let n = 0;
  const fetcher = (async (url: string, init: any) => {
    if (++n === 4) return new Response("quota", { status: 429 });
    return gm(url as any, init);
  }) as any;
  const r = await googleDiscover({ apiKey: "k", center: KYIV, radius: 3000, categories: resolveCategories("cafe"), maxRequests: 20, fetcher });
  assert.equal(r.stats.requests, 4); // 4-й запрос тоже мог быть оплачен — считаем его
  assert.match(r.stats.error ?? "", /429/);
  assert.ok(r.places.length > 0, "частичные результаты сохранены");
});
