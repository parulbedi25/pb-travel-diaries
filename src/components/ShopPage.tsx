import { useEffect, useMemo, useState } from "react";
import { ArrowUpRight, Check, PackageOpen, ShoppingBag } from "lucide-react";
import { useSite, type GearItem } from "../store/siteContent";
import { isOn } from "../utils/enabled";
import { cn } from "../utils/cn";
import { externalLinkProps } from "./ui/SocialIcons";
import { Item, Reveal, Stagger } from "./ui/motion";
import Photo from "./ui/Photo";
import Navbar from "./Navbar";
import Footer from "./Footer";

function productTitle(item: GearItem): string {
  return item.name?.trim() || [item.brand, item.model].filter(Boolean).join(" ") || "Gear item";
}

function productCategory(item: GearItem): string {
  return item.category?.trim() || "Riding gear";
}

function productCategoryKey(item: GearItem): string {
  return productCategory(item).toLocaleLowerCase();
}

function productKey(item: GearItem): string {
  return item.id?.trim() || [item.name, item.brand, item.model, item.image, item.link]
    .map((value) => value?.trim() ?? "")
    .join("|");
}

const EMPTY_ITEMS: GearItem[] = [];

export default function ShopPage() {
  const { content } = useSite();
  const [activeCategoryKey, setActiveCategoryKey] = useState<string | null>(null);
  // Read the saved My Picks list directly. Do not merge or seed sample products on this page.
  const gearSection = content.sections.find((section) => section.type === "gears");
  const catalogItems = Array.isArray(gearSection?.data.items)
    ? gearSection.data.items as GearItem[]
    : EMPTY_ITEMS;
  const items = useMemo(
    () => catalogItems.filter((item) => Boolean(item) && isOn(item)),
    [catalogItems],
  );
  const categories = useMemo(() => {
    const byKey = new Map<string, { key: string; label: string; count: number }>();
    items.forEach((item) => {
      const key = productCategoryKey(item);
      const current = byKey.get(key);
      if (current) current.count += 1;
      else byKey.set(key, { key, label: productCategory(item), count: 1 });
    });
    return [...byKey.values()];
  }, [items]);
  useEffect(() => {
    if (activeCategoryKey && !categories.some((category) => category.key === activeCategoryKey)) {
      setActiveCategoryKey(null);
    }
  }, [activeCategoryKey, categories]);
  const visibleItems = useMemo(
    () => activeCategoryKey
      ? items.filter((item) => productCategoryKey(item) === activeCategoryKey)
      : items,
    [items, activeCategoryKey],
  );

  return (
    <div className="min-h-screen overflow-hidden bg-ink-950 text-white">
      <Navbar />
      <main className="relative min-h-[70vh] pb-24 pt-32 sm:pt-40">
        <div className="pointer-events-none absolute left-1/2 top-16 h-80 w-[min(90vw,52rem)] -translate-x-1/2 rounded-full bg-saffron-400/[0.08] blur-[130px]" aria-hidden="true" />
        <div className="relative mx-auto max-w-7xl px-5 sm:px-8">
          <Reveal>
            <div className="mx-auto max-w-3xl text-center">
              <p className="inline-flex items-center gap-2 rounded-full border border-saffron-300/20 bg-saffron-300/[0.07] px-3.5 py-2 font-mono text-[9px] font-semibold uppercase tracking-[0.2em] text-saffron-200">
                <ShoppingBag className="h-3.5 w-3.5" aria-hidden="true" /> Shop collection
              </p>
              <h1 className="mt-6 font-display text-4xl font-bold tracking-tight text-white sm:text-6xl">
                My <span className="text-gradient">Picks.</span>
              </h1>
              <p className="mx-auto mt-5 max-w-2xl text-sm leading-relaxed text-zinc-400 sm:text-base">
                Browse the current gear picks, including their brand details and purchase links. Prices and availability can change; check each product page for the latest information.
              </p>
              <p className="mt-5 font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">
                {items.length} {items.length === 1 ? "pick" : "picks"} in the current list
              </p>
            </div>
          </Reveal>

          {items.length === 0 ? (
            <Reveal className="mx-auto mt-12 max-w-3xl">
              <div className="rounded-[2rem] border border-dashed border-white/15 bg-white/[0.025] px-6 py-14 text-center">
                <PackageOpen className="mx-auto h-7 w-7 text-saffron-300/75" aria-hidden="true" />
                <h2 className="mt-4 font-display text-xl font-semibold text-white">No picks published</h2>
                <p className="mt-2 text-sm text-zinc-500">This page only displays products already in the current gear list.</p>
              </div>
            </Reveal>
          ) : (
            <>
              {categories.length > 1 && (
                <Reveal className="mt-10">
                  <div className="flex flex-wrap justify-center gap-2" role="group" aria-label="Filter My Picks by category">
                    <button
                      type="button"
                      aria-pressed={activeCategoryKey === null}
                      onClick={() => setActiveCategoryKey(null)}
                      className={cn(
                        "rounded-full border px-4 py-2 text-xs font-semibold transition-colors",
                        activeCategoryKey === null ? "border-saffron-300/40 bg-saffron-300/10 text-saffron-200" : "border-white/10 bg-white/[0.03] text-zinc-400 hover:border-white/20 hover:text-white"
                      )}
                    >
                      All picks <span className="ml-1 font-mono text-[10px] opacity-70">{items.length}</span>
                    </button>
                    {categories.map((category) => {
                      const selected = activeCategoryKey === category.key;
                      return (
                        <button
                          key={category.key}
                          type="button"
                          aria-pressed={selected}
                          onClick={() => setActiveCategoryKey(category.key)}
                          className={cn(
                            "rounded-full border px-4 py-2 text-xs font-semibold transition-colors",
                            selected ? "border-saffron-300/40 bg-saffron-300/10 text-saffron-200" : "border-white/10 bg-white/[0.03] text-zinc-400 hover:border-white/20 hover:text-white"
                          )}
                        >
                          {category.label} <span className="ml-1 font-mono text-[10px] opacity-70">{category.count}</span>
                        </button>
                      );
                    })}
                  </div>
                </Reveal>
              )}

              {visibleItems.length ? (
                <Stagger key={activeCategoryKey === null ? "filter:all" : `filter:${activeCategoryKey}`} className="mt-9 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
                  {visibleItems.map((item) => {
                    const title = productTitle(item);
                    const maker = [item.brand, item.model].map((value) => value?.trim()).filter(Boolean).join(" · ");
                    const highlights = Array.isArray(item.highlights)
                      ? item.highlights.map((value) => value?.trim()).filter((value): value is string => Boolean(value)).slice(0, 3)
                      : [];
                    const localImage = item.image?.startsWith("/images/gear/") ?? false;
                    return (
                      <Item key={productKey(item)}>
                        <article className="group flex h-full flex-col overflow-hidden rounded-[1.75rem] border border-white/[0.09] bg-white/[0.025] transition-colors hover:border-saffron-300/30 hover:bg-white/[0.04]">
                          <div className={cn("relative aspect-[4/3] overflow-hidden", localImage ? "bg-white" : "bg-ink-900")}>
                            {item.image ? (
                              <Photo
                                src={item.image}
                                alt={item.imageAlt?.trim() || title}
                                className={cn("h-full w-full transition-transform duration-500 group-hover:scale-[1.035]", localImage ? "object-contain" : "object-cover")}
                                label="Product image unavailable"
                              />
                            ) : (
                              <div className="grid h-full place-items-center bg-white/[0.03] text-zinc-500">
                                <PackageOpen className="h-7 w-7" aria-hidden="true" />
                              </div>
                            )}
                            <span className="absolute left-4 top-4 rounded-full border border-white/15 bg-ink-950/70 px-3 py-1.5 text-[9px] font-semibold uppercase tracking-[0.16em] text-white backdrop-blur-md">
                              {item.category?.trim() || "Riding gear"}
                            </span>
                            {item.price?.trim() && (
                              <span className="absolute right-4 top-4 rounded-full border border-saffron-300/25 bg-ink-950/80 px-3 py-1.5 font-mono text-[10px] font-semibold text-saffron-200 backdrop-blur-md">
                                {item.price}
                              </span>
                            )}
                          </div>
                          <div className="flex flex-1 flex-col p-5 sm:p-6">
                            {maker && <p className="font-mono text-[9px] uppercase tracking-[0.18em] text-saffron-300/80">{maker}</p>}
                            <h2 className="mt-2 font-display text-xl font-semibold leading-snug text-white">{title}</h2>
                            {item.description?.trim() && <p className="mt-3 text-sm leading-relaxed text-zinc-400">{item.description}</p>}
                            {(item.fit?.trim() || item.usedFor?.trim()) && (
                              <div className="mt-4 grid gap-2 border-t border-white/[0.07] pt-4">
                                {item.fit?.trim() && <p className="text-xs text-zinc-300"><span className="mr-2 font-mono text-[9px] uppercase tracking-[0.15em] text-zinc-600">Fit</span>{item.fit}</p>}
                                {item.usedFor?.trim() && <p className="text-xs text-zinc-300"><span className="mr-2 font-mono text-[9px] uppercase tracking-[0.15em] text-zinc-600">Use</span>{item.usedFor}</p>}
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
                                View product <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
                              </a>
                            )}
                          </div>
                        </article>
                      </Item>
                    );
                  })}
                </Stagger>
              ) : (
                <div className="mt-10 text-center text-sm text-zinc-500">No picks in this category.</div>
              )}
            </>
          )}
        </div>
      </main>
      <Footer />
    </div>
  );
}
