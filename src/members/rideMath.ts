/**
 * The same arithmetic the server does, for a ride that is still being written.
 *
 * A member drops a pin, the distance has to move *now* — waiting for a round
 * trip to the server to see the number would make the builder feel broken. So
 * the sums are done here too, and the numbers the server sends back replace
 * them the moment the ride is saved.
 *
 * This mirrors `server/lib/tripMath.js` line for line: straight-line distance
 * between consecutive stops, one-way and round trip, litres from km per litre.
 * If one changes, the other has to change with it.
 */

const EARTH_RADIUS_KM = 6371.0088;
const rad = (deg: number) => (deg * Math.PI) / 180;

export function haversineKm(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

const round = (value: number, places = 1) => {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
};

export interface LocalMaths {
  oneWayKm: number;
  roundTripKm: number;
  litresOneWay: number | null;
  litresRoundTrip: number | null;
  legs: { from: string; to: string; km: number }[];
}

export function rideMaths(
  stops: { name: string; lat: number; lng: number }[],
  kmpl: number | null,
): LocalMaths {
  const legs: { from: string; to: string; km: number }[] = [];
  for (let i = 1; i < stops.length; i += 1) {
    legs.push({
      from: stops[i - 1].name,
      to: stops[i].name,
      km: round(haversineKm(stops[i - 1], stops[i]), 1),
    });
  }
  const oneWayKm = round(legs.reduce((sum, leg) => sum + leg.km, 0), 1);
  const roundTripKm = round(oneWayKm * 2, 1);
  const perLitre = Number(kmpl) > 0 ? Number(kmpl) : null;
  return {
    legs,
    oneWayKm,
    roundTripKm,
    litresOneWay: perLitre ? round(oneWayKm / perLitre, 2) : null,
    litresRoundTrip: perLitre ? round(roundTripKm / perLitre, 2) : null,
  };
}
