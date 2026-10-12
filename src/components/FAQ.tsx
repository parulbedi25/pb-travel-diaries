import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Plus, MessageCircle, Mail } from "lucide-react";
import type { FaqData } from "../store/siteContent";
import { SectionHeader, Reveal } from "./ui/motion";
import { isOn } from "../utils/enabled";
import { cn } from "../utils/cn";

export default function FAQ({ data }: { data: FaqData }) {
  const [open, setOpen] = useState<number | null>(0);

  return (
    <section id="faq" aria-labelledby="faq-title" className="relative scroll-mt-28 py-24 sm:py-32">
      <div className="relative mx-auto max-w-7xl px-5 sm:px-8">
        <div className="grid gap-12 lg:grid-cols-[420px_1fr] lg:gap-20">
          {/* left — sticky intro */}
          <div className="lg:sticky lg:top-32 lg:self-start">
            <SectionHeader
              align="left"
              eyebrow={data.eyebrow}
              id="faq-title"
              title={
                <>
                  {data.titleA}
                  <span className="text-gradient">{data.titleHi}</span>
                  {data.titleB}
                </>
              }
              sub={data.sub}
            />
            <Reveal delay={0.2}>
              <div className="mt-8 flex flex-col gap-3">
                <a
                  href="#cta"
                  className="group inline-flex items-center gap-3 rounded-2xl glass px-5 py-4 transition-all duration-300 hover:border-white/20 hover:bg-white/[0.06]"
                >
                  <span className="grid h-10 w-10 place-items-center rounded-xl bg-gradient-to-br from-saffron-400 to-flame-500 text-white">
                    <MessageCircle className="h-4.5 w-4.5" />
                  </span>
                  <span>
                    <span className="block text-sm font-semibold text-white">{data.discordLabel}</span>
                    <span className="block text-xs text-zinc-500">{data.discordMeta}</span>
                  </span>
                </a>
                <a
                  href={`mailto:${data.email}`}
                  className="group inline-flex items-center gap-3 rounded-2xl glass px-5 py-4 transition-all duration-300 hover:border-white/20 hover:bg-white/[0.06]"
                >
                  <span className="grid h-10 w-10 place-items-center rounded-xl bg-white/[0.07] text-zinc-300">
                    <Mail className="h-4.5 w-4.5" />
                  </span>
                  <span>
                    <span className="block text-sm font-semibold text-white">{data.email}</span>
                    <span className="block text-xs text-zinc-500">{data.emailMeta}</span>
                  </span>
                </a>
              </div>
            </Reveal>
          </div>

          {/* right — accordion */}
          <div className="flex flex-col gap-3">
            {data.items.filter(isOn).map((f, i) => {
              const isOpen = open === i;
              return (
                <Reveal key={`${f.q}-${i}`} delay={i * 0.05}>
                  <div
                    className={cn(
                      "overflow-hidden rounded-2xl border transition-all duration-500",
                      isOpen
                        ? "border-white/20 bg-white/[0.05]"
                        : "border-white/[0.07] bg-white/[0.02] hover:border-white/[0.14] hover:bg-white/[0.04]"
                    )}
                  >
                    <button
                      onClick={() => setOpen(isOpen ? null : i)}
                      aria-expanded={isOpen}
                      className="flex w-full items-center justify-between gap-4 px-6 py-5 text-left"
                    >
                      <span
                        className={cn(
                          "font-display text-[15px] font-semibold transition-colors duration-300 sm:text-base",
                          isOpen ? "text-white" : "text-zinc-200"
                        )}
                      >
                        {f.q}
                      </span>
                      <motion.span
                        animate={{ rotate: isOpen ? 45 : 0 }}
                        transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
                        className={cn(
                          "grid h-8 w-8 shrink-0 place-items-center rounded-full transition-colors duration-300",
                          isOpen
                            ? "bg-gradient-to-br from-saffron-400 to-flame-500 text-white"
                            : "bg-white/[0.06] text-zinc-400"
                        )}
                      >
                        <Plus className="h-4 w-4" />
                      </motion.span>
                    </button>
                    <AnimatePresence initial={false}>
                      {isOpen && (
                        <motion.div
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: "auto", opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
                        >
                          <p className="px-6 pb-6 text-sm leading-relaxed text-zinc-400 sm:text-[15px]">
                            {f.a}
                          </p>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                </Reveal>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}
