import { websiteKind } from "./places.ts";

export type ScoreInput = {
  website?: string | null;
  phone?: string | null;
  email?: string | null;
  category?: string | null;
  websiteStatus?: string;
  /** true, если место найдено в Google Maps: там отсутствие сайта — надёжный сигнал. */
  websiteCheckedInGoogle?: boolean;
  rating?: number | null;
  reviewCount?: number | null;
  audit?: { performance?: number; accessibility?: number; seo?: number; https?: boolean };
};

export function scoreLead(l: ScoreInput) {
  let score = 30;
  const why: string[] = [];
  const kind = websiteKind(l.website ?? null);

  if (kind === "none") {
    if (l.websiteCheckedInGoogle) { score += 38; why.push("в Google Maps сайт не указан"); }
    else { score += 22; why.push("сайт не указан в OpenStreetMap — нужна ручная проверка"); }
  } else if (kind === "social") {
    score += 32;
    why.push("вместо сайта только соцсеть");
  } else if (l.websiteStatus === "weak") {
    score += 27;
    why.push("сайт технически слабый");
  } else {
    why.push("сайт указан в источнике");
  }

  if (l.phone) { score += 10; why.push("есть телефон для связи"); }
  if (l.email) { score += 5; why.push("есть email"); }

  // Много отзывов = живой бизнес с клиентами и деньгами, а не заброшенная точка на карте.
  const reviews = l.reviewCount ?? 0;
  if (reviews >= 50) { score += 12; why.push(`активный бизнес: ${reviews} отзывов`); }
  else if (reviews >= 10) { score += 6; why.push(`${reviews} отзывов`); }

  if (l.audit) {
    const a = l.audit;
    if ((a.performance ?? 100) < 55) { score += 10; why.push("низкая скорость"); }
    if ((a.seo ?? 100) < 65) { score += 8; why.push("слабое SEO"); }
    if (!a.https) { score += 9; why.push("нет HTTPS"); }
  }
  return { score: Math.min(100, score), reason: why.join("; ") };
}
