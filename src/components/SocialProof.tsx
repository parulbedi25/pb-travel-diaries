import { Flame } from "lucide-react";
import type { SocialProofData } from "../store/siteContent";
import { CountUp, Reveal, Stagger, Item } from "./ui/motion";
import { isOn } from "../utils/enabled";

export default function SocialProof({ data }: { data: SocialProofData }) {
  return (
    <section aria-label="Social proof" className="relative py-20 sm:py-24">
      <div className="mx-auto max-w-7xl px-5 sm:px-8">
        {/* press marquee */}
        <Reveal>
          <p className="text-center text-[11px] font-semibold uppercase tracking-[0.28em] text-zinc-500">
            {data.pressIntro}
          </p>
        </Reveal>
        <Reveal delay={0.1}>
          <div className="mask-fade-x mt-8 overflow-hidden">
            <div className="flex w-max animate-marquee items-center gap-14 pr-14">
              {[...data.press, ...data.press].map((name, i) => (
                <span
                  key={`${name}-${i}`}
                  aria-hidden={i >= data.press.length}
                  className="whitespace-nowrap font-display text-xl font-semibold tracking-tight text-zinc-600 transition-colors duration-300 hover:text-zinc-300 sm:text-2xl"
                >
                  {name}
                </span>
              ))}
            </div>
          </div>
        </Reveal>

        {/* stats */}
        <Stagger className="mt-16 grid grid-cols-2 gap-4 lg:grid-cols-4">
          {data.stats.filter(isOn).map((s) => (
            <Item key={s.label}>
              <div className="group relative overflow-hidden rounded-3xl glass p-6 transition-all duration-500 hover:-translate-y-1 hover:border-white/20 sm:p-7">
                <div className="shrink-0 aspect-square pointer-events-none absolute -right-8 -top-8 h-24 w-24 rounded-full bg-saffron-400/20 blur-2xl transition-opacity duration-500 group-hover:opacity-100" />
                <Flame className="h-4 w-4 text-saffron-400/80" />
                <p className="mt-4 font-display text-3xl font-bold tracking-tight text-white sm:text-4xl">
                  <CountUp to={s.value} suffix={s.suffix} />
                </p>
                <p className="mt-1.5 text-sm font-medium text-zinc-300">{s.label}</p>
                <p className="mt-0.5 text-xs text-zinc-500">{s.sub}</p>
              </div>
            </Item>
          ))}
        </Stagger>
      </div>
    </section>
  );
}
