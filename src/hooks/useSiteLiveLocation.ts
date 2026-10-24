import { useMemo } from "react";
import { sectionData, useSite, type LiveData } from "../store/siteContent";
import { currentStop } from "../utils/liveRoute";
import { useLiveLocation, type LiveLocationSeed } from "./useLiveLocation";

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
  return { ...track, route: data, stop };
}
