import { Fragment, useEffect, useMemo, useState, type CSSProperties, type MouseEvent } from "react";
import { ArrowUp } from "lucide-react";
import { Logo } from "./Navbar";
import { externalLinkProps, resolveSocialIcon } from "./ui/SocialIcons";
import { resolveFooter, useSite, type FooterSettings } from "../store/siteContent";
import { cn } from "../utils/cn";

/**
 * Footer markup driven entirely by settings. Used on the live site and in the
 * dashboard preview, so what you see while editing is what visitors get.
 */
export function FooterView({
  settings,
  preview = false,
}: {
  settings: FooterSettings;
  /** Set inside the dashboard, where a viewport-fixed button would float over
   *  the dashboard itself rather than over the preview panel. */
  preview?: boolean;
}) {
  // Hidden columns and links are dropped; an empty column disappears entirely.
  const columns = settings.columns
    .filter((c) => c.enabled)
    .map((c) => ({ ...c, links: c.links.filter((l) => l.enabled && l.href.trim()) }))
    .filter((c) => c.links.length > 0);
  const socials = settings.socials.filter((s) => s.enabled && s.href.trim());
  const year = new Date().getFullYear();

  return (
    <footer className="relative border-t border-white/[0.07] pt-16 sm:pt-20">
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-px bg-saffron-400/50"
        aria-hidden
      />
      <div className="mx-auto max-w-7xl px-5 sm:px-8">
        <div className="grid gap-12 pb-14 lg:grid-cols-[1.3fr_2fr]">
          {/* brand */}
          <div className="max-w-sm">
            <Logo />
            {settings.description && (
              <p className="mt-5 text-sm leading-relaxed text-zinc-500">{settings.description}</p>
            )}
            {socials.length > 0 && (
              <div className="mt-6 flex gap-2.5">
                {socials.map((s) => {
                  const Icon = resolveSocialIcon(s);
                  return (
                    <a
                      key={s.id}
                      href={s.href.trim()}
                      {...externalLinkProps(s.href)}
                      aria-label={s.label}
                      className="shrink-0 aspect-square social-link grid h-10 w-10 place-items-center rounded-full glass text-zinc-400 transition-all duration-300 hover:-translate-y-1 hover:bg-saffron-400 hover:text-on-gold"
                    >
                      <span
                        className="social-glyph inline-flex"
                        style={s.color ? ({ "--social-glyph-color": s.color } as CSSProperties) : undefined}
                      >
                        {Icon ? <Icon className="h-4 w-4" /> : <span className="text-xs">{s.label[0]}</span>}
                      </span>
                    </a>
                  );
                })}
              </div>
            )}
          </div>

          {/* link columns */}
          <div className="grid grid-cols-2 gap-10 sm:grid-cols-3">
            {columns.map((col) => (
              <nav key={col.id} aria-label={col.title}>
                <h3 className="text-xs font-semibold uppercase tracking-[0.22em] text-zinc-500">
                  {col.title}
                </h3>
                <ul className="mt-5 flex flex-col gap-3">
                  {col.links.map((link) => (
                    <li key={link.id}>
                      <a
                        href={link.href}
                        {...externalLinkProps(link.href)}
                        className="group inline-flex items-center gap-1.5 text-sm text-zinc-400 transition-colors duration-300 hover:text-white"
                      >
                        <span className="h-px w-0 bg-saffron-400 transition-all duration-300 group-hover:w-3" />
                        {link.label}
                      </a>
                    </li>
                  ))}
                </ul>
              </nav>
            ))}
          </div>
        </div>

        {/* bottom bar — the last thing on the page, so it is given enough
            contrast to be read rather than skimmed past. */}
        <div className="flex flex-col items-center justify-between gap-5 border-t border-white/[0.12] py-8 sm:flex-row">
          <p className="text-[13px] text-zinc-400">
            © {year} {settings.copyright}
          </p>
          {settings.credit && <Credit text={settings.credit} />}
        </div>
      </div>

      {/* Not in the bottom bar any more: the button floats over the page. */}
      {settings.showBackToTop && !preview && <BackToTop />}
    </footer>
  );
}

/**
 * The footer's credit line, with its heart made to beat.
 *
 * The line is free text from the dashboard, so the heart is found in it rather
 * than being a separate field: wherever a ♥ appears it becomes a red heart that
 * pumps — two quick thumps and a rest, its glow fading between them — while the
 * words around it stay ordinary text. A line written without a heart simply
 * reads as it was typed. The movement is dropped for anyone who has asked their
 * system not to animate things (see the reduced-motion block in index.css), and
 * the heart is hidden from screen readers in favour of the word "love", so the
 * sentence is still a sentence when it is spoken.
 */
function Credit({ text }: { text: string }) {
  const pieces = text.split("♥");
  if (pieces.length === 1) return <p className="text-[13px] text-zinc-300">{text}</p>;
  return (
    <p className="text-[13px] text-zinc-300">
      {pieces.map((piece, index) => (
        <Fragment key={index}>
          {index > 0 && (
            <>
              <span aria-hidden="true" className="credit-heart mx-[0.2em] inline-block animate-heartbeat text-red-500">
                ♥
              </span>
              <span className="sr-only">love</span>
            </>
          )}
          {piece}
        </Fragment>
      ))}
    </p>
  );
}

/**
 * Floating "back to top" button.
 *
 * It floats over the page rather than sitting in the footer's bottom bar, so
 * it is within reach anywhere in a long scroll, and it keeps out of the way
 * until the page has actually moved. The saffron ring is the site's accent and
 * reads on both themes; the plate follows the theme's ink token, so it stays
 * legible when the tokens invert.
 */
function BackToTop() {
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const onScroll = () => setShown(window.scrollY > 420);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // The href works without JavaScript. With it, scroll smoothly instead of
  // jumping, leave the address bar alone, and honour reduced-motion.
  const toTop = (e: MouseEvent<HTMLAnchorElement>) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    window.scrollTo({ top: 0, behavior: still ? "auto" : "smooth" });
  };

  return (
    <a
      href="#top"
      onClick={toTop}
      aria-label="Back to top"
      title="Back to top"
      className={cn(
        "shrink-0 aspect-square fixed bottom-6 right-5 z-[50] grid h-12 w-12 place-items-center rounded-full border-2 border-saffron-400/70 bg-ink-950/90 text-saffron-300 shadow-lg shadow-black/40 backdrop-blur-md transition-all duration-300",
        "hover:-translate-y-1 hover:border-saffron-400 hover:bg-saffron-400 hover:text-black",
        "focus:outline-none focus-visible:ring-2 focus-visible:ring-saffron-400",
        shown ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-4 opacity-0",
      )}
    >
      <ArrowUp className="h-5 w-5" aria-hidden="true" />
    </a>
  );
}

/** The live footer. Renders nothing when the footer section is switched off. */
export default function Footer() {
  // Same as the header: editors see their draft, visitors see what is published.
  const { live: content } = useSite();
  const settings = useMemo(() => resolveFooter(content.footer), [content.footer]);
  if (!settings.enabled) return null;
  return <FooterView settings={settings} />;
}
