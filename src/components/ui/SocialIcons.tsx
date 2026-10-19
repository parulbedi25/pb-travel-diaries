import {
  AtSign,
  Calendar,
  Camera,
  Film,
  Globe,
  Heart,
  Image as ImageIcon,
  Link as LinkIcon,
  Mail,
  MapPin,
  MessageCircle,
  Phone,
  Play,
  Rss,
  Send,
  Share2,
  ShoppingBag,
  ThumbsUp,
  Users,
  Video,
} from "lucide-react";
import type { ComponentType } from "react";
import { BRAND_PATHS } from "./brandPaths";
import { cn } from "../../utils/cn";

type IconProps = { className?: string };

/** Draws one committed brand path on the shared 24x24 grid. */
function brandMark(path: string) {
  return function BrandMark({ className }: IconProps) {
    return (
      <svg viewBox="0 0 24 24" className={cn("h-4 w-4", className)} fill="currentColor" aria-hidden="true">
        <path d={path} />
      </svg>
    );
  };
}

const pathFor = (key: string) => BRAND_PATHS.find((b) => b.key === key)?.path ?? "";

/**
 * Named exports kept because other sections use these marks directly.
 * They now render the official paths rather than the earlier hand-drawn ones.
 */
export const YouTubeIcon = brandMark(pathFor("youtube"));
export const InstagramIcon = brandMark(pathFor("instagram"));

export type SocialIconComponent = ComponentType<{ className?: string }>;

export interface SocialIconSpec {
  /** Stored on the social link, so renaming a label never changes its icon. */
  key: string;
  label: string;
  Icon: SocialIconComponent;
}

/** The order brands appear in the picker: everyday socials, then work, then the rest. */
const BRAND_ORDER = [
  // socials and messaging
  "instagram",
  "youtube",
  "x",
  "facebook",
  "linkedin",
  "whatsapp",
  "telegram",
  "discord",
  "reddit",
  "twitch",
  "threads",
  "snapchat",
  "tiktok",
  "pinterest",
  "mastodon",
  "bluesky",
  "signal",
  "matrix",
  "tumblr",
  "flickr",
  "vk",
  "line",
  "wechat",
  "qq",
  // career and work
  "indeed",
  "glassdoor",
  "wellfound",
  "upwork",
  "fiverr",
  "dribbble",
  "behance",
  "stackoverflow",
  "gitlab",
  "producthunt",
  "handshake",
  "xing",
  // creator and media
  "spotify",
  "soundcloud",
  "vimeo",
  "medium",
  "substack",
  "patreon",
  "github",
  "devdotto",
  "hashnode",
  "wordpress",
  "notion",
  // travel, money and meet-ups
  "strava",
  "komoot",
  "airbnb",
  "tripadvisor",
  "paypal",
  "etsy",
  "zoom",
  "meetup",
];

const brandSpecs: SocialIconSpec[] = BRAND_ORDER.flatMap((key) => {
    const brand = BRAND_PATHS.find((b) => b.key === key);
    if (!brand) return [];
    return [{ key: brand.key, label: brand.label, Icon: brandMark(brand.path) }];
  });

/** Generic glyphs for anything without an official mark. */
const genericSpecs: SocialIconSpec[] = [
  { key: "website", label: "Website", Icon: Globe },
  { key: "mail", label: "Email", Icon: Mail },
  { key: "phone", label: "Phone", Icon: Phone },
  { key: "location", label: "Location", Icon: MapPin },
  { key: "chat", label: "Chat", Icon: MessageCircle },
  { key: "send", label: "Send", Icon: Send },
  { key: "camera", label: "Photos", Icon: Camera },
  { key: "video", label: "Video", Icon: Video },
  { key: "play", label: "Play", Icon: Play },
  { key: "store", label: "Store", Icon: ShoppingBag },
  { key: "calendar", label: "Calendar", Icon: Calendar },
  { key: "rss", label: "RSS", Icon: Rss },
  { key: "link", label: "Link", Icon: LinkIcon },
  { key: "heart", label: "Heart", Icon: Heart },
  { key: "mention", label: "Mention", Icon: AtSign },
  { key: "community", label: "Community", Icon: Users },
  { key: "film", label: "Film", Icon: Film },
  { key: "image", label: "Image", Icon: ImageIcon },
  { key: "share", label: "Share", Icon: Share2 },
  { key: "thumbs", label: "Thumbs up", Icon: ThumbsUp },
];

export const SOCIAL_ICONS: SocialIconSpec[] = [...brandSpecs, ...genericSpecs];

/**
 * Labels used before the icon picker existed, mapped onto today's keys so a
 * saved link keeps its mark. "X (Twitter)" is the one that no longer matches
 * any icon name.
 */
const LEGACY_LABELS: Record<string, string> = {
  "x (twitter)": "x",
  twitter: "x",
};

/**
 * Resolve the icon for a saved social link: the stored key wins, then a label
 * match so links saved before the icon picker existed keep their mark.
 */
export function resolveSocialIcon(
  social?: { label?: string; icon?: string } | null
): SocialIconComponent | null {
  if (!social) return null;
  if (social.icon) {
    const byKey = SOCIAL_ICONS.find((s) => s.key === social.icon);
    if (byKey) return byKey.Icon;
  }
  const label = (social.label ?? "").trim().toLowerCase();
  if (!label) return null;
  const aliased = LEGACY_LABELS[label] ?? label;
  return (
    SOCIAL_ICONS.find((s) => s.key === aliased)?.Icon ??
    SOCIAL_ICONS.find((s) => s.label.toLowerCase() === label)?.Icon ??
    null
  );
}

/** Opens external URLs in a new tab, while keeping in-page links local. */
export function externalLinkProps(href: string): { target: "_blank"; rel: "noreferrer" } | {} {
  return /^https?:\/\//i.test(href.trim()) ? { target: "_blank", rel: "noreferrer" } : {};
}
