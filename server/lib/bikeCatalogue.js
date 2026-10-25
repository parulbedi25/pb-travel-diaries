/**
 * The bikes a member can pick in their garage.
 *
 * This list exists so signing up never means typing a model name from memory
 * and hoping it is spelled the same way twice. It holds the makers a rider in
 * India actually chooses between, the models each one sells, and the average
 * mileage those models return in real use — that last number is what turns a
 * journey on the map into litres of petrol.
 *
 * Three rules keep it honest:
 *
 *  - **Mileage is a range, not a promise.** `kmpl` is the figure a model
 *    usually lands near on mixed riding, not a brochure best case. The member
 *    can always override it, and the estimate says it is an estimate.
 *  - **The year only nudges it.** An engine that has done 60,000 km is a
 *    little thirstier than a new one, so an old bike gets a small deduction
 *    rather than a different model's number.
 *  - **Unknown is not an error.** A model that is not in this list still
 *    works; it falls back to its maker's average and then to a plain 45 km/l.
 *
 * The logos are drawn locally (`public/media/bike-makers/*.svg`) — a small
 * wordmark badge per maker in its own colour, so the picker works with no
 * network and nothing is pulled from a third-party CDN.
 */

/** How a model's mileage is treated once the bike has some years on it. */
const YEAR_WEAR = [
  // [age in years from, multiplier]
  [12, 0.88],
  [7, 0.93],
  [3, 0.97],
];

const withWear = (kmpl, year, now = new Date().getFullYear()) => {
  if (!year) return kmpl;
  const age = Math.max(0, now - Number(year));
  const step = YEAR_WEAR.find(([from]) => age >= from);
  return Math.round(kmpl * (step ? step[1] : 1) * 10) / 10;
};

/**
 * Makers, models and their average mileage.
 *
 * `logo` is a file under `public/`, served from the site itself; `accent` is
 * the colour the badge is drawn in, so the picker can tint without loading a
 * second asset.
 */
export const BIKE_MAKERS = [
  {
    id: "hero",
    name: "Hero",
    urdu: "ہیرو",
    accent: "#e2231a",
    logo: "/media/bike-makers/hero.svg",
    models: [
      { id: "splendor-plus", name: "Splendor Plus", cc: 97, kmpl: 70 },
      { id: "hf-deluxe", name: "HF Deluxe", cc: 97, kmpl: 70 },
      { id: "passion-plus", name: "Passion Plus", cc: 113, kmpl: 60 },
      { id: "glamour", name: "Glamour", cc: 125, kmpl: 60 },
      { id: "xtreme-160r", name: "Xtreme 160R", cc: 163, kmpl: 45 },
      { id: "xpulse-200", name: "XPulse 200", cc: 199, kmpl: 35 },
      { id: "destini-125", name: "Destini 125", cc: 125, kmpl: 50 },
    ],
  },
  {
    id: "honda",
    name: "Honda",
    urdu: "ہونڈا",
    accent: "#e40521",
    logo: "/media/bike-makers/honda.svg",
    models: [
      { id: "shine-125", name: "Shine 125", cc: 124, kmpl: 55 },
      { id: "sp-125", name: "SP 125", cc: 124, kmpl: 65 },
      { id: "unicorn", name: "Unicorn", cc: 162, kmpl: 50 },
      { id: "hornet-20", name: "Hornet 2.0", cc: 184, kmpl: 45 },
      { id: "cb350", name: "CB350", cc: 348, kmpl: 35 },
      { id: "activa-6g", name: "Activa 6G", cc: 109, kmpl: 50 },
      { id: "dio", name: "Dio", cc: 109, kmpl: 48 },
    ],
  },
  {
    id: "bajaj",
    name: "Bajaj",
    urdu: "بجاج",
    accent: "#0b4ea2",
    logo: "/media/bike-makers/bajaj.svg",
    models: [
      { id: "platina-100", name: "Platina 100", cc: 102, kmpl: 70 },
      { id: "ct-110x", name: "CT 110X", cc: 115, kmpl: 70 },
      { id: "pulsar-150", name: "Pulsar 150", cc: 149, kmpl: 50 },
      { id: "pulsar-n160", name: "Pulsar N160", cc: 164, kmpl: 45 },
      { id: "avenger-220", name: "Avenger 220", cc: 220, kmpl: 40 },
      { id: "dominar-400", name: "Dominar 400", cc: 373, kmpl: 30 },
    ],
  },
  {
    id: "tvs",
    name: "TVS",
    urdu: "ٹی وی ایس",
    accent: "#0d57a6",
    logo: "/media/bike-makers/tvs.svg",
    models: [
      { id: "xl-100", name: "XL 100", cc: 100, kmpl: 60 },
      { id: "raider-125", name: "Raider 125", cc: 125, kmpl: 60 },
      { id: "apache-rtr-160", name: "Apache RTR 160", cc: 159, kmpl: 45 },
      { id: "ronin", name: "Ronin", cc: 226, kmpl: 40 },
      { id: "jupiter", name: "Jupiter", cc: 110, kmpl: 50 },
      { id: "ntorq", name: "NTorq 125", cc: 124, kmpl: 40 },
    ],
  },
  {
    id: "royal-enfield",
    name: "Royal Enfield",
    urdu: "رائل انفیلڈ",
    accent: "#a2561b",
    logo: "/media/bike-makers/royal-enfield.svg",
    models: [
      { id: "classic-350", name: "Classic 350", cc: 349, kmpl: 35 },
      { id: "bullet-350", name: "Bullet 350", cc: 349, kmpl: 35 },
      { id: "hunter-350", name: "Hunter 350", cc: 349, kmpl: 35 },
      { id: "meteor-350", name: "Meteor 350", cc: 349, kmpl: 35 },
      { id: "himalayan-450", name: "Himalayan 450", cc: 452, kmpl: 30 },
      { id: "scram-411", name: "Scram 411", cc: 411, kmpl: 30 },
    ],
  },
  {
    id: "yamaha",
    name: "Yamaha",
    urdu: "یاماہا",
    accent: "#0033a0",
    logo: "/media/bike-makers/yamaha.svg",
    models: [
      { id: "fz-s", name: "FZ-S", cc: 149, kmpl: 45 },
      { id: "mt-15", name: "MT-15", cc: 155, kmpl: 45 },
      { id: "r15", name: "R15", cc: 155, kmpl: 45 },
      { id: "fascino", name: "Fascino 125", cc: 125, kmpl: 50 },
      { id: "rayzr", name: "RayZR 125", cc: 125, kmpl: 50 },
    ],
  },
  {
    id: "suzuki",
    name: "Suzuki",
    urdu: "سوزوکی",
    accent: "#0b3c8c",
    logo: "/media/bike-makers/suzuki.svg",
    models: [
      { id: "access-125", name: "Access 125", cc: 124, kmpl: 50 },
      { id: "burgman-street", name: "Burgman Street", cc: 124, kmpl: 45 },
      { id: "gixxer", name: "Gixxer", cc: 155, kmpl: 45 },
      { id: "v-strom-sx", name: "V-Strom SX", cc: 249, kmpl: 35 },
    ],
  },
  {
    id: "ktm",
    name: "KTM",
    urdu: "کے ٹی ایم",
    accent: "#ff6600",
    logo: "/media/bike-makers/ktm.svg",
    models: [
      { id: "duke-125", name: "Duke 125", cc: 125, kmpl: 40 },
      { id: "duke-200", name: "Duke 200", cc: 199, kmpl: 35 },
      { id: "duke-390", name: "Duke 390", cc: 373, kmpl: 28 },
      { id: "rc-200", name: "RC 200", cc: 199, kmpl: 35 },
    ],
  },
  {
    id: "yezdi",
    name: "Yezdi",
    urdu: "یزدی",
    accent: "#4a2f1b",
    logo: "/media/bike-makers/yezdi.svg",
    models: [
      { id: "roadster", name: "Roadster", cc: 334, kmpl: 30 },
      { id: "scrambler", name: "Scrambler", cc: 334, kmpl: 30 },
      { id: "adventure", name: "Adventure", cc: 334, kmpl: 28 },
    ],
  },
];

/** What the picker needs: everything but the maths. */
export function listBikeCatalogue() {
  return BIKE_MAKERS.map(({ id, name, urdu, accent, logo, models }) => ({
    id,
    name,
    urdu,
    accent,
    logo,
    models: models.map(({ id: modelId, name: modelName, cc, kmpl }) => ({
      id: modelId,
      name: modelName,
      cc,
      kmpl,
    })),
  }));
}

const slug = (value) =>
  String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

/** A maker by id *or* by the name a member typed, case and spacing aside. */
export function findMaker(value) {
  const wanted = slug(value);
  if (!wanted) return null;
  return (
    BIKE_MAKERS.find((maker) => maker.id === wanted || slug(maker.name) === wanted) ?? null
  );
}

/** A model inside a maker, again by id or by the name that was typed. */
export function findModel(makerValue, modelValue) {
  const maker = findMaker(makerValue);
  if (!maker) return null;
  const wanted = slug(modelValue);
  if (!wanted) return null;
  const model =
    maker.models.find((entry) => entry.id === wanted || slug(entry.name) === wanted) ?? null;
  return model ? { maker, model } : null;
}

/**
 * The mileage figure for a member's bike.
 *
 * `source` is the honest part: `manual` when the member typed it, `estimated`
 * when it came from this list. The dashboard shows the difference, and an
 * estimate can always be replaced.
 */
export function estimateMileage({ maker, model, year } = {}) {
  const found = findModel(maker, model);
  if (found) {
    const kmpl = withWear(found.model.kmpl, year);
    return {
      kmpl,
      source: "estimated",
      note: `${found.maker.name} ${found.model.name} averages about ${found.model.kmpl} km/l; with the year you gave, ${kmpl} km/l.`,
    };
  }

  const makerOnly = findMaker(maker);
  if (makerOnly) {
    const average = makerOnly.models.reduce((sum, entry) => sum + entry.kmpl, 0) / makerOnly.models.length;
    const kmpl = withWear(Math.round(average * 10) / 10, year);
    return {
      kmpl,
      source: "estimated",
      note: `${makerOnly.name} models average about ${kmpl} km/l — tell us the model for a closer figure.`,
    };
  }

  return {
    kmpl: 45,
    source: "estimated",
    note: "A typical Indian motorcycle returns about 45 km/l; enter your own figure for a real number.",
  };
}

/** The maker's name as it should be stored, whatever spelling came in. */
export function makerName(value) {
  return findMaker(value)?.name ?? String(value ?? "").trim().slice(0, 60);
}

/** The model's name as it should be stored. */
export function modelName(makerValue, modelValue) {
  return findModel(makerValue, modelValue)?.model.name ?? String(modelValue ?? "").trim().slice(0, 60);
}
