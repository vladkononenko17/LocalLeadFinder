import { NextRequest, NextResponse } from "next/server";
import { runSearch, UpstreamError, UserError } from "@/lib/search";
import { authedSupabase } from "@/lib/supabase";
import type { Source } from "@/lib/places";

export const runtime = "nodejs";
export const maxDuration = 60;

// Бесплатная квота Text Search Enterprise — 1000 запросов/мес. По умолчанию оставляем запас 5%.
// В SQL дополнительно зашит потолок 1000, так что env не может его превысить.
const MONTHLY_CAP = Math.min(1000, Number(process.env.GOOGLE_MONTHLY_CAP) || 950);
const PER_SEARCH = Math.max(1, Number(process.env.GOOGLE_MAX_REQUESTS) || 40);

const DEFAULT_CATEGORIES = "cafe|restaurant|beauty|hairdresser|dentist|car_repair|fitness_centre";

export async function POST(req: NextRequest) {
  let auth;
  try {
    auth = await authedSupabase(req);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Нужно войти" }, { status: 401 });
  }
  const { sb, user } = auth;
  let reserved = 0;
  let used = 0;
  let released = false;
  // Возвращает неиспользованный остаток резерва ровно один раз.
  const release = async () => {
    if (released || reserved - used <= 0) return;
    released = true;
    await sb.rpc("release_google_requests", { unused: reserved - used });
  };
  try {
    const b = await req.json();
    const sources = (Array.isArray(b.sources) ? b.sources : ["osm", "google"]).filter((s: string): s is Source => s === "osm" || s === "google");
    if (sources.includes("google") && process.env.GOOGLE_MAPS_API_KEY) {
      // Резервируем запросы ДО обращения к Google. Нет резерва (или ошибка счётчика) — Google не вызывается.
      const { data, error } = await sb.rpc("reserve_google_requests", { want: PER_SEARCH, monthly_cap: MONTHLY_CAP });
      if (error) throw new UpstreamError(`Не удалось проверить лимит Google: ${error.message}`);
      reserved = Number(data) || 0;
    }
    let result;
    try {
      result = await runSearch(
        {
          city: String(b.city || "Киев"),
          radius: Math.min(15000, Math.max(300, Number(b.radius) || 5000)),
          category: String(b.category || DEFAULT_CATEGORIES),
          limit: Math.min(300, Math.max(1, Number(b.limit) || 100)),
          sources: sources.length ? sources : ["osm"],
        },
        { googleApiKey: process.env.GOOGLE_MAPS_API_KEY, googleBudget: reserved },
      );
    } catch (e) {
      // UpstreamError знает точное число запросов; категория неверна — Google не вызывался;
      // всё прочее — считаем резерв потраченным целиком (безопаснее для лимита).
      used = e instanceof UpstreamError ? e.googleRequests : e instanceof UserError ? 0 : reserved;
      throw e;
    }
    used = result.stats.googleRequests;
    const now = new Date().toISOString();
    const payload = result.leads.map((l) => ({
      user_id: user.id,
      osm_id: l.key,
      name: l.name,
      category: l.category,
      address: l.address,
      phone: l.phone,
      email: l.email,
      website: l.website,
      website_kind: l.websiteKind,
      source_url: l.sourceUrl,
      maps_url: l.mapsUrl,
      google_place_id: l.googlePlaceId,
      sources: l.sources,
      rating: l.rating ?? null,
      review_count: l.reviewCount ?? null,
      latitude: l.lat,
      longitude: l.lon,
      website_status: l.website ? "unverified" : "unknown",
      score: l.score,
      score_reason: l.reason,
      checked_at: now,
    }));
    if (payload.length) {
      const { error } = await sb.from("leads").upsert(payload, { onConflict: "user_id,osm_id" });
      if (error) throw error;
    }
    await release();
    const { data: usedThisMonth } = await sb.rpc("google_usage_current");
    return NextResponse.json({
      found: result.stats.merged,
      saved: payload.length,
      ...result.stats,
      googleMonthlyCap: MONTHLY_CAP,
      googleUsedThisMonth: Number(usedThisMonth) || 0,
    });
  } catch (e) {
    await release();
    const status = e instanceof UserError ? 400 : e instanceof UpstreamError ? 502 : 500;
    const message = e instanceof Error ? e.message : typeof e === "object" && e && "message" in e ? String((e as { message: unknown }).message) : "Ошибка поиска";
    return NextResponse.json({ error: message }, { status });
  }
}
