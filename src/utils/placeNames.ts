/**
 * Turning a map link's place string into a name worth putting on a map.
 *
 * Google writes a stop as a full postal address:
 *
 *   "Gurudwara Chati Patshahi, 4R3C 7R7, Nowhatta, Srinagar, Jammu and Kashmir 190003"
 *   "Leh laddakh, 5H7P 687, Leh, Ladakh 194101"
 *   "Manali, Himachal Pradesh"
 *
 * On a map pin that is unreadable — it is truncated to nine rems of uppercase
 * — and as a search string it is worse than useless, because a geocoder asked
 * for a plus code and a postcode will often answer with neither. So the first
 * real segment is the name, the next is the region, and the rest is kept as
 * the address in the stop's note: nothing is thrown away, it is just filed
 * where it can be read.
 *
 * A "+" code (4R3C 7R7) and a bare postcode are the two things Google adds
 * that are certainly not a name, so they are recognised and skipped.
 */

/**
 * `4R3C 7R7`, `5H7P 687`, `4R3C+7R7` — Google's short codes for a spot.
 *
 * Case matters: the code itself is uppercase and contains digits, while a
 * place name is ordinary text. An earlier, laxer pattern ("four letters, then
 * two more") matched half the place names in India — Nangal, Punjab included —
 * and quietly deleted them.
 */
const PLUS_CODE = /^(?=.*\d)[0-9A-Z]{4}[+\s][0-9A-Z]{2,3}$/;
const POSTCODE = /^\d{4,6}$/;
/** `Jammu and Kashmir 190003` — a region with a postcode stuck on the end. */
const REGION_WITH_POSTCODE = /^(.*?)\s+\d{4,6}$/;

function segmentsOf(label: string): string[] {
  return label
    .split(",")
    .map((piece) => piece.trim())
    .filter(Boolean);
}

function isNoise(segment: string): boolean {
  return PLUS_CODE.test(segment) || POSTCODE.test(segment);
}

/** The readable name of a stop: the first segment that is not a code. */
export function shortPlaceName(label: string): string {
  const clean = label.trim().replace(/\s+/g, " ");
  if (!clean) return "";
  const segments = segmentsOf(clean).filter((segment) => !isNoise(segment));
  if (!segments.length) return clean;
  const first = segments[0].replace(REGION_WITH_POSTCODE, "$1").trim();
  // A one- or two-letter first segment ("A, B 123456") is not a name on its
  // own; keep the next segment with it.
  if (first.length <= 2 && segments[1]) {
    return `${first}, ${segments[1].replace(REGION_WITH_POSTCODE, "$1").trim()}`;
  }
  return first;
}

/** The region a stop sits in, when the address says so in its second part. */
export function placeRegion(label: string): string | undefined {
  const segments = segmentsOf(label).filter((segment) => !isNoise(segment));
  if (segments.length < 2) return undefined;
  const region = segments[1].replace(REGION_WITH_POSTCODE, "$1").trim();
  if (!region || region.length > 40) return undefined;
  // "Srinagar 190001" is a city, and a fine region for a landmark inside it;
  // "Jammu and Kashmir" is a state. Both read well under the place name.
  return /^\d/.test(region) ? undefined : region;
}

/**
 * What to ask a geocoder, best first.
 *
 * Tried in order, stopping at the first hit: the placename on its own (the
 * most likely to resolve), then with its region for the ones that need
 * county-level context, then the whole address as a last resort.
 */
export function lookupQueries(label: string): string[] {
  const full = label.trim().replace(/\s+/g, " ");
  const name = shortPlaceName(full);
  const region = placeRegion(full);
  const queries = [name, region ? `${name}, ${region}` : "", full].filter(
    (query) => query.trim().length > 0,
  );
  return [...new Set(queries)];
}
