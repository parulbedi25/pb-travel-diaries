import { resolveBrand, useSite, type BrandSettings } from "../store/siteContent";
import { cn } from "../utils/cn";

// Only editor previews pass a draft; public instances always use saved branding.
export default function BrandLogo({
  size = "md",
  className,
  brand,
}: {
  size?: "sm" | "md";
  className?: string;
  brand?: Partial<BrandSettings>;
}) {
  const { content } = useSite();
  const b = resolveBrand(brand ?? content.brand);

  const showLogo = b.showLogo;
  const showText = b.showText;
  const baseHeight = Number.isFinite(b.logoHeight) ? Math.min(72, Math.max(20, b.logoHeight)) : 36;
  const height = size === "sm" ? Math.max(18, Math.round(baseHeight * 0.8)) : baseHeight;
  const plain = Boolean(b.plainLogo);
  const words = [
    { text: b.textPrimary, color: b.colorPrimary },
    { text: b.textSecondary, color: b.colorSecondary },
    { text: b.textTertiary, color: b.colorTertiary },
  ];
  const label = words.map((word) => word.text).filter(Boolean).join(" ") || "PB from PB";

  if (!showLogo && !showText) {
    return (
      <span
        className={cn("font-display text-[15px] font-semibold", className)}
        style={{ color: b.colorPrimary }}
      >
        PB from PB
      </span>
    );
  }

  return (
    <span className={cn("inline-flex max-w-full items-center gap-2.5", className)}>
      {showLogo && b.logo && (
        <span
          className={cn(
            "relative grid shrink-0 place-items-center overflow-hidden",
            !plain &&
              "rounded-xl bg-gradient-to-br from-saffron-400 via-flame-500 to-orchid-500 shadow-lg shadow-flame-500/25 transition-transform duration-300 group-hover:scale-105 group-hover:rotate-3"
          )}
          style={{
            height,
            width: plain ? undefined : height,
            maxWidth: plain ? Math.min(180, height * 4) : height,
            background: !plain && b.iconBg ? b.iconBg : undefined,
          }}
        >
          <img
            src={b.logo}
            alt={showText ? "" : label}
            className="h-full max-w-full w-auto object-contain"
          />
        </span>
      )}
      {showLogo && !b.logo && (
        <span
          className="relative grid shrink-0 place-items-center overflow-hidden rounded-xl bg-gradient-to-br from-saffron-400 via-flame-500 to-orchid-500 font-display text-sm font-bold text-[#171513] shadow-lg shadow-flame-500/25"
          style={{ height, width: height, background: b.iconBg || undefined }}
        >
          PB
          <span className="absolute inset-0 bg-gradient-to-t from-black/20 to-transparent" />
        </span>
      )}
      {showText && (
        <span className="inline-flex min-w-0 flex-wrap items-baseline gap-x-1 font-display text-[15px] font-semibold tracking-tight">
          {words.map((word, index) => word.text && (
            <span key={index} className="break-words [overflow-wrap:anywhere]" style={{ color: word.color }}>
              {word.text}
            </span>
          ))}
        </span>
      )}
    </span>
  );
}
