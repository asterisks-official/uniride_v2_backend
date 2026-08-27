import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DHAKA_AREAS, nearestArea, searchAreas } from './dhaka-areas';

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
    /**
     * How large a thing this is. Photon's own classification, and the field
     * that separates a building from the neighbourhood around it:
     * `house` and `street` are points you can stand on, while `locality`,
     * `district`, `city` and friends are regions with a centroid.
     */
    type?: string;
    /** OSM tag key — `building`, `amenity`, `shop`, `highway`, `place`. */
    osm_key?: string;
    osm_value?: string;
    /**
     * Footprint of the feature as `[minLng, maxLat, maxLng, minLat]`, present
     * for anything mapped as a way rather than a bare node.
     */
    extent?: [number, number, number, number];
  };
}

interface NominatimAddress {
  house_number?: string;
  road?: string;
  neighbourhood?: string;
  suburb?: string;
  city?: string;
}

interface NominatimPlace {
  lat?: string;
  lon?: string;
  name?: string;
  display_name?: string;
  /** OSM tag key/value — `building`/`commercial`, `amenity`/`restaurant`. */
  category?: string;
  type?: string;
  address?: NominatimAddress;
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

  /**
   * Within this of the pin, a feature's name is what is there.
   *
   * Deliberately tight. An earlier version used 200 m, reasoning that OSM
   * stores a building as a single node so the pin could sit well off it. What
   * that actually bought was a shopfront on the main road answering for every
   * house behind it — in Shewrapara, where OSM has the shops along Begum
   * Rokeya Sharani and none of the residential blocks, a whole neighbourhood
   * came back "Decent Sweets". A name has to mean *this* gate, not one within
   * a two-minute walk of it.
   *
   * Buildings large enough that 60 m is unfair to them are handled by
   * [containsPin] instead, which uses the footprint rather than a radius.
   *
   * Past this the name is still used, prefixed "Near" — the threshold picks
   * the wording, not whether a pin gets named at all.
   */
  private static readonly PINPOINT_M = 60;

  /**
   * Photon `type` values that describe a point rather than a region.
   *
   * Everything else — `locality`, `district`, `city`, `county`, `state` — is a
   * neighbourhood name attached to a centroid, which is precisely the answer
   * this service must never give.
   */
  private static readonly SPECIFIC_TYPES = new Set(['house', 'street']);

  /**
   * Identifies us to the OSM services. Nominatim's policy requires it and
   * rejects anonymous callers; Photon is less strict but no less entitled to
   * know who is calling.
   */
  private static readonly USER_AGENT = 'UniRide/1.0 (+https://uniride.app)';

  /**
   * Nominatim's usage policy caps callers at one request a second. This is the
   * gap held between our calls to it — the reason it is a fallback tier and
   * not the primary, since a type-ahead cannot wait a second per keystroke.
   */
  private static readonly NOMINATIM_MIN_GAP_MS = 1100;

  private static readonly CACHE_TTL_MS = 6 * 60 * 60 * 1000;
  private readonly cache = new Map<string, { at: number; value: unknown }>();

  /** Serialises Nominatim calls so the one-per-second policy holds. */
  private nominatimGate: Promise<unknown> = Promise.resolve();

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

    const cached = this.fromCache<PlaceSuggestion[]>(`search:${q.toLowerCase()}`);
    if (cached) return cached;

    if (!this.isLive) return this.osmSearch(q);

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
          `Places autocomplete returned ${res.status}; falling back to OSM`,
        );
        return this.osmSearch(q);
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
      this.logger.warn('Places autocomplete failed; falling back to OSM', err);
      return this.osmSearch(q);
    }
  }

  /**
   * Place search without a Google key, in three descending tiers.
   *
   * Photon first — it is built for type-ahead and answers in about a second.
   * Nominatim second, because Photon's public instance throttles: it blocked
   * this project's IP outright during testing, at which point search silently
   * became the 58 hard-coded areas and every real place — a university, a
   * restaurant — returned nothing. One geocoder is a single point of failure
   * for the entire search box.
   *
   * The area list stays as the last tier, for when both are unreachable.
   *
   * A tier is only skipped when it *fails*. An empty answer from a working
   * geocoder is a real answer — the place is not in OSM — and falling through
   * on it would replace "no results" with three unrelated neighbourhoods.
   */
  private async osmSearch(query: string): Promise<PlaceSuggestion[]> {
    const answered =
      (await this.photonSearch(query)) ?? (await this.nominatimSearch(query));

    if (answered === null) {
      this.logger.warn(`Both OSM geocoders failed for "${query}"`);
      // Deliberately not cached: this is a degraded answer, and caching it
      // would outlast the outage that caused it.
      return this.fallbackSearch(query);
    }

    this.toCache(`search:${query.toLowerCase()}`, answered);
    return answered;
  }

  /**
   * Nominatim search. Slower and rate-limited, but a different host — which
   * is the entire point of having it.
   */
  private async nominatimSearch(
    query: string,
  ): Promise<PlaceSuggestion[] | null> {
    try {
      const url = new URL('https://nominatim.openstreetmap.org/search');
      url.searchParams.set('q', query);
      url.searchParams.set('format', 'jsonv2');
      url.searchParams.set('limit', '10');
      url.searchParams.set('countrycodes', 'bd');
      url.searchParams.set('addressdetails', '1');
      url.searchParams.set('accept-language', 'en');

      const body = await this.nominatimFetch<NominatimPlace[]>(url);
      if (!body) return null;

      return body
        .map((r) => GeocodingService.toNominatimSuggestion(r))
        .filter((r): r is PlaceSuggestion => r !== null);
    } catch (err) {
      this.logger.warn('Nominatim search failed', err);
      return null;
    }
  }

  private static toNominatimSuggestion(
    place: NominatimPlace,
  ): PlaceSuggestion | null {
    const lat = Number(place.lat);
    const lng = Number(place.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

    const a = place.address ?? {};
    const primary = place.name || a.road || place.display_name?.split(',')[0];
    if (!primary) return null;

    // display_name is the full chain down to the country; the first element is
    // the name we have already used, so the two after it are the useful ones.
    const secondary = (place.display_name ?? '')
      .split(',')
      .map((v) => v.trim())
      .filter((v) => v && v !== primary)
      .slice(0, 2)
      .join(', ');

    return { id: `point:${lat},${lng}`, primary, secondary, lat, lng };
  }

  /** A throttled, identified GET against Nominatim. Null on any failure. */
  private async nominatimFetch<T>(url: URL): Promise<T | null> {
    return this.throttleNominatim(async () => {
      const res = await fetch(url, {
        headers: { 'User-Agent': GeocodingService.USER_AGENT },
        signal: AbortSignal.timeout(6000),
      });
      if (!res.ok) return null;
      return (await res.json()) as T;
    });
  }

  /**
   * Runs `fn` after every Nominatim call already queued, then holds the lane
   * for [NOMINATIM_MIN_GAP_MS] so the next one cannot breach the policy.
   */
  private throttleNominatim<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.nominatimGate.then(fn, fn);
    const gap = (): Promise<void> =>
      new Promise((resolve) =>
        setTimeout(resolve, GeocodingService.NOMINATIM_MIN_GAP_MS),
      );
    this.nominatimGate = run.then(gap, gap);
    return run;
  }

  // ── Resolve a suggestion to coordinates ────────────────────────────────────

  async resolve(placeId: string): Promise<ResolvedPlace | null> {
    // `photon:` and `point:` both mean "the coordinates are in the id" — the
    // second is what Nominatim suggestions carry.
    if (placeId.startsWith('photon:') || placeId.startsWith('point:')) {
      const [lat, lng] = placeId.slice(placeId.indexOf(':') + 1)
        .split(',')
        .map(Number);
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
   * What is at a dropped pin — the most specific thing there.
   *
   * A building, a business, a road. Not the neighbourhood: see [PlaceName].
   */
  async reverse(lat: number, lng: number): Promise<PlaceName> {
    // Round before the cache lookup so a continuous pan is a handful of calls
    // rather than one per frame.
    //
    // 4dp is ~11 m. An earlier version used 3dp, reasoning that ~110 m was as
    // fine as an area label ever got and that reverse geocoding is billed per
    // call. Both halves were wrong on this path: the labels are building- and
    // business-specific, and Photon is not billed. What 3dp actually did was
    // serve one square's first answer to every later pin in it — four pins in
    // one Dhanmondi square resolve to three different shops, and all three
    // showed whichever was asked for first, for the next six hours. That is
    // the pin appearing not to move, which is the one thing this screen
    // exists to make impossible.
    const key = `rev:${lat.toFixed(4)}:${lng.toFixed(4)}`;

    const cached = this.fromCache<PlaceName>(key);
    if (cached) return cached;

    const value =
      (await this.photonReverse(lat, lng)) ??
      (await this.nominatimReverse(lat, lng)) ??
      GeocodingService.coordinateName(lat, lng);
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
  private async photonSearch(query: string): Promise<PlaceSuggestion[] | null> {
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

      const res = await fetch(url, {
        headers: { 'User-Agent': GeocodingService.USER_AGENT },
        signal: AbortSignal.timeout(4000),
      });
      // null, not an empty list: the difference between "Photon is down" and
      // "no such place" decides whether the next tier gets a turn.
      if (!res.ok) return null;

      const body = (await res.json()) as { features?: PhotonFeature[] };
      return (body.features ?? [])
        .map((f) => this.toSuggestion(f))
        .filter((s): s is PlaceSuggestion => s !== null);
    } catch (err) {
      this.logger.warn('Photon search failed', err);
      return null;
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

  /**
   * The specific thing standing at a coordinate — never the area around it.
   *
   * Asks for ten candidates rather than one and picks the nearest that is
   * actually a *place*. Taking Photon's first result looked equivalent and is
   * not: results are sorted by distance alone, so wherever OSM has mapped a
   * neighbourhood centroid closer than any building, the nearest hit is the
   * neighbourhood. Pin a field outside Savar and `limit=1` answers "Savar
   * Cantonment" — a suburb, 175 m off — while the mosque that would actually
   * orient a rider sits a little further out and never gets considered.
   *
   * Distance decides how the name is phrased, never whether there is one.
   * Only a pin with no mapped feature anywhere near it — or a Photon that
   * would not answer — falls through to a coordinate.
   */
  private async photonReverse(
    lat: number,
    lng: number,
  ): Promise<PlaceName | null> {
    const features = await this.photonReverseFetch(lat, lng);
    if (!features) return null;

    // Photon returns these nearest-first, so the first that survives the
    // filter is also the closest one.
    for (const feature of features) {
      const label = GeocodingService.specificLabel(feature);
      if (!label) continue;

      const coords = feature.geometry?.coordinates;
      if (!coords) continue;
      const metres = GeocodingService.metresBetween(
        lat,
        lng,
        coords[1],
        coords[0],
      );

      if (
        GeocodingService.containsPin(feature, lat, lng) ||
        metres <= GeocodingService.PINPOINT_M
      ) {
        return { name: label, areaLabel: label };
      }
      // Further off than that, but still the closest mapped thing there is —
      // and a landmark a rider can steer by beats a pair of decimals. The
      // prefix carries the honesty: "Near Mayer Achol" does not claim you are
      // standing in it.
      const near = `Near ${label}`;
      return { name: near, areaLabel: near };
    }

    return null;
  }

  /**
   * One retry, because the alternative is a coordinate.
   *
   * The label is fetched on every pan-settle and a phone on mobile data will
   * lose one occasionally. Before this method existed a single dropped request
   * fell straight through to the static area list, which is how an intermittent
   * network turned into an intermittently wrong place name.
   *
   * An `ok` response with no features is a real answer — OSM knows nothing
   * here — and is returned as an empty array rather than retried.
   */
  private async photonReverseFetch(
    lat: number,
    lng: number,
  ): Promise<PhotonFeature[] | null> {
    const url = new URL('https://photon.komoot.io/reverse');
    url.searchParams.set('lat', String(lat));
    url.searchParams.set('lon', String(lng));
    // Enough to see past a neighbourhood centroid to the buildings behind it.
    url.searchParams.set('limit', '10');
    url.searchParams.set('lang', 'en');

    for (const timeout of [4000, 6000]) {
      try {
        const res = await fetch(url, {
          headers: { 'User-Agent': GeocodingService.USER_AGENT },
          signal: AbortSignal.timeout(timeout),
        });
        if (!res.ok) continue;
        const body = (await res.json()) as { features?: PhotonFeature[] };
        return body.features ?? [];
      } catch {
        // Timeout or network error — fall through to the next attempt.
      }
    }

    this.logger.warn(`Photon reverse failed for ${lat},${lng}`);
    return null;
  }

  /**
   * What to call a feature, or null if it does not name a point.
   *
   * A named building or business is its name. An unnamed building is its
   * address, which in Dhaka's residential blocks is the common case and is
   * every bit as precise — "32 Road 2" is a gate a rider can find. A named
   * road is the road.
   *
   * Region features are rejected outright, whatever they are called. So is a
   * building with neither name nor number, which has nothing to offer but the
   * district it sits in.
   */
  private static specificLabel(feature: PhotonFeature): string | null {
    const p = feature.properties;
    if (!p) return null;
    if (!p.type || !GeocodingService.SPECIFIC_TYPES.has(p.type)) return null;

    if (p.name) return p.name;
    if (p.housenumber && p.street) return `${p.housenumber} ${p.street}`;
    if (p.street) return p.street;
    return null;
  }

  /**
   * Is the pin inside the feature's own footprint?
   *
   * A radius cannot serve both a corner shop and a university block: 60 m is
   * right for the first and absurd for the second. Where OSM has mapped the
   * outline, the outline answers instead — stand anywhere inside the building
   * and it is where you are, however far that is from its centre.
   */
  private static containsPin(
    feature: PhotonFeature,
    lat: number,
    lng: number,
  ): boolean {
    const extent = feature.properties?.extent;
    if (!extent) return false;
    const [minLng, maxLat, maxLng, minLat] = extent;
    return lng >= minLng && lng <= maxLng && lat >= minLat && lat <= maxLat;
  }

  /** Haversine, in metres. */
  private static metresBetween(
    lat1: number,
    lng1: number,
    lat2: number,
    lng2: number,
  ): number {
    const R = 6_371_000;
    const rad = Math.PI / 180;
    const dLat = (lat2 - lat1) * rad;
    const dLng = (lng2 - lng1) * rad;
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(a));
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

  /**
   * What Nominatim says is at a point, when Photon will not say anything.
   *
   * It answers a different question than Photon does, and often a better one:
   * Photon returns the nearest indexed *object*, while Nominatim at `zoom=18`
   * returns the feature that **contains** the point. At 23.78837, 90.37663 —
   * where Photon offers a sweet shop 18 m away — this returns the building the
   * pin is actually inside.
   *
   * Region-level answers are rejected exactly as they are for Photon: an
   * address or a named thing, or nothing.
   */
  private async nominatimReverse(
    lat: number,
    lng: number,
  ): Promise<PlaceName | null> {
    try {
      const url = new URL('https://nominatim.openstreetmap.org/reverse');
      url.searchParams.set('lat', String(lat));
      url.searchParams.set('lon', String(lng));
      url.searchParams.set('format', 'jsonv2');
      // Building level. Lower numbers widen to street, suburb, city — the
      // generalisations this service exists to avoid.
      url.searchParams.set('zoom', '18');
      url.searchParams.set('addressdetails', '1');
      url.searchParams.set('accept-language', 'en');

      const place = await this.nominatimFetch<NominatimPlace>(url);
      if (!place) return null;

      const a = place.address ?? {};
      const street =
        a.house_number && a.road ? `${a.house_number} ${a.road}` : a.road;
      const name = place.name || street;
      if (!name) return null;

      return { name, areaLabel: name };
    } catch (err) {
      this.logger.warn('Nominatim reverse failed', err);
      return null;
    }
  }

  /**
   * Last resort: OSM knows of nothing anywhere near this point, or Photon
   * would not answer twice running.
   *
   * Not a fallback anyone should see in Dhaka — a named feature is always
   * preferred however far off it is, because a landmark beats decimals. It
   * exists for the cases where there is genuinely no name to give.
   *
   * It replaced a guess at the nearest of 58 hard-coded areas, which read as
   * an answer while being wrong by up to 4 km. A coordinate is never wrong.
   */
  private static coordinateName(lat: number, lng: number): PlaceName {
    const label = `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
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
