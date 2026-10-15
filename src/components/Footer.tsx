import { useMemo } from "react";
import { ArrowUp } from "lucide-react";
import { Logo } from "./Navbar";
import { externalLinkProps, resolveSocialIcon } from "./ui/SocialIcons";
import { resolveFooter, useSite, type FooterSettings } from "../store/siteContent";

/**
 * Footer markup driven entirely by settings. Used on the live site and in the
 * dashboard preview, so what you see while editing is what visitors get.
 */
export function FooterView({ settings }: { settings: FooterSettings }) {
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
                      className="grid h-10 w-10 place-items-center rounded-full glass text-zinc-400 transition-all duration-300 hover:-translate-y-1 hover:bg-saffron-400 hover:text-on-gold"
                    >
                      <span className="inline-flex" style={s.color ? { color: s.color } : undefined}>
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

        {/* bottom bar */}
        <div className="flex flex-col items-center justify-between gap-5 border-t border-white/[0.06] py-8 sm:flex-row">
          <p className="text-xs text-zinc-600">
            © {year} {settings.copyright}
          </p>
          {settings.credit && <p className="text-xs text-zinc-600">{settings.credit}</p>}
          {settings.showBackToTop && (
            <a
              href="#top"
              className="group inline-flex items-center gap-2 rounded-full glass px-4 py-2 text-xs font-medium text-zinc-400 transition-all duration-300 hover:-translate-y-1 hover:text-white"
            >
              Back to top
              <ArrowUp className="h-3.5 w-3.5 transition-transform duration-300 group-hover:-translate-y-0.5" />
            </a>
          )}
        </div>
      </div>
    </footer>
  );
}

/** The live footer. Renders nothing when the footer section is switched off. */
export default function Footer() {
  const { content } = useSite();
  const settings = useMemo(() => resolveFooter(content.footer), [content.footer]);
  if (!settings.enabled) return null;
  return <FooterView settings={settings} />;
}
