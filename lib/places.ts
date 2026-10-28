import { distanceM } from "./geo.ts";

export type Source = "osm" | "google";

/** Место в едином формате, независимо от источника. */
export type RawPlace = {
  source: Source;
  sourceId: string; // "node/123" для OSM, place id для Google
  name: string;
  category: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  lat: number | null;
  lon: number | null;
  sourceUrl: string;
  rating?: number | null;
  reviewCount?: number | null;
};

export type MergedPlace = Omit<RawPlace, "source" | "sourceId" | "sourceUrl"> & {
  sources: Source[];
  osmId: string | null;
  googlePlaceId: string | null;
  sourceUrl: string;
  mapsUrl: string | null;
  /** Google надёжно отдаёт websiteUri; отсутствие сайта там — сильный сигнал, в OSM — слабый. */
  websiteCheckedInGoogle: boolean;
};

const SOCIAL_HOSTS = [
  "instagram.com", "facebook.com", "fb.com", "fb.me", "tiktok.com", "t.me", "telegram.me",
  "linktr.ee", "taplink.cc", "taplink.ws", "youtube.com", "vk.com", "ok.ru", "wa.me", "viber.com",
];

export function hostOf(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`).hostname.toLowerCase().replace(/^(www\.|m\.)/, "");
  } catch {
    return null;
  }
}

export type WebsiteKind = "none" | "social" | "site";
export function websiteKind(url: string | null): WebsiteKind {
  const h = hostOf(url);
  if (!h) return "none";
  return SOCIAL_HOSTS.some((s) => h === s || h.endsWith(`.${s}`)) ? "social" : "site";
}

/** Ключ телефона: последние 9 цифр украинского номера (0XX…, +380XX…, 380XX… совпадут). */
export function phoneKey(phone: string | null): string | null {
  if (!phone) return null;
  const first = phone.split(/[;,]/)[0];
  const d = first.replace(/\D/g, "");
  return d.length >= 9 ? d.slice(-9) : null;
}

// \b в JS не работает с кириллицей, поэтому границы слова через \p{L}.
const GENERIC = /(?<!\p{L})(кафе|кав ?ярня|ресторан|салон|краси|красоты|сто|автосервіс|автосервис|стоматологія|стоматология|клініка|клиника|барбершоп|перукарня|парикмахерская|фітнес|фитнес|клуб|студія|студия|тов|фоп|ооо|cafe|coffee|restaurant|barbershop|studio)(?!\p{L})/gu;
export function nameKey(name: string): string {
  return name.toLowerCase().replace(/[«»"'`’ʼ.,\-–—()&]/g, " ").replace(GENERIC, " ").replace(/\s+/g, " ").trim();
}

function sameName(a: string, b: string): boolean {
  const x = nameKey(a), y = nameKey(b);
  if (!x || !y) return a.trim().toLowerCase() === b.trim().toLowerCase();
  return x === y || (Math.min(x.length, y.length) >= 4 && (x.includes(y) || y.includes(x)));
}

/** Те же ли это бизнесы: совпал телефон, или домен сайта (не соцсеть), или похожее имя в пределах 150 м. */
export function isSamePlace(a: RawPlace | MergedPlace, b: RawPlace): boolean {
  const pa = phoneKey(a.phone), pb = phoneKey(b.phone);
  if (pa && pb && pa === pb) return true;
  const ha = websiteKind(a.website) === "site" ? hostOf(a.website) : null;
  const hb = websiteKind(b.website) === "site" ? hostOf(b.website) : null;
  if (ha && hb && ha === hb) return true;
  if (a.lat != null && a.lon != null && b.lat != null && b.lon != null) {
    if (distanceM({ lat: a.lat, lon: a.lon }, { lat: b.lat, lon: b.lon }) <= 150 && sameName(a.name, b.name)) return true;
  }
  return false;
}

function fromRaw(p: RawPlace): MergedPlace {
  const { source, sourceId, sourceUrl, ...rest } = p;
  return {
    ...rest,
    sources: [source],
    osmId: source === "osm" ? sourceId : null,
    googlePlaceId: source === "google" ? sourceId : null,
    sourceUrl,
    mapsUrl: source === "google" ? sourceUrl : null,
    websiteCheckedInGoogle: source === "google",
  };
}

function absorb(m: MergedPlace, p: RawPlace) {
  if (!m.sources.includes(p.source)) m.sources.push(p.source);
  if (p.source === "osm") {
    m.osmId ??= p.sourceId;
    m.sourceUrl = m.sourceUrl || p.sourceUrl;
  } else {
    m.googlePlaceId ??= p.sourceId;
    m.mapsUrl ??= p.sourceUrl;
    m.websiteCheckedInGoogle = true;
    m.rating ??= p.rating;
    m.reviewCount ??= p.reviewCount;
  }
  // Настоящий сайт важнее ссылки на соцсеть; Google обычно свежее OSM.
  const rank = (u: string | null) => ({ none: 0, social: 1, site: 2 })[websiteKind(u)];
  if (rank(p.website) > rank(m.website)) m.website = p.website;
  m.phone ??= p.phone;
  m.email ??= p.email;
  m.address ??= p.address;
  m.category ??= p.category;
  m.lat ??= p.lat;
  m.lon ??= p.lon;
}

export function mergePlaces(places: RawPlace[]): MergedPlace[] {
  const out: MergedPlace[] = [];
  // Сначала OSM, чтобы ключ лида в БД (osm_id) оставался прежним для уже сохранённых лидов.
  const sorted = [...places].sort((a, b) => (a.source === b.source ? 0 : a.source === "osm" ? -1 : 1));
  for (const p of sorted) {
    if (!p.name) continue;
    const hit = out.find((m) => isSamePlace(m, p));
    if (hit) absorb(hit, p);
    else out.push(fromRaw(p));
  }
  return out;
}

/** Стабильный ключ лида для upsert (колонка osm_id исторически хранит его). */
export function leadKey(m: MergedPlace): string {
  return m.osmId ?? `google/${m.googlePlaceId}`;
}
