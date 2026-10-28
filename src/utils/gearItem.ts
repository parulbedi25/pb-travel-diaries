import type { GearItem } from "../store/siteContent";

/**
 * How a gear item is named.
 *
 * The Gear, the Shop, Gears and the member ride builder all render the same
 * catalogue, and each carried its own copy of this rule — so an item could be
 * titled one way in the wardrobe and another in the shop. One module, one
 * answer.
 */
export function gearItemTitle(item: GearItem): string {
  return item.name?.trim() || [item.brand, item.model].filter(Boolean).join(" ") || "Gear item";
}

/** The quiet second line under a product: brand · model. */
export function gearItemMaker(item: GearItem): string {
  return [item.brand, item.model].map((v) => v?.trim()).filter(Boolean).join(" · ");
}

/** Category label, with the section's own wording as the fallback. */
export function gearItemCategory(item: GearItem, fallback: string): string {
  return (item.category ?? "").trim() || fallback;
}

/**
 * A photo this site serves itself, rather than one fetched from another host.
 *
 * A product shot is cut out on white or on nothing at all, so it is shown on a
 * white plate and fitted inside it. A remote URL might be a lifestyle
 * photograph, which belongs edge to edge instead. The shop, The Gear and the
 * dashboard's gear editor all ask this one question, so a product looks the
 * same wherever it appears — an uploaded photo used to be treated as remote and
 * landed on a near-black plate, which showed through as a black block around
 * anything transparent.
 */
export function isProductPhoto(src?: string): boolean {
  const value = src?.trim() ?? "";
  return value.startsWith("/") || value.startsWith("data:");
}
