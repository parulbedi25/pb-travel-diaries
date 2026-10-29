/**
 * One saved place, on its own page.
 *
 * A place kept in the member's garage is a name, an address and a coordinate.
 * This page gives the coordinate the room it needs: the map opens on the place
 * itself instead of on a whole ride, with one pointer standing on it, and the
 * member can come straight back to the garage.
 *
 * The page reads the place from this browser, where the garage saved it (see
 * `memberPlaces`), so it opens for nobody else. Its theme is the member's own,
 * like the garage that opened it.
 */

import { ArrowLeft, ExternalLink, MapPin } from "lucide-react";
import RideMap from "./RideMap";
import { cn } from "../utils/cn";
import { useSite } from "../store/siteContent";
import { findSavedPlaceAnywhere, placeStops } from "./memberPlaces";
import { memberThemeClass, memberThemeStyle, useMemberTheme } from "./memberTheme";

export default function MemberPlacePage({ placeId }: { placeId: string }) {
  const { account, content, theme: siteTheme } = useSite();
  const member = useMemberTheme(account?.id ?? null, siteTheme === "light" ? "light" : "dark");
  const place = findSavedPlaceAnywhere(placeId);

  return (
    <div
      className={cn("min-h-screen bg-ink-950 pb-20 text-white", memberThemeClass(member.theme))}
      style={memberThemeStyle(content.themeColors, member.theme)}
    >
      <header className="border-b border-white/[0.07] bg-ink-950/80 backdrop-blur">
        <div className="mx-auto flex max-w-4xl flex-wrap items-center gap-3 px-5 py-4">
          <a
            href="#/ride"
            className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-white/[0.06] text-zinc-400 transition-colors hover:bg-white/[0.12] hover:text-white"
            aria-label="Back to your garage"
          >
            <ArrowLeft className="h-4 w-4" />
          </a>
          <div className="min-w-0">
            <h1 className="truncate font-display text-lg font-semibold leading-tight">
              {place ? place.name : "Place not found"}
            </h1>
            <p className="text-[11px] text-zinc-500">One place, kept in your garage</p>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-5 py-6">
        {place ? (
          <>
            <RideMap
              stops={placeStops(place)}
              height={460}
              themeOverride={member.theme}
              className="shadow-2xl shadow-black/40"
            />

            <div className="mt-4 grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
              <div className="rounded-3xl glass p-5">
                <p className="flex items-start gap-2 text-sm font-medium text-white">
                  <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-saffron-300" />
                  <span className="min-w-0">{place.name}</span>
                </p>
                {place.address && (
                  <p className="mt-1 pl-6 text-[12px] leading-relaxed text-zinc-400">{place.address}</p>
                )}
                <p className="mt-3 pl-6 font-mono text-[11px] text-zinc-500">
                  {place.lat.toFixed(5)}, {place.lng.toFixed(5)}
                </p>
              </div>

              <a
                href={`https://www.openstreetmap.org/?mlat=${place.lat}&mlon=${place.lng}#map=13/${place.lat}/${place.lng}`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-white/10 bg-white/[0.05] px-4 py-2.5 text-xs font-semibold text-zinc-200 transition-colors hover:border-white/25 hover:text-white"
              >
                <ExternalLink className="h-3.5 w-3.5" /> Open in OpenStreetMap
              </a>
            </div>

            <a
              href="#/ride"
              className="mt-5 inline-flex items-center gap-1.5 text-xs text-zinc-500 transition-colors hover:text-white"
            >
              <ArrowLeft className="h-3.5 w-3.5" /> Back to your garage
            </a>
          </>
        ) : (
          <div className="rounded-3xl border border-dashed border-white/12 px-5 py-10 text-center">
            <p className="font-display text-sm font-semibold text-white">
              This place is not on this browser
            </p>
            <p className="mx-auto mt-2 max-w-md text-[12px] leading-relaxed text-zinc-500">
              Your saved places travel with your garage on the device where you saved them, so a
              place opened here has to have been saved here. Find it again from the map and it will
              be listed as before.
            </p>
            <a
              href="#/ride"
              className="mt-5 inline-flex items-center gap-1.5 rounded-xl bg-saffron-400 px-4 py-2.5 text-xs font-semibold text-on-gold transition-all hover:brightness-110 active:scale-95"
            >
              <ArrowLeft className="h-3.5 w-3.5" /> Back to your garage
            </a>
          </div>
        )}
      </main>
    </div>
  );
}
