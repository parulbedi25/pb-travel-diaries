/**
 * Remove the personal data that a camera writes into a photograph.
 *
 * A photo straight off a phone carries GPS coordinates, the device make and
 * serial, the owner's name, and the exact time it was taken. Every upload here
 * is served from a public URL, so storing those bytes verbatim would publish a
 * visitor's home coordinates and hardware identifiers next to the picture.
 *
 * The pixels are left exactly as they arrived — this is not a re-encode, so
 * quality and transparency are untouched. Only the metadata blocks are dropped:
 *
 *   JPEG  APP1 (EXIF, including GPS, and XMP), APP13 (IPTC captions and creator)
 *   PNG   eXIf, tEXt / iTXt / zTXt (author, software, camera notes)
 *   WebP  EXIF and XMP chunks
 *
 * ICC colour profiles (JPEG APP2, WebP ICCP) are deliberately kept: they are
 * what makes the image look like the image, and they say nothing about a person.
 *
 * Anything that cannot be parsed is returned untouched — a file the app cannot
 * understand is not a file it should attempt to rewrite.
 */

/** Formats this module knows how to clean. */
const CLEANABLE = /^image\/(jpeg|png|webp)$/i;

/**
 * A JPEG is a run of `FFxx` markers. Everything before the image data is
 * metadata, so the segment types to drop are simply skipped while copying.
 */
function stripJpeg(buffer) {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) return null;

  const parts = [buffer.subarray(0, 2)]; // SOI
  let offset = 2;
  let changed = false;

  while (offset + 4 <= buffer.length) {
    // Markers can be preceded by fill bytes (0xFF padding).
    if (buffer[offset] !== 0xff) {
      // Not a marker: stop and keep the rest as it is (a broken or unusual file).
      parts.push(buffer.subarray(offset));
      offset = buffer.length;
      break;
    }
    const marker = buffer[offset + 1];
    // Start of scan / end of image: the entropy-coded data follows, untouched.
    if (marker === 0xda || marker === 0xd9) {
      parts.push(buffer.subarray(offset));
      offset = buffer.length;
      break;
    }
    // Standalone markers carry no length field.
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) {
      parts.push(buffer.subarray(offset, offset + 2));
      offset += 2;
      continue;
    }
    const length = buffer.readUInt16BE(offset + 2);
    if (length < 2 || offset + 2 + length > buffer.length) {
      // Malformed: give up rather than truncate the file.
      return null;
    }
    const end = offset + 2 + length;
    // APP1 = EXIF/XMP, APP13 = IPTC, COM = a free-text comment a camera or an
    // editor may have filled with anything. APP2 (ICC) and the rest stay.
    const drop = marker === 0xe1 || marker === 0xed || marker === 0xfe;
    if (drop) changed = true;
    else parts.push(buffer.subarray(offset, end));
    offset = end;
  }

  if (!changed) return buffer;
  return Buffer.concat(parts);
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** A PNG is a signature followed by length-prefixed, CRC'd chunks. */
function stripPng(buffer) {
  if (buffer.length < 8 || !buffer.subarray(0, 8).equals(PNG_SIGNATURE)) return null;

  const parts = [buffer.subarray(0, 8)];
  let offset = 8;
  let changed = false;
  // Text chunks name their author, the software used and sometimes a location.
  const dropped = new Set(["eXIf", "tEXt", "iTXt", "zTXt", "tIME"]);

  while (offset + 12 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString("latin1", offset + 4, offset + 8);
    const end = offset + 12 + length;
    if (end > buffer.length) return null;
    if (dropped.has(type)) changed = true;
    else parts.push(buffer.subarray(offset, end));
    offset = end;
    if (type === "IEND") break;
  }

  if (!changed) return buffer;
  return Buffer.concat(parts);
}

/** WebP is RIFF: a header, then length-prefixed chunks. */
function stripWebp(buffer) {
  if (buffer.length < 12) return null;
  if (buffer.toString("latin1", 0, 4) !== "RIFF") return null;
  if (buffer.toString("latin1", 8, 12) !== "WEBP") return null;

  const chunks = [];
  let offset = 12;
  let changed = false;
  while (offset + 8 <= buffer.length) {
    const type = buffer.toString("latin1", offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    const end = offset + 8 + size + (size % 2); // chunks are padded to even
    if (offset + 8 + size > buffer.length) return null;
    if (type === "EXIF" || type === "XMP ") changed = true;
    else chunks.push(buffer.subarray(offset, Math.min(end, buffer.length)));
    offset = end;
  }
  if (!changed) return buffer;

  const body = Buffer.concat(chunks);
  const header = Buffer.alloc(12);
  header.write("RIFF", 0, "latin1");
  header.writeUInt32LE(body.length + 4, 4);
  header.write("WEBP", 8, "latin1");
  return Buffer.concat([header, body]);
}

/**
 * Strip identifying metadata from image bytes.
 *
 * Returns `{ buffer, stripped }` — `stripped` says whether anything was
 * actually removed, so the caller can record it. Bytes that are not a
 * supported image, or do not parse, come back exactly as they went in.
 */
export function stripImageMetadata(input, mime = "") {
  const buffer = Buffer.isBuffer(input) ? input : Buffer.from(input ?? []);
  if (!buffer.length) return { buffer, stripped: false };

  // Trust the bytes over the declared type: a .jpg renamed to .png is common.
  let cleaned = null;
  if (buffer[0] === 0xff && buffer[1] === 0xd8) cleaned = stripJpeg(buffer);
  else if (buffer.subarray(0, 8).equals(PNG_SIGNATURE)) cleaned = stripPng(buffer);
  else if (buffer.toString("latin1", 0, 4) === "RIFF") cleaned = stripWebp(buffer);
  else if (CLEANABLE.test(mime)) return { buffer, stripped: false };

  if (!cleaned) return { buffer, stripped: false };
  // A cleaned file must still be the same kind of file: the rewrite may only
  // ever drop blocks, never the signature. (A WebP's RIFF length is rewritten
  // to match its new size, so only its "RIFF"/"WEBP" markers are compared.)
  const same = (start, end) => cleaned.subarray(start, end).equals(buffer.subarray(start, end));
  const recognisable =
    buffer[0] === 0xff
      ? same(0, 2)
      : buffer.subarray(0, 8).equals(PNG_SIGNATURE)
        ? same(0, 8)
        : same(0, 4) && same(8, 12);
  if (cleaned !== buffer && !recognisable) return { buffer, stripped: false };
  return { buffer: cleaned, stripped: cleaned !== buffer };
}

