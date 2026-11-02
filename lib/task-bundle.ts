/**
 * Read one STORED (uncompressed) entry from a MediaPipe .task bundle (a zip).
 *
 * The pinned gesture_recognizer.task contains the exact hand_landmarker.task
 * (palm detector + landmark model) next to a gesture embedder/classifier.
 * Fingerspelling never uses gestures, so it can run HandLandmarker on those
 * same verified weights. The caller verifies the outer bundle's SHA-256
 * first and the extracted entry's SHA-256 after; this reader is strict and
 * rejects anything other than a single stored entry with consistent sizes.
 */
const u16 = (b: Uint8Array, at: number) => b[at] | (b[at + 1] << 8);
const u32 = (b: Uint8Array, at: number) => (b[at] | (b[at + 1] << 8) | (b[at + 2] << 16) | (b[at + 3] << 24)) >>> 0;

export function storedZipEntry(bundle: Uint8Array, name: string): Uint8Array {
  // End of central directory: signature within the last 64 KiB + 22 bytes.
  let eocd = -1;
  for (let at = bundle.length - 22; at >= Math.max(0, bundle.length - 65557); at--) {
    if (u32(bundle, at) === 0x06054b50) { eocd = at; break; }
  }
  if (eocd < 0) throw new Error("Model bundle has no zip directory");
  const count = u16(bundle, eocd + 10), size = u32(bundle, eocd + 12), offset = u32(bundle, eocd + 16);
  // Bytes prepended before the archive shift every recorded offset equally.
  const shift = eocd - size - offset;
  if (shift < 0) throw new Error("Model bundle directory is inconsistent");
  const expected = new TextEncoder().encode(name);
  let at = offset + shift, match: { local: number; length: number } | null = null;
  for (let i = 0; i < count; i++) {
    if (at + 46 > eocd || u32(bundle, at) !== 0x02014b50) throw new Error("Model bundle directory is malformed");
    const method = u16(bundle, at + 10), compressed = u32(bundle, at + 20), length = u32(bundle, at + 24);
    const nameLength = u16(bundle, at + 28), extra = u16(bundle, at + 30), comment = u16(bundle, at + 32), local = u32(bundle, at + 42);
    const entry = bundle.subarray(at + 46, at + 46 + nameLength);
    if (entry.length === expected.length && entry.every((v, j) => v === expected[j])) {
      if (match) throw new Error("Model bundle has duplicate entries");
      if (method !== 0 || compressed !== length) throw new Error("Model bundle entry is not stored uncompressed");
      match = { local: local + shift, length };
    }
    at += 46 + nameLength + extra + comment;
  }
  if (!match) throw new Error(`Model bundle has no ${name}`);
  const { local, length } = match;
  if (u32(bundle, local) !== 0x04034b50) throw new Error("Model bundle entry header is malformed");
  const start = local + 30 + u16(bundle, local + 26) + u16(bundle, local + 28);
  if (start + length > bundle.length) throw new Error("Model bundle entry is truncated");
  return bundle.subarray(start, start + length);
}
