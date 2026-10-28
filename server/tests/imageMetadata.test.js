/**
 * Photos carry personal data. These check it is removed and that the picture
 * itself survives the removal.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const { stripImageMetadata } = await import("../lib/imageMetadata.js");

/** A JPEG marker segment: FFxx, a two-byte length, then the payload. */
function jpegSegment(marker, payload) {
  const head = Buffer.alloc(4);
  head.writeUInt16BE(0xff00 | marker, 0);
  head.writeUInt16BE(payload.length + 2, 2);
  return Buffer.concat([head, payload]);
}

const SOI = Buffer.from([0xff, 0xd8]);
const EOI = Buffer.from([0xff, 0xd9]);

/** A tiny but structurally valid JPEG with an EXIF block and an ICC profile. */
function jpegWithMetadata() {
  const exif = jpegSegment(0xe1, Buffer.from("Exif\0\0MM\0*GPSLatitude 30.9 SerialNumber SN-1", "latin1"));
  const xmp = jpegSegment(0xe1, Buffer.from("http://ns.adobe.com/xap/1.0/\0<x:xmpmeta>author</x:xmpmeta>", "latin1"));
  const icc = jpegSegment(0xe2, Buffer.from("ICC_PROFILE\0sRGB-ish profile bytes", "latin1"));
  const iptc = jpegSegment(0xed, Buffer.from("Photoshop 3.0\0creator: Parul", "latin1"));
  const comment = jpegSegment(0xfe, Buffer.from("shot at home", "latin1"));
  const sos = Buffer.from([0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x00, 0x00]);
  return Buffer.concat([SOI, exif, xmp, icc, iptc, comment, sos, Buffer.from([0x12, 0x34, 0x56, 0x78]), EOI]);
}

function pngChunk(type, payload) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(payload.length, 0);
  head.write(type, 4, "latin1");
  return Buffer.concat([head, payload, Buffer.alloc(4)]); // CRC is not checked by the stripper
}

function pngWithMetadata() {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return Buffer.concat([
    signature,
    pngChunk("IHDR", Buffer.alloc(13)),
    pngChunk("eXIf", Buffer.from("GPSLatitude=30.9", "latin1")),
    pngChunk("tEXt", Buffer.from("Author\0Parul Bedi", "latin1")),
    pngChunk("iTXt", Buffer.from("XML:com.adobe.xmp\0\0\0\0\0<camera/>", "latin1")),
    pngChunk("IDAT", Buffer.from([0x78, 0x9c, 0x01, 0x02])),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

function webpWithMetadata() {
  const chunk = (type, payload) => {
    const head = Buffer.alloc(8);
    head.write(type, 0, "latin1");
    head.writeUInt32LE(payload.length, 4);
    const pad = payload.length % 2 ? Buffer.from([0]) : Buffer.alloc(0);
    return Buffer.concat([head, payload, pad]);
  };
  const parts = [
    chunk("VP8 ", Buffer.from([0x00, 0x01, 0x02, 0x03])),
    chunk("EXIF", Buffer.from("SerialNumber SN-1", "latin1")),
    chunk("XMP ", Buffer.from("<x:xmpmeta/>", "latin1")),
    chunk("ICCP", Buffer.from("colour profile", "latin1")),
  ];
  const body = Buffer.concat(parts);
  const header = Buffer.alloc(12);
  header.write("RIFF", 0, "latin1");
  header.writeUInt32LE(body.length + 4, 4);
  header.write("WEBP", 8, "latin1");
  return Buffer.concat([header, body]);
}

test("JPEG: EXIF, XMP, IPTC and comments go; the image and the colour profile stay", () => {
  const original = jpegWithMetadata();
  const { buffer, stripped } = stripImageMetadata(original, "image/jpeg");

  assert.equal(stripped, true);
  for (const secret of ["GPSLatitude", "SerialNumber", "xmpmeta", "creator: Parul", "shot at home"]) {
    assert.ok(!buffer.includes(Buffer.from(secret, "latin1")), `${secret} survived`);
  }
  // The picture is untouched: SOI, the ICC profile, the scan data and EOI.
  assert.deepEqual(buffer.subarray(0, 2), SOI);
  assert.ok(buffer.includes(Buffer.from("ICC_PROFILE", "latin1")), "the colour profile was kept");
  assert.ok(buffer.includes(Buffer.from([0x12, 0x34, 0x56, 0x78])), "the pixels were kept");
  assert.deepEqual(buffer.subarray(-2), EOI);
  assert.ok(buffer.length < original.length);
});

test("PNG: text and EXIF chunks go; the pixel data stays byte for byte", () => {
  const original = pngWithMetadata();
  const { buffer, stripped } = stripImageMetadata(original, "image/png");

  assert.equal(stripped, true);
  for (const secret of ["GPSLatitude", "Parul Bedi", "camera"]) {
    assert.ok(!buffer.includes(Buffer.from(secret, "latin1")), `${secret} survived`);
  }
  assert.ok(buffer.includes(Buffer.from("IDAT", "latin1")), "the image data was kept");
  assert.ok(buffer.includes(Buffer.from("IHDR", "latin1")));
  assert.deepEqual(buffer.subarray(0, 8), original.subarray(0, 8));
});

test("WebP: EXIF and XMP chunks go; the colour profile and image stay", () => {
  const original = webpWithMetadata();
  const { buffer, stripped } = stripImageMetadata(original, "image/webp");

  assert.equal(stripped, true);
  assert.ok(!buffer.includes(Buffer.from("SerialNumber", "latin1")));
  assert.ok(!buffer.includes(Buffer.from("xmpmeta", "latin1")));
  assert.ok(buffer.includes(Buffer.from("VP8 ", "latin1")));
  assert.ok(buffer.includes(Buffer.from("ICCP", "latin1")));
  assert.equal(buffer.toString("latin1", 0, 4), "RIFF");
  assert.equal(buffer.readUInt32LE(4), buffer.length - 8, "the RIFF length was rewritten");
});

test("an image with nothing to remove is left byte for byte alone", () => {
  const icc = jpegSegment(0xe2, Buffer.from("ICC_PROFILE\0profile", "latin1"));
  const plain = Buffer.concat([SOI, icc, Buffer.from([0xff, 0xda, 0x00, 0x02]), EOI]);
  assert.deepEqual(stripImageMetadata(plain, "image/jpeg"), { buffer: plain, stripped: false });

  // A camera's free-text comment counts as removable: there is no way to tell
  // whether somebody wrote a place name into it, so it goes with the rest.
  const commented = Buffer.concat([
    SOI,
    jpegSegment(0xfe, Buffer.from("shot at home")),
    Buffer.from([0xff, 0xda, 0x00, 0x02]),
    EOI,
  ]);
  const cleaned = stripImageMetadata(commented, "image/jpeg");
  assert.equal(cleaned.stripped, true);
  assert.ok(!cleaned.buffer.includes(Buffer.from("shot at home")));
});

test("files it cannot parse come back untouched, never half-written", () => {
  const cases = [
    ["not an image at all", "image/jpeg"],
    [Buffer.from("%PDF-1.4\n%%EOF"), "application/pdf"],
    [Buffer.from([0xff, 0xd8, 0xff, 0xe1, 0x00]), "image/jpeg"], // truncated APP1
    [Buffer.from("RIFF\x10\x00\x00\x00WEBPEXIF"), "image/webp"], // truncated chunk
    [Buffer.alloc(0), "image/jpeg"],
  ];
  for (const [input, mime] of cases) {
    const buffer = Buffer.isBuffer(input) ? input : Buffer.from(input);
    assert.deepEqual(stripImageMetadata(buffer, mime), { buffer, stripped: false });
  }
});

test("a real photograph keeps its dimensions and loses its metadata", (t) => {
  let convert;
  try {
    convert = execFileSync("which", ["convert"]).toString().trim();
  } catch {
    t.skip("ImageMagick is not installed here");
    return;
  }
  if (!convert) {
    t.skip("ImageMagick is not installed here");
    return;
  }

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pb-exif-"));
  const source = path.join(dir, "photo.jpg");
  try {
    // ImageMagick writes a real JFIF/EXIF-bearing JPEG; we add our own block.
    execFileSync(convert, ["-size", "320x240", "gradient:#123456-#abcdef", source]);
    const bytes = fs.readFileSync(source);
    const withExif = Buffer.concat([
      bytes.subarray(0, 2),
      jpegSegment(0xe1, Buffer.from("Exif\0\0GPSLatitude 30.9 SerialNumber SN-9", "latin1")),
      bytes.subarray(2),
    ]);
    const { buffer, stripped } = stripImageMetadata(withExif, "image/jpeg");
    assert.equal(stripped, true);
    assert.ok(!buffer.includes(Buffer.from("GPSLatitude", "latin1")));

    const strippedPath = path.join(dir, "clean.jpg");
    fs.writeFileSync(strippedPath, buffer);
    const size = execFileSync("identify", ["-format", "%wx%h", strippedPath]).toString().trim();
    assert.equal(size, "320x240", "the cleaned file is still a 320×240 JPEG");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
