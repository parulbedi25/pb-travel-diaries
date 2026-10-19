import { ArrowRight, Lock, Sparkles } from "lucide-react";
import type { SectionEntry } from "../store/siteContent";

/**
 * What a visitor sees in place of a members-only section.
 *
 * The server strips the real content from the anonymous response, so this is
 * not a cosmetic overlay — there is nothing behind it to uncover. Signing in
 * (or creating a free read-only account) makes the next page load include the
 * full section.
 */
export default function LockedSection({ entry }: { entry: SectionEntry }) {
  return (
    <section
      id={entry.id}
      className="relative overflow-hidden border-y border-white/[0.07] bg-ink-950 px-5 py-20 sm:py-24"
    >
      <div
        className="pointer-events-none absolute inset-0 bg-grid opacity-30 [mask-image:radial-gradient(ellipse_at_center,black,transparent_72%)]"
        aria-hidden
      />
      <div className="relative mx-auto max-w-2xl">
        <div className="rounded-3xl glass p-8 text-center sm:p-12">
          <span className="inline-flex items-center gap-2 rounded-full bg-saffron-400/15 px-3.5 py-1.5 text-[11px] font-bold uppercase tracking-[0.18em] text-saffron-300">
            <Lock className="h-3.5 w-3.5" /> Members only
          </span>

          <h2 className="mt-5 font-display text-2xl font-semibold tracking-tight text-white sm:text-3xl">
            {entry.label}
          </h2>
          <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-zinc-400">
            This part of the journal is for the tribe. Sign in — or create a free account — to
            unlock it.
          </p>

          <div className="mt-7 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <a
              href="#/members"
              className="inline-flex items-center gap-2 rounded-full bg-saffron-400 px-6 py-3 text-sm font-semibold text-on-gold shadow-lg shadow-saffron-400/25 transition-all duration-300 hover:brightness-110 active:scale-95"
            >
              Sign in <ArrowRight className="h-4 w-4" />
            </a>
            <a
              href="#/members?signup"
              className="inline-flex items-center gap-2 rounded-full border border-white/15 px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-white/[0.08]"
            >
              <Sparkles className="h-4 w-4 text-saffron-300" /> Create a free account
            </a>
          </div>

          <p className="mt-5 text-[11px] leading-relaxed text-zinc-600">
            Free accounts are read-only: they unlock the members-only sections and nothing else.
          </p>
        </div>
      </div>
    </section>
  );
}
