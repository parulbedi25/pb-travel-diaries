import { useState } from "react";
import { ArrowUpRight, Check, PackageOpen, ShieldCheck } from "lucide-react";
import type { GearItem, GearsData } from "../store/siteContent";
import { isOn } from "../utils/enabled";
import { externalLinkProps } from "./ui/SocialIcons";
import { Item, Reveal, SectionHeader, Stagger } from "./ui/motion";
import Photo from "./ui/Photo";

function categoryName(item: GearItem): string {
  return (item.category ?? "").trim() || "Riding gear";
}

export default function Gears({ data }: { data: GearsData }) {
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const items = Array.isArray(data.items) ? data.items.filter(isOn) : [];

  // Keep categories in the order they first appear in the wardrobe, while
  // treating capitalization-only differences as the same category.
  const categoryMap = new Map<string, string>();
  for (const item of items) {
    const label = categoryName(item);
    const key = label.toLocaleLowerCase();
    if (!categoryMap.has(key)) categoryMap.set(key, label);
  }
  const categories = [...categoryMap.values()];
  const visibleItems = activeCategory
    ? items.filter(
        (item) => categoryName(item).toLocaleLowerCase() === activeCategory.toLocaleLowerCase()
      )
    : items;

  return (
    <section
      id="gears"
      aria-labelledby="gears-title"
      className="relative overflow-hidden py-24 sm:py-32"
    >
      <div
        className="pointer-events-none absolute left-1/2 top-0 h-80 w-[760px] -translate-x-1/2 rounded-full bg-saffron-400/[0.07] blur-[130px]"
        aria-hidden="true"
      />
      <div className="relative mx-auto max-w-7xl px-5 sm:px-8">
        <SectionHeader
          eyebrow={data.eyebrow}
          id="gears-title"
          title={
            <>
              {data.titleA}
              <span className="text-gradient">{data.titleHi}</span>
              {data.titleB}
            </>
          }
          sub={data.sub}
        />

        {items.length === 0 ? (
          <Reveal className="mx-auto mt-12 max-w-3xl">
            <div className="relative overflow-hidden rounded-[2rem] border border-dashed border-white/15 bg-white/[0.025] px-6 py-12 text-center sm:px-10 sm:py-16">
              <div
                className="pointer-events-none absolute left-1/2 top-0 h-40 w-64 -translate-x-1/2 rounded-full bg-saffron-400/[0.08] blur-[70px]"
                aria-hidden="true"
              />
              <div className="relative mx-auto grid h-14 w-14 place-items-center rounded-2xl border border-saffron-300/20 bg-saffron-300/[0.08] text-saffron-300">
                <PackageOpen className="h-6 w-6" aria-hidden="true" />
              </div>
              <h3 className="relative mt-5 font-display text-xl font-semibold text-white">
                {data.emptyTitle || "The kit is being packed."}
              </h3>
              <p className="relative mx-auto mt-2 max-w-lg text-sm leading-relaxed text-zinc-400">
                {data.emptyText || "Gear details will appear here as items are added."}
              </p>
            </div>
          </Reveal>
        ) : (
          <>
            <Reveal className="mt-10 flex flex-wrap items-center justify-between gap-4 border-y border-white/[0.08] py-4">
              <p className="flex items-center gap-2 text-xs font-medium text-zinc-400">
                <ShieldCheck className="h-4 w-4 text-saffron-300" aria-hidden="true" />
                Worn on the road. Chosen for the ride.
              </p>
              <div className="flex flex-wrap items-center gap-4">
                <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">
                  {items.length} {items.length === 1 ? "piece" : "pieces"}
                  <span className="mx-2 text-white/20">/</span>
                  {categories.length} {categories.length === 1 ? "category" : "categories"}
                </p>
                <a href="#/shop" className="inline-flex items-center gap-1.5 text-xs font-semibold text-saffron-300 transition-colors hover:text-saffron-200">
                  Shop My Picks <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
                </a>
              </div>
            </Reveal>

            <div className="mt-7 flex flex-wrap items-center justify-center gap-2" role="group" aria-label="Filter riding gear by category">
              <button
                type="button"
                aria-pressed={activeCategory === null}
                onClick={() => setActiveCategory(null)}
                className={`inline-flex items-center gap-2 rounded-full border px-4 py-2 text-xs font-semibold transition-colors ${
                  activeCategory === null
                    ? "border-saffron-300/40 bg-saffron-300/10 text-saffron-200"
                    : "border-white/10 bg-white/[0.03] text-zinc-400 hover:border-white/20 hover:text-white"
                }`}
              >
                All gear <span className="font-mono text-[10px] opacity-70">{items.length}</span>
              </button>
              {categories.map((category) => {
                const selected = activeCategory?.toLocaleLowerCase() === category.toLocaleLowerCase();
                const count = items.filter(
                  (item) => categoryName(item).toLocaleLowerCase() === category.toLocaleLowerCase()
                ).length;
                return (
                  <button
                    key={category.toLocaleLowerCase()}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => setActiveCategory(selected ? null : category)}
                    className={`inline-flex items-center gap-2 rounded-full border px-4 py-2 text-xs font-semibold transition-colors ${
                      selected
                        ? "border-saffron-300/40 bg-saffron-300/10 text-saffron-200"
                        : "border-white/10 bg-white/[0.03] text-zinc-400 hover:border-white/20 hover:text-white"
                    }`}
                  >
                    {category} <span className="font-mono text-[10px] opacity-70">{count}</span>
                  </button>
                );
              })}
            </div>

            {visibleItems.length > 0 ? (
              <Stagger className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
                {visibleItems.map((item, index) => {
                  const title = item.name?.trim() || [item.brand, item.model].filter(Boolean).join(" ") || "Gear item";
                  const maker = [item.brand, item.model].map((value) => value?.trim()).filter(Boolean).join(" · ");
                  const highlights = Array.isArray(item.highlights)
                    ? item.highlights.map((value) => value.trim()).filter(Boolean).slice(0, 3)
                    : [];
                  const alt = item.imageAlt?.trim() || title;
                  const localGearPhoto = item.image?.startsWith("/images/gear/") ?? false;

                  return (
                    <Item key={`${title}-${index}`}>
                      <article className="group flex h-full flex-col overflow-hidden rounded-[1.75rem] border border-white/[0.09] bg-white/[0.025] transition-colors duration-300 hover:border-saffron-300/30 hover:bg-white/[0.04]">
                        <div className={`relative aspect-[4/3] overflow-hidden ${localGearPhoto ? "product-plate" : "bg-ink-900"}`}>
                          {item.image ? (
                            <Photo
                              src={item.image}
                              alt={alt}
                              className={localGearPhoto
                                ? "h-full w-full object-contain transition-transform duration-500 group-hover:scale-[1.03]"
                                : "h-full w-full object-cover transition-transform duration-700 group-hover:scale-[1.04]"}
                              label="Gear photo unavailable"
                            />
                          ) : (
                            <div className="grid h-full w-full place-items-center bg-[radial-gradient(ellipse_at_center,_rgba(245,158,11,0.12),_transparent_60%)] photo-empty-mark">
                              <div className="flex flex-col items-center gap-3">
                                <PackageOpen className="h-8 w-8" aria-hidden="true" />
                                <span className="font-mono text-[9px] uppercase tracking-[0.22em] text-zinc-500">Gear photo</span>
                              </div>
                            </div>
                          )}
                          {!localGearPhoto && <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-ink-950/80 via-transparent to-ink-950/15" />}
                          <span className="absolute left-4 top-4 rounded-full border border-white/15 bg-ink-950/65 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-white backdrop-blur-md">
                            {categoryName(item)}
                          </span>
                          {item.price?.trim() && (
                            <span className="absolute right-4 top-4 rounded-full border border-saffron-300/25 bg-ink-950/70 px-3 py-1.5 font-mono text-[10px] font-semibold text-saffron-200 backdrop-blur-md">
                              {item.price}
                            </span>
                          )}
                        </div>

                        <div className="flex flex-1 flex-col p-5 sm:p-6">
                          {maker && (
                            <p className="font-mono text-[9px] uppercase tracking-[0.2em] text-saffron-300/80">
                              {maker}
                            </p>
                          )}
                          <h3 className="mt-2 font-display text-xl font-semibold leading-snug text-white">
                            {title}
                          </h3>
                          {item.description?.trim() && (
                            <p className="mt-3 text-sm leading-relaxed text-zinc-400">{item.description}</p>
                          )}

                          {(item.fit?.trim() || item.usedFor?.trim()) && (
                            <div className="mt-4 grid gap-2 border-t border-white/[0.07] pt-4">
                              {item.fit?.trim() && (
                                <p className="text-xs text-zinc-300">
                                  <span className="mr-2 font-mono text-[9px] uppercase tracking-[0.16em] text-zinc-600">Fit</span>
                                  {item.fit}
                                </p>
                              )}
                              {item.usedFor?.trim() && (
                                <p className="text-xs text-zinc-300">
                                  <span className="mr-2 font-mono text-[9px] uppercase tracking-[0.16em] text-zinc-600">Used for</span>
                                  {item.usedFor}
                                </p>
                              )}
                            </div>
                          )}

                          {highlights.length > 0 && (
                            <ul className="mt-4 space-y-2 border-t border-white/[0.07] pt-4">
                              {highlights.map((highlight, highlightIndex) => (
                                <li key={`${highlight}-${highlightIndex}`} className="flex gap-2 text-xs leading-relaxed text-zinc-400">
                                  <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-saffron-300" aria-hidden="true" />
                                  <span>{highlight}</span>
                                </li>
                              ))}
                            </ul>
                          )}

                          {item.link?.trim() && (
                            <a
                              href={item.link.trim()}
                              {...externalLinkProps(item.link)}
                              className="mt-auto inline-flex w-fit items-center gap-2 pt-5 text-xs font-semibold text-saffron-300 transition-colors hover:text-saffron-200"
                            >
                              View gear details <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
                            </a>
                          )}
                        </div>
                      </article>
                    </Item>
                  );
                })}
              </Stagger>
            ) : (
              <div className="mt-10 rounded-2xl border border-white/10 bg-white/[0.025] px-5 py-8 text-center">
                <p className="text-sm text-zinc-400">No gear in this category right now.</p>
                <button
                  type="button"
                  onClick={() => setActiveCategory(null)}
                  className="mt-3 text-xs font-semibold text-saffron-300 hover:text-saffron-200"
                >
                  Show all gear
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
}
