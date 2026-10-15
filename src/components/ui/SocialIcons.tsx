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
  Music2,
  Phone,
  Play,
  Podcast,
  Rss,
  Send,
  Share2,
  ShoppingBag,
  ThumbsUp,
  Users,
  Video,
} from "lucide-react";
import type { ComponentType } from "react";
import { cn } from "../../utils/cn";

type IconProps = { className?: string };

function Base({
  className,
  children,
  stroke = false,
  viewBox = "0 0 24 24",
}: IconProps & { children: React.ReactNode; stroke?: boolean; viewBox?: string }) {
  return (
    <svg
      viewBox={viewBox}
      className={cn("h-4 w-4", className)}
      fill={stroke ? "none" : "currentColor"}
      stroke={stroke ? "currentColor" : "none"}
      strokeWidth={stroke ? 2 : undefined}
      strokeLinecap={stroke ? "round" : undefined}
      strokeLinejoin={stroke ? "round" : undefined}
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

export function YouTubeIcon({ className }: IconProps) {
  return (
    <Base className={className}>
      <path d="M23.5 6.19a3.02 3.02 0 0 0-2.12-2.14C19.5 3.55 12 3.55 12 3.55s-7.5 0-9.38.5A3.02 3.02 0 0 0 .5 6.19 31.6 31.6 0 0 0 0 12a31.6 31.6 0 0 0 .5 5.81 3.02 3.02 0 0 0 2.12 2.14c1.88.5 9.38.5 9.38.5s7.5 0 9.38-.5a3.02 3.02 0 0 0 2.12-2.14A31.6 31.6 0 0 0 24 12a31.6 31.6 0 0 0-.5-5.81ZM9.55 15.57V8.43L15.82 12l-6.27 3.57Z" />
    </Base>
  );
}

export function InstagramIcon({ className }: IconProps) {
  return (
    <Base className={className} stroke>
      <rect x="2" y="2" width="20" height="20" rx="5" ry="5" />
      <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" />
      <line x1="17.5" y1="6.5" x2="17.51" y2="6.5" />
    </Base>
  );
}

export function XIcon({ className }: IconProps) {
  return (
    <Base className={className}>
      <path d="M18.9 1.15h3.68l-8.04 9.19L24 22.85h-7.41l-5.8-7.58-6.64 7.58H.47l8.6-9.83L0 1.15h7.59l5.24 6.93 6.07-6.93Zm-1.29 19.5h2.04L6.49 3.24H4.3l13.31 17.41Z" />
    </Base>
  );
}

export function FacebookIcon({ className }: IconProps) {
  return (
    <Base className={className}>
      <path d="M24 12.07C24 5.4 18.63 0 12 0S0 5.4 0 12.07C0 18.1 4.39 23.09 10.13 24v-8.44H7.08v-3.49h3.04V9.41c0-3.02 1.8-4.7 4.54-4.7 1.31 0 2.68.24 2.68.24v2.97h-1.5c-1.5 0-1.96.93-1.96 1.89v2.26h3.32l-.53 3.49h-2.8V24C19.62 23.1 24 18.1 24 12.07Z" />
    </Base>
  );
}

export type SocialIconComponent = ComponentType<{ className?: string }>;

export interface SocialIconSpec {
  /** Stored on the social link, so renaming a label never changes its icon. */
  key: string;
  label: string;
  Icon: SocialIconComponent;
}

/**
 * Everything an admin can pick from.
 *
 * The four brand marks are drawn here because lucide dropped its brand icons.
 * The rest are generic glyphs rather than official logos — they cover the
 * platforms people actually link to without shipping a mark that is subtly
 * wrong, and the set is easy to extend.
 */
export const SOCIAL_ICONS: SocialIconSpec[] = [
  { key: "youtube", label: "YouTube", Icon: YouTubeIcon },
  { key: "instagram", label: "Instagram", Icon: InstagramIcon },
  { key: "x", label: "X (Twitter)", Icon: XIcon },
  { key: "facebook", label: "Facebook", Icon: FacebookIcon },
  { key: "website", label: "Website", Icon: Globe },
  { key: "mail", label: "Email", Icon: Mail },
  { key: "phone", label: "Phone", Icon: Phone },
  { key: "location", label: "Location", Icon: MapPin },
  { key: "chat", label: "Chat", Icon: MessageCircle },
  { key: "send", label: "Send / Telegram", Icon: Send },
  { key: "music", label: "Music", Icon: Music2 },
  { key: "podcast", label: "Podcast", Icon: Podcast },
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

/** Label-keyed view of the registry, for anything still matching by label. */
export const SOCIALS: { label: string; Icon: SocialIconComponent }[] = SOCIAL_ICONS.map(
  ({ label, Icon }) => ({ label, Icon })
);

export const socialIconLabel = (key: string | undefined): string =>
  SOCIAL_ICONS.find((s) => s.key === key)?.label ?? "";

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
  return SOCIAL_ICONS.find((s) => s.label.toLowerCase() === label)?.Icon ?? null;
}

/** Opens external URLs in a new tab, while keeping in-page links local. */
export function externalLinkProps(href: string): { target: "_blank"; rel: "noreferrer" } | {} {
  return /^https?:\/\//i.test(href.trim()) ? { target: "_blank", rel: "noreferrer" } : {};
}
