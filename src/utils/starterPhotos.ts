// Upgrade only the previous bundled collection, never a custom/uploaded URL.
const refreshedPhotos: Record<string, string> = {
  "/media/starter/ladakh.webp": "/media/starter/ladakh-pangong.webp",
  "/media/starter/nubra.webp": "/media/starter/nubra-diskit.webp",
  "/media/starter/spiti.webp": "/media/starter/spiti-dhankar.webp",
  "/media/starter/rajasthan.webp": "/media/starter/rajasthan-jaipur.webp",
  "/media/starter/varanasi.webp": "/media/starter/varanasi-sunrise.webp",
  "/media/starter/meghalaya.webp": "/media/starter/meghalaya-dawki.webp",
  "/media/starter/kerala.webp": "/media/starter/kerala-munnar.webp",
  "/media/starter/goa.webp": "/media/starter/goa-agonda.webp",
};

export function resolveStarterPhoto(value: string | undefined, fallback: string): string {
  return value ? refreshedPhotos[value] ?? value : fallback;
}
