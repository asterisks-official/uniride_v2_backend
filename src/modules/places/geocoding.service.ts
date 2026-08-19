import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  DHAKA_AREAS,
  distanceToAreaKm,
  nearestArea,
  searchAreas,
} from './dhaka-areas';

export interface PlaceSuggestion {
  /** Google place id, or `area:<name>` when this came from the fallback. */
  id: string;
  /** What to show in bold — "Daffodil International University". */
  primary: string;
  /** The line underneath — "Ashulia, Savar". Empty for fallback areas. */
  secondary: string;
  /** Present when the coordinate is already known and no lookup is needed. */
  lat?: number;
  lng?: number;
}

interface PhotonFeature {
  geometry?: { coordinates?: [number, number] };
  properties?: {
    name?: string;
    street?: string;
    housenumber?: string;
    district?: string;
    suburb?: string;
    city?: string;
    state?: string;
  };
}

/// What a coordinate is called.
///
/// The most specific thing OSM knows about the point — a university, a
/// building, a road — not the neighbourhood it sits in.
///
/// An earlier version returned a coarse district instead, on the principle
/// that precise whereabouts should stay private until both sides commit to a
/// ride. That rule was dropped: pin the map on Daffodil International
/// University and being told "Ashulia" is unhelpful to the person pinning and
/// no more useful to the rider who has to find them.
///
/// [areaLabel] is kept alongside so the wire shape and `RideStop.areaLabel`
/// do not need a migration, but it now carries the same specific string.
export interface PlaceName {
  name: string;
  areaLabel: string;
}

export interface ResolvedPlace {
  lat: number;
  lng: number;
  /// The specific thing at that point. Falls back to [areaLabel].
  name?: string;
  areaLabel: string;
}

/**
 * Place search and reverse geocoding, proxied rather than called from the app.
 *
 * Three reasons the app does not talk to Google directly:
 *
 * 1. **The key stays server-side.** A Places key shipped in an APK can be
 *    extracted in minutes and spent by someone else. The Maps *SDK* key still
 *    has to be in the app — the native renderer needs it — but that one is
 *    restricted by package name and signing fingerprint, which this one
 *    cannot be.
 * 2. **Billing.** Autocomplete is charged per request. Caching here is shared
 *    by every user; caching in the app is not.
 * 3. **Bias.** Results are pinned to Dhaka in one place instead of in every
 *    caller.
 *
 * With no key configured it degrades to the static area list rather than
 * failing, so development and CI need no billing account.
 */
@Injectable()
export class GeocodingService {
  private readonly logger = new Logger(GeocodingService.name);

  /** Dhaka centre, for biasing results. */
  private static readonly BIAS = { lat: 23.78, lng: 90.4 };
  private static readonly BIAS_RADIUS_M = 40_000;

  /** Past this from any known area, a fallback label would be a guess. */
  private static readonly MAX_FALLBACK_LABEL_KM = 4;

  private static readonly CACHE_TTL_MS = 6 * 60 * 60 * 1000;
  private readonly cache = new Map<string, { at: number; value: unknown }>();

  constructor(private readonly config: ConfigService) {}

  private get apiKey(): string | undefined {
    return this.config.get<string>('google.mapsApiKey');
  }

  get isLive(): boolean {
    return Boolean(this.apiKey);
  }

  // ── Autocomplete ───────────────────────────────────────────────────────────

  async search(query: string): Promise<PlaceSuggestion[]> {
    const q = query.trim();
    if (q.length < 2) return [];

    if (!this.isLive) return this.photonSearch(q);

    const cached = this.fromCache<PlaceSuggestion[]>(`search:${q.toLowerCase()}`);
    if (cached) return cached;

    try {
      const res = await fetch(
        'https://places.googleapis.com/v1/places:autocomplete',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Goog-Api-Key': this.apiKey!,
          },
          body: JSON.stringify({
            input: q,
            // Bangladesh only, biased to Dhaka. Without this, "Mirpur" returns
            // results in Pakistan before the one two kilometres away.
            includedRegionCodes: ['bd'],
            locationBias: {
              circle: {
                center: {
                  latitude: GeocodingService.BIAS.lat,
                  longitude: GeocodingService.BIAS.lng,
                },
                radius: GeocodingService.BIAS_RADIUS_M,
              },
            },
          }),
          signal: AbortSignal.timeout(4000),
        },
      );

      if (!res.ok) {
        this.logger.warn(
          `Places autocomplete returned ${res.status}; falling back to Photon`,
        );
        return this.photonSearch(q);
      }

      const body = (await res.json()) as {
        suggestions?: {
          placePrediction?: {
            placeId?: string;
            structuredFormat?: {
              mainText?: { text?: string };
              secondaryText?: { text?: string };
            };
          };
        }[];
      };

      const results: PlaceSuggestion[] = (body.suggestions ?? [])
        .map((s) => s.placePrediction)
        .filter((p): p is NonNullable<typeof p> => Boolean(p?.placeId))
        .map((p) => ({
          id: p.placeId!,
          primary: p.structuredFormat?.mainText?.text ?? '',
          secondary: p.structuredFormat?.secondaryText?.text ?? '',
        }))
        .filter((p) => p.primary.length > 0);

      this.toCache(`search:${q.toLowerCase()}`, results);
      return results;
    } catch (err) {
      // A timeout or a network blip must not stop someone posting a ride.
      this.logger.warn('Places autocomplete failed; falling back to Photon', err);
      return this.photonSearch(q);
    }
  }

  // ── Resolve a suggestion to coordinates ────────────────────────────────────

  async resolve(placeId: string): Promise<ResolvedPlace | null> {
    if (placeId.startsWith('photon:')) {
      const [lat, lng] = placeId.slice(7).split(',').map(Number);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
      const named = await this.reverse(lat, lng);
      return { lat, lng, name: named.name, areaLabel: named.areaLabel };
    }

    if (placeId.startsWith('area:')) {
      const name = placeId.slice(5);
      const area = DHAKA_AREAS.find((a) => a.name === name);
      return area ? { lat: area.lat, lng: area.lng, areaLabel: area.name } : null;
    }

    // A Photon suggestion already carries its coordinates, so it is resolved
    // on arrival and never reaches this method.
    if (!this.isLive) return null;

    const cached = this.fromCache<ResolvedPlace>(`place:${placeId}`);
    if (cached) return cached;

    try {
      const res = await fetch(
        `https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}`,
        {
          headers: {
            'X-Goog-Api-Key': this.apiKey!,
            // Field mask is not optional: Places bills by the fields you ask
            // for, and omitting it requests — and charges for — all of them.
            'X-Goog-FieldMask': 'location,shortFormattedAddress,displayName',
          },
          signal: AbortSignal.timeout(4000),
        },
      );
      if (!res.ok) return null;

      const body = (await res.json()) as {
        location?: { latitude?: number; longitude?: number };
        shortFormattedAddress?: string;
        displayName?: { text?: string };
      };

      const lat = body.location?.latitude;
      const lng = body.location?.longitude;
      if (lat === undefined || lng === undefined) return null;

      const resolved: ResolvedPlace = {
        lat,
        lng,
        areaLabel:
          body.displayName?.text ??
          body.shortFormattedAddress ??
          nearestArea(lat, lng).name,
      };
      this.toCache(`place:${placeId}`, resolved);
      return resolved;
    } catch (err) {
      this.logger.warn(`Place details failed for ${placeId}`, err);
      return null;
    }
  }

  // ── Reverse ────────────────────────────────────────────────────────────────

  /**
   * A coarse label for a dropped pin.
   *
   * Deliberately coarse even when Google could be precise: this string is
   * shown to other users before either side has committed to a ride, and the
   * platform's rule is areas, not addresses.
   */
  async reverse(lat: number, lng: number): Promise<PlaceName> {
    // Round before the cache lookup — 3dp is ~110 m, which is the granularity
    // an area label has anyway, and it turns a pan into one call not fifty.
    const key = `rev:${lat.toFixed(3)}:${lng.toFixed(3)}`;

    const cached = this.fromCache<PlaceName>(key);
    if (cached) return cached;

    const value =
      (await this.photonReverse(lat, lng)) ?? this.fallbackName(lat, lng);
    this.toCache(key, value);
    return value;
  }

  // ── Photon: free OSM geocoding, no key ─────────────────────────────────────

  /**
   * Real place search without an API key.
   *
   * The tier between Google and the static area list, and the one that makes
   * search actually usable before anybody has set up billing: 57 hard-coded
   * area names cannot find a college, a hospital or a shop, and on-demand
   * trips go to arbitrary places.
   *
   * Photon rather than Nominatim, which is the better-known OSM geocoder:
   * Nominatim's usage policy explicitly prohibits autocomplete, because each
   * query is expensive. Photon exists precisely for type-ahead and is happy to
   * be typed at.
   *
   * Results arrive with coordinates attached, so unlike Google there is no
   * second lookup when a suggestion is tapped — which also means no second
   * billed call the day Google is switched on for comparison.
   *
   * The public instance is fine for development. Before launch it should be
   * either self-hosted or replaced by Google, same as the tiles.
   */
  private async photonSearch(query: string): Promise<PlaceSuggestion[]> {
    try {
      const url = new URL('https://photon.komoot.io/api/');
      url.searchParams.set('q', query);
      url.searchParams.set('limit', '10');
      url.searchParams.set('lang', 'en');
      // Bias towards Dhaka, and bound to Bangladesh — without this "Mirpur"
      // returns results in Pakistan before the one two kilometres away.
      url.searchParams.set('lat', String(GeocodingService.BIAS.lat));
      url.searchParams.set('lon', String(GeocodingService.BIAS.lng));
      url.searchParams.set('bbox', '88.0,20.5,92.7,26.7');

      const res = await fetch(url, { signal: AbortSignal.timeout(4000) });
      if (!res.ok) return this.fallbackSearch(query);

      const body = (await res.json()) as { features?: PhotonFeature[] };
      const results = (body.features ?? [])
        .map((f) => this.toSuggestion(f))
        .filter((s): s is PlaceSuggestion => s !== null);

      // An empty answer from Photon is a real answer — the place does not
      // exist in OSM. Falling through to the area list would replace "no
      // results" with three unrelated neighbourhoods.
      return results;
    } catch (err) {
      this.logger.warn('Photon search failed; using area fallback', err);
      return this.fallbackSearch(query);
    }
  }

  private toSuggestion(feature: PhotonFeature): PlaceSuggestion | null {
    const [lng, lat] = feature.geometry?.coordinates ?? [];
    const p = feature.properties ?? {};
    const primary = p.name ?? p.street;
    if (primary === undefined || lat === undefined || lng === undefined) {
      return null;
    }

    // Widest-to-narrowest, deduplicated — OSM often repeats the same string
    // across district and city, and "Mirpur, Mirpur, Dhaka" reads as a bug.
    const secondary = [p.street, p.district, p.city, p.state]
      .filter((v): v is string => Boolean(v) && v !== primary)
      .filter((v, i, all) => all.indexOf(v) === i)
      .slice(0, 2)
      .join(', ');

    return { id: `photon:${lat},${lng}`, primary, secondary, lat, lng };
  }

  /** What is at a coordinate, specific and coarse. */
  private async photonReverse(
    lat: number,
    lng: number,
  ): Promise<PlaceName | null> {
    try {
      const url = new URL('https://photon.komoot.io/reverse');
      url.searchParams.set('lat', String(lat));
      url.searchParams.set('lon', String(lng));
      url.searchParams.set('limit', '1');
      url.searchParams.set('lang', 'en');

      const res = await fetch(url, { signal: AbortSignal.timeout(4000) });
      if (!res.ok) return null;

      const body = (await res.json()) as { features?: PhotonFeature[] };
      const p = body.features?.[0]?.properties;
      if (!p) return null;

      // Most specific first. A house number without its street is meaningless,
      // so the two are joined; everything after that is a widening fallback
      // for a pin dropped somewhere OSM knows little about.
      const street = p.housenumber && p.street
        ? `${p.housenumber} ${p.street}`
        : p.street;

      const name =
        p.name ?? street ?? p.district ?? p.suburb ?? p.city ?? null;
      if (!name) return null;

      return { name, areaLabel: name };
    } catch {
      return null;
    }
  }

  // ── Fallbacks ──────────────────────────────────────────────────────────────

  private fallbackSearch(query: string): PlaceSuggestion[] {
    return searchAreas(query).map((a) => ({
      id: `area:${a.name}`,
      primary: a.name,
      secondary: 'Dhaka',
      lat: a.lat,
      lng: a.lng,
    }));
  }

  /// No network and no OSM: the static area list is all there is.
  private fallbackName(lat: number, lng: number): PlaceName {
    const area = nearestArea(lat, lng);
    const label =
      distanceToAreaKm(lat, lng, area) <=
      GeocodingService.MAX_FALLBACK_LABEL_KM
        ? area.name
        : 'Dropped pin';
    return { name: label, areaLabel: label };
  }

  // ── Cache ──────────────────────────────────────────────────────────────────

  private fromCache<T>(key: string): T | undefined {
    const hit = this.cache.get(key);
    if (!hit) return undefined;
    if (Date.now() - hit.at > GeocodingService.CACHE_TTL_MS) {
      this.cache.delete(key);
      return undefined;
    }
    return hit.value as T;
  }

  private toCache(key: string, value: unknown): void {
    // Bounded so a long-running process cannot grow this without limit.
    if (this.cache.size > 5000) this.cache.clear();
    this.cache.set(key, { at: Date.now(), value });
  }
}
