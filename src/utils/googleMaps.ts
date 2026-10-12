/** Singleton loader for the Google Maps JavaScript API. */

let loadingPromise: Promise<void> | null = null;

export function loadGoogleMaps(apiKey: string): Promise<void> {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("Google Maps can only load in the browser"));
  }
  const g = (window as unknown as { google?: typeof google }).google;
  if (g?.maps) return Promise.resolve();

  if (!loadingPromise) {
    loadingPromise = new Promise<void>((resolve, reject) => {
      const script = document.createElement("script");
      script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(
        apiKey
      )}&v=weekly&loading=async`;
      script.async = true;
      script.defer = true;
      script.onload = () => resolve();
      script.onerror = () => {
        loadingPromise = null;
        reject(new Error("Failed to load the Google Maps script"));
      };
      document.head.appendChild(script);
    });
  }
  return loadingPromise;
}
