import { useState } from "react";
import { ArrowUpRight, Check, ImageOff, Quote as QuoteIcon } from "lucide-react";
import { cn } from "../../utils/cn";
import { images, items, str, type SectionBlock } from "../../blocks/types";

/**
 * Renders one block the way a visitor sees it.
 *
 * `admin` only changes empty states: a block with no photo or no entries
 * shows a faint outline to the person building the page, and renders nothing
 * at all to a visitor, so a half-built section never ships an empty box.
 */
export default function BlockView({
  block,
  admin = false,
}: {
  block: SectionBlock;
  admin?: boolean;
}) {
  switch (block.kind) {
    case "heading":
      return <HeadingBlock block={block} />;
    case "text":
      return <TextBlock block={block} />;
    case "image":
      return <ImageBlock block={block} admin={admin} />;
    case "imageScroller":
      return <ScrollerBlock block={block} admin={admin} />;
    case "gallery":
      return <GalleryBlock block={block} admin={admin} />;
    case "list":
      return <ListBlock block={block} admin={admin} />;
    case "tiles":
      return <TilesBlock block={block} admin={admin} />;
    case "buttons":
      return <ButtonsBlock block={block} admin={admin} />;
    case "video":
      return <VideoBlock block={block} admin={admin} />;
    case "stats":
      return <StatsBlock block={block} admin={admin} />;
    case "quote":
      return <QuoteBlock block={block} />;
    case "embed":
      return <EmbedBlock block={block} admin={admin} />;
    case "divider":
      return <DividerBlock block={block} />;
    default:
      return null;
  }
}

const alignCls = (a: string) =>
  a === "center" ? "text-center" : a === "right" ? "text-right" : "text-left";

const justifyCls = (a: string) =>
  a === "center" ? "justify-center" : a === "right" ? "justify-end" : "justify-start";

/** Faint outline shown only while building, where content is still missing. */
function Empty({ label }: { label: string }) {
  return (
    <div className="grid h-full min-h-[80px] w-full place-items-center rounded-2xl border border-dashed border-white/15 text-zinc-500">
      <span className="flex items-center gap-2 text-[11px] uppercase tracking-[0.18em]">
        <ImageOff className="h-3.5 w-3.5" aria-hidden="true" />
        {label}
      </span>
    </div>
  );
}

const gridCols = (c: string) =>
  c === "2" ? "sm:grid-cols-2" : c === "4" ? "sm:grid-cols-2 lg:grid-cols-4" : "sm:grid-cols-2 lg:grid-cols-3";

function HeadingBlock({ block }: { block: SectionBlock }) {
  const eyebrow = str(block.data.eyebrow);
  const text = str(block.data.text);
  const level = str(block.data.level, "h2");
  const cls = cn("font-display font-semibold tracking-tight text-white text-balance", alignCls(str(block.data.align)));
  const sizeCls =
    level === "h3" ? "text-xl sm:text-2xl" : level === "h4" ? "text-lg sm:text-xl" : "text-2xl sm:text-3xl lg:text-[2.5rem]";
  return (
    <div className={cn("flex h-full flex-col justify-center gap-2", alignCls(str(block.data.align)))}>
      {eyebrow && (
        <span className="text-[11px] font-semibold uppercase tracking-[0.22em] text-saffron-300">{eyebrow}</span>
      )}
      {level === "h3" ? (
        <h3 className={cn(cls, sizeCls)}>{text}</h3>
      ) : level === "h4" ? (
        <h4 className={cn(cls, sizeCls)}>{text}</h4>
      ) : (
        <h2 className={cn(cls, sizeCls)}>{text}</h2>
      )}
    </div>
  );
}

function TextBlock({ block }: { block: SectionBlock }) {
  const body = str(block.data.body);
  const cols = str(block.data.columns, "1");
  const size = str(block.data.size, "base");
  const sizeCls = size === "lg" ? "text-lg sm:text-xl" : size === "sm" ? "text-sm" : "text-base";
  return (
    <div className={cn("flex h-full flex-col justify-center", alignCls(str(block.data.align)))}>
      <p
        className={cn(
          "whitespace-pre-line leading-relaxed text-zinc-400",
          sizeCls,
          cols === "2" && "sm:columns-2 sm:gap-8"
        )}
      >
        {body}
      </p>
    </div>
  );
}

function ImageBlock({ block, admin }: { block: SectionBlock; admin: boolean }) {
  const src = str(block.data.src);
  if (!src) return admin ? <Empty label="No photo yet" /> : null;
  const caption = str(block.data.caption);
  const radius = str(block.data.rounded, "2rem");
  return (
    <figure className="flex h-full flex-col gap-2">
      <div
        className="relative min-h-0 flex-1 overflow-hidden border border-white/10 bg-white/[0.03]"
        style={{ borderRadius: radius === "none" ? 0 : radius }}
      >
        <img
          src={src}
          alt={str(block.data.alt)}
          loading="lazy"
          className={cn(
            "h-full w-full",
            str(block.data.fit, "cover") === "contain" ? "object-contain" : "object-cover"
          )}
        />
      </div>
      {caption && <figcaption className="text-xs text-zinc-500">{caption}</figcaption>}
    </figure>
  );
}

const peekCls = (p: string) => (p === "sm" ? "w-36 sm:w-44" : p === "lg" ? "w-64 sm:w-80" : "w-48 sm:w-64");

function ScrollerBlock({ block, admin }: { block: SectionBlock; admin: boolean }) {
  const imgs = images(block.data.images);
  if (imgs.length === 0) return admin ? <Empty label="No photos yet" /> : null;
  return (
    <div className="flex h-full snap-x snap-mandatory gap-4 overflow-x-auto pb-2 [scrollbar-width:thin]">
      {imgs.map((img, i) => (
        <div
          key={`${img.src}-${i}`}
          className={cn(
            "relative h-full shrink-0 snap-start overflow-hidden rounded-2xl border border-white/10",
            peekCls(str(block.data.peek, "md"))
          )}
        >
          <img src={img.src} alt={img.alt || ""} loading="lazy" className="h-full w-full object-cover" />
        </div>
      ))}
    </div>
  );
}

function GalleryBlock({ block, admin }: { block: SectionBlock; admin: boolean }) {
  const imgs = images(block.data.images);
  const [open, setOpen] = useState<string | null>(null);
  if (imgs.length === 0) return admin ? <Empty label="No photos yet" /> : null;
  return (
    <>
      <div className={cn("grid h-full gap-3", gridCols(str(block.data.columns, "3")))}>
        {imgs.map((img, i) => (
          <button
            key={`${img.src}-${i}`}
            type="button"
            onClick={() => setOpen(img.src)}
            className="group relative overflow-hidden rounded-xl border border-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-saffron-400"
          >
            <img
              src={img.src}
              alt={img.alt || ""}
              loading="lazy"
              className="h-full min-h-[90px] w-full object-cover transition-transform duration-500 group-hover:scale-[1.04]"
            />
          </button>
        ))}
      </div>
      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Photo"
          className="fixed inset-0 z-[90] grid place-items-center bg-black/85 p-6 backdrop-blur-sm"
          onClick={() => setOpen(null)}
        >
          <img src={open} alt="" className="max-h-full max-w-full rounded-2xl" />
          <button
            type="button"
            onClick={() => setOpen(null)}
            className="absolute right-5 top-5 rounded-full border border-white/20 px-4 py-2 text-xs uppercase tracking-[0.16em] text-white"
          >
            Close
          </button>
        </div>
      )}
    </>
  );
}

function ListBlock({ block, admin }: { block: SectionBlock; admin: boolean }) {
  const rows = items(block.data.items);
  if (rows.length === 0) return admin ? <Empty label="No points yet" /> : null;
  const style = str(block.data.style, "check");
  const twoCol = str(block.data.columns, "1") === "2";
  return (
    <ul className={cn("h-full space-y-3", twoCol && "sm:grid sm:grid-cols-2 sm:gap-x-8 sm:space-y-0")}>
      {rows.map((row, i) => (
        <li key={i} className="flex gap-3">
          <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-saffron-400/15 text-[10px] font-semibold text-saffron-300">
            {style === "number" ? i + 1 : style === "dot" ? "•" : <Check className="h-3 w-3" />}
          </span>
          <span className="min-w-0">
            {row.title && <span className="block font-medium text-white">{row.title}</span>}
            {row.text && <span className="mt-0.5 block text-sm leading-relaxed text-zinc-400">{row.text}</span>}
          </span>
        </li>
      ))}
    </ul>
  );
}

function TilesBlock({ block, admin }: { block: SectionBlock; admin: boolean }) {
  const rows = items(block.data.items);
  if (rows.length === 0) return admin ? <Empty label="No tiles yet" /> : null;
  return (
    <div className={cn("grid h-full gap-4", gridCols(str(block.data.columns, "3")))}>
      {rows.map((row, i) => {
        const inner = (
          <>
            {row.badge && (
              <span className="mb-3 inline-flex rounded-full border border-saffron-300/30 bg-saffron-400/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-saffron-300">
                {row.badge}
              </span>
            )}
            <h3 className="font-display text-base font-semibold text-white">{row.title}</h3>
            {row.text && <p className="mt-2 text-sm leading-relaxed text-zinc-400">{row.text}</p>}
            {row.href && (
              <span className="mt-4 inline-flex items-center gap-1 text-xs font-semibold uppercase tracking-[0.16em] text-saffron-300">
                Open
                <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
              </span>
            )}
          </>
        );
        const cls =
          "group flex h-full flex-col rounded-2xl border border-white/10 bg-white/[0.03] p-5 transition-colors duration-300 hover:border-saffron-300/30 hover:bg-white/[0.06]";
        return row.href ? (
          <a key={i} href={row.href} className={cls}>
            {inner}
          </a>
        ) : (
          <div key={i} className={cls}>
            {inner}
          </div>
        );
      })}
    </div>
  );
}

function ButtonsBlock({ block, admin }: { block: SectionBlock; admin: boolean }) {
  const rows = items(block.data.items);
  if (rows.length === 0) return admin ? <Empty label="No buttons yet" /> : null;
  return (
    <div className={cn("flex h-full flex-wrap items-center gap-3", justifyCls(str(block.data.align)))}>
      {rows.map((row, i) => {
        const variant = str(row.variant, "primary");
        const cls = cn(
          "inline-flex items-center gap-2 rounded-full px-6 py-3 font-display text-sm font-semibold transition-all duration-300",
          variant === "primary" &&
            "bg-saffron-400 text-on-gold shadow-lg shadow-saffron-400/25 hover:brightness-110 active:scale-95",
          variant === "outline" &&
            "border border-saffron-300/40 text-saffron-200 hover:border-saffron-300 hover:bg-saffron-400/10",
          variant === "ghost" && "text-zinc-300 hover:text-white"
        );
        return (
          <a key={i} href={row.href || "#top"} className={cls}>
            {row.label}
            <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
          </a>
        );
      })}
    </div>
  );
}

function VideoBlock({ block, admin }: { block: SectionBlock; admin: boolean }) {
  const src = str(block.data.src);
  if (!src) return admin ? <Empty label="No video yet" /> : null;
  return (
    <div className="h-full overflow-hidden rounded-[1.5rem] border border-white/10 bg-black">
      <video
        src={src}
        poster={str(block.data.poster) || undefined}
        controls={block.data.controls !== false}
        loop={block.data.loop === true}
        muted={block.data.muted !== false}
        autoPlay={block.data.autoplay === true}
        playsInline
        preload="metadata"
        className="h-full w-full object-cover"
      />
    </div>
  );
}

function StatsBlock({ block, admin }: { block: SectionBlock; admin: boolean }) {
  const rows = items(block.data.items);
  if (rows.length === 0) return admin ? <Empty label="No stats yet" /> : null;
  return (
    <div className={cn("grid h-full gap-6", gridCols(str(block.data.columns, "3")))}>
      {rows.map((row, i) => (
        <div key={i} className="flex flex-col justify-center">
          <span className="font-display text-3xl font-semibold text-saffron-300 sm:text-4xl">{row.value}</span>
          <span className="mt-1 text-xs uppercase tracking-[0.18em] text-zinc-500">{row.label}</span>
        </div>
      ))}
    </div>
  );
}

function QuoteBlock({ block }: { block: SectionBlock }) {
  const text = str(block.data.text);
  const author = str(block.data.author);
  if (!text && !author) return null;
  return (
    <blockquote className="flex h-full flex-col justify-center gap-4">
      <QuoteIcon className="h-6 w-6 text-saffron-400/60" aria-hidden="true" />
      <p className="font-display text-lg leading-relaxed text-white sm:text-xl text-balance">{text}</p>
      {(author || str(block.data.role)) && (
        <footer className="text-sm text-zinc-500">
          {author}
          {author && str(block.data.role) ? " · " : ""}
          {str(block.data.role)}
        </footer>
      )}
    </blockquote>
  );
}

function EmbedBlock({ block, admin }: { block: SectionBlock; admin: boolean }) {
  const url = str(block.data.url);
  if (!url) return admin ? <Empty label="No URL yet" /> : null;
  return (
    <div className="h-full overflow-hidden rounded-[1.5rem] border border-white/10 bg-white/[0.03]">
      <iframe
        src={url}
        title={str(block.data.title, "Embedded content")}
        className="h-full w-full"
        loading="lazy"
        referrerPolicy="no-referrer-when-downgrade"
        sandbox="allow-scripts allow-same-origin allow-popups allow-forms allow-presentation"
      />
    </div>
  );
}

function DividerBlock({ block }: { block: SectionBlock }) {
  const style = str(block.data.style, "line");
  const label = str(block.data.label);
  if (style === "space") return <div className="h-full" aria-hidden="true" />;
  if (style === "dots") {
    return (
      <div className="flex h-full items-center justify-center gap-2" aria-hidden="true">
        <span className="h-1.5 w-1.5 rounded-full bg-saffron-400/70" />
        <span className="h-1.5 w-1.5 rounded-full bg-saffron-400/50" />
        <span className="h-1.5 w-1.5 rounded-full bg-saffron-400/30" />
      </div>
    );
  }
  if (label) {
    return (
      <div className="flex h-full items-center gap-4">
        <span className="h-px flex-1 bg-white/10" />
        <span className="text-[10px] font-semibold uppercase tracking-[0.22em] text-zinc-500">{label}</span>
        <span className="h-px flex-1 bg-white/10" />
      </div>
    );
  }
  return <div className="flex h-full items-center" aria-hidden="true"><span className="h-px w-full bg-white/10" /></div>;
}
