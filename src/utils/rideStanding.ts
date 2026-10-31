/**
 * Where the ride actually is, measured against the route.
 *
 * Until now the tracker only knew what the dashboard had been told: a stop
 * marked "Here now" and a handful of stops around it. That is a statement made
 * by a person, at a desk, and it goes stale the moment the bike moves — a stop
 * stays "here now" for a whole day while the rider is four hundred kilometres
 * past it, and the next stop is still "still to come" after it has been
 * ridden through.
 *
 * This module answers the same question from the phone's own fix instead, with
 * one rule, in both directions:
 *
 *  - **Inside the arrival radius (2 km by default) a stop is "here now".**
 *    Approaching it counts, arriving counts, being parked in it counts.
 *  - **Once the rider is that far past it, it is "ridden".** Not when it is
 *    left, but when it is properly behind — so a stop does not flicker between
 *    the two states at the edge of the radius.
 *
 * Distance *to* a stop is the straight line, because that is the distance a
 * rider feels ("I am two kilometres outside Mandi"). Distance *past* a stop is
 * measured along the road, because that is the only way to know a rider has
 * gone by: on a hairpin they can be two kilometres away and still on the wrong
 * side of the town.
 *
 * Everything here is pure: no React, no fetching, no clock. The tracker, the
 * map and the nearby page all read the same answer, which is why they agree.
 */
import type { LiveStop } from "../store/siteContent";
import type { LatLng } from "./routing";
import { haversineKm } from "./routeProgress";

/** The radius, in kilometres, that makes a stop "here now". */
export const ARRIVE_KM = 2;

/** Straight-line kilometres per degree, near enough for a projection. */
const KM_PER_DEG_LAT = 110.574;
const kmPerDegLng = (lat: number): number => 111.32 * Math.cos((lat * Math.PI) / 180);

export type Standing = "live" | "done" | "next";

/** A point's place on the road: how far along, and how far off it. */
export interface RouteProjection {
  /** Kilometres from the road's first vertex to the nearest point on it. */
  alongKm: number;
  /** Kilometres from the road itself — zero when the rider is on it. */
  offKm: number;
  /** The vertex the projection falls after. */
  vertexIndex: number;
  /** How far into that segment, 0–1. */
  ratio: number;
}

/**
 * Project a point onto a road.
 *
 * Done segment by segment in a local flat plane — a hundredth of a degree of
 * error over a few hundred metres of hillside, and no trigonometry worth
 * worrying about per segment. The nearest segment wins, and the position inside
 * it is kept, so the answer can be used to place a pin on the line rather than
 * only to count kilometres.
 */
export function projectOnRoute(
  geometry: readonly LatLng[],
  point: { lat: number; lng: number },
): RouteProjection | null {
  if (geometry.length < 2) return null;

  let best: RouteProjection | null = null;
  let travelled = 0;

  for (let i = 0; i < geometry.length - 1; i += 1) {
    const [aLat, aLng] = geometry[i];
    const [bLat, bLng] = geometry[i + 1];
    const segmentKm = haversineKm(geometry[i], geometry[i + 1]);

    const kx = kmPerDegLng((aLat + bLat) / 2);
    const ax = aLng * kx;
    const ay = aLat * KM_PER_DEG_LAT;
    const bx = bLng * kx;
    const by = bLat * KM_PER_DEG_LAT;
    const px = point.lng * kx;
    const py = point.lat * KM_PER_DEG_LAT;

    const dx = bx - ax;
    const dy = by - ay;
    const lengthSq = dx * dx + dy * dy;
    const raw = lengthSq === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / lengthSq;
    const ratio = Math.min(1, Math.max(0, raw));

    const offKm = Math.hypot(px - (ax + dx * ratio), py - (ay + dy * ratio));
    if (!best || offKm < best.offKm) {
      best = { alongKm: travelled + segmentKm * ratio, offKm, vertexIndex: i, ratio };
    }
    travelled += segmentKm;
  }

  return best;
}

/** The road to measure against: the fetched road, else the stops themselves. */
function rideLine(stops: readonly LiveStop[], geometry: readonly LatLng[]): LatLng[] {
  if (geometry.length >= 2) return [...geometry];
  return stops.map((stop) => [stop.lat, stop.lng] as LatLng);
}

/**
 * The rider's position in kilometres along the ride.
 *
 * Scaled to the route's own total, so it can be compared with the stop
 * distances the tracker already prints: a simplified road sums a little short
 * of the drive, and two rulers must not argue about the same journey.
 */
export function rideAlongKm(
  stops: readonly LiveStop[],
  geometry: readonly LatLng[],
  totals: readonly number[],
  point: { lat: number; lng: number },
): { alongKm: number; offKm: number } | null {
  const line = rideLine(stops, geometry);
  const projection = projectOnRoute(line, point);
  if (!projection) return null;

  const totalKm = totals.length ? (totals[totals.length - 1] ?? 0) : 0;
  const lineKm = line.reduce((sum, vertex, i) => (i === 0 ? 0 : sum + haversineKm(line[i - 1], vertex)), 0);
  const scale = lineKm > 0 && totalKm > 0 ? totalKm / lineKm : 1;
  return {
    alongKm: Math.min(Math.max(projection.alongKm * scale, 0), totalKm),
    offKm: projection.offKm,
  };
}

/** Everything the pages need to know about where the ride has got to. */
export interface RideStanding {
  /** One status per stop, in route order. Exactly one stop may be "live". */
  statuses: Standing[];
  /** The stop the rider is inside the radius of, or -1. */
  hereIndex: number;
  /** The stop being ridden towards, or -1 when the route is finished. */
  toIndex: number;
  /** The last stop ridden, or -1 before the first one is left behind. */
  fromIndex: number;
  /** Kilometres along the road where the rider is. */
  alongKm: number;
  /** Kilometres from the road, where the fix says so. */
  offKm: number;
  /** True while the rider is inside the arrival radius of a stop. */
  arrived: boolean;
  /** Straight-line kilometres to each stop, for the "2 km out" line. */
  distances: number[];
}

/**
 * Work out every stop's status from one position.
 *
 * The route is walked once. A stop is "ridden" when the rider is more than the
 * arrival radius past it along the road, "here now" when they are inside the
 * radius of it in a straight line and have not already left it, and "still to
 * come" otherwise. When two stops qualify — the two ends of a round trip, the
 * two halves of a town split across a river — the earlier one wins, and the
 * later one becomes the next thing to reach rather than a second "here now".
 */
export function rideStanding(
  stops: readonly LiveStop[],
  geometry: readonly LatLng[],
  totals: readonly number[],
  point: { lat: number; lng: number },
  arriveKm = ARRIVE_KM,
): RideStanding {
  const count = stops.length;
  if (count === 0) {
    return {
      statuses: [],
      hereIndex: -1,
      toIndex: -1,
      fromIndex: -1,
      alongKm: 0,
      offKm: 0,
      arrived: false,
      distances: [],
    };
  }

  const distances = stops.map((stop) => haversineKm([stop.lat, stop.lng], [point.lat, point.lng]));
  const along = rideAlongKm(stops, geometry, totals, point);
  const alongKm = along?.alongKm ?? 0;

  // Behind by road, or not. A stop exactly at the rider is not behind them.
  const passed = stops.map((_, i) => (totals[i] ?? 0) <= alongKm - arriveKm);

  // Inside the radius, and not already left behind. Nearest first, then the
  // earliest in the route, so a fix that jumps does not pick a stop at random.
  let hereIndex = -1;
  let bestKm = Number.POSITIVE_INFINITY;
  for (let i = 0; i < count; i += 1) {
    if (passed[i]) continue;
    if (distances[i] > arriveKm) continue;
    if (distances[i] < bestKm - 1e-9 || (Math.abs(distances[i] - bestKm) <= 1e-9 && hereIndex < 0)) {
      bestKm = distances[i];
      hereIndex = i;
    }
  }
  const statuses: Standing[] = stops.map((_, i) => {
    if (i === hereIndex) return "live";
    if (passed[i]) return "done";
    return "next";
  });

  // The stop being ridden towards: the first one still ahead. Once inside the
  // radius that stop is "here now", and the next one becomes the target.
  const firstAhead = statuses.findIndex((status) => status === "next");
  const toIndex =
    hereIndex >= 0
      ? hereIndex + 1 < count
        ? hereIndex + 1
        : -1
      : firstAhead >= 0
        ? firstAhead
        : -1;

  const fromIndex =
    hereIndex >= 0
      ? hereIndex
      : statuses.reduce((acc, status, i) => (status === "done" ? i : acc), -1);

  return {
    statuses,
    hereIndex,
    toIndex,
    fromIndex,
    alongKm,
    offKm: along?.offKm ?? 0,
    arrived: hereIndex >= 0,
    distances,
  };
}

/** The same stops with the statuses the ride has earned, not the ones typed. */
export function withStanding(stops: readonly LiveStop[], statuses: readonly Standing[]): LiveStop[] {
  return stops.map((stop, i) => {
    const status = statuses[i];
    if (!status || status === stop.status) return stop;
    return { ...stop, status };
  });
}

/** One of the three cities the nearby page always shows. */
export interface RideCity {
  index: number;
  name: string;
  state?: string;
  lat: number;
  lng: number;
  /** coming from / about to reach / entering soon */
  role: "from" | "to" | "next";
  /** Kilometres along the route from the start. */
  planKm: number;
  /** Straight-line kilometres from the rider right now. */
  awayKm: number;
  /** True while the rider is inside the arrival radius of this city. */
  here: boolean;
}

/**
 * The three cities that matter right now.
 *
 * The nearby page should never be a list of every town on a two-thousand
 * kilometre route: what a rider needs is the town behind them, the town they
 * are heading into, and the one after that — the three the next few hours
 * happen between. Parked at the start, those are the start itself, the first
 * stop and the second; three days in they are the town just left, the one
 * coming up and the one beyond it.
 *
 * When the rider is inside a city, that city is the "coming from" one and the
 * ride ahead supplies the other two — the page always points forwards.
 */
export function nearbyCities(
  stops: readonly LiveStop[],
  standing: RideStanding,
  totals: readonly number[] = [],
): RideCity[] {
  const count = stops.length;
  if (!count) return [];

  const { hereIndex, toIndex, fromIndex } = standing;

  // The stop the three are counted from: the one being entered, else the one
  // being ridden towards, else the last of the route.
  const anchor = hereIndex >= 0 ? hereIndex : toIndex >= 0 ? toIndex : count - 1;
  // Parked at the start with nothing ridden, there is nothing behind to come
  // from — the start itself is the place the ride leaves.
  const atStart = hereIndex === 0 && !standing.statuses.some((status) => status === "done");

  const fromAt = atStart ? 0 : anchor - 1;
  const toAt = atStart ? 1 : anchor;
  const nextAt = atStart ? 2 : anchor + 1;

  const picks: { index: number; role: RideCity["role"] }[] = [];
  const push = (index: number, role: RideCity["role"]) => {
    if (index < 0 || index >= count) return;
    if (picks.some((pick) => pick.index === index)) return;
    picks.push({ index, role });
  };

  push(fromAt, "from");
  push(toAt, "to");
  push(nextAt, "next");

  // Three cities, always, when the route has them: on a short route the ride
  // ahead runs out before three do, so the gap is filled from behind — the
  // towns just ridden are still the ones the rider came through.
  if (picks.length < 3) {
    for (let step = 1; step < count && picks.length < 3; step += 1) {
      const behind = anchor - step;
      const ahead = anchor + step;
      push(behind >= 0 ? behind : -1, "from");
      if (picks.length < 3) push(ahead, "next");
    }
  }
  if (!picks.length && fromIndex >= 0) push(fromIndex, "from");

  return picks
    .sort((a, b) => (totals[a.index] ?? 0) - (totals[b.index] ?? 0))
    .map((pick) => {
      const stop = stops[pick.index];
      return {
        index: pick.index,
        name: stop.name,
        state: stop.state,
        lat: stop.lat,
        lng: stop.lng,
        role: pick.role,
        planKm: totals[pick.index] ?? 0,
        awayKm: standing.distances[pick.index] ?? 0,
        here: pick.index === hereIndex,
      };
    });
}

/** "Coming from" / "About to reach" / "Entering soon", in words. */
export const CITY_ROLE_COPY: Record<RideCity["role"], string> = {
  from: "Coming from",
  to: "About to reach",
  next: "Entering soon",
};
