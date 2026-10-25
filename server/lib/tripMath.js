/**
 * The arithmetic a member actually wants: how far is this ride, and how much
 * petrol will it drink?
 *
 * The stops come from the same resolver the admin dashboard uses for the
 * expedition, so a member's ride is measured the same way the site's own ride
 * is. Distances are straight lines between consecutive stops (the haversine
 * formula), which under-reads a winding mountain road — the site's tracker
 * makes the same choice, deliberately, because a road-accurate figure needs a
 * routing service and a key, and a member building a ride by hand should not
 * need either.
 *
 * Petrol is litres, never rupees: a price changes weekly and a number that
 * silently goes stale is worse than no number. The dashboard knows the current
 * price per litre if it wants to show money.
 */

const EARTH_RADIUS_KM = 6371.0088;

const rad = (deg) => (deg * Math.PI) / 180;

/** Straight-line distance between two coordinate pairs, in kilometres. */
export function haversineKm(a, b) {
  if (!a || !b) return 0;
  const [lat1, lng1] = [Number(a.lat), Number(a.lng)];
  const [lat2, lng2] = [Number(b.lat), Number(b.lng)];
  if (![lat1, lng1, lat2, lng2].every(Number.isFinite)) return 0;
  const dLat = rad(lat2 - lat1);
  const dLng = rad(lng2 - lng1);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

const round = (value, places = 1) => {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
};

/** Only stops that can be measured; a half-filled row is skipped, not guessed. */
export function measureStops(stops) {
  const list = Array.isArray(stops) ? stops : [];
  return list
    .filter((stop) => stop && Number.isFinite(Number(stop.lat)) && Number.isFinite(Number(stop.lng)))
    .map((stop) => ({
      name: String(stop.name ?? "").trim(),
      lat: Number(stop.lat),
      lng: Number(stop.lng),
    }));
}

/**
 * Everything about a journey once a mileage is known.
 *
 * `roundTrip` is offered, not assumed: a member can look at both figures and
 * decide on the morning. `legs` is per hop, so the dashboard can show the ride
 * stop by stop rather than as one opaque total.
 */
export function journeyMath(stops, { kmpl = null, roundTrip = false } = {}) {
  const points = measureStops(stops);
  const legs = [];
  for (let i = 1; i < points.length; i += 1) {
    legs.push({
      from: points[i - 1].name,
      to: points[i].name,
      km: round(haversineKm(points[i - 1], points[i]), 1),
    });
  }
  const oneWayKm = round(legs.reduce((sum, leg) => sum + leg.km, 0), 1);
  const roundTripKm = round(oneWayKm * 2, 1);
  const perLitre = Number(kmpl) > 0 ? Number(kmpl) : null;

  return {
    stops: points.length,
    legs,
    oneWayKm,
    roundTripKm,
    /** The bike the figures belong to, if one was chosen. */
    kmpl: perLitre,
    litresOneWay: perLitre ? round(oneWayKm / perLitre, 2) : null,
    litresRoundTrip: perLitre ? round(roundTripKm / perLitre, 2) : null,
    /** Which figure the member asked to see as *the* answer. */
    selectedKm: roundTrip ? roundTripKm : oneWayKm,
    selectedLitres: perLitre ? round((roundTrip ? roundTripKm : oneWayKm) / perLitre, 2) : null,
    /** Where the ride begins and ends, in the member's own words. */
    from: points[0]?.name ?? "",
    to: points.at(-1)?.name ?? "",
  };
}

/**
 * The same ride measured for every bike in the garage.
 *
 * Two bikes is the common case — a commuter and a weekend bike — and the whole
 * point is to compare them before choosing, so the figures are computed for
 * each one instead of only for the bike marked as preferred.
 */
export function petrolPerBike(stops, bikes) {
  return (Array.isArray(bikes) ? bikes : []).map((bike) => {
    const maths = journeyMath(stops, { kmpl: bike.mileageKmpl });
    return {
      bikeId: bike.id,
      maker: bike.maker,
      model: bike.model,
      kmpl: bike.mileageKmpl,
      mileageSource: bike.mileageSource,
      litresOneWay: maths.litresOneWay,
      litresRoundTrip: maths.litresRoundTrip,
    };
  });
}
