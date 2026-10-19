import { useState } from "react";
import { ArrowRight, Check, Send, Compass } from "lucide-react";
import type { CtaData } from "../store/siteContent";
import { Reveal } from "./ui/motion";

export default function CTA({ data }: { data: CtaData }) {
  const [email, setEmail] = useState("");
  const [done, setDone] = useState(false);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (email.trim()) setDone(true);
  };

  return (
    <section id="cta" aria-labelledby="cta-title" className="relative py-24 sm:py-32">
      <div className="mx-auto max-w-7xl px-5 sm:px-8">
        <Reveal>
          <div className="relative overflow-hidden rounded-[2.5rem] border border-white/10 px-6 py-16 text-center sm:px-12 sm:py-24">
            <div className="absolute inset-0 bg-white/[0.04]" aria-hidden />
            <div
              className="absolute -top-40 left-1/2 h-80 w-[560px] -translate-x-1/2 rounded-full bg-saffron-400/12 blur-[110px] animate-pulse-soft"
              aria-hidden
            />
            <div className="absolute inset-0 bg-grid opacity-30 [mask-image:radial-gradient(ellipse_at_center,black,transparent_80%)]" aria-hidden />

            <div className="relative" data-section-anchor>
              <span className="inline-flex items-center gap-2 rounded-full glass px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.22em] text-saffron-300">
                <Compass className="h-3.5 w-3.5" />
                {data.badge}
              </span>

              <h2
                id="cta-title"
                className="mx-auto mt-6 max-w-3xl font-display text-4xl font-semibold leading-[1.05] tracking-tight text-white sm:text-5xl lg:text-6xl text-balance"
              >
                {data.titleA}
                <span className="text-gradient">{data.titleHi}</span>
              </h2>
              <p className="mx-auto mt-5 max-w-xl text-base leading-relaxed text-zinc-400 sm:text-lg">
                {data.sub}
              </p>

              <div className="mx-auto mt-10 max-w-lg">
                {done ? (
                  <div className="flex items-center justify-center gap-3 rounded-full border border-emerald-400/30 bg-emerald-400/10 px-6 py-4">
                    <span className="grid h-8 w-8 place-items-center rounded-full bg-emerald-400/20">
                      <Check className="h-4 w-4 text-emerald-300" />
                    </span>
                    <p className="text-sm font-medium text-emerald-200">{data.success}</p>
                  </div>
                ) : (
                  <form
                    onSubmit={submit}
                    className="flex flex-col gap-3 sm:flex-row sm:items-center sm:rounded-full sm:border sm:border-white/10 sm:bg-white/[0.05] sm:p-2 sm:backdrop-blur-xl"
                  >
                    <label htmlFor="cta-email" className="sr-only">
                      Email address
                    </label>
                    <input
                      id="cta-email"
                      type="email"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder={data.placeholder}
                      className="w-full flex-1 rounded-full border border-white/10 bg-white/[0.05] px-5 py-4 text-sm text-white placeholder:text-zinc-500 focus:border-saffron-400/60 focus:outline-none sm:border-0 sm:bg-transparent sm:py-3"
                    />
                    <button
                      type="submit"
                      className="group inline-flex items-center justify-center gap-2 rounded-full bg-saffron-400 px-7 py-4 font-display text-sm font-semibold text-on-gold shadow-xl shadow-saffron-400/30 transition-all duration-300 hover:brightness-110 hover:shadow-saffron-400/50 active:scale-95 sm:py-3.5"
                    >
                      {data.btnLabel}
                      <Send className="h-4 w-4 transition-transform duration-300 group-hover:translate-x-1 group-hover:-translate-y-0.5" />
                    </button>
                  </form>
                )}
                <p className="mt-4 text-xs text-zinc-500">{data.fineprint}</p>
              </div>

              <div className="mt-10 flex flex-wrap items-center justify-center gap-x-8 gap-y-3 text-sm text-zinc-500">
                {data.chips.map((c) => (
                  <span key={c} className="inline-flex items-center gap-2">
                    <Check className="h-4 w-4 text-emerald-400" />
                    {c}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </Reveal>

        <Reveal delay={0.15}>
          <p className="mt-8 text-center text-sm text-zinc-500">
            Prefer to browse first?{" "}
            <a
              href="#journey"
              className="group inline-flex items-center gap-1 font-medium text-saffron-300 transition-colors hover:text-saffron-400"
            >
              Replay the journey
              <ArrowRight className="h-3.5 w-3.5 transition-transform duration-300 group-hover:translate-x-1" />
            </a>
          </p>
        </Reveal>
      </div>
    </section>
  );
}
