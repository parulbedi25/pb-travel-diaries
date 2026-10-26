import { Star, Quote } from "lucide-react";
import type { StoriesData } from "../store/siteContent";
import { SectionHeader, Stagger, Item } from "./ui/motion";
import { isOn } from "../utils/enabled";

export default function Testimonials({ data }: { data: StoriesData }) {
  return (
    <section id="stories" aria-labelledby="stories-title" className="relative py-24 sm:py-32">
      <div
        className="pointer-events-none absolute left-1/2 top-10 h-72 w-[560px] -translate-x-1/2 rounded-full bg-saffron-500/6 blur-[120px]"
        aria-hidden
      />
      <div className="relative mx-auto max-w-7xl px-5 sm:px-8">
        <SectionHeader
          eyebrow={data.eyebrow}
          id="stories-title"
          title={
            <>
              {data.titleA}
              <span className="text-gradient">{data.titleHi}</span>
              {data.titleB}
            </>
          }
          sub={data.sub}
        />

        <Stagger className="mt-14 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {data.items.filter(isOn).map((t, i) => (
            <Item key={`${t.name}-${i}`}>
              <figure className="group relative flex h-full flex-col rounded-3xl glass p-7 transition-all duration-500 hover:-translate-y-1.5 hover:border-white/20 hover:shadow-2xl hover:shadow-black/40">
                <Quote className="h-5 w-5 text-saffron-400/50" />
                <blockquote className="mt-4 flex-1 text-sm leading-relaxed text-zinc-300">
                  "{t.quote}"
                </blockquote>
                <div className="mt-6 flex items-center gap-1">
                  {Array.from({ length: 5 }).map((_, s) => (
                    <Star key={s} className="h-3.5 w-3.5 fill-saffron-400 text-saffron-400" />
                  ))}
                </div>
                <figcaption className="mt-4 flex items-center gap-3 border-t border-white/[0.07] pt-5">
                  <span
                    className="shrink-0 aspect-square grid h-10 w-10 place-items-center rounded-full bg-saffron-400 font-display text-xs font-bold text-on-gold"
                  >
                    {t.name.split(" ").map((w) => w[0]).join("").slice(0, 2)}
                  </span>
                  <div>
                    <p className="text-sm font-semibold text-white">{t.name}</p>
                    <p className="text-xs text-zinc-500">{t.age}</p>
                  </div>
                </figcaption>
              </figure>
            </Item>
          ))}
        </Stagger>
      </div>
    </section>
  );
}
