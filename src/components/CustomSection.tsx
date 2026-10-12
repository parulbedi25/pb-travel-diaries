import { ArrowUpRight } from "lucide-react";
import type { CustomData } from "../store/siteContent";
import { Reveal } from "./ui/motion";
import { cn } from "../utils/cn";

/** Generic block the admin can insert anywhere on the page. */
export default function CustomSection({ data }: { data: CustomData }) {
  const imageRight = data.layout === "image-right";

  return (
    <section aria-label={data.title || "Section"} className="relative py-20 sm:py-28">
      <div className="mx-auto max-w-7xl px-5 sm:px-8">
        <div
          className={cn(
            "grid items-center gap-10 lg:gap-16",
            data.image ? "lg:grid-cols-2" : "mx-auto max-w-3xl text-center"
          )}
        >
          <Reveal className={cn(data.image && imageRight && "lg:order-2")}>
            {data.eyebrow && (
              <span className="inline-flex items-center gap-2 rounded-full glass px-4 py-1.5 text-[11px] font-semibold uppercase tracking-[0.22em] text-saffron-300">
                <span className="h-1.5 w-1.5 rounded-full bg-saffron-400" />
                {data.eyebrow}
              </span>
            )}
            <h2 className="mt-5 font-display text-3xl font-semibold leading-[1.08] tracking-tight text-white sm:text-4xl lg:text-[2.75rem] text-balance">
              {data.title}
            </h2>
            {data.sub && (
              <p className="mt-5 text-base leading-relaxed text-zinc-400 sm:text-lg">{data.sub}</p>
            )}
            {data.buttonLabel && (
              <a
                href={data.buttonHref || "#"}
                className="group mt-8 inline-flex items-center gap-2 rounded-full bg-saffron-400 px-7 py-4 font-display text-[15px] font-semibold text-on-gold shadow-xl shadow-saffron-400/30 transition-all duration-300 hover:brightness-110 active:scale-95"
              >
                {data.buttonLabel}
                <ArrowUpRight className="h-4 w-4 transition-transform duration-300 group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
              </a>
            )}
          </Reveal>

          {data.image && (
            <Reveal delay={0.12} className={cn(imageRight ? "lg:order-1" : "")}>
              <div className="group overflow-hidden rounded-[2rem] border border-white/10 shadow-2xl shadow-black/50">
                <img
                  src={data.image}
                  alt={data.imageAlt || data.title}
                  loading="lazy"
                  className="aspect-[16/10] w-full object-cover transition-transform duration-[1.4s] ease-out group-hover:scale-105"
                />
              </div>
            </Reveal>
          )}
        </div>
      </div>
    </section>
  );
}
