import { ArrowUpRight, Film } from "lucide-react";
import type { InstagramData, YouTubeData } from "../store/siteContent";
import { isOn } from "../utils/enabled";
import { SectionHeader, Reveal, Stagger, Item } from "./ui/motion";
import { InstagramIcon, YouTubeIcon } from "./ui/SocialIcons";

function youtubeId(url: string): string | null {
  const value = url.trim();
  if (/^[\w-]{11}$/.test(value)) return value;
  try {
    const parsed = new URL(value);
    if (parsed.hostname.includes("youtu.be")) return parsed.pathname.split("/").filter(Boolean)[0] ?? null;
    if (parsed.pathname.startsWith("/shorts/") || parsed.pathname.startsWith("/embed/")) {
      return parsed.pathname.split("/").filter(Boolean)[1] ?? null;
    }
    return parsed.searchParams.get("v");
  } catch {
    return null;
  }
}

function instagramEmbed(url: string): string | null {
  try {
    const parsed = new URL(url.trim());
    if (!parsed.hostname.includes("instagram.com")) return null;
    const parts = parsed.pathname.split("/").filter(Boolean);
    if (!parts[0] || !parts[1] || !["p", "reel", "tv"].includes(parts[0])) return null;
    return `https://www.instagram.com/${parts[0]}/${parts[1]}/embed/captioned/`;
  } catch {
    return null;
  }
}

export function YouTubeSection({ data }: { data: YouTubeData }) {
  const items = data.items.filter(isOn);
  return (
    <section id="youtube" aria-labelledby="youtube-title" className="relative scroll-mt-28 py-24 sm:py-32">
      <div className="mx-auto max-w-7xl px-5 sm:px-8">
        <SectionHeader
          eyebrow={data.eyebrow}
          id="youtube-title"
          title={<>{data.titleA}<span className="text-gradient">{data.titleHi}</span>{data.titleB}</>}
          sub={data.sub}
        />
        {items.length ? (
          <Stagger className="mt-14 grid gap-6 md:grid-cols-2">
            {items.map((item, i) => {
              const id = youtubeId(item.url);
              return (
                <Item key={`${item.url}-${i}`}>
                  <article className="overflow-hidden rounded-[2rem] border border-white/10 bg-white/[0.03]">
                    {id ? (
                      <iframe
                        src={`https://www.youtube-nocookie.com/embed/${id}`}
                        title={item.title || `YouTube video ${i + 1}`}
                        loading="lazy"
                        className="aspect-video w-full"
                        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                        referrerPolicy="strict-origin-when-cross-origin"
                        allowFullScreen
                      />
                    ) : (
                      <div className="grid aspect-video place-items-center bg-white/[0.03] text-zinc-600">
                        <Film className="h-8 w-8" />
                      </div>
                    )}
                    <div className="p-5">
                      <h3 className="font-display text-lg font-semibold text-white">{item.title}</h3>
                      {item.description && <p className="mt-2 text-sm leading-relaxed text-zinc-400">{item.description}</p>}
                      <a href={item.url} target="_blank" rel="noreferrer" className="mt-4 inline-flex items-center gap-1.5 text-xs font-semibold text-saffron-300 hover:text-saffron-400">
                        Open on YouTube <ArrowUpRight className="h-3.5 w-3.5" />
                      </a>
                    </div>
                  </article>
                </Item>
              );
            })}
          </Stagger>
        ) : (
          <p className="mt-14 text-center text-sm text-zinc-500">Add YouTube videos from the dashboard.</p>
        )}
        {data.channelLabel && data.channelHref && (
          <Reveal className="mt-10 text-center">
            <a href={data.channelHref} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 rounded-full bg-white px-6 py-3 text-sm font-semibold text-ink-950 transition-transform active:scale-95">
              <YouTubeIcon className="h-4 w-4" /> {data.channelLabel} <ArrowUpRight className="h-4 w-4" />
            </a>
          </Reveal>
        )}
      </div>
    </section>
  );
}

export function InstagramSection({ data }: { data: InstagramData }) {
  const items = data.items.filter(isOn);
  return (
    <section id="instagram" aria-labelledby="instagram-title" className="relative scroll-mt-28 py-24 sm:py-32">
      <div className="mx-auto max-w-7xl px-5 sm:px-8">
        <SectionHeader
          eyebrow={data.eyebrow}
          id="instagram-title"
          title={<>{data.titleA}<span className="text-gradient">{data.titleHi}</span>{data.titleB}</>}
          sub={data.sub}
        />
        {items.length ? (
          <Stagger className="mt-14 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {items.map((item, i) => {
              const embed = instagramEmbed(item.url);
              return (
                <Item key={`${item.url}-${i}`}>
                  <article className="overflow-hidden rounded-[2rem] border border-white/10 bg-white/[0.03]">
                    {embed ? (
                      <iframe
                        src={embed}
                        title={item.title || `Instagram post ${i + 1}`}
                        loading="lazy"
                        className="h-[520px] w-full bg-white"
                        allow="encrypted-media"
                      />
                    ) : (
                      <div className="grid aspect-[4/5] place-items-center bg-white/[0.03] text-zinc-600">
                        <InstagramIcon className="h-8 w-8" />
                      </div>
                    )}
                    <div className="p-5">
                      <h3 className="font-display text-base font-semibold text-white">{item.title}</h3>
                      {item.caption && <p className="mt-2 text-sm leading-relaxed text-zinc-400">{item.caption}</p>}
                      <a href={item.url} target="_blank" rel="noreferrer" className="mt-4 inline-flex items-center gap-1.5 text-xs font-semibold text-saffron-300 hover:text-saffron-400">
                        Open on Instagram <ArrowUpRight className="h-3.5 w-3.5" />
                      </a>
                    </div>
                  </article>
                </Item>
              );
            })}
          </Stagger>
        ) : (
          <p className="mt-14 text-center text-sm text-zinc-500">Add public Instagram post or reel links from the dashboard.</p>
        )}
        {data.profileLabel && data.profileHref && (
          <Reveal className="mt-10 text-center">
            <a href={data.profileHref} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 rounded-full bg-saffron-400 px-6 py-3 text-sm font-semibold text-on-gold transition-transform active:scale-95">
              <InstagramIcon className="h-4 w-4" /> {data.profileLabel} <ArrowUpRight className="h-4 w-4" />
            </a>
          </Reveal>
        )}
      </div>
    </section>
  );
}