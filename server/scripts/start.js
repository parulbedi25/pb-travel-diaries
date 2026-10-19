/**
 * The production entry point.
 *
 *   npm start        → this file
 *   npm run prod     → build, then this file
 *   cPanel / Passenger → startup file `server/scripts/start.js`
 *
 * It is deliberately tiny: the app itself is `server/index.js`. The only thing
 * that has to happen first is NODE_ENV. A hosting panel does not always set it,
 * and in development mode an error response includes the exception message —
 * harmless locally, not something a visitor should ever receive. Running the
 * server directly (`node server/index.js`) keeps whatever the environment
 * says, which is what the local workflow wants.
 */
process.env.NODE_ENV ||= "production";
await import("../index.js");
