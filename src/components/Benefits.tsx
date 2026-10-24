import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { Check, Volume2, VolumeX, Play } from "lucide-react";
import { resolveFooter, useSite, type BenefitsData } from "../store/siteContent";
import Photo from "./ui/Photo";
import { IMAGES, SHOWREEL_VIDEO } from "../data/content";
import { SectionHeader, Reveal, Stagger, Item } from "./ui/motion";
import { isOn } from "../utils/enabled";
import { externalLinkProps, resolveSocialIcon } from "./ui/SocialIcons";

export default function Benefits({ data }: { data: BenefitsData }) {
  // The section film is a content field, so the owner can swap the drone shot
  // for their own from the dashboard. The old constant stays as a last resort
  // for content saved before the field existed.
  const videoSrc = data.videoSrc || SHOWREEL_VIDEO;
  const videoPoster = data.videoPoster || IMAGES.videoPoster;
  const videoRef = useRef<HTMLVideoElement>(null);
  const [muted, setMuted] = useState(true);
  const { content } = useSite();
  const socialLinks = useMemo(
    () => resolveFooter(content.footer).socials.filter((s) => s.enabled && s.href.trim()),
    [content.footer]
  );

  // Only fetch + play the showreel once it scrolls into view; pause when it leaves.
  // Saves the whole 4K download for visitors who never reach this section.
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) {
          if (v.preload === "none") v.preload = "auto";
          void v.play().catch(() => {});
        } else {
          v.pause();
        }
      },
      { rootMargin: "200px 0px", threshold: 0.1 }
    );
    io.observe(v);
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
              {...(videoSrc ? { src: videoSrc, poster: videoPoster } : {})}
              muted
              loop
              playsInline
              preload="none"
              aria-label="Drone film of a green Himalayan valley"
            />
            <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-ink-950/90 via-ink-950/20 to-ink-950/30" />

            <button
              onClick={toggleMute}
              aria-label={muted ? "Unmute showreel" : "Mute showreel"}
              className="absolute right-5 top-5 grid h-11 w-11 place-items-center rounded-full bg-ink-950/55 text-white backdrop-blur-md transition-all duration-300 hover:scale-105 hover:bg-ink-950/75 active:scale-95"
            >
              {muted ? <VolumeX className="h-4.5 w-4.5" /> : <Volume2 className="h-4.5 w-4.5" />}
            </button>

            <div className="absolute inset-x-0 bottom-0 flex flex-wrap items-end justify-between gap-4 p-6 sm:p-9">
              <div>
                <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.24em] text-saffron-300">
                  <Play className="h-3.5 w-3.5 fill-current" /> The road so far
                </p>
                <p className="mt-2 font-display text-2xl font-semibold tracking-tight text-white sm:text-3xl">
                  {data.videoLine}
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
