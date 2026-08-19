/**
 * Named areas of Dhaka, with a representative coordinate each.
 *
 * The fallback for both lookups when Google Places is not configured — local
 * development, CI, and any window where the key is missing or the quota is
 * spent. Keeping it means place search degrades to "area names only" instead
 * of failing, and a developer can run the whole ride-creation flow without a
 * billing account.
 *
 * Coordinates are area centres, not addresses. Precision past ~4 decimal
 * places would be false: the point of an area label is that it is coarse.
 */
export interface DhakaArea {
  name: string;
  lat: number;
  lng: number;
}

export const DHAKA_AREAS: DhakaArea[] = [
  { name: 'Mirpur 1', lat: 23.7957, lng: 90.3537 },
  { name: 'Mirpur 2', lat: 23.8069, lng: 90.3628 },
  { name: 'Mirpur 10', lat: 23.8069, lng: 90.3668 },
  { name: 'Mirpur 11', lat: 23.8223, lng: 90.3654 },
  { name: 'Mirpur 12', lat: 23.8283, lng: 90.3661 },
  { name: 'Pallabi', lat: 23.8264, lng: 90.3639 },
  { name: 'Kazipara', lat: 23.7963, lng: 90.3746 },
  { name: 'Shewrapara', lat: 23.7906, lng: 90.3781 },
  { name: 'Agargaon', lat: 23.7784, lng: 90.3797 },
  { name: 'Kafrul', lat: 23.79, lng: 90.383 },
  { name: 'Cantonment', lat: 23.8103, lng: 90.396 },
  { name: 'Banani', lat: 23.7937, lng: 90.4066 },
  { name: 'Gulshan 1', lat: 23.7806, lng: 90.4147 },
  { name: 'Gulshan 2', lat: 23.7925, lng: 90.4148 },
  { name: 'Baridhara', lat: 23.8041, lng: 90.4213 },
  { name: 'Bashundhara R/A', lat: 23.8203, lng: 90.4276 },
  { name: 'Nikunja', lat: 23.828, lng: 90.418 },
  { name: 'Khilkhet', lat: 23.829, lng: 90.4203 },
  { name: 'Uttara Sector 3', lat: 23.8697, lng: 90.3985 },
  { name: 'Uttara Sector 7', lat: 23.8709, lng: 90.386 },
  { name: 'Uttara Sector 10', lat: 23.876, lng: 90.383 },
  { name: 'Uttara Sector 13', lat: 23.876, lng: 90.369 },
  { name: 'Airport', lat: 23.8433, lng: 90.3978 },
  { name: 'Ashulia', lat: 23.8944, lng: 90.3167 },
  { name: 'Savar', lat: 23.8583, lng: 90.2667 },
  { name: 'Birulia', lat: 23.8869, lng: 90.3494 },
  { name: 'Dhanmondi 27', lat: 23.7509, lng: 90.3799 },
  { name: 'Dhanmondi 32', lat: 23.753, lng: 90.376 },
  { name: 'Kalabagan', lat: 23.748, lng: 90.383 },
  { name: 'New Market', lat: 23.7333, lng: 90.3844 },
  { name: 'Azimpur', lat: 23.7283, lng: 90.3856 },
  { name: 'Lalbagh', lat: 23.719, lng: 90.388 },
  { name: 'Farmgate', lat: 23.7583, lng: 90.3894 },
  { name: 'Karwan Bazar', lat: 23.7509, lng: 90.3931 },
  { name: 'Tejgaon', lat: 23.7639, lng: 90.3944 },
  { name: 'Mohakhali', lat: 23.7783, lng: 90.4053 },
  { name: 'Moghbazar', lat: 23.748, lng: 90.405 },
  { name: 'Malibagh', lat: 23.7476, lng: 90.4147 },
  { name: 'Rampura', lat: 23.7614, lng: 90.4214 },
  { name: 'Badda', lat: 23.7806, lng: 90.4256 },
  { name: 'Banasree', lat: 23.7614, lng: 90.4283 },
  { name: 'Khilgaon', lat: 23.75, lng: 90.425 },
  { name: 'Motijheel', lat: 23.733, lng: 90.4172 },
  { name: 'Paltan', lat: 23.735, lng: 90.412 },
  { name: 'Shahbagh', lat: 23.7386, lng: 90.3956 },
  { name: 'Mohammadpur', lat: 23.765, lng: 90.3583 },
  { name: 'Shyamoli', lat: 23.7742, lng: 90.3661 },
  { name: 'Adabor', lat: 23.7742, lng: 90.3583 },
  { name: 'Gabtoli', lat: 23.7869, lng: 90.3428 },
  { name: 'Jatrabari', lat: 23.71, lng: 90.435 },
  { name: 'Sayedabad', lat: 23.715, lng: 90.429 },
  { name: 'Wari', lat: 23.718, lng: 90.418 },
  { name: 'Old Dhaka', lat: 23.7104, lng: 90.4074 },
  { name: 'Keraniganj', lat: 23.7, lng: 90.39 },
  { name: 'Tongi', lat: 23.8918, lng: 90.4056 },
  { name: 'Gazipur', lat: 23.9999, lng: 90.4203 },
  { name: 'Narayanganj', lat: 23.6238, lng: 90.5 },
];

/** Areas whose name contains `query`, prefix matches ranked first. */
export function searchAreas(query: string, limit = 8): DhakaArea[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];

  const starts: DhakaArea[] = [];
  const contains: DhakaArea[] = [];
  for (const area of DHAKA_AREAS) {
    const name = area.name.toLowerCase();
    if (name.startsWith(q)) starts.push(area);
    else if (name.includes(q)) contains.push(area);
  }
  return [...starts, ...contains].slice(0, limit);
}

/**
 * Nearest named area to a coordinate.
 *
 * Squared degrees rather than true distance: this only has to *rank*, and at
 * Dhaka's latitude the distortion cannot reorder neighbours kilometres apart.
 */
export function nearestArea(lat: number, lng: number): DhakaArea {
  let best = DHAKA_AREAS[0];
  let bestScore = Infinity;
  for (const area of DHAKA_AREAS) {
    const score = (area.lat - lat) ** 2 + (area.lng - lng) ** 2;
    if (score < bestScore) {
      bestScore = score;
      best = area;
    }
  }
  return best;
}

/** Kilometres from a coordinate to an area centre. */
export function distanceToAreaKm(
  lat: number,
  lng: number,
  area: DhakaArea,
): number {
  const kmPerDegLat = 111;
  const kmPerDegLng = 111 * Math.cos((lat * Math.PI) / 180);
  const dLat = (area.lat - lat) * kmPerDegLat;
  const dLng = (area.lng - lng) * kmPerDegLng;
  return Math.sqrt(dLat * dLat + dLng * dLng);
}
