import fs from "node:fs";
import { gzipSync } from "node:zlib";

/**
 * The page, told where the API is when this app is not at the domain root.
 *
 * A page served from `/server/` makes its calls to `/api/…`, which is the
 * domain root — Apache's business, not this app's. So when `BASE_PATH` is set,
 * the address is written into the document on the way out, exactly as the
 * static export writes it with `--api`. One build then works at the root of a
 * Node deployment and in a subfolder beside a static one.
 */
function withApiBase(html, apiBase) {
  if (!apiBase) return html;
  const tag = `<script>window.__PB_API_BASE__=${JSON.stringify(apiBase)};</script>`;
  // Byte-for-byte insertion rather than a string rebuild: the document can be
  // 3 MB, and `</head>` is ASCII so the split cannot fall inside a character.
  const at = html.indexOf(Buffer.from("</head>", "utf8"));
  if (at < 0) return Buffer.concat([Buffer.from(tag, "utf8"), html]);
  return Buffer.concat([html.subarray(0, at), Buffer.from(tag, "utf8"), html.subarray(at)]);
}

/** Cache the already-minified document and its gzip representation once at boot. */
export function siteDocument(file, { apiBase = "" } = {}) {
  if (!fs.existsSync(file)) return (_req, _res, next) => next();
  const plain = withApiBase(fs.readFileSync(file), apiBase);
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
