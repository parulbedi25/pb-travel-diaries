/**
 * The member's own API.
 *
 * Kept apart from `siteApi` on purpose: everything here belongs to one signed-in
 * person's private garage, and nothing here reads or writes the website. That
 * separation is the point of the feature, so it is visible in the file layout
 * too — a reader can follow the member tracker without touching a single line
 * of the site's own code.
 */

import { api } from "./client";

/** One model in the maker's line-up, with the mileage it usually returns. */
export interface CatalogueModel {
  id: string;
  name: string;
  cc: number;
  /** Average km per litre in real use — the figure a blank field is filled from. */
  kmpl: number;
}

export interface CatalogueMaker {
  id: string;
  name: string;
  urdu: string;
  /** The badge's colour, so the picker can tint without a second asset. */
  accent: string;
  /** A locally drawn wordmark under public/media/bike-makers. */
  logo: string;
  models: CatalogueModel[];
}

export interface MemberBike {
  id: number;
  maker: string;
  model: string;
  year: number | null;
  mileageKmpl: number | null;
  /** `manual` when the member typed it, `estimated` when the catalogue filled it. */
  mileageSource: "manual" | "estimated";
  /** A sentence explaining where an estimate came from. */
  estimateNote?: string;
  litresPer100Km: number | null;
  createdAt?: string | null;
}

export interface BikeInput {
  maker: string;
  model: string;
  year?: number | null;
  mileageKmpl?: number | null;
}

export interface MemberStop {
  name: string;
  lat: number;
  lng: number;
  altitudeM?: number;
}

export interface JourneyLeg {
  from: string;
  to: string;
  km: number;
}

export interface JourneyMaths {
  stops: number;
  legs: JourneyLeg[];
  oneWayKm: number;
  roundTripKm: number;
  kmpl: number | null;
  litresOneWay: number | null;
  litresRoundTrip: number | null;
  selectedKm: number;
  selectedLitres: number | null;
  from: string;
  to: string;
}

/** What one bike in the garage would drink on this ride. */
export interface PerBikePetrol {
  bikeId: number;
  maker: string;
  model: string;
  kmpl: number | null;
  mileageSource: "manual" | "estimated";
  litresOneWay: number | null;
  litresRoundTrip: number | null;
}

export interface GalleryItem {
  url: string;
  caption: string;
}

export interface MemberJourney {
  id: number;
  title: string;
  bikeId: number | null;
  stops: MemberStop[];
  notes: string;
  gallery: GalleryItem[];
  roundTrip: boolean;
  createdAt?: string | null;
  updatedAt?: string | null;
  maths: JourneyMaths;
  perBike: PerBikePetrol[];
}

export interface JourneyInput {
  title: string;
  bikeId: number | null;
  stops: MemberStop[];
  notes: string;
  gallery: GalleryItem[];
  roundTrip: boolean;
}

export interface GarageTotals {
  bikes: number;
  journeys: number;
  kmOneWay: number;
  stops: number;
}

const invalidate = () => {
  /* no cache to clear — the dashboard holds its own copy */
};

export const memberApi = {
  /** Makers, models and their average mileage. Public-ish: it is only listed. */
  async catalogue(): Promise<CatalogueMaker[]> {
    const { makers } = await api.get<{ makers: CatalogueMaker[] }>("/api/member/catalogue");
    return makers;
  },

  async garage(): Promise<{
    bikes: MemberBike[];
    journeys: MemberJourney[];
    totals: GarageTotals;
  }> {
    return api.get("/api/member/garage");
  },

  async addBike(input: BikeInput): Promise<{ bike: MemberBike; bikes: MemberBike[]; estimateNote?: string }> {
    invalidate();
    return api.post("/api/member/bikes", input);
  },

  async updateBike(
    id: number,
    input: BikeInput,
  ): Promise<{ bike: MemberBike; bikes: MemberBike[]; estimateNote?: string }> {
    invalidate();
    return api.patch(`/api/member/bikes/${id}`, input);
  },

  async deleteBike(id: number): Promise<{ bikes: MemberBike[] }> {
    invalidate();
    return api.delete(`/api/member/bikes/${id}`);
  },

  async saveJourney(input: JourneyInput, id?: number): Promise<MemberJourney> {
    invalidate();
    if (id) {
      const { journey } = await api.patch<{ journey: MemberJourney }>(`/api/member/journeys/${id}`, input);
      return journey;
    }
    const { journey } = await api.post<{ journey: MemberJourney }>("/api/member/journeys", input);
    return journey;
  },

  async deleteJourney(id: number): Promise<void> {
    invalidate();
    await api.delete(`/api/member/journeys/${id}`);
  },

  /**
   * A short share link, expanded server-side.
   *
   * A page cannot read a cross-origin redirect, so the server follows it and
   * hands back the long directions link — which the same parser that reads the
   * dashboard's links can then read (`utils/mapLinks`).
   */
  async expandLink(url: string): Promise<string> {
    const { url: expanded } = await api.post<{ url: string }>("/api/member/link", { url });
    return expanded;
  },
};
