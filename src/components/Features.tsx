import {
  Clapperboard,
  Route,
  IndianRupee,
  Compass,
  Backpack,
  Users,
  ArrowUpRight,
  type LucideIcon,
} from "lucide-react";
import type { FeaturesData, FeatureItem } from "../store/siteContent";
import { SectionHeader, Stagger, Item } from "./ui/motion";
import { isOn } from "../utils/enabled";

const ICONS: Record<string, LucideIcon> = {
  clapperboard: Clapperboard,
  route: Route,
  rupee: IndianRupee,
  compass: Compass,
  backpack: Backpack,
  users: Users,
};

export default function Features({ data }: { data: FeaturesData }) {
  return (
    <section id="features" aria-labelledby="features-title" className="relative py-24 sm:py-32">
      <div
        className="pointer-events-none absolute left-1/2 top-0 h-72 w-[640px] -translate-x-1/2 rounded-full bg-saffron-400/6 blur-[120px]"
        aria-hidden
      />
      <div className="relative mx-auto max-w-7xl px-5 sm:px-8">
        <SectionHeader
          eyebrow={data.eyebrow}
          id="features-title"
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
          {data.items.filter(isOn).map((f: FeatureItem, i: number) => {
            const Icon = ICONS[f.icon] ?? Compass;
            return (
              <Item key={`${f.title}-${i}`}>
                <article className="group relative h-full overflow-hidden rounded-3xl glass p-7 transition-all duration-500 hover:-translate-y-1.5 hover:border-white/20 hover:shadow-2xl hover:shadow-black/40">
                  <div
                    className="shrink-0 aspect-square pointer-events-none absolute -right-10 -top-10 h-32 w-32 rounded-full bg-saffron-400/25 blur-2xl opacity-0 transition-opacity duration-500 group-hover:opacity-100"
                    aria-hidden
                  />
                  <div className="flex items-start justify-between">
                    <span
                      className={`grid h-12 w-12 place-items-center rounded-2xl text-on-gold shadow-lg transition-transform duration-500 group-hover:scale-110 group-hover:-rotate-6 ${f.color ? "" : "bg-saffron-400"}`}
                      style={f.color ? { background: `linear-gradient(135deg, ${f.color}, ${f.color}99)` } : undefined}
                    >
                      <Icon className="h-5.5 w-5.5" />
                    </span>
                    <ArrowUpRight className="h-5 w-5 text-zinc-600 transition-all duration-300 group-hover:translate-x-1 group-hover:-translate-y-1 group-hover:text-white" />
                  </div>
                  <h3 className="mt-6 font-display text-lg font-semibold tracking-tight text-white">
                    {f.title}
                  </h3>
                  <p className="mt-2.5 text-sm leading-relaxed text-zinc-400">{f.desc}</p>
                </article>
              </Item>
            );
          })}
        </Stagger>
      </div>
    </section>
  );
}
