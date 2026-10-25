import { useEffect, useRef, useState } from "react";
import {
  motion,
  AnimatePresence,
  useScroll,
  useSpring,
  useMotionValueEvent,
} from "framer-motion";
import { Menu, X, ArrowUpRight, SlidersHorizontal, Eye, EyeOff, UserRound, LogIn } from "lucide-react";
import { canEditSite, resolveHeaderButtons, useSite, type HeaderButton } from "../store/siteContent";
import BrandLogo from "./BrandLogo";
import ThemeToggle from "./ThemeToggle";
import { cn } from "../utils/cn";
import { ANCHOR_GAP_CSS } from "../utils/anchorScroll";
import { navItemState } from "../utils/navSections";

export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <a href="#top" className="group inline-flex items-center" aria-label="PB from PB — home">
      <BrandLogo size={compact ? "sm" : "md"} />
    </a>
  );
}

const isExternal = (href: string) => /^https?:\/\//i.test(href);

function variantClass(v: HeaderButton["variant"]): string {
  if (v === "gold") {
    return "text-on-gold bg-saffron-400 shadow-lg shadow-saffron-400/25 hover:brightness-110";
  }
  if (v === "outline") return "border border-white/20 text-white hover:bg-white/[0.08]";
  return "bg-white text-ink-950 hover:shadow-[0_0_28px_rgba(255,255,255,0.25)]";
}

/** A header call-to-action. Opens in a new tab when asked to, or for any external link. */
function HeaderCta({
  b,
  className,
  onClick,
}: {
  b: HeaderButton;
  className?: string;
  onClick?: () => void;
}) {
  const external = b.newTab || isExternal(b.href);
  return (
    <a
      href={b.href}
      {...(external ? { target: "_blank", rel: "noreferrer" } : {})}
      onClick={onClick}
      className={cn(
        "group items-center gap-2 rounded-full px-5 py-2.5 text-sm font-semibold transition-all duration-300 active:scale-95",
        variantClass(b.variant),
        className
      )}
    >
      {b.label}
      <ArrowUpRight className="h-4 w-4 transition-transform duration-300 group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
    </a>
  );
}

export default function Navbar() {
  // The draft is what an editor paints, so a menu or brand edit shows here
  // before it is published.
  const { live: content, previewAsVisitor, setPreviewAsVisitor, account } = useSite();
  const isAdmin = canEditSite(account);
  // A link whose section is switched off is a dead anchor. The admin sees it
  // struck through, because for them it explains where the section went; a
  // visitor and a member never see it at all — a menu is a list of places you
  // can go, and offering one you cannot is not information, it is clutter.
  // Either way only the link is affected; the section itself is untouched by
  // anything the menu does (see utils/navSections).
  const showDormant = isAdmin && !previewAsVisitor;
  const nav = content.nav
    .filter((l) => l.enabled)
    .map((link) => ({ link, state: navItemState(content, link) }))
    .filter(({ state }) => state.available || showDormant);
  const ctas = resolveHeaderButtons(content.headerButtons)
    .filter((b) => b.enabled && b.label.trim())
    .slice(0, 2);
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);
  const header = useRef<HTMLElement | null>(null);
  const { scrollY, scrollYProgress } = useScroll();
  const progress = useSpring(scrollYProgress, { stiffness: 120, damping: 28 });

  useMotionValueEvent(scrollY, "change", (v) => setScrolled(v > 24));

  // The header is fixed and shrinks as you scroll, so the gap every in-page
  // jump leaves for it has to be measured, not assumed.
  useEffect(() => {
    const el = header.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const root = document.documentElement;
    const publish = (height: number) => {
      if (height <= 0) return;
      root.style.setProperty("--header-h", `${height}px`);
      // Room for the header in the browser's own anchor landing. Only pages
      // that mount this header get it: the dashboard scrolls its own panels
      // into view and has no header to clear.
      root.style.scrollPaddingTop = `calc(${height}px + ${ANCHOR_GAP_CSS})`;
    };
    publish(el.getBoundingClientRect().height);
    // border-box, and measured off the element: the header's height changes
    // through its padding, which a content-box observation does not see.
    const observer = new ResizeObserver(() => publish(el.getBoundingClientRect().height));
    observer.observe(el, { box: "border-box" });
    return () => {
      observer.disconnect();
      root.style.removeProperty("--header-h");
      root.style.removeProperty("scroll-padding-top");
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    const desktop = window.matchMedia("(min-width: 1280px)");
    const closeOnDesktop = () => { if (desktop.matches) setOpen(false); };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.body.style.overflow = "hidden";
    closeOnDesktop();
    desktop.addEventListener("change", closeOnDesktop);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      desktop.removeEventListener("change", closeOnDesktop);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  // Flags the open overlay on <html> so the live-site section controls can
  // step out of the way instead of floating above the menu.
  useEffect(() => {
    if (!open) return;
    document.documentElement.setAttribute("data-nav-open", "true");
    return () => document.documentElement.removeAttribute("data-nav-open");
  }, [open]);

  return (
    <>
      <motion.div
        className="fixed inset-x-0 top-0 z-[70] h-[2.5px] origin-left bg-saffron-400"
        style={{ scaleX: progress }}
        aria-hidden
      />
      <motion.header
        initial={{ y: -70, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.9, ease: [0.16, 1, 0.3, 1], delay: 0.2 }}
        ref={header}
        data-site-header
        className="fixed inset-x-0 top-0 z-[60]"
      >
        <div
          className={cn(
            "site-header-row mx-auto flex max-w-7xl items-center justify-between gap-4 px-5 transition-all duration-500 sm:px-8",
            scrolled ? "py-3" : "py-5"
          )}
        >
          <div
            className={cn(
              "pointer-events-none absolute inset-0 border-b transition-all duration-500",
              scrolled
                ? "border-white/[0.07] bg-ink-950/70 backdrop-blur-xl"
                : "border-transparent bg-transparent"
            )}
            aria-hidden
          />
          <div className="relative z-10">
            <Logo />
          </div>

          <nav aria-label="Primary" className="site-header-links relative z-10 hidden items-center gap-1 lg:flex">
            {nav.map(({ link, state }) =>
              state.available ? (
                <a
                  key={link.id}
                  href={link.href}
                  className="group relative rounded-full px-4 py-2 text-sm font-medium text-zinc-400 transition-colors duration-300 hover:text-white"
                >
                  {link.label}
                  <span className="absolute inset-x-4 -bottom-px h-px origin-left scale-x-0 bg-saffron-400 transition-transform duration-300 group-hover:scale-x-100" />
                </a>
              ) : (
                // Its section is switched off, so there is nothing to jump to.
                <span
                  key={link.id}
                  role="link"
                  aria-disabled="true"
                  title={`${state.section?.label ?? "That section"} is switched off in the dashboard`}
                  className="relative cursor-not-allowed rounded-full px-4 py-2 text-sm font-medium text-zinc-600 line-through decoration-zinc-700 decoration-1"
                >
                  {link.label}
                </span>
              ),
            )}
          </nav>

          <div className="site-header-actions relative z-10 flex items-center gap-2.5 sm:gap-3">
            {isAdmin && (
              <button
                type="button"
                onClick={() => setPreviewAsVisitor((v) => !v)}
                aria-label={previewAsVisitor ? "Exit user preview" : "Preview as user"}
                aria-pressed={previewAsVisitor}
                className={cn(
                  "hidden sm:inline-flex items-center gap-1.5 rounded-full px-3.5 py-2 text-xs font-semibold transition-all duration-300 shadow-md active:scale-95",
                  previewAsVisitor
                    ? "border border-amber-400/50 bg-amber-400/15 text-amber-300 hover:bg-amber-400/25"
                    : "border border-emerald-400/50 bg-emerald-400/15 text-emerald-300 hover:bg-emerald-400/25"
                )}
                title={
                  previewAsVisitor
                    ? "Viewing website as a normal user (resizers hidden). Click to return to Admin Edit Mode."
                    : "Currently in Admin Edit Mode (resizers visible). Click to preview website as a normal user."
                }
              >
                {previewAsVisitor ? (
                  <>
                    <EyeOff className="h-3.5 w-3.5" />
                    <span className="site-preview-label">Exit User View</span>
                  </>
                ) : (
                  <>
                    <Eye className="h-3.5 w-3.5" />
                    <span className="site-preview-label">Preview as User</span>
                  </>
                )}
              </button>
            )}
            <ThemeToggle />
            {/* Members sign in here; visitors get the same entry so the
                members-only sections are not a dead end. */}
            <a
              href="#/members"
              aria-label={account ? "Your account" : "Sign in"}
              title={
                account
                  ? account.role === "reader"
                    ? "Your account"
                    : "PB Control account"
                  : "Sign in or create a read-only account"
              }
              className="grid h-10 w-10 place-items-center rounded-full glass text-zinc-400 transition-all duration-300 hover:text-white"
            >
              {account ? <UserRound className="h-4 w-4" /> : <LogIn className="h-4 w-4" />}
            </a>
            <a
              href="#/admin"
              aria-label="Admin dashboard"
              title="Admin dashboard"
              className="hidden h-10 w-10 place-items-center rounded-full glass text-zinc-400 transition-all duration-300 hover:rotate-45 hover:text-white sm:grid"
            >
              <SlidersHorizontal className="h-4 w-4" />
            </a>
            {ctas.map((b) => (
              <HeaderCta
                key={b.id}
                b={b}
                className="hidden transition-all hover:shadow-saffron-400/30 sm:inline-flex"
              />
            ))}
            <button
              onClick={() => setOpen((v) => !v)}
              aria-expanded={open}
              aria-label={open ? "Close menu" : "Open menu"}
              className="grid h-10 w-10 place-items-center rounded-full glass text-white lg:hidden"
            >
              {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </button>
          </div>
        </div>
      </motion.header>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.35 }}
            className="site-mobile-menu fixed inset-0 z-[55] flex flex-col bg-ink-950/90 backdrop-blur-2xl lg:hidden"
          >
            <div className="pointer-events-none absolute inset-0 bg-grid opacity-40 [mask-image:radial-gradient(ellipse_at_top,black,transparent_75%)]" />
            <div className="site-mobile-menu-content relative mt-28 flex flex-col gap-2 px-8">
              {nav.map(({ link, state }, i) => (
                <motion.a
                  key={link.id}
                  href={state.available ? link.href : undefined}
                  aria-disabled={state.available ? undefined : true}
                  onClick={(event) => {
                    if (!state.available) {
                      event.preventDefault();
                      return;
                    }
                    setOpen(false);
                    // Unlock now rather than waiting for the effect: the jump
                    // that follows this click cannot move a locked body.
                    document.body.style.overflow = "";
                  }}
                  initial={{ opacity: 0, x: -24 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -24 }}
                  transition={{ delay: 0.06 * i, duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
                  className={cn(
                    "group flex items-center justify-between border-b border-white/[0.06] py-5 font-display text-2xl font-semibold",
                    state.available
                      ? "text-white"
                      : "cursor-not-allowed text-zinc-600 line-through decoration-zinc-700",
                  )}
                >
                  {link.label}
                  {state.available ? (
                    <ArrowUpRight className="h-5 w-5 text-zinc-600 transition-all duration-300 group-hover:text-saffron-400" />
                  ) : (
                    <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-600 no-underline">
                      Section off
                    </span>
                  )}
                </motion.a>
              ))}
              {ctas.map((b, i) => (
                <motion.div
                  key={b.id}
                  initial={{ opacity: 0, y: 16 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.4 + i * 0.06, duration: 0.5 }}
                  className={i === 0 ? "mt-8" : "mt-3"}
                >
                  <HeaderCta
                    b={b}
                    onClick={() => setOpen(false)}
                    className="inline-flex w-full justify-center py-4 text-base"
                  />
                </motion.div>
              ))}
              {isAdmin && (
                <motion.button
                  type="button"
                  onClick={() => {
                    setPreviewAsVisitor((v) => !v);
                    setOpen(false);
                  }}
                  initial={{ opacity: 0, y: 16 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.44, duration: 0.5 }}
                  className={cn(
                    "mt-4 inline-flex items-center justify-center gap-2 rounded-full px-6 py-3.5 text-sm font-semibold transition-all",
                    previewAsVisitor
                      ? "border border-amber-400/50 bg-amber-400/15 text-amber-300"
                      : "border border-emerald-400/50 bg-emerald-400/15 text-emerald-300"
                  )}
                >
                  {previewAsVisitor ? (
                    <>
                      <EyeOff className="h-4 w-4" />
                      <span>Exit User View (Edit Mode)</span>
                    </>
                  ) : (
                    <>
                      <Eye className="h-4 w-4" />
                      <span>Preview as Normal User</span>
                    </>
                  )}
                </motion.button>
              )}
              <motion.a
                href="#/members"
                onClick={() => setOpen(false)}
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.46, duration: 0.5 }}
                className="mt-3 inline-flex items-center justify-center gap-2 rounded-full glass px-6 py-3.5 text-sm font-semibold text-zinc-300"
              >
                <UserRound className="h-4 w-4" />
                {account ? "Your account" : "Sign in / Create account"}
              </motion.a>
              <motion.a
                href="#/admin"
                onClick={() => setOpen(false)}
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.5, duration: 0.5 }}
                className="mt-3 inline-flex items-center justify-center gap-2 rounded-full glass px-6 py-3.5 text-sm font-semibold text-zinc-300"
              >
                <SlidersHorizontal className="h-4 w-4" />
                Admin dashboard
              </motion.a>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
