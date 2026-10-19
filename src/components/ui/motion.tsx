import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  motion,
  animate,
  useInView,
  useReducedMotion,
  type Variants,
} from "framer-motion";
import { cn } from "../../utils/cn";

export const EASE = [0.16, 1, 0.3, 1] as const;

/* ---------- Scroll reveal wrapper ---------- */
export function Reveal({
  children,
  delay = 0,
  y = 28,
  className,
  once = true,
}: {
  children: ReactNode;
  delay?: number;
  y?: number;
  className?: string;
  once?: boolean;
}) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: reduce ? 0 : y }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once, margin: "-60px" }}
      transition={{ duration: 0.9, delay, ease: EASE }}
    >
      {children}
    </motion.div>
  );
}

/* ---------- Staggered container + item ---------- */
export const staggerParent: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.09, delayChildren: 0.1 } },
};

export const staggerChild: Variants = {
  hidden: { opacity: 0, y: 26 },
  show: { opacity: 1, y: 0, transition: { duration: 0.8, ease: EASE } },
};

/**
 * Reveals its children in sequence, once.
 *
 * The `once` reveal only runs for the children present at the time. If the
 * list can change afterwards — a filter, a tab, a sort — give this container a
 * `key` derived from whatever changed, so the new children get a reveal of
 * their own instead of inheriting `hidden` from a container that already ran.
 */
export function Stagger({
  children,
  className,
  once = true,
}: {
  children: ReactNode;
  className?: string;
  once?: boolean;
}) {
  return (
    <motion.div
      className={className}
      variants={staggerParent}
      initial="hidden"
      whileInView="show"
      viewport={{ once, margin: "-60px" }}
    >
      {children}
    </motion.div>
  );
}

export function Item({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <motion.div variants={staggerChild} className={className}>
      {children}
    </motion.div>
  );
}

/* ---------- Animated counter ---------- */
export function CountUp({
  to,
  suffix = "",
  duration = 1.8,
  className,
}: {
  to: number;
  suffix?: string;
  duration?: number;
  className?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, margin: "-40px" });
  const [val, setVal] = useState(0);

  useEffect(() => {
    if (!inView) return;
    const controls = animate(0, to, {
      duration,
      ease: EASE,
      onUpdate: (v) => setVal(v),
    });
    return () => controls.stop();
  }, [inView, to, duration]);

  return (
    <span ref={ref} className={cn("tabular-nums", className)}>
      {Math.round(val).toLocaleString("en-IN")}
      {suffix}
    </span>
  );
}

/* ---------- Section heading ---------- */
export function SectionHeader({
  eyebrow,
  title,
  sub,
  align = "center",
  id,
}: {
  eyebrow: string;
  title: ReactNode;
  sub?: string;
  align?: "center" | "left";
  id?: string;
}) {
  return (
    // data-section-anchor: the block a jump aims at. Not the section's top,
    // which is the top of its padding — see utils/anchorScroll.ts.
    <div
      data-section-anchor
      className={cn(
        "max-w-2xl",
        align === "center" ? "mx-auto text-center" : "text-left"
      )}
    >
      <Reveal>
        <span className="inline-flex items-center gap-2 rounded-full glass px-4 py-1.5 text-[11px] font-semibold uppercase tracking-[0.22em] text-saffron-300">
          <span className="h-1.5 w-1.5 rounded-full bg-saffron-400" />
          {eyebrow}
        </span>
      </Reveal>
      <Reveal delay={0.08}>
        <h2
          id={id}
          className="mt-5 font-display text-3xl font-semibold leading-[1.08] tracking-tight text-white sm:text-4xl lg:text-[2.75rem] text-balance"
        >
          {title}
        </h2>
      </Reveal>
      {sub && (
        <Reveal delay={0.16}>
          <p className="mt-5 text-base leading-relaxed text-zinc-400 sm:text-lg">
            {sub}
          </p>
        </Reveal>
      )}
    </div>
  );
}
