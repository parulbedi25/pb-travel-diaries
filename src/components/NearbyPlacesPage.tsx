import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowUpRight,
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
import { fitViewInset, makeMercatorProjector } from "../utils/mercator";
import { googleMapsPlaceUrl } from "../utils/liveRoute";
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
 * The list lives *inside* the map panel, because the two are one thought —
 * "these places, there". That makes the panel a room with furniture in it, so
 * the fit has to know which part of the map is still visible: the pins are
 * zoomed into what the list leaves uncovered, never slide under it, and keep a
 * few pixels of air at every edge they can reach.
 *
 * Nothing here is stored in the site document. The places are fetched from
 * Wikipedia when the page opens, because a place worth visiting is not a thing
 * anybody should have to retype into a dashboard.
 */

/** Distance between a pin and its bubble, in pixels. */
const BUBBLE_OFFSET = 16;
/** The bubble's own width (w-62 = 15.5rem). Used to keep it clear of the list. */
const BUBBLE_WIDTH = 248;
/** Roughly how tall a bubble gets; enough to know if there is room for one. */
const BUBBLE_HEIGHT = 246;
/** Air between a pin's coordinate and the nearest uncovered edge. */
const PIN_PAD_X = 26;
const PIN_PAD_Y = 46;
/** Pixels of map the panel keeps clear on each side. */
type Insets = { top: number; right: number; bottom: number; left: number };
/** Before the panel is measured: a little air on every side. */
const DEFAULT_INSETS: Insets = { top: 34, right: 34, bottom: 54, left: 34 };

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
  // Ten kilometres is the range this page is built for: close enough to be a
  // detour, far enough that a small town still has something in it.
  const radiusKm = Math.max(1, Math.min(10, Math.round(settings?.radiusKm ?? 10)));
  const count = Math.max(5, Math.min(10, Math.round(settings?.count ?? 8)));
  const { places, loading, error, reload } = useNearbyPlaces({
    lat: location.lat,
    lng: location.lng,
    radiusKm,
    count,
  });

  const [selected, setSelected] = useState<number | null>(null);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [layout, setLayout] = useState({
    width: 900,
    height: 520,
    insets: DEFAULT_INSETS,
  });

  // The pins are laid over the tiles, so the panel is measured rather than
  // assumed — and so is the list, because whatever the list covers is not map
  // as far as the pins are concerned.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const measure = () => {
      const rect = host.getBoundingClientRect();
      const width = host.clientWidth;
      const height = host.clientHeight;
      if (!width || !height) return;

      const panel = panelRef.current?.getBoundingClientRect();
      let insets: Insets = DEFAULT_INSETS;
      if (panel && panel.width > 0 && panel.height > 0) {
        const gap = 20;
        const isBottomSheet = panel.top - rect.top > rect.height * 0.3;
        insets = isBottomSheet
          ? // The sheet and the credit above it.
            { ...DEFAULT_INSETS, bottom: Math.round(rect.bottom - panel.top) + gap + 28 }
          : // The sidebar and the gap between it and the pins.
            { ...DEFAULT_INSETS, right: Math.round(rect.right - panel.left) + gap };
      }
      setLayout({ width, height, insets });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(host);
    if (panelRef.current) observer.observe(panelRef.current);
    return () => observer.disconnect();
  }, []);

  const { width, height, insets } = layout;

  // Every place plus the current position, fitted into the part of the map
  // the list does not cover.
  const points = useMemo(
    () => [
      { lat: location.lat, lng: location.lng },
      ...places.map((p) => ({ lat: p.lat, lng: p.lng })),
    ],
    [location.lat, location.lng, places],
  );
  const view = useMemo(
    () => fitViewInset(points, width, height, insets, { padX: PIN_PAD_X, padY: PIN_PAD_Y }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [points, width, height, insets.top, insets.right, insets.bottom, insets.left],
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

  // Where the bubble goes: beside its pin, never over the list and never off
  // an edge. Above the pin when there is room, below it when there is not.
  const bubble = useMemo(() => {
    if (!selectedPlace) return null;
    const point = projector.toXY({ lat: selectedPlace.lat, lng: selectedPlace.lng });
    const px = (point.x / 100) * width;
    const py = (point.y / 100) * height;
    const minX = insets.left + BUBBLE_WIDTH / 2 + 8;
    const maxX = width - insets.right - BUBBLE_WIDTH / 2 - 8;
    const left = Math.min(Math.max(px, Math.min(minX, maxX)), Math.max(minX, maxX));
    const roomAbove = py - insets.top - BUBBLE_OFFSET;
    const roomBelow = height - insets.bottom - py - BUBBLE_OFFSET;
    const above = roomAbove > BUBBLE_HEIGHT || roomAbove > roomBelow;
    return { left, top: py, above };
  }, [selectedPlace, projector, width, height, insets]);

  const mapsUrlFor = (place: NearbyPlace) =>
    googleMapsPlaceUrl({ lat: place.lat, lng: place.lng });

  const select = (index: number) => setSelected(selected === index ? null : index);

  const panelBody = (
    <>
      <div className="flex items-center justify-between gap-2 border-b border-white/[0.07] px-3.5 py-2.5">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-500">
            Within {radiusKm} km
          </p>
          <p className="font-display text-sm font-semibold text-white">
            {loading ? "Searching…" : `${places.length} places`}
          </p>
        </div>
        <button
          type="button"
          onClick={reload}
          className="inline-flex items-center gap-1.5 rounded-full border border-white/15 px-3 py-1.5 text-[11px] font-semibold text-zinc-300 transition-colors hover:border-white/30 hover:text-white"
        >
          <RefreshCcw className={cn("h-3 w-3", loading && "animate-spin")} />
          Refresh
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-2">
        {loading && !places.length && (
          <ul className="flex flex-col gap-1">
            {Array.from({ length: 6 }).map((_, i) => (
              <li key={i} className="flex gap-3 rounded-xl p-2">
                <span className="h-14 w-16 shrink-0 animate-pulse rounded-lg bg-white/[0.06]" />
                <span className="flex-1 space-y-1.5 py-0.5">
                  <span className="block h-3 w-2/3 animate-pulse rounded bg-white/[0.06]" />
                  <span className="block h-2.5 w-1/3 animate-pulse rounded bg-white/[0.05]" />
                  <span className="block h-2.5 w-full animate-pulse rounded bg-white/[0.04]" />
                </span>
              </li>
            ))}
          </ul>
        )}

        {!loading && error && (
          <div className="rounded-xl border border-amber-400/25 bg-amber-400/[0.07] p-3 text-[11px] leading-relaxed text-amber-200">
            <p>{error}</p>
            <button
              type="button"
              onClick={reload}
              className="mt-2.5 rounded-full border border-amber-300/40 px-3 py-1 text-[11px] font-semibold text-amber-100 transition-colors hover:bg-amber-300/10"
            >
              Try again
            </button>
          </div>
        )}

        {!loading && !error && !places.length && (
          <div className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-3 text-[11px] leading-relaxed text-zinc-400">
            <p className="font-display text-sm font-semibold text-white">
              Nothing geotagged within {radiusKm} km
            </p>
            <p className="mt-1">
              Wikipedia has no articles pinned this close to {location.name}.
            </p>
          </div>
        )}

        {places.length > 0 && (
          <ul className="flex flex-col gap-1">
            {places.map((place, index) => {
              const active = selected === index;
              const mapsUrl = mapsUrlFor(place);
              return (
                <li key={place.pageid}>
                  <div
                    className={cn(
                      "group flex items-start gap-2.5 rounded-xl p-2 transition-colors",
                      active ? "bg-saffron-400/[0.12]" : "hover:bg-white/[0.05]",
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => select(index)}
                      aria-pressed={active}
                      aria-label={`Show ${place.title} on the map`}
                      className="relative h-14 w-16 shrink-0 overflow-hidden rounded-lg"
                    >
                      <PlaceThumb
                        place={place}
                        className={cn(
                          "h-full w-full transition-transform duration-500 group-hover:scale-105",
                          active && "scale-105",
                        )}
                        sizes="64px"
                      />
                      <span className="shrink-0 aspect-square absolute left-1 top-1 grid h-4.5 w-4.5 min-h-[18px] min-w-[18px] place-items-center rounded-full bg-ink-950/85 text-[9px] font-bold text-white">
                        {index + 1}
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => select(index)}
                      className="min-w-0 flex-1 text-left"
                    >
                      <span className="flex items-baseline justify-between gap-2">
                        <span className="truncate font-display text-[13px] font-semibold text-white">
                          {place.title}
                        </span>
                        <span className="shrink-0 font-mono text-[10px] text-saffron-300">
                          {place.distanceKm.toFixed(1)} km
                        </span>
                      </span>
                      {place.extract && (
                        <span className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-zinc-400">
                          {place.extract}
                        </span>
                      )}
                    </button>
                    <a
                      href={mapsUrl}
                      {...externalLinkProps(mapsUrl)}
                      aria-label={`Open ${place.title} in Google Maps`}
                      title="Open in Google Maps"
                      className="shrink-0 rounded-lg border border-white/10 p-1.5 text-zinc-400 transition-colors hover:border-white/25 hover:text-white"
                    >
                      <MapPin className="h-3.5 w-3.5" />
                    </a>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <p className="border-t border-white/[0.07] px-3.5 py-2 text-[9.5px] leading-relaxed text-zinc-500">
        Places &amp; photos: Wikipedia · Wikimedia Commons (CC BY-SA)
      </p>
    </>
  );

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

      <main className="mx-auto flex w-full max-w-7xl flex-1 flex-col px-5 pb-10 pt-6 sm:px-8">
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
        </div>

        {/* ---------- Map + the list that lives on it ---------- */}
        <div
          ref={hostRef}
          className="map-paper relative mt-5 h-[58svh] max-h-[760px] min-h-[360px] overflow-hidden rounded-[2rem] border border-white/10 bg-ink-900 shadow-2xl shadow-black/50 sm:h-[70vh] sm:min-h-[540px]"
        >
          <VectorBasemap
            view={view}
            width={width}
            height={height}
            className="absolute inset-0"
            attributionClassName="live-map-attribution pointer-events-none absolute bottom-[calc(46%+1.5rem)] left-3 z-20 text-[9px] lg:bottom-3"
          />

          {/* Where PB is: the same gold pin the live map uses, kept on top. */}
          <div
            className="pointer-events-none absolute z-20 -translate-x-1/2 -translate-y-1/2"
            style={{ left: `${here.x}%`, top: `${here.y}%` }}
          >
            <span
              className={cn(
                "shrink-0 aspect-square relative grid h-5 w-5 place-items-center rounded-full border-2 border-white shadow-lg ring-1 ring-black/50",
                status === "live" ? "bg-saffron-400 shadow-saffron-400/50" : "bg-zinc-500 shadow-zinc-500/50",
              )}
            >
              {status === "live" && (
                <span className="absolute inset-0 rounded-full bg-saffron-400/40 animate-radar" aria-hidden />
              )}
              <span className="shrink-0 aspect-square h-1.5 w-1.5 rounded-full bg-white" />
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
                onClick={() => select(index)}
                aria-label={`${place.title}, ${place.distanceKm.toFixed(1)} kilometres away`}
                aria-pressed={active}
                className={cn(
                  "shrink-0 aspect-square group absolute z-10 grid h-7 w-7 -translate-x-1/2 -translate-y-full place-items-center rounded-full border-2 border-white text-[11px] font-bold shadow-lg transition-transform duration-200 hover:scale-110",
                  active ? "bg-saffron-400 text-ink-950" : "bg-ink-950/85 text-white hover:bg-ink-800",
                )}
                style={{ left: `${point.x}%`, top: `${point.y}%` }}
              >
                {index + 1}
              </button>
            );
          })}

          {/* The bubble: beside its pin, above or below depending on the room,
              and slid inwards rather than allowed under the list. */}
          {selectedPlace && bubble && (
            <div
              role="dialog"
              aria-label={selectedPlace.title}
              className="absolute z-30 w-[15.5rem] overflow-hidden rounded-2xl border border-white/10 bg-ink-950/95 shadow-2xl shadow-black/60 backdrop-blur-xl"
              style={{
                left: `${bubble.left}px`,
                top: `${bubble.top}px`,
                transform: `translate(-50%, ${
                  bubble.above ? `calc(-100% - ${BUBBLE_OFFSET}px)` : `${BUBBLE_OFFSET}px`
                })`,
              }}
            >
              <div className="relative">
                <PlaceThumb place={selectedPlace} className="h-32 w-full" sizes="15.5rem" />
                <button
                  type="button"
                  onClick={() => setSelected(null)}
                  aria-label="Close"
                  className="shrink-0 aspect-square absolute right-2 top-2 grid h-6 w-6 place-items-center rounded-full bg-ink-950/80 text-white transition-colors hover:bg-ink-950"
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
                  href={mapsUrlFor(selectedPlace)}
                  {...externalLinkProps(mapsUrlFor(selectedPlace))}
                  className="mt-3 inline-flex w-full items-center justify-center gap-1.5 rounded-full bg-white px-3 py-2 text-[11px] font-semibold text-ink-950 transition-colors hover:bg-saffron-300"
                >
                  <Navigation className="h-3 w-3" />
                  Open in Google Maps
                </a>
                <a
                  href={selectedPlace.wikiUrl}
                  {...externalLinkProps(selectedPlace.wikiUrl)}
                  className="mt-2 inline-flex w-full items-center justify-center gap-1 text-[10px] font-semibold text-zinc-400 transition-colors hover:text-white"
                >
                  Read on Wikipedia
                  <ArrowUpRight className="h-3 w-3" />
                </a>
              </div>
            </div>
          )}

          {/* The list, on the map: a sidebar where there is width for one, a
              sheet along the bottom where there is not. */}
          <div
            ref={panelRef}
            className="absolute inset-x-3 bottom-3 z-20 flex h-[46%] flex-col overflow-hidden rounded-2xl border border-white/10 bg-ink-950/90 shadow-2xl shadow-black/60 backdrop-blur-xl lg:inset-x-auto lg:bottom-4 lg:right-4 lg:top-4 lg:h-auto lg:w-[350px] xl:w-[380px]"
          >
            {panelBody}
          </div>
        </div>

        <p className="mt-5 text-[11px] leading-relaxed text-zinc-500">
          Top places within {radiusKm} km of {location.name}, fetched live from{" "}
          <a
            href="https://www.wikipedia.org"
            {...externalLinkProps("https://www.wikipedia.org")}
            className="underline decoration-dotted underline-offset-2 hover:text-zinc-300"
          >
            Wikipedia
          </a>{" "}
          with photos from{" "}
          <a
            href="https://commons.wikimedia.org"
            {...externalLinkProps("https://commons.wikimedia.org")}
            className="underline decoration-dotted underline-offset-2 hover:text-zinc-300"
          >
            Wikimedia Commons
          </a>{" "}
          (CC BY-SA). Maps © OpenStreetMap contributors.
        </p>
      </main>
    </div>
  );
}
