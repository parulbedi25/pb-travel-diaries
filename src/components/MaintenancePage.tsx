import { Mail, Wrench } from "lucide-react";
import type { MaintenanceData } from "../store/siteContent";
import { useSite } from "../store/siteContent";
import BrandLogo from "./BrandLogo";
import { CountdownDots } from "./CountdownSection";

/**
 * Maintenance mode page. Shown instead of the entire site (no header, no footer)
 * whenever the Maintenance section is enabled. The logo falls back to the
 * website branding configured in Logo & brand.
 */
export default function MaintenancePage({ data }: { data: MaintenanceData }) {
  const { content } = useSite();

  return (
    <div className="relative grid min-h-dvh place-items-center overflow-hidden bg-ink-950 px-5 py-16">
      <div className="pointer-events-none absolute inset-0 bg-grid opacity-50 [mask-image:radial-gradient(ellipse_at_top,black,transparent_72%)]" aria-hidden />
      <div
        className="pointer-events-none absolute left-1/2 top-1/2 h-80 w-[680px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-gradient-to-r from-saffron-500/20 via-flame-500/15 to-orchid-500/20 blur-[130px]"
        aria-hidden
      />

      <div className="relative w-full max-w-xl text-center">
        {/* website logo — override in Maintenance, or the saved brand logo */}
        <div className="flex justify-center">
          <a href="#/" aria-label="PB from PB">
            {data.logo ? (
              <img
                src={data.logo}
                alt="PB from PB"
                className="mx-auto max-h-16 w-auto object-contain"
              />
            ) : (
              <BrandLogo brand={content.brand} />
            )}
          </a>
        </div>

        <div className="mt-9 rounded-[2.5rem] border border-white/10 bg-white/[0.04] p-8 backdrop-blur-xl sm:p-11">
          <span className="inline-flex items-center gap-2 rounded-full border border-amber-400/30 bg-amber-400/10 px-4 py-1.5 text-[11px] font-semibold uppercase tracking-[0.22em] text-amber-300">
            <Wrench className="h-3.5 w-3.5" />
            {data.badge}
          </span>

          <h1 className="mt-6 font-display text-3xl font-semibold leading-[1.08] tracking-tight text-white sm:text-4xl text-balance">
            {data.title}
          </h1>
          <p className="mt-5 text-base leading-relaxed text-zinc-400">{data.description}</p>

          {data.expectedBack && (
            <div className="mt-9">
              <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-zinc-500">
                Back in
              </p>
              <div className="mt-4 flex justify-center">
                <CountdownDots target={data.expectedBack} size="sm" />
              </div>
            </div>
          )}

          {(data.note || data.email) && (
            <div className="mt-9 flex flex-col items-center gap-3 border-t border-white/[0.07] pt-7">
              {data.note && <p className="text-sm leading-relaxed text-zinc-500">{data.note}</p>}
              {data.email && (
                <a
                  href={`mailto:${data.email}`}
                  className="inline-flex items-center gap-2 rounded-full bg-white/[0.06] px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-white/[0.12]"
                >
                  <Mail className="h-4 w-4 text-saffron-300" />
                  {data.email}
                </a>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
