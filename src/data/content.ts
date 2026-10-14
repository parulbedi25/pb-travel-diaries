export const IMAGES = {
  heroMain:
    "",
  heroCardA:
    "",
  heroCardB:
    "",
  heroCardC:
    "",
  portrait:
    "",
  videoPoster:
    "",
};

export const SHOWREEL_VIDEO =
  "";

export const NAV_LINKS = [
  { label: "Live", href: "#live" },
  { label: "The Journey", href: "#journey" },
  { label: "The Machine", href: "#machine" },
  { label: "Why PB", href: "#features" },
  { label: "Tribe Stories", href: "#stories" },
  { label: "Membership", href: "#pricing" },
  { label: "FAQ", href: "#faq" },
];

export const HERO_MARQUEE = [
  "Ladakh",
  "Spiti",
  "Kashmir",
  "Rajasthan",
  "Kerala",
  "Meghalaya",
  "Goa",
  "Varanasi",
  "Rann of Kutch",
  "Andaman",
  "Nubra",
  "Coorg",
];

export const STATS = [
  { value: 28, suffix: "", label: "States conquered", sub: "All 28, zero shortcuts" },
  { value: 140, suffix: "K+", label: "Kilometres ridden", sub: "And counting every mile" },
  { value: 480, suffix: "K+", label: "Tribe members", sub: "Across YouTube & Insta" },
  { value: 96, suffix: "M+", label: "Film views", sub: "380+ stories published" },
];

export const PRESS = [
  "Tripoto",
  "The Better India",
  "NatGeo Traveller",
  "CNN-News18",
  "Red Bull India",
  "Royal Enfield",
  "YourStory",
  "MTV India",
];

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

export const DESTINATIONS: Destination[] = [
  {
    slug: "ladakh",
    name: "Ladakh",
    state: "Jammu & Kashmir",
    tagline: "The Land of High Passes",
    description:
      "Eleven passes above 16,000 ft, Pangong turning gold at dawn, and mornings that smell of butter tea and diesel. Ladakh isn't a trip — it's a rite of passage. Full GPX, permit checklist and fuel strategy included.",
    image:
      "",
    distance: "2,150 km",
    days: "12 days",
    season: "Jun – Sep",
    vibe: "High-altitude madness",
  },
  {
    slug: "nubra",
    name: "Nubra Valley",
    state: "Ladakh",
    tagline: "The Cold Desert",
    description:
      "Sand dunes wedged between snow peaks, double-humped camels at Hunder, and Turtuk — a Baltistan village India opened to the world only in 2010. The detour most riders skip, and never forget.",
    image:
      "",
    distance: "480 km",
    days: "4 days",
    season: "Jun – Sep",
    vibe: "Otherworldly",
  },
  {
    slug: "spiti",
    name: "Spiti Valley",
    state: "Himachal Pradesh",
    tagline: "The Middle Land",
    description:
      "Raw, lunar, and humbling. Key Monastery at sunrise, Chandra Tal under the Milky Way, and the world's highest villages where time moves at 0.5x. My most requested route — mapped to the last kilometre.",
    image:
      "",
    distance: "1,320 km",
    days: "9 days",
    season: "May – Oct",
    vibe: "Raw & spiritual",
  },
  {
    slug: "rajasthan",
    name: "Rajasthan",
    state: "The Desert Crown",
    tagline: "Forts, Dunes & Fury",
    description:
      "Amber Fort at golden hour, Jaisalmer's dunes under a full moon, and Udaipur's lakes at dusk. A 2,400 km loop through living palaces, thorn forests and the loudest thalis in India.",
    image:
      "",
    distance: "2,400 km",
    days: "10 days",
    season: "Oct – Feb",
    vibe: "Royal & loud",
  },
  {
    slug: "varanasi",
    name: "Varanasi",
    state: "Uttar Pradesh",
    tagline: "The Eternal City",
    description:
      "The oldest living city on earth doesn't photograph — it swallows you. Dawn boats on the Ganga, the thunder of the evening aarti, and kachori-sabzi breakfasts in lanes older than empires.",
    image:
      "",
    distance: "620 km",
    days: "3 days",
    season: "Oct – Mar",
    vibe: "Intense & timeless",
  },
  {
    slug: "meghalaya",
    name: "Meghalaya",
    state: "Northeast India",
    tagline: "The Abode of Clouds",
    description:
      "Nohkalikai plunging 1,115 ft, living root bridges grown over 500 years, and Mawlynnong — Asia's cleanest village. India's wettest, greenest, most surprising corner, packed into one epic loop.",
    image:
      "",
    distance: "1,180 km",
    days: "8 days",
    season: "Oct – Apr",
    vibe: "Lush & wild",
  },
  {
    slug: "kerala",
    name: "Kerala",
    state: "God's Own Country",
    tagline: "Slow Roads & Stiller Waters",
    description:
      "Houseboats drifting through Alappuzha, Munnar's tea carpeting every hill, and Fort Kochi's Chinese fishing nets at sunset. The antidote to burnout — best absorbed at 40 kmph, windows down.",
    image:
      "",
    distance: "940 km",
    days: "7 days",
    season: "Sep – Mar",
    vibe: "Slow & green",
  },
  {
    slug: "goa",
    name: "Goa",
    state: "The Coastal Pulse",
    tagline: "Beyond the Beach Shacks",
    description:
      "Everyone knows Baga. Almost nobody finds Kakolem. My Goa route trades crowds for hidden coves, spice-farm trails, Divar island ferry hops and the Saturday night market at Arpora.",
    image:
      "",
    distance: "560 km",
    days: "5 days",
    season: "Nov – Feb",
    vibe: "Salty & free",
  },
];
