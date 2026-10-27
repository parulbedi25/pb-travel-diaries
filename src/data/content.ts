/**
 * The one photograph the sections do not get from the dashboard.
 *
 * It lives here (rather than in the content store) because the Benefits
 * portrait is part of the section's design, not something the owner sets: the
 * quote card is laid over it. The dashboard can still upload a film and a
 * poster, so those two stay empty and fall back to the section's own fields.
 */
export const IMAGES = {
  portrait: "/images/benefits-portrait.webp",
  videoPoster: "",
};

export const SHOWREEL_VIDEO =
  "";

export type Destination = {
  slug: string;
  name: string;
  state: string;
  tagline: string;
  description: string;
  image: string;
  distance: string;
  days: string;
  season: string;
  vibe: string;
};
