import { NextRequest, NextResponse } from "next/server";
import { runSearch, UpstreamError, UserError } from "@/lib/search";
import { authedSupabase } from "@/lib/supabase";
import type { Source } from "@/lib/places";

export const runtime = "nodejs";
export const maxDuration = 60;

const DEFAULT_CATEGORIES = "cafe|restaurant|beauty|hairdresser|dentist|car_repair|fitness_centre";

export async function POST(req: NextRequest) {
  let auth;
  try {
    auth = await authedSupabase(req);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Нужно войти" }, { status: 401 });
  }
  const { sb, user } = auth;
  try {
    const b = await req.json();
    const sources = (Array.isArray(b.sources) ? b.sources : ["osm", "google"]).filter((s: string): s is Source => s === "osm" || s === "google");
    const result = await runSearch(
      {
        city: String(b.city || "Киев"),
        radius: Math.min(15000, Math.max(300, Number(b.radius) || 5000)),
        category: String(b.category || DEFAULT_CATEGORIES),
        limit: Math.min(300, Math.max(1, Number(b.limit) || 100)),
        sources: sources.length ? sources : ["osm"],
      },
      { googleApiKey: process.env.GOOGLE_MAPS_API_KEY, googleMaxRequests: Number(process.env.GOOGLE_MAX_REQUESTS) || 40 },
    );
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
    return NextResponse.json({ found: result.stats.merged, saved: payload.length, ...result.stats });
  } catch (e) {
    const status = e instanceof UserError ? 400 : e instanceof UpstreamError ? 502 : 500;
    const message = e instanceof Error ? e.message : typeof e === "object" && e && "message" in e ? String((e as { message: unknown }).message) : "Ошибка поиска";
    return NextResponse.json({ error: message }, { status });
  }
}
