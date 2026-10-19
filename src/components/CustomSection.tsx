import { useEffect, useRef, useState } from "react";
import { ArrowUpRight } from "lucide-react";
import type { CustomData, SectionEntry } from "../store/siteContent";
import { useSite } from "../store/siteContent";
import type { SectionBlock } from "../blocks/types";
import BlockCanvas from "./blocks/BlockCanvas";
import { Reveal } from "./ui/motion";
import { cn } from "../utils/cn";

/**
 * A `custom` section renders one of two ways.
 *
 * Sections created before the composer shipped carry the original fixed
 * fields (eyebrow, title, sub, image, button) and keep rendering exactly as
 * they always have. A section whose data carries a `blocks` array is a
 * composed section and renders those blocks instead.
 */
export default function CustomSection({
  data,
  entry,
}: {
  data: CustomData;
  entry?: SectionEntry;
}) {
  const raw = entry?.data?.blocks;
  if (Array.isArray(raw)) {
    return <ComposedSection entry={entry!} blocks={raw as SectionBlock[]} />;
  }
  return <LegacyCustomSection data={data} />;
}

function ComposedSection({
  entry,
  blocks,
}: {
  entry: SectionEntry;
  blocks: SectionBlock[];
}) {
  const { draft, updateSectionField, saveDraft, previewAsVisitor, account } = useSite();
  const admin = Boolean(account) && !previewAsVisitor;

  // While building, show the working copy so an edit appears the moment it is
  // typed. `updateSectionField` only writes the draft, and the published
  // content is what visitors see.
  const draftBlocks = draft.sections.find((s) => s.id === entry.id)?.data?.blocks;
  const shown = (admin && Array.isArray(draftBlocks) ? draftBlocks : blocks) as SectionBlock[];

  // Publishing has to wait for the draft to settle: `saveDraft` closes over
  // the draft, so calling it in the same tick as the edit would publish the
  // previous state. `tick` covers commits with no draft change, such as
  // closing the editor after typing.
  const pending = useRef(false);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!pending.current) return;
    pending.current = false;
    saveDraft("Edited a composed section");
  }, [draft, tick, saveDraft]);

  const publish = () => {
    pending.current = true;
    setTick((t) => t + 1);
  };

  return (
    <section aria-label={entry.label || "Section"} className="relative py-20 sm:py-28">
      <div className="mx-auto max-w-7xl px-5 sm:px-8">
        <BlockCanvas
          blocks={shown}
          editable={admin}
          sectionLabel={entry.label}
          onChange={(next) => updateSectionField(entry.id, entry.label, "blocks", next)}
          onCommit={publish}
        />
      </div>
    </section>
  );
}

function LegacyCustomSection({ data }: { data: CustomData }) {
  const imageRight = data.layout === "image-right";

  return (
    <section aria-label={data.title || "Section"} className="relative py-20 sm:py-28">
      <div className="mx-auto max-w-7xl px-5 sm:px-8">
        <div
          className={cn(
            "grid items-center gap-10 lg:gap-16",
            data.image ? "lg:grid-cols-2" : "mx-auto max-w-3xl text-center"
          )}
        >
          <Reveal className={cn(data.image && imageRight && "lg:order-2")}>
            {data.eyebrow && (
              <span className="inline-flex items-center gap-2 rounded-full glass px-4 py-1.5 text-[11px] font-semibold uppercase tracking-[0.22em] text-saffron-300">
                <span className="h-1.5 w-1.5 rounded-full bg-saffron-400" />
                {data.eyebrow}
              </span>
            )}
            <h2 className="mt-5 font-display text-3xl font-semibold leading-[1.08] tracking-tight text-white sm:text-4xl lg:text-[2.75rem] text-balance">
              {data.title}
            </h2>
            {data.sub && (
              <p className="mt-5 text-base leading-relaxed text-zinc-400 sm:text-lg">{data.sub}</p>
            )}
            {data.buttonLabel && (
              <a
                href={data.buttonHref || "#"}
                className="group mt-8 inline-flex items-center gap-2 rounded-full bg-saffron-400 px-7 py-4 font-display text-[15px] font-semibold text-on-gold shadow-xl shadow-saffron-400/30 transition-all duration-300 hover:brightness-110 active:scale-95"
              >
                {data.buttonLabel}
                <ArrowUpRight className="h-4 w-4 transition-transform duration-300 group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
              </a>
            )}
          </Reveal>

          {data.image && (
            <Reveal delay={0.12} className={cn(imageRight ? "lg:order-1" : "")}>
              <div className="group overflow-hidden rounded-[2rem] border border-white/10 shadow-2xl shadow-black/50">
                <img
                  src={data.image}
                  alt={data.imageAlt || data.title}
                  loading="lazy"
                  className="aspect-[16/10] w-full object-cover transition-transform duration-[1.4s] ease-out group-hover:scale-105"
                />
              </div>
            </Reveal>
          )}
        </div>
      </div>
    </section>
  );
}
