import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import express from "express";
import { gunzipSync } from "node:zlib";
import { siteDocument } from "../lib/siteDocument.js";

const file = new URL("../../dist/index.html", import.meta.url);
function request(port, encoding, method = "GET") {
  return new Promise((resolve, reject) => {
    const req = http.request({ port, path: "/", method, headers: { "Accept-Encoding": encoding } }, res => {
      const chunks = [];
      res.on("data", chunk => chunks.push(chunk));
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on("error", reject);
    req.end();
  });
}

test("document negotiation preserves HTML, validators, HEAD and gzip refusals", async () => {
  const app = express();
  app.get("/", siteDocument(file));
  const server = app.listen(0);
  await new Promise(resolve => server.once("listening", resolve));
  try {
    const port = server.address().port;
    const plain = await request(port, "identity");
    const compressed = await request(port, "gzip");
    assert.deepEqual(plain.body, fs.readFileSync(file));
    assert.equal(compressed.headers["content-encoding"], "gzip");
    assert.match(compressed.headers.vary, /Accept-Encoding/);
    assert.equal(compressed.headers["cache-control"], "no-cache");
    assert.deepEqual(gunzipSync(compressed.body), plain.body);
    assert.ok(compressed.body.length < plain.body.length / 2);
    assert.ok(compressed.headers.etag);
    assert.equal((await request(port, "gzip;q=0, identity")).headers["content-encoding"], undefined);
    const head = await request(port, "gzip", "HEAD");
    assert.equal(head.body.length, 0);
    assert.equal(Number(head.headers["content-length"]), compressed.body.length);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

test("missing document yields to the next handler", () => {
  let called = false;
  siteDocument(new URL("./not-present.html", import.meta.url))({}, {}, () => { called = true; });
  assert.equal(called, true);
});
