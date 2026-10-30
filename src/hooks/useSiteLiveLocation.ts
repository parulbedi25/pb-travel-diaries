import { useMemo } from "react";
import { sectionData, useSite, type LiveData, type LiveStop } from "../store/siteContent";
import { currentStop, distanceKm } from "../utils/liveRoute";
import { useLiveLocation, type LiveLocationData, type LiveLocationSeed } from "./useLiveLocation";

/**
 * How near a phone fix has to be to a stop before that stop's name is used.
 *
 * A fix is a point, a stop name is a place: within this radius the phone is
 * "at" that place, and saying so is more use than a pair of numbers. Past it
 * the site says where the position came from instead of borrowing a name it
 * does not deserve.
 */
const NAME_RADIUS_KM = 30;

/**
 * The live position as the whole site sees it: read from the dashboard's route.
 *
 * The tracker, the live map and the nearby-places page all have to agree about
 * where PB is, so they all come through here instead of each picking a stop
 * themselves. Reading the draft (`live`) rather than the published content
 * means the owner sees a stop they just marked "Here now" without saving.
 */
export function useSiteLiveLocation() {
  const { live } = useSite();
  const data = sectionData<LiveData>(live, "live");
  const stop = currentStop(data.stops ?? []);
  const seed = useMemo<LiveLocationSeed | null>(
    () =>
      stop
        ? {
            lat: stop.lat,
            lng: stop.lng,
            name: stop.name,
            state: stop.state,
            altitude: stop.altitude,
            note: stop.note,
          }
        : null,
    [stop?.lat, stop?.lng, stop?.name, stop?.state, stop?.altitude, stop?.note], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const track = useLiveLocation(seed);

  /**
   * The position, named.
   *
   * A fix from the phone has coordinates and nothing else — OwnTracks reports
   * where, not what is there. So the nearest stop on the route lends its name
   * while the phone is near it, and past that the card says plainly that this
   * is a live fix rather than a town. Nothing here invents a place.
   */
  const location = useMemo<LiveLocationData>(() => {
    if (track.location.source !== "phone") return track.location;
    const nearest = nearestStop(data.stops ?? [], track.location.lat, track.location.lng);
    const near = nearest && nearest.km <= NAME_RADIUS_KM ? nearest.stop : null;
    return {
      ...track.location,
      name: near?.name?.trim() || "Live GPS",
      state: near?.state?.trim() || "your phone",
      altitude: track.location.altitude || near?.altitude?.trim() || "",
      note: track.location.note || "Live from the phone in the rider's pocket.",
    };
  }, [
    // The fields the naming actually depends on: a new object every render
    // would recompute this on every tick of the tracker's one-second clock.
    track.location.source,
    track.location.lat,
    track.location.lng,
    track.location.altitude,
    track.location.note,
    data.stops,
  ]); // eslint-disable-line react-hooks/exhaustive-deps

  return { ...track, location, route: data, stop };
}

/** The closest stop to a point, with its distance. */
function nearestStop(stops: LiveStop[], lat: number, lng: number) {
  let best: { stop: LiveStop; km: number } | null = null;
  for (const stop of stops) {
    const km = distanceKm({ lat, lng }, { lat: stop.lat, lng: stop.lng });
    if (!best || km < best.km) best = { stop, km };
  }
  return best;
}
