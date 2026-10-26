import { useState } from "react";
import { motion } from "framer-motion";
import { Check, Sparkles, Zap, Crown, type LucideIcon } from "lucide-react";
import type { PricingData } from "../store/siteContent";
import { SectionHeader, Reveal, Stagger, Item } from "./ui/motion";
import { isOn } from "../utils/enabled";
import { cn } from "../utils/cn";

const PLAN_ICONS: LucideIcon[] = [Sparkles, Zap, Crown];

export default function Pricing({ data }: { data: PricingData }) {
  const [yearly, setYearly] = useState(true);

  return (
    <section id="pricing" aria-labelledby="pricing-title" className="relative py-24 sm:py-32">
      <div
        className="shrink-0 aspect-square pointer-events-none absolute right-0 top-40 h-96 w-96 rounded-full bg-saffron-400/6 blur-[130px]"
        aria-hidden
      />
      <div className="relative mx-auto max-w-7xl px-5 sm:px-8">
        <SectionHeader
          eyebrow={data.eyebrow}
          id="pricing-title"
          title={
            <>
              {data.titleA}
              <span className="text-gradient">{data.titleHi}</span>
              {data.titleB}
            </>
          }
          sub={data.sub}
        />

        {/* billing toggle */}
        <Reveal delay={0.1} className="mt-10 flex justify-center">
          <div className="relative flex items-center rounded-full glass p-1.5" role="group" aria-label="Billing period">
            {(["Monthly", "Yearly"] as const).map((label) => {
              const isYear = label === "Yearly";
              const selected = yearly === isYear;
              return (
                <button
                  key={label}
                  onClick={() => setYearly(isYear)}
                  aria-pressed={selected}
                  className={cn(
                    "relative rounded-full px-5 py-2.5 text-sm font-semibold transition-colors duration-300",
                    selected ? "text-white" : "text-zinc-400 hover:text-zinc-200"
                  )}
                >
                  {selected && (
                    <motion.span
                      layoutId="billing-pill"
                      className="absolute inset-0 rounded-full bg-saffron-400 shadow-lg shadow-saffron-400/30"
                      transition={{ type: "spring", stiffness: 400, damping: 32 }}
                    />
                  )}
                  <span className="relative flex items-center gap-1.5">
                    {label}
                    {isYear && (
                      <span
                        className={cn(
                          "rounded-full px-2 py-0.5 text-[10px] font-bold",
                          selected ? "bg-white/20 text-white" : "bg-emerald-400/15 text-emerald-300"
                        )}
                      >
                        −20%
                      </span>
                    )}
                  </span>
                </button>
              );
            })}
          </div>
        </Reveal>

        <Stagger className="mt-12 grid gap-6 lg:grid-cols-3 lg:items-stretch">
          {data.plans.filter(isOn).map((plan, pi) => {
            const price = yearly ? plan.yearly : plan.monthly;
            const Icon = PLAN_ICONS[pi % PLAN_ICONS.length] ?? Sparkles;
            return (
              <Item key={plan.name} className="h-full">
                <article
                  className={cn(
                    "group relative flex h-full flex-col rounded-[2rem] p-8 transition-all duration-500 hover:-translate-y-2",
                    plan.featured
                      ? "border border-saffron-400/75 bg-white/[0.06] shadow-2xl shadow-saffron-400/15 lg:scale-[1.03]"
                      : "glass hover:border-white/20"
                  )}
                >
                  {plan.featured && (
                    <span className="absolute -top-3.5 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full bg-saffron-400 px-4 py-1.5 text-[11px] font-bold uppercase tracking-[0.14em] text-on-gold shadow-lg shadow-saffron-400/40">
                      Most popular
                    </span>
                  )}

                  <div className="flex items-center gap-3">
                    <span
                      className={cn(
                        "grid h-11 w-11 place-items-center rounded-2xl",
                        plan.featured
                          ? "bg-saffron-400 text-on-gold"
                          : "bg-white/[0.07] text-zinc-300"
                      )}
                    >
                      <Icon className="h-5 w-5" />
                    </span>
                    <div>
                      <h3 className="font-display text-lg font-semibold text-white">{plan.name}</h3>
                      <p className="text-xs text-zinc-500">{plan.tagline}</p>
                    </div>
                  </div>

                  <div className="mt-7 flex items-end gap-2">
                    <span className="font-display text-5xl font-bold tracking-tight text-white tabular-nums">
                      ₹{price.toLocaleString("en-IN")}
                    </span>
                    <span className="pb-1.5 text-sm text-zinc-500">
                      {price === 0 ? "forever" : "/month"}
                    </span>
                  </div>
                  <p className="mt-1.5 text-xs text-zinc-500">
                    {price === 0
                      ? "No card needed. Ever."
                      : yearly
                        ? `Billed ₹${(price * 12).toLocaleString("en-IN")} yearly — save ₹${((plan.monthly - price) * 12).toLocaleString("en-IN")}`
                        : "Billed monthly. Cancel anytime."}
                  </p>

                  <ul className="mt-7 flex flex-1 flex-col gap-3.5">
                    {plan.features.map((f) => (
                      <li key={f} className="flex items-start gap-3 text-sm text-zinc-300">
                        <span
                          className={cn(
                            "aspect-square mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full",
                            plan.featured ? "bg-saffron-400/20" : "bg-emerald-400/12"
                          )}
                        >
                          <Check
                            className={cn(
                              "h-3 w-3",
                              plan.featured ? "text-saffron-300" : "text-emerald-300"
                            )}
                          />
                        </span>
                        {f}
                      </li>
                    ))}
                  </ul>

                  <a
                    href="#cta"
                    className={cn(
                      "mt-8 inline-flex items-center justify-center rounded-full px-6 py-3.5 font-display text-sm font-semibold transition-all duration-300 active:scale-95",
                      plan.featured
                        ? "bg-saffron-400 text-on-gold shadow-xl shadow-saffron-400/30 hover:brightness-110 hover:shadow-saffron-400/50"
                        : "bg-white/[0.07] text-white hover:bg-white hover:text-ink-950"
                    )}
                  >
                    {plan.cta}
                  </a>
                </article>
              </Item>
            );
          })}
        </Stagger>

        <Reveal delay={0.2}>
          <p className="mt-10 text-center text-sm text-zinc-500">
            {data.fine}{" "}
            <a href="#faq" className="text-saffron-300 underline-offset-4 hover:underline">
              Questions?
            </a>
          </p>
        </Reveal>
      </div>
    </section>
  );
}
