import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { Check, Play } from "lucide-react";
import { resolveFooter, useSite, type BenefitsData } from "../store/siteContent";
import Photo from "./ui/Photo";
import { IMAGES, SHOWREEL_VIDEO } from "../data/content";
import { SectionHeader, Reveal, Stagger, Item } from "./ui/motion";
import { isOn } from "../utils/enabled";
import { externalLinkProps, resolveSocialIcon } from "./ui/SocialIcons";

export default function Benefits({ data }: { data: BenefitsData }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [paused, setPaused] = useState(true);
  const [videoError, setVideoError] = useState(false);
  const userPaused = useRef(false);
  const videoSource = data.videoUrl || SHOWREEL_VIDEO;
  const videoPoster = data.videoPoster || (videoSource === SHOWREEL_VIDEO ? IMAGES.videoPoster : undefined);
  const { content } = useSite();
  const socialLinks = useMemo(
    () => resolveFooter(content.footer).socials.filter((s) => s.enabled && s.href.trim()),
    [content.footer]
  );

  // Autoplay only while visible, without overriding a manual pause or reduced motion.
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    userPaused.current = false;
    setVideoError(false);
    let inView = false;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => {
      if (inView && !document.hidden && !userPaused.current && !reduced.matches) {
        v.preload = "auto";
        void v.play().catch(() => {});
      } else v.pause();
    };
    const io = new IntersectionObserver(([entry]) => {
      inView = entry.isIntersecting;
      sync();
    }, { threshold: 0.1 });
    io.observe(v);
    document.addEventListener("visibilitychange", sync);
    reduced.addEventListener("change", sync);
    return () => {
      io.disconnect();
      document.removeEventListener("visibilitychange", sync);
      reduced.removeEventListener("change", sync);
      v.pause();
    };
  }, [videoSource]);

  const togglePlayback = () => {
    const v = videoRef.current;
    if (!v) return;
    userPaused.current = !v.paused;
    if (v.paused) void v.play().catch(() => {});
    else v.pause();
  };

  return () => io.disconnect();
  }, []);

  const toggleMute = () => {
    const v = videoRef.current;
    if (!v) return;
    v.muted = !v.muted;
    setMuted(v.muted);
  };

  return (
    <section id="showreel" aria-labelledby="benefits-title" className="relative py-24 sm:py-32">
      <div
        className="pointer-events-none absolute -left-32 top-1/3 h-96 w-96 rounded-full bg-saffron-400/6 blur-[130px]"
        aria-hidden
      />
      <div className="relative mx-auto max-w-7xl px-5 sm:px-8">
        <SectionHeader
          eyebrow={data.eyebrow}
          id="benefits-title"
          title={
            <>
              {data.titleA}
              <span className="text-gradient">{data.titleHi}</span>
              {data.titleB}
            </>
          }
          sub={data.sub}
        />

        {/* showreel banner */}
        <Reveal className="mt-14">
          <div className="group relative overflow-hidden rounded-[2rem] border border-white/10 shadow-2xl shadow-black/50">
            <video
              ref={videoRef}
              className="aspect-[16/10] w-full object-cover sm:aspect-[21/9]"
              src={videoSource}
              poster={videoPoster}
              onPlay={() => setPaused(false)}
              onPause={() => setPaused(true)}
              onError={() => setVideoError(true)}
              muted
              loop
              playsInline
              preload="none"
              aria-label="Looping aerial drone video"
            />
            <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-ink-950/90 via-ink-950/20 to-ink-950/30" />

            <button
              onClick={togglePlayback}
              style={{ zIndex: 2 }}
              aria-label={paused ? "Play drone video" : "Pause drone video"}
              aria-pressed={!paused}
              className="absolute right-5 top-5 grid h-11 w-11 place-items-center rounded-full bg-ink-950/55 text-white backdrop-blur-md transition-all duration-300 hover:scale-105 hover:bg-ink-950/75 active:scale-95"
            >
              {paused ? <Play className="h-4.5 w-4.5" /> : <span aria-hidden="true">Ⅱ</span>}
            </button>

            <div className="absolute inset-x-0 bottom-0 flex flex-wrap items-end justify-between gap-4 p-6 sm:p-9">
              <div>
                <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.24em] text-saffron-300">
                  <Play className="h-3.5 w-3.5 fill-current" /> Above the everyday
                </p>
                <p className="mt-2 font-display text-lg font-semibold tracking-tight text-white sm:text-3xl">
                  {data.videoLine === "8 years · 28 states · 140,000 km — in 40 seconds" ? "A new perspective. An endless journey." : data.videoLine}
                </p>
              </div>
              <div className="flex flex-wrap gap-2.5">
                {data.videoChips.map((chip) => (
                  <span
                    key={chip}
                    className="rounded-full bg-white/[0.09] px-3.5 py-1.5 text-xs font-medium text-white backdrop-blur-md"
                  >
                    {chip}
                  </span>
                ))}
              </div>
            </div>
          </div>
          {videoError && <p role="status" className="mt-3 text-sm text-zinc-400">Video unavailable. You can replace it in the section editor.</p>}
          {videoSource === SHOWREEL_VIDEO && (
            <a href="/media/starter/credits.html?v=drone-loop-1" className="mt-3 block text-center text-xs text-zinc-500 underline underline-offset-4">
              Illustrative stock drone footage · ArtHouse Studio · Video credits
            </a>
          )}
        </Reveal>

        {/* portrait + personas */}
        <div className="mt-14 grid gap-6 lg:grid-cols-12">
          <Reveal className="lg:col-span-5">
            <div className="group relative h-full min-h-[420px] overflow-hidden rounded-[2rem] border border-white/10">
              <Photo
                src={IMAGES.portrait}
                alt="PB filming the mountains with his camera"
                className="absolute inset-0 h-full w-full object-cover transition-transform duration-[1.4s] ease-out group-hover:scale-105"
                label="Photo unavailable"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-ink-950 via-ink-950/30 to-transparent" />
              <div className="absolute inset-x-0 bottom-0 p-7 sm:p-8">
                <p className="font-display text-xl font-semibold leading-snug text-white">
                  "{data.quote}"
                </p>
                <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <span className="grid h-10 w-10 place-items-center rounded-full bg-saffron-400 font-display text-xs font-bold text-on-gold">
                      PB
                    </span>
                    <div>
                      <p className="text-sm font-semibold text-white">PB · Parul Bedi</p>
                      <p className="text-xs text-zinc-400">Creator, rider, storyteller · Nangal Dam, Punjab</p>
                    </div>
                  </div>
                  {socialLinks.length > 0 && (
                    <div className="flex flex-wrap justify-end gap-2">
                      {socialLinks.map((social) => {
                        const Icon = resolveSocialIcon(social);
                        return (
                          <a
                            key={social.id}
                            href={social.href.trim()}
                            {...externalLinkProps(social.href)}
                            aria-label={social.label}
                            className="social-link grid h-8 w-8 place-items-center rounded-full bg-white/[0.08] text-zinc-300 backdrop-blur-md transition-all duration-300 hover:scale-110 hover:bg-white hover:text-ink-950"
                          >
                            <span
                                className="social-glyph inline-flex"
                                style={
                                  social.color ? ({ "--social-glyph-color": social.color } as CSSProperties) : undefined
                                }
                              >
                              {Icon ? <Icon className="h-3.5 w-3.5" /> : <span className="text-xs">{social.label[0]}</span>}
                            </span>
                          </a>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </Reveal>

          <Stagger className="flex flex-col gap-5 lg:col-span-7">
            {data.personas.filter(isOn).map((p) => (
              <Item key={p.tag} className="flex-1">
                <article className="group flex h-full flex-col justify-center rounded-[2rem] glass p-7 transition-all duration-500 hover:-translate-y-1 hover:border-white/20 sm:p-8">
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                    <span className="rounded-full bg-saffron-400/15 px-3.5 py-1.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-saffron-300">
                      {p.tag}
                    </span>
                    <h3 className="font-display text-xl font-semibold tracking-tight text-white">
                      {p.title}
                    </h3>
                  </div>
                  <ul className="mt-5 grid gap-3 sm:grid-cols-3">
                    {p.points.map((pt) => (
                      <li key={pt} className="flex items-start gap-2.5 text-[13px] leading-snug text-zinc-400">
                        <span className="mt-0.5 grid h-4.5 w-4.5 shrink-0 place-items-center rounded-full bg-emerald-400/15">
                          <Check className="h-3 w-3 text-emerald-300" />
                        </span>
                        {pt}
                      </li>
                    ))}
                  </ul>
                </article>
              </Item>
            ))}
          </Stagger>
        </div>
      </div>
    </section>
  );
}
