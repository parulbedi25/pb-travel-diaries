/** cPanel/Passenger startup bridge. CommonJS keeps older Passenger loaders happy. */
process.env.NODE_ENV ||= "production";
import("./server/index.js").catch((error) => {
  console.error("[startup] Could not start PB Travel Diaries:", error);
  process.exit(1);
});
