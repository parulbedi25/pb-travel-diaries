import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowUpRight,
  Compass,
  ImageOff,
  MapPin,
  Navigation,
  RefreshCcw,
  X,
} from "lucide-react";
import { useSiteLiveLocation } from "../hooks/useSiteLiveLocation";
import { useNearbyPlaces, type NearbyPlace } from "../hooks/useNearbyPlaces";
import VectorBasemap from "./VectorBasemap";
import ThemeToggle from "./ThemeToggle";
import { Logo } from "./Navbar";
import { fitViewExact, makeMercatorProjector } from "../utils/mercator";
import { distanceKm, googleMapsPlaceUrl, type MapPoint } from "../utils/liveRoute";
import { externalLinkProps } from "./ui/SocialIcons";
import { cn } from "../utils/cn";

/**
 * "Nearby places" — what there is to see around wherever PB is right now.
 *
 * A different question from the live map's, which answers only "where is he".
 * This page keeps that pinpoint on the map and hangs the country around it:
 * every geotagged Wikipedia article within a short ride, with its free photo
 * and a tap-through to Google Maps for the ones worth a detour.
 *
 * Nothing here is stored in the site document. The places are fetched from
 * Wikipedia when the page opens, because a place worth visiting is not a thing
 * anybody should have to retype into a dashboard.
 */

/** How far each pin's label is nudged so it does not sit on the pin itself. */
const BUBBLE_OFFSET = 16;

function PlaceThumb({
  place,
  className,
  sizes,
}: {
  place: NearbyPlace;
  className?: string;
  sizes?: string;
}) {
  const [failed, setFailed] = useState(false);
  if (!place.image || failed) {
    return (
      <div
        className={cn(
          "grid place-items-center bg-gradient-to-br from-saffron-400/20 via-ink-800 to-ink-900 text-zinc-500",
          className,
        )}
      >
        <ImageOff className="h-5 w-5" aria-hidden />
      </div>
    );
  }
  return (
    <img
      src={place.image}
      alt={place.title}
      sizes={sizes}
      loading="lazy"
      draggable={false}
      onError={() => setFailed(true)}
      className={cn("object-cover", className)}
    />
  );
}

export default function NearbyPlacesPage() {
  const { location, status, route } = useSiteLiveLocation();
  const settings = route.nearby;
  const radiusKm = Math.max(1, Math.min(50, Math.round(settings?.radiusKm ?? 10)));
  const count = Math.max(5, Math.min(10, Math.round(settings?.count ?? 8)));
  const { places, loading, error, reload } = useNearbyPlaces({
    lat: location.lat,
    lng: location.lng,
    radiusKm,
    count,
  });

  const [selected, setSelected] = useState<number | null>(null);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });

  // The pins are laid over the tiles, so the panel is measured rather than
  // assumed — same reason the live map measures its own.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const measure = () => {
      const width = host.clientWidth;
      const height = host.clientHeight;
      if (width > 0 && height > 0) setSize({ width, height });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(host);
    return () => observer.disconnect();
  }, []);

  const width = size.width || 900;
  const height = size.height || 480;

  const points = useMemo(
    () => [{ lat: location.lat, lng: location.lng }, ...places.map((p) => ({ lat: p.lat, lng: p.lng }))],
    [location.lat, location.lng, places],
  );
  const view = useMemo(
    () => fitViewExact(points, width, height, { padX: 56, padY: 60 }),
    [points, width, height],
  );
  const projector = useMemo(
    () => makeMercatorProjector(view, width, height),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [view.lat, view.lng, view.zoom, width, height],
  );
  const here = projector.toXY({ lat: location.lat, lng: location.lng });

  // A place can be nearest-first from Wikipedia and still sit on the far side
  // of the panel; the map is drawn for the whole set, the list keeps the order.
  const selectedPlace = selected !== null ? places[selected] : undefined;
  const selectedPoint: MapPoint | null = selectedPlace
    ? { lat: selectedPlace.lat, lng: selectedPlace.lng }
    : null;
  const selectedXY = selectedPoint ? projector.toXY(selectedPoint) : null;

  return (
    <div className="flex min-h-screen flex-col bg-ink-950">
      {/* ---------- Top bar ---------- */}
      <header className="relative z-30 border-b border-white/[0.07] bg-ink-950/85 backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-3 px-5 py-3.5 sm:px-8">
          <a
            href="#/"
            className="group inline-flex items-center gap-2 rounded-full glass px-4 py-2 text-xs font-semibold text-zinc-300 transition-all duration-300 hover:border-white/25 hover:text-white"
          >
            <ArrowLeft className="h-3.5 w-3.5 transition-transform duration-300 group-hover:-translate-x-0.5" />
            pbfrompb.in
          </a>
          <Logo compact />
          <span className="hidden h-6 w-px bg-white/10 sm:block" aria-hidden />
          <h1 className="font-display text-sm font-semibold tracking-tight text-white sm:text-base">
            {settings?.heading?.trim() || "Nearby places"}
          </h1>
          <span className="inline-flex items-center gap-2 rounded-full border border-saffron-400/30 bg-saffron-400/10 px-3.5 py-1.5 text-[11px] font-bold tracking-[0.12em] text-saffron-300">
            <MapPin className="h-3 w-3" aria-hidden />
            {location.name.toUpperCase()}
          </span>
          <ThemeToggle className="ml-auto shrink-0" />
        </div>
      </header>

      <main className="mx-auto w-full max-w-7xl flex-1 px-5 pb-16 pt-8 sm:px-8">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="max-w-2xl">
            <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-zinc-500">
              Around {location.name}, {location.state}
            </p>
            <h2 className="mt-2 font-display text-3xl font-semibold tracking-tight text-white sm:text-4xl">
              {settings?.heading?.trim() || "Nearby places"}
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-zinc-400">
              {settings?.intro?.trim() ||
                "Pulled live from Wikipedia around wherever PB is right now."}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-[11px] text-zinc-400">
            <span className="rounded-full bg-white/[0.06] px-3 py-1.5 font-mono">
              within {radiusKm} km
            </span>
            <span className="rounded-full bg-white/[0.06] px-3 py-1.5 font-mono">
              {loading ? "searching…" : `${places.length} places`}
            </span>
            <button
              type="button"
              onClick={reload}
              className="inline-flex items-center gap-1.5 rounded-full border border-white/15 px-3 py-1.5 font-semibold text-zinc-300 transition-colors hover:border-white/30 hover:text-white"
            >
              <RefreshCcw className={cn("h-3 w-3", loading && "animate-spin")} />
              Refresh
            </button>
          </div>
        </div>

        {/* ---------- The map ---------- */}
        <div
          ref={hostRef}
          className="map-paper relative mt-6 h-[420px] overflow-hidden rounded-[2rem] border border-white/10 bg-ink-900 shadow-2xl shadow-black/50 sm:h-[500px]"
        >
          <VectorBasemap
            view={view}
            width={width}
            height={height}
            className="absolute inset-0"
            attributionClassName="live-map-attribution pointer-events-none absolute right-3 top-3 z-20 text-[9px]"
          />

          {/* Where PB is: the same gold pin the live map uses, kept on top. */}
          <div
            className="pointer-events-none absolute z-20 -translate-x-1/2 -translate-y-1/2"
            style={{ left: `${here.x}%`, top: `${here.y}%` }}
          >
            <span
              className={cn(
                "relative grid h-5 w-5 place-items-center rounded-full border-2 border-white shadow-lg ring-1 ring-black/50",
                status === "live" ? "bg-saffron-400 shadow-saffron-400/50" : "bg-zinc-500 shadow-zinc-500/50",
              )}
            >
              {status === "live" && (
                <span className="absolute inset-0 rounded-full bg-saffron-400/40 animate-radar" aria-hidden />
              )}
              <span className="h-1.5 w-1.5 rounded-full bg-white" />
            </span>
          </div>

          {/* One pointer per place. Clicking it opens the bubble over the map. */}
          {places.map((place, index) => {
            const point = projector.toXY(place);
            const active = selected === index;
            return (
              <button
                key={place.pageid}
                type="button"
                onClick={() => setSelected(active ? null : index)}
                aria-label={`${place.title}, ${place.distanceKm.toFixed(1)} kilometres away`}
                aria-pressed={active}
                className={cn(
                  "group absolute z-10 grid h-7 w-7 -translate-x-1/2 -translate-y-full place-items-center rounded-full border-2 border-white text-[11px] font-bold shadow-lg transition-transform duration-200 hover:scale-110",
                  active
                    ? "bg-saffron-400 text-ink-950"
                    : "bg-ink-950/85 text-white hover:bg-ink-800",
                )}
                style={{ left: `${point.x}%`, top: `${point.y}%` }}
              >
                {index + 1}
              </button>
            );
          })}

          {/* The bubble. Placed below the pin when the pin is high up, above it
              when the pin is low, so it never leaves the map. */}
          {selectedPlace && selectedXY && (
            <div
              role="dialog"
              aria-label={selectedPlace.title}
              className="absolute z-30 w-[15.5rem] overflow-hidden rounded-2xl border border-white/10 bg-ink-950/95 shadow-2xl shadow-black/60 backdrop-blur-xl"
              style={{
                left: `${Math.min(88, Math.max(12, selectedXY.x))}%`,
                top: `${selectedXY.y}%`,
                transform: `translate(-50%, ${selectedXY.y > 35 ? "calc(-100% - " + BUBBLE_OFFSET + "px)" : BUBBLE_OFFSET + "px"})`,
              }}
            >
              <div className="relative">
                <PlaceThumb place={selectedPlace} className="h-32 w-full" sizes="15.5rem" />
                <button
                  type="button"
                  onClick={() => setSelected(null)}
                  aria-label="Close"
                  className="absolute right-2 top-2 grid h-6 w-6 place-items-center rounded-full bg-ink-950/80 text-white transition-colors hover:bg-ink-950"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
              <div className="p-3.5">
                <p className="font-display text-sm font-semibold leading-tight text-white">
                  {selectedPlace.title}
                </p>
                <p className="mt-1 font-mono text-[10px] text-saffron-300">
                  {selectedPlace.distanceKm.toFixed(1)} km away
                </p>
                <a
                  href={googleMapsPlaceUrl({ lat: selectedPlace.lat, lng: selectedPlace.lng })}
                  {...externalLinkProps(googleMapsPlaceUrl({ lat: selectedPlace.lat, lng: selectedPlace.lng }))}
                  className="mt-3 inline-flex w-full items-center justify-center gap-1.5 rounded-full bg-white px-3 py-2 text-[11px] font-semibold text-ink-950 transition-colors hover:bg-saffron-300"
                >
                  <Navigation className="h-3 w-3" />
                  Open in Google Maps
                </a>
              </div>
            </div>
          )}

          <div className="pointer-events-none absolute bottom-3 left-3 z-20 flex items-center gap-2 rounded-full bg-ink-950/80 px-3 py-1.5 text-[10px] text-zinc-400">
            <Compass className="h-3 w-3 text-saffron-300" aria-hidden />
            {loading
              ? "Asking Wikipedia for places near here…"
              : `${location.name} · ${places.length} places · tap a pin`}
          </div>
        </div>

        {/* ---------- The list ---------- */}
        {loading && !places.length && (
          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-64 animate-pulse rounded-3xl border border-white/[0.06] bg-white/[0.03]" />
            ))}
          </div>
        )}

        {error && !loading && (
          <div className="mt-8 rounded-3xl border border-amber-400/25 bg-amber-400/[0.07] p-5 text-sm text-amber-200">
            <p>{error}</p>
            <button
              type="button"
              onClick={reload}
              className="mt-3 rounded-full border border-amber-300/40 px-4 py-1.5 text-xs font-semibold text-amber-100 transition-colors hover:bg-amber-300/10"
            >
              Try again
            </button>
          </div>
        )}

        {!loading && !error && !places.length && (
          <div className="mt-8 rounded-3xl border border-white/[0.08] bg-white/[0.03] p-6 text-sm text-zinc-400">
            <p className="font-display text-base font-semibold text-white">
              Nothing geotagged within {radiusKm} km
            </p>
            <p className="mt-1.5 leading-relaxed">
              Wikipedia has no articles pinned this close to {location.name}. Widen the search
              radius in the dashboard — the tracker&apos;s live section sets it.
            </p>
          </div>
        )}

        {places.length > 0 && (
          <ul className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {places.map((place, index) => {
              const mapsUrl = googleMapsPlaceUrl({ lat: place.lat, lng: place.lng });
              const active = selected === index;
              return (
                <li key={place.pageid}>
                  <article
                    className={cn(
                      "group flex h-full flex-col overflow-hidden rounded-3xl border bg-white/[0.03] transition-colors duration-300",
                      active ? "border-saffron-400/50" : "border-white/[0.08] hover:border-white/20",
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => setSelected(active ? null : index)}
                      className="relative block w-full text-left"
                      aria-label={`Show ${place.title} on the map`}
                    >
                      <PlaceThumb place={place} className="h-40 w-full transition-transform duration-500 group-hover:scale-[1.03]" sizes="(max-width: 640px) 100vw, 33vw" />
                      <span className="absolute left-3 top-3 grid h-6 w-6 place-items-center rounded-full bg-ink-950/85 text-[11px] font-bold text-white">
                        {index + 1}
                      </span>
                      <span className="absolute right-3 top-3 rounded-full bg-ink-950/85 px-2.5 py-1 font-mono text-[10px] text-saffron-300">
                        {place.distanceKm.toFixed(1)} km
                      </span>
                    </button>
                    <div className="flex flex-1 flex-col p-4">
                      <h3 className="font-display text-base font-semibold leading-tight text-white">
                        {place.title}
                      </h3>
                      {place.extract ? (
                        <p className="mt-1.5 line-clamp-3 text-xs leading-relaxed text-zinc-400">
                          {place.extract}
                        </p>
                      ) : (
                        <p className="mt-1.5 text-xs leading-relaxed text-zinc-500">
                          {distanceKm({ lat: location.lat, lng: location.lng }, place).toFixed(1)} km from{" "}
                          {location.name}.
                        </p>
                      )}
                      <div className="mt-3 flex flex-wrap items-center gap-2 pt-1">
                        <a
                          href={mapsUrl}
                          {...externalLinkProps(mapsUrl)}
                          className="inline-flex items-center gap-1.5 rounded-full bg-white px-3.5 py-1.5 text-[11px] font-semibold text-ink-950 transition-colors hover:bg-saffron-300"
                        >
                          <MapPin className="h-3 w-3" />
                          Google Maps
                          <ArrowUpRight className="h-3 w-3" />
                        </a>
                        <a
                          href={place.wikiUrl}
                          {...externalLinkProps(place.wikiUrl)}
                          className="inline-flex items-center gap-1.5 rounded-full border border-white/15 px-3 py-1.5 text-[11px] font-semibold text-zinc-300 transition-colors hover:border-white/30 hover:text-white"
                        >
                          Wikipedia
                        </a>
                      </div>
                    </div>
                  </article>
                </li>
              );
            })}
          </ul>
        )}

        <p className="mt-8 text-[11px] leading-relaxed text-zinc-500">
          Places, text and photos come from{" "}
          <a
            href="https://www.wikipedia.org"
            {...externalLinkProps("https://www.wikipedia.org")}
            className="underline decoration-dotted underline-offset-2 hover:text-zinc-300"
          >
            Wikipedia
          </a>{" "}
          and{" "}
          <a
            href="https://commons.wikimedia.org"
            {...externalLinkProps("https://commons.wikimedia.org")}
            className="underline decoration-dotted underline-offset-2 hover:text-zinc-300"
          >
            Wikimedia Commons
          </a>{" "}
          (CC BY-SA), fetched live around {location.name} · {radiusKm} km. Maps ©
          OpenStreetMap contributors.
        </p>
      </main>
    </div>
  );
}
