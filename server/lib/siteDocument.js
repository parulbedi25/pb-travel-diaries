import fs from "node:fs";
import { gzipSync } from "node:zlib";

/** Cache the already-minified document and its gzip representation once at boot. */
export function siteDocument(file) {
  if (!fs.existsSync(file)) return (_req, _res, next) => next();
  const plain = fs.readFileSync(file);
  const gzip = gzipSync(plain);
  return (req, res) => {
    // Express negotiates q-values, including an explicit gzip;q=0 refusal.
    const encoded = req.acceptsEncodings("gzip", "identity") === "gzip";
    res.vary("Accept-Encoding");
    res.set("Cache-Control", "no-cache");
    res.type("html");
    if (encoded) res.set("Content-Encoding", "gzip");
    res.send(encoded ? gzip : plain);
  };
}
