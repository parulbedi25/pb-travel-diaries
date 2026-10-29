import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowUpRight,
  BedDouble,
  ChevronDown,
  Fuel,
  HeartPulse,
  ImageOff,
  Landmark,
  Loader2,
  MapPin,
  Navigation,
  RefreshCcw,
  UtensilsCrossed,
  Wrench,
  X,
} from "lucide-react";
import { useSiteLiveLocation } from "../hooks/useSiteLiveLocation";
import { useNearbyPlaces, type NearbyPlace } from "../hooks/useNearbyPlaces";
import {
  useNearbyAmenities,
  type Amenity,
} from "../hooks/useNearbyAmenities";
import VectorBasemap from "./VectorBasemap";
import ThemeToggle from "./ThemeToggle";
import { Logo } from "./Navbar";
import { fitViewInset, makeMercatorProjector } from "../utils/mercator";
import { googleMapsPlaceUrl } from "../utils/liveRoute";
import { externalLinkProps } from "./ui/SocialIcons";
import { cn } from "../utils/cn";

/**
 * "Nearby places" — what there is around a stop on the live route.
 *
 * The tracker says where the ride is going; this page answers the three
 * questions a rider actually asks when they stop:
 *
 *  1. **Places to visit** — what is worth a detour, from Wikipedia's geotagged
 *     articles: notable by an editor's judgement rather than a paid listing.
 *  2. **Stays** and **Food** — a bed or a meal, from Google and OpenStreetMap:
 *     hotels but also lodges, homestays and motels; restaurants but also
 *     dhabas, cafes and fast-food counters, with Google's rating on the row.
 *  3. **Stays** — a bed, from OpenStreetMap, with guest houses and
 *     hostels shown before hotels, because this is a motorcycle ride and not a
 *     package holiday.
 *  3. **Fuel · Service · Hospital** — petrol, Royal Enfield workshops and
 *     motorcycle shops, and hospitals or clinics, all from the same map.
 *
 * Everything is asked around a **chosen stop**: the dropdown holds every name
 * in the live tracker, so the page can answer for Nangal before the ride starts
 * and for Leh three days in, without waiting for a GPS fix.
 *
 * The list lives *inside* the map panel, because the two are one thought —
 * "these places, there". That makes the panel a room with furniture in it, so
 * the fit has to know which part of the map is still visible: the pins are
 * zoomed into what the list leaves uncovered, never slide under it, and keep a
 * few pixels of air at every edge they can reach.
 *
 * Nothing here is stored in the site document. The places are fetched when the
 * page opens, because a place worth visiting is not a thing anybody should have
 * to retype into a dashboard.
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

type TabId = "places" | "stays" | "food" | "essentials";

/** What each tab is called when the search is handed to Google instead. */
const GOOGLE_TERMS: Record<TabId, string> = {
  places: "places to visit",
  stays: "hotels lodges homestays guest houses motels",
  food: "restaurants dhaba cafes",
  essentials: "petrol pump hospital automobile service centre motorcycle workshop Royal Enfield",
};

/** The source each tab's list came from, in words a rider reads once. */
const SOURCE_COPY: Record<string, string> = {
  google: "Google",
  overpass: "OpenStreetMap (Overpass)",
  photon: "OpenStreetMap (Photon)",
  nominatim: "OpenStreetMap (Nominatim)",
  none: "no source answered",
};

/**
 * The tabs, in the order a rider stops: where to go, where to sleep, what the
 * bike needs. Each one owns the map while it is open — its own pins, its own
 * distances, its own fit — so the left half always shows the list on the right.
 */
const TABS: { id: TabId; label: string; short: string; icon: typeof Landmark }[] = [
  { id: "places", label: "Places to visit", short: "Places", icon: Landmark },
  { id: "stays", label: "Hotels · lodges · homestays", short: "Stays", icon: BedDouble },
  { id: "food", label: "Restaurants · dhabas · cafes", short: "Food", icon: UtensilsCrossed },
  { id: "essentials", label: "Fuel · hospital · service centre", short: "Service", icon: Wrench },
];

/** One row of the list, whichever tab it came from. */
interface PinItem {
  key: string;
  title: string;
  lat: number;
  lng: number;
  distanceKm: number;
  /** The line under the title: a Wikipedia extract, or what the place is. */
  detail?: string;
  /** A free photo, for the Wikipedia places. */
  image?: string;
  /** The article, when there is one. */
  wikiUrl?: string;
  /** A chip beside the title: "Royal Enfield", "budget", "4.6★". */
  badge?: string;
  kind: "place" | "stay" | "eat" | "fuel" | "hospital" | "service";
}

const PLACE_TONE: Record<PinItem["kind"], { pin: string; chip: string; icon: typeof Landmark }> = {
  place: { pin: "bg-ink-950/85 text-white", chip: "bg-white/[0.06] text-zinc-300", icon: Landmark },
  stay: { pin: "bg-emerald-500 text-ink-950", chip: "bg-emerald-500/15 text-emerald-200", icon: BedDouble },
  eat: { pin: "bg-rose-400 text-ink-950", chip: "bg-rose-400/15 text-rose-200", icon: UtensilsCrossed },
  fuel: { pin: "bg-amber-400 text-ink-950", chip: "bg-amber-400/15 text-amber-200", icon: Fuel },
  hospital: { pin: "bg-red-500 text-white", chip: "bg-red-500/15 text-red-200", icon: HeartPulse },
  service: { pin: "bg-sky-400 text-ink-950", chip: "bg-sky-400/15 text-sky-200", icon: Wrench },
};

function PlaceThumb({ place, className, sizes }: { place: NearbyPlace; className?: string; sizes?: string }) {
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

/** The little round icon a row and its pin share, for everything but places. */
function KindBadge({ kind, className }: { kind: PinItem["kind"]; className?: string }) {
  const Icon = PLACE_TONE[kind].icon;
  return <Icon className={className} aria-hidden />;
}

function placesToItems(places: readonly NearbyPlace[]): PinItem[] {
  return places.map((place) => ({
    key: `wiki-${place.pageid}`,
    title: place.title,
    lat: place.lat,
    lng: place.lng,
    distanceKm: place.distanceKm,
    detail: place.extract,
    image: place.image,
    wikiUrl: place.wikiUrl,
    kind: "place",
  }));
}

function amenitiesToItems(items: readonly Amenity[]): PinItem[] {
  return items.map((item) => ({
    key: item.id,
    title: item.title,
    lat: item.lat,
    lng: item.lng,
    distanceKm: item.distanceKm,
    detail: item.opening ? `${item.detail} · ${item.opening}` : item.detail,
    // The chip a rider scans for: the marque on a workshop, the word on a
    // cheap bed, and the rating on a place to eat that people rate well.
    badge: item.royalEnfield
      ? "Royal Enfield"
      : item.budget
        ? "budget"
        : item.kind === "eat" && (item.rating ?? 0) >= 4
          ? `${item.rating}★`
          : undefined,
    kind: item.kind,
  }));
}

export default function NearbyPlacesPage() {
  const { location, status, route } = useSiteLiveLocation();
  const settings = route.nearby;
  // Ten kilometres is the range this page is built for: close enough to be a
  // detour, far enough that a small town still has something in it.
  const radiusKm = Math.max(1, Math.min(10, Math.round(settings?.radiusKm ?? 10)));
  const count = Math.max(5, Math.min(10, Math.round(settings?.count ?? 8)));

  const stops = useMemo(() => route.stops ?? [], [route.stops]);

  /**
   * Every name in the live tracker, plus wherever PB actually is.
   *
   * The dropdown is the route itself, in order, so the page can be asked about
   * a stop that is still ahead — which is when a rider most wants to know what
   * is there.
   */
  const origins = useMemo(
    () => [
      {
        key: "live",
        name: location.name,
        state: location.state,
        lat: location.lat,
        lng: location.lng,
        live: true,
      },
      ...stops.map((stop, index) => ({
        key: `stop-${index}`,
        name: stop.name,
        state: stop.state,
        lat: stop.lat,
        lng: stop.lng,
        live: false,
      })),
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [stops, location.name, location.state, location.lat, location.lng],
  );

  const [originKey, setOriginKey] = useState("live");
  const origin = origins.find((entry) => entry.key === originKey) ?? origins[0];

  const [tab, setTab] = useState<TabId>("places");
  const [selected, setSelected] = useState<string | null>(null);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [layout, setLayout] = useState({ width: 900, height: 520, insets: DEFAULT_INSETS });

  // The three questions. Stays and essentials are asked the moment the page
  // knows where it is, together with the places, so a tab is ready by the time
  // it is clicked rather than starting its search then. Both are asked at once
  // — the server answers each from whichever source replies first.
  const placesQuery = useNearbyPlaces({
    lat: origin.lat,
    lng: origin.lng,
    radiusKm,
    count,
  });
  const stays = useNearbyAmenities({
    lat: origin.lat,
    lng: origin.lng,
    place: origin.name,
    group: "stays",
  });
  const food = useNearbyAmenities({
    lat: origin.lat,
    lng: origin.lng,
    place: origin.name,
    group: "food",
  });
  const essentials = useNearbyAmenities({
    lat: origin.lat,
    lng: origin.lng,
    place: origin.name,
    group: "essentials",
  });

  const items = useMemo<PinItem[]>(() => {
    if (tab === "places") return placesToItems(placesQuery.places);
    if (tab === "stays") return amenitiesToItems(stays.items);
    if (tab === "food") return amenitiesToItems(food.items);
    return amenitiesToItems(essentials.items);
  }, [tab, placesQuery.places, stays.items, food.items, essentials.items]);

  const loading = tab === "places" ? placesQuery.loading : tab === "stays" ? stays.loading : tab === "food" ? food.loading : essentials.loading;
  const error = tab === "places" ? placesQuery.error : tab === "stays" ? stays.error : tab === "food" ? food.error : essentials.error;
  const reloadActive = tab === "places" ? placesQuery.reload : tab === "stays" ? stays.reload : tab === "food" ? food.reload : essentials.reload;
  const loadingSource =
    tab === "stays" ? stays.loadingSource : tab === "food" ? food.loadingSource : tab === "essentials" ? essentials.loadingSource : "Wikipedia";
  /** Which service answered each tab, for the line under the list. */
  const source: Record<TabId, string> = {
    places: "wikipedia",
    stays: stays.source,
    food: food.source,
    essentials: essentials.source,
  };
  /**
   * What the empty state is allowed to say.
   *
   * When every source comes back empty that is a real answer and it is said
   * plainly. When the sources were busy the order they were tried in is
   * printed, so "nothing here" never stands in for "nothing answered".
   */
  const active = tab === "stays" ? stays : tab === "food" ? food : essentials;
  const activeTried = tab === "places" ? [] : active.tried;
  const googleSearchUrl = (which: TabId) =>
    `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
      `${GOOGLE_TERMS[which]} near ${origin.name}`,
    )}`;

  /**
   * What the list covers, in the rider's words.
   *
   * Not a radius: the whole town, and nothing outside it. If the town's
   * boundary cannot be found there is no list to caption, and the line says
   * that instead of inventing a circle.
   */
  const activeArea = tab === "stays" ? stays.area : tab === "food" ? food.area : tab === "essentials" ? essentials.area : null;
  const reason = tab === "places" ? "" : active.reason;
  const coverage =
    tab === "places"
      ? `Within ${radiusKm} km of ${origin.name}`
      : reason === "no-area"
        ? `No boundary found for ${origin.name}`
        : activeArea?.city
          ? `All of ${activeArea.label}`
          : `All of ${origin.name}`;

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

  // Everything the active tab found, plus the stop it was all measured from,
  // fitted into the part of the map the list does not cover.
  const points = useMemo(
    () => [{ lat: origin.lat, lng: origin.lng }, ...items.map((item) => ({ lat: item.lat, lng: item.lng }))],
    [origin.lat, origin.lng, items],
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
  const originPoint = projector.toXY({ lat: origin.lat, lng: origin.lng });

  const selectedItem = selected ? items.find((item) => item.key === selected) : undefined;

  // Where the bubble goes: beside its pin, never over the list and never off
  // an edge. Above the pin when there is room, below it when there is not.
  const bubble = useMemo(() => {
    if (!selectedItem) return null;
    const point = projector.toXY({ lat: selectedItem.lat, lng: selectedItem.lng });
    const px = (point.x / 100) * width;
    const py = (point.y / 100) * height;
    const minX = insets.left + BUBBLE_WIDTH / 2 + 8;
    const maxX = width - insets.right - BUBBLE_WIDTH / 2 - 8;
    const left = Math.min(Math.max(px, Math.min(minX, maxX)), Math.max(minX, maxX));
    const roomAbove = py - insets.top - BUBBLE_OFFSET;
    const roomBelow = height - insets.bottom - py - BUBBLE_OFFSET;
    const above = roomAbove > BUBBLE_HEIGHT || roomAbove > roomBelow;
    return { left, top: py, above };
  }, [selectedItem, projector, width, height, insets]);

  const mapsUrlFor = (item: PinItem) => googleMapsPlaceUrl({ lat: item.lat, lng: item.lng });
  const select = (key: string) => setSelected(selected === key ? null : key);

  /** Changing what the page is about always starts a clean view. */
  const changeOrigin = (key: string) => {
    setOriginKey(key);
    setSelected(null);
  };
  const changeTab = (id: TabId) => {
    setTab(id);
    setSelected(null);
  };

  const emptyCopy =
    reason === "no-area"
      ? {
          title: `Couldn't find the boundary of ${origin.name}`,
          body: `Every place here is listed town by town, so nothing from the next town can creep in. This stop's boundary could not be looked up just now — reload, or pick another stop from the list above.`,
        }
      : tab === "places"
      ? {
          title: `Nothing geotagged within ${radiusKm} km`,
          body: `Wikipedia has no articles pinned this close to ${origin.name}.`,
        }
      : tab === "stays"
        ? {
            title: `No beds listed in ${activeArea?.city ? activeArea.label : origin.name}`,
            body: `Google and OpenStreetMap have no hotel, lodge, homestay or guest house anywhere in ${
              activeArea?.city ? activeArea.label : origin.name
            }. Try the next town from the list above, or open the search in Google Maps.`,
          }
        : tab === "food"
          ? {
              title: `Nothing to eat listed in ${activeArea?.city ? activeArea.label : origin.name}`,
              body: `Google and OpenStreetMap have no restaurant, dhaba or cafe anywhere in ${
                activeArea?.city ? activeArea.label : origin.name
              }. Try the next town from the list above, or open the search in Google Maps.`,
            }
          : {
            title: `Nothing listed in ${activeArea?.city ? activeArea.label : origin.name}`,
            body: `No fuel, workshop or hospital is listed anywhere in ${
              activeArea?.city ? activeArea.label : origin.name
            }. Try the next town from the list above, or open the search in Google Maps.`,
          };

  const panelBody = (
    <>
      <div className="flex items-center justify-between gap-2 border-b border-white/[0.07] px-3.5 py-2.5">
        <div className="min-w-0">
          <p className="truncate text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-500">
            {coverage}
          </p>
          <p className="font-display text-sm font-semibold text-white">
            {loading ? `Searching ${loadingSource}…` : `${items.length} ${items.length === 1 ? "place" : "places"}`}
          </p>
        </div>
        <button
          type="button"
          onClick={reloadActive}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-white/15 px-3 py-1.5 text-[11px] font-semibold text-zinc-300 transition-colors hover:border-white/30 hover:text-white"
        >
          <RefreshCcw className={cn("h-3 w-3", loading && "animate-spin")} />
          Refresh
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-2">
        {loading && !items.length && (
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
            <div className="mt-2.5 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={reloadActive}
                className="rounded-full border border-amber-300/40 px-3 py-1 text-[11px] font-semibold text-amber-100 transition-colors hover:bg-amber-300/10"
              >
                Try again
              </button>
              {/* The map data being busy is not the rider's problem: hand the
                  same question to Google, which always answers. */}
              <a
                href={googleSearchUrl(tab)}
                {...externalLinkProps(googleSearchUrl(tab))}
                className="inline-flex items-center gap-1 rounded-full bg-white/90 px-3 py-1 text-[11px] font-semibold text-ink-950 transition-colors hover:bg-white"
              >
                Search on Google Maps
                <ArrowUpRight className="h-3 w-3" />
              </a>
            </div>
          </div>
        )}

        {!loading && !error && !items.length && (
          <div className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-3 text-[11px] leading-relaxed text-zinc-400">
            <p className="font-display text-sm font-semibold text-white">{emptyCopy.title}</p>
            <p className="mt-1">{emptyCopy.body}</p>
            <a
              href={googleSearchUrl(tab)}
              {...externalLinkProps(googleSearchUrl(tab))}
              className="mt-2.5 inline-flex items-center gap-1 rounded-full border border-white/20 px-3 py-1 text-[11px] font-semibold text-zinc-200 transition-colors hover:border-white/40 hover:text-white"
            >
              Search on Google Maps
              <ArrowUpRight className="h-3 w-3" />
            </a>
          </div>
        )}

        {items.length > 0 && (
          <ul className="flex flex-col gap-1">
            {items.map((item, index) => {
              const active = selected === item.key;
              const mapsUrl = mapsUrlFor(item);
              const tone = PLACE_TONE[item.kind];
              return (
                <li key={item.key}>
                  <div
                    className={cn(
                      "group flex items-start gap-2.5 rounded-xl p-2 transition-colors",
                      active ? "bg-saffron-400/[0.12]" : "hover:bg-white/[0.05]",
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => select(item.key)}
                      aria-pressed={active}
                      aria-label={`Show ${item.title} on the map`}
                      className="relative h-14 w-16 shrink-0 overflow-hidden rounded-lg"
                    >
                      {item.image ? (
                        <PlaceThumb
                          place={{ image: item.image, title: item.title } as NearbyPlace}
                          className={cn(
                            "h-full w-full transition-transform duration-500 group-hover:scale-105",
                            active && "scale-105",
                          )}
                          sizes="64px"
                        />
                      ) : (
                        <span className={cn("grid h-full w-full place-items-center", tone.chip)}>
                          <KindBadge kind={item.kind} className="h-5 w-5" />
                        </span>
                      )}
                      <span className="shrink-0 aspect-square absolute left-1 top-1 grid h-4.5 w-4.5 min-h-[18px] min-w-[18px] place-items-center rounded-full bg-ink-950/85 text-[9px] font-bold text-white">
                        {index + 1}
                      </span>
                    </button>
                    <button type="button" onClick={() => select(item.key)} className="min-w-0 flex-1 text-left">
                      <span className="flex items-baseline justify-between gap-2">
                        <span className="truncate font-display text-[13px] font-semibold text-white">
                          {item.title}
                        </span>
                        <span className="shrink-0 font-mono text-[10px] text-saffron-300">
                          {item.distanceKm.toFixed(1)} km
                        </span>
                      </span>
                      {item.badge && (
                        <span
                          className={cn(
                            "mt-1 inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.1em]",
                            tone.chip,
                          )}
                        >
                          {item.badge}
                        </span>
                      )}
                      {item.detail && (
                        <span className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-zinc-400">
                          {item.detail}
                        </span>
                      )}
                    </button>
                    <a
                      href={mapsUrl}
                      {...externalLinkProps(mapsUrl)}
                      aria-label={`Open ${item.title} in Google Maps`}
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
        {tab === "places"
          ? "Places & photos: Wikipedia · Wikimedia Commons (CC BY-SA)"
          : source[tab] === "google"
            ? "Results from Google Maps · nearest first"
            : source[tab] && source[tab] !== "none"
              ? `${SOURCE_COPY[source[tab]] ?? "OpenStreetMap"} · © OpenStreetMap contributors (ODbL) · nearest first`
              : `Tried ${activeTried.length ? activeTried.join(" → ") : "every source"}`}
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
            {origin.name.toUpperCase()}
          </span>
          <ThemeToggle className="ml-auto shrink-0" />
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-7xl flex-1 flex-col px-5 pb-10 pt-6 sm:px-8">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="max-w-2xl">
            <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-zinc-500">
              Around {origin.name}
              {origin.state ? `, ${origin.state}` : ""}
            </p>
            <h2 className="mt-2 font-display text-3xl font-semibold tracking-tight text-white sm:text-4xl">
              {settings?.heading?.trim() || "Nearby places"}
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-zinc-400">
              {settings?.intro?.trim() ||
                "Places to visit, beds, fuel and hospitals around any stop on the ride."}
            </p>
          </div>

          {/* Every stop in the live tracker, in order, plus where PB is now. */}
          <label className="relative inline-flex flex-col gap-1.5">
            <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-500">
              Search around
            </span>
            <span className="relative">
              <select
                value={origin.key}
                onChange={(event) => changeOrigin(event.target.value)}
                aria-label="Choose the stop to search around"
                className="w-full min-w-[15rem] appearance-none rounded-xl border border-white/12 bg-white/[0.05] py-2.5 pl-3.5 pr-10 text-sm font-semibold text-white transition-colors hover:border-white/25 focus:border-saffron-400/60 focus:outline-none focus:ring-2 focus:ring-saffron-400/20"
              >
                {origins.map((entry) => (
                  <option key={entry.key} value={entry.key} className="bg-ink-900">
                    {entry.live ? `Where PB is now — ${entry.name}` : entry.name}
                  </option>
                ))}
              </select>
              <ChevronDown
                className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400"
                aria-hidden
              />
            </span>
          </label>
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
            attributionClassName="pointer-events-none absolute bottom-[calc(46%+1.5rem)] left-3 z-20 lg:bottom-3"
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

          {/* The stop being searched around, when it is not where PB is. */}
          {origin.key !== "live" && (
            <div
              className="pointer-events-none absolute z-20 -translate-x-1/2 -translate-y-1/2"
              style={{ left: `${originPoint.x}%`, top: `${originPoint.y}%` }}
            >
              <span className="relative grid h-6 w-6 place-items-center rounded-full border-2 border-saffron-400 bg-ink-950 shadow-lg ring-1 ring-black/50">
                <span className="h-2 w-2 rounded-full bg-saffron-400" />
              </span>
            </div>
          )}

          {/* One pointer per item, numbered to match the list. Colour says what
              it is: saffron places, green beds, amber fuel, red hospitals, blue
              workshops. */}
          {items.map((item, index) => {
            const point = projector.toXY(item);
            const active = selected === item.key;
            const tone = PLACE_TONE[item.kind];
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => select(item.key)}
                aria-label={`${item.title}, ${item.distanceKm.toFixed(1)} kilometres away`}
                aria-pressed={active}
                className={cn(
                  "shrink-0 aspect-square group absolute z-10 grid h-7 w-7 -translate-x-1/2 -translate-y-full place-items-center rounded-full border-2 text-[11px] font-bold shadow-lg transition-transform duration-200 hover:scale-110",
                  active ? "border-saffron-400 bg-saffron-400 text-ink-950" : cn("border-white", tone.pin),
                )}
                style={{ left: `${point.x}%`, top: `${point.y}%` }}
              >
                {index + 1}
              </button>
            );
          })}

          {/* The bubble: beside its pin, above or below depending on the room,
              and slid inwards rather than allowed under the list. */}
          {selectedItem && bubble && (
            <div
              role="dialog"
              aria-label={selectedItem.title}
              className="absolute z-30 w-[15.5rem] overflow-hidden rounded-2xl border border-white/10 bg-ink-950/95 shadow-2xl shadow-black/60 backdrop-blur-xl"
              style={{
                left: `${bubble.left}px`,
                top: `${bubble.top}px`,
                transform: `translate(-50%, ${
                  bubble.above ? `calc(-100% - ${BUBBLE_OFFSET}px)` : `${BUBBLE_OFFSET}px`
                })`,
              }}
            >
              {selectedItem.image ? (
                <div className="relative">
                  <PlaceThumb
                    place={{ image: selectedItem.image, title: selectedItem.title } as NearbyPlace}
                    className="h-32 w-full"
                    sizes="15.5rem"
                  />
                  <button
                    type="button"
                    onClick={() => setSelected(null)}
                    aria-label="Close"
                    className="shrink-0 aspect-square absolute right-2 top-2 grid h-6 w-6 place-items-center rounded-full bg-ink-950/80 text-white transition-colors hover:bg-ink-950"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ) : (
                <div className="flex items-center justify-between gap-2 border-b border-white/[0.07] px-3.5 py-2">
                  <span
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-[10px] font-bold uppercase tracking-[0.1em]",
                      PLACE_TONE[selectedItem.kind].chip,
                    )}
                  >
                    <KindBadge kind={selectedItem.kind} className="h-3 w-3" />
                    {selectedItem.kind === "place" ? "place" : selectedItem.kind}
                  </span>
                  <button
                    type="button"
                    onClick={() => setSelected(null)}
                    aria-label="Close"
                    className="shrink-0 aspect-square grid h-6 w-6 place-items-center rounded-full bg-ink-950/80 text-white transition-colors hover:bg-ink-950"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              )}
              <div className="p-3.5">
                <p className="font-display text-sm font-semibold leading-tight text-white">
                  {selectedItem.title}
                </p>
                <p className="mt-1 font-mono text-[10px] text-saffron-300">
                  {selectedItem.distanceKm.toFixed(1)} km away
                </p>
                {selectedItem.detail && (
                  <p className="mt-1.5 line-clamp-3 text-[11px] leading-relaxed text-zinc-400">
                    {selectedItem.detail}
                  </p>
                )}
                <a
                  href={mapsUrlFor(selectedItem)}
                  {...externalLinkProps(mapsUrlFor(selectedItem))}
                  className="mt-3 inline-flex w-full items-center justify-center gap-1.5 rounded-full bg-white px-3 py-2 text-[11px] font-semibold text-ink-950 transition-colors hover:bg-saffron-300"
                >
                  <Navigation className="h-3 w-3" />
                  Open in Google Maps
                </a>
                {selectedItem.wikiUrl && (
                  <a
                    href={selectedItem.wikiUrl}
                    {...externalLinkProps(selectedItem.wikiUrl)}
                    className="mt-2 inline-flex w-full items-center justify-center gap-1 text-[10px] font-semibold text-zinc-400 transition-colors hover:text-white"
                  >
                    Read on Wikipedia
                    <ArrowUpRight className="h-3 w-3" />
                  </a>
                )}
              </div>
            </div>
          )}

          {/* The list, on the map: a sidebar where there is width for one, a
              sheet along the bottom where there is not. */}
          <div
            ref={panelRef}
            className="absolute inset-x-3 bottom-3 z-20 flex h-[46%] flex-col overflow-hidden rounded-2xl border border-white/10 bg-ink-950/90 shadow-2xl shadow-black/60 backdrop-blur-xl lg:inset-x-auto lg:bottom-4 lg:right-4 lg:top-4 lg:h-auto lg:w-[350px] xl:w-[380px]"
          >
            {/* The tabs: one question at a time, each with its own pins. */}
            <div
              role="tablist"
              aria-label="What to show nearby"
              className="flex shrink-0 gap-1 border-b border-white/[0.07] bg-white/[0.02] p-1.5"
            >
              {TABS.map((entry) => {
                const Icon = entry.icon;
                const active = tab === entry.id;
                // A tab that is still being filled is shown busy and cannot be
                // opened: clicking it would only show a half-built list.
                const asked =
                  entry.id === "stays"
                    ? stays
                    : entry.id === "food"
                      ? food
                      : entry.id === "essentials"
                        ? essentials
                        : null;
                const busy = Boolean(asked?.loading && !asked.settled);
                return (
                  <button
                    key={entry.id}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    aria-controls="nearby-panel"
                    aria-busy={busy}
                    aria-disabled={busy}
                    disabled={busy}
                    onClick={() => changeTab(entry.id)}
                    title={busy ? `${entry.label} — searching…` : entry.label}
                    className={cn(
                      "inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg px-2 py-2 text-[11px] font-semibold transition-colors",
                      active
                        ? "bg-saffron-400 text-on-gold shadow-sm"
                        : "text-zinc-400 hover:bg-white/[0.06] hover:text-white",
                      busy && "cursor-wait opacity-60 hover:bg-transparent",
                    )}
                  >
                    {busy ? (
                      <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" aria-hidden />
                    ) : (
                      <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
                    )}
                    <span className="truncate">{entry.short}</span>
                    {!busy && asked && asked.items.length > 0 && (
                      <span className="shrink-0 rounded-full bg-white/15 px-1.5 text-[9px] font-bold tabular-nums">
                        {asked.items.length}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
            <div id="nearby-panel" role="tabpanel" className="flex min-h-0 flex-1 flex-col">
              {panelBody}
            </div>
          </div>

          {/* The very first ask of an unopened tab is the slow one; say so on
              the map rather than leaving a blank half-panel. */}
          {loading && !items.length && (
            <div className="pointer-events-none absolute left-1/2 top-6 z-20 -translate-x-1/2 rounded-full border border-white/10 bg-ink-950/85 px-3.5 py-1.5 text-[11px] font-semibold text-zinc-300 backdrop-blur">
              <Loader2 className="mr-1.5 inline h-3 w-3 animate-spin" />
              Looking around {origin.name}…
            </div>
          )}
        </div>

        <p className="mt-5 text-[11px] leading-relaxed text-zinc-500">
          Places and photos from{" "}
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
          (CC BY-SA). Beds, fuel, workshops and hospitals from{" "}
          <a
            href="https://www.openstreetmap.org/copyright"
            {...externalLinkProps("https://www.openstreetmap.org/copyright")}
            className="underline decoration-dotted underline-offset-2 hover:text-zinc-300"
          >
            OpenStreetMap
          </a>{" "}
          (ODbL). Maps © OpenStreetMap contributors. Prices and opening hours are not published on the
          map, so a bed is called budget only when the map says it is a guest house or a hostel — check
          before you ride to it.
        </p>
      </main>
    </div>
  );
}
