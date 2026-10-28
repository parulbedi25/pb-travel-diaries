import {
  Cloud,
  CloudDrizzle,
  CloudFog,
  CloudLightning,
  CloudRain,
  CloudSnow,
  CloudSun,
  Sun,
  Wind,
  type LucideIcon,
} from "lucide-react";
import { cn } from "../utils/cn";
import type { StopWeather, WeatherKind } from "../utils/weather";

/**
 * One checkpoint's weather, as a picture rather than a sentence.
 *
 * A rider glancing at the route wants to know which pass is raining, not to
 * read a forecast, so each kind of weather gets a single icon and, beside it,
 * the temperature in whole degrees. The code-to-icon table is here and
 * nowhere else, so every bad weather on the site looks the same.
 */
const ICONS: Record<WeatherKind, LucideIcon> = {
  clear: Sun,
  partly: CloudSun,
  cloudy: Cloud,
  fog: CloudFog,
  drizzle: CloudDrizzle,
  rain: CloudRain,
  snow: CloudSnow,
  thunder: CloudLightning,
  wind: Wind,
};

/** Weather that deserves a colour of its own: rain and worse. */
const TONE: Partial<Record<WeatherKind, string>> = {
  rain: "text-sky-300",
  drizzle: "text-sky-300",
  snow: "text-sky-200",
  thunder: "text-amber-300",
  fog: "text-zinc-300",
};

export function WeatherBadge({
  conditions,
  compact = false,
  showTemp = true,
  className,
}: {
  conditions?: StopWeather | null;
  /** Icon and degrees only — for a checkpoint dot on the map. */
  compact?: boolean;
  /** Off on a crowded route, where the degrees would run into each other. */
  showTemp?: boolean;
  className?: string;
}) {
  if (!conditions) return null;
  const Icon = ICONS[conditions.kind] ?? Cloud;
  const tone = TONE[conditions.kind] ?? "text-saffron-300";
  const degrees = conditions.tempC === null ? null : `${conditions.tempC}°`;

  if (compact) {
    return (
      <span
        className={cn(
          "flex items-center gap-0.5 rounded-full border border-white/15 bg-ink-950/85 px-1.5 py-0.5 shadow-md shadow-black/40 backdrop-blur-md",
          className,
        )}
        title={degrees ? `${conditions.label} · ${degrees}C` : conditions.label}
        aria-label={degrees ? `${conditions.label}, ${degrees} Celsius` : conditions.label}
      >
        <Icon className={cn("h-3 w-3", tone)} aria-hidden="true" />
        {degrees && showTemp && (
          <span className="font-mono text-[9px] font-bold leading-none text-zinc-200">{degrees}</span>
        )}
      </span>
    );
  }

  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.05] px-2.5 py-1 text-[10px] font-semibold text-zinc-300",
        className,
      )}
      title={conditions.label}
    >
      <Icon className={cn("h-3.5 w-3.5", tone)} aria-hidden="true" />
      {degrees ?? conditions.label}
      {degrees && <span className="sr-only">{conditions.label}</span>}
    </span>
  );
}

export default WeatherBadge;
