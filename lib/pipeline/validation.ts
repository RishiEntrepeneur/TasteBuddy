/**
 * Upload validation for the 2D-to-3D pipeline.
 *
 * Mesh generation is expensive, so everything that can be rejected cheaply is
 * rejected here — before a single byte reaches the generator. Content type is
 * sniffed from magic bytes rather than trusted from the multipart header,
 * because the header is attacker-controlled.
 */

export const MAX_UPLOAD_BYTES = 12 * 1024 * 1024; // 12 MB
export const MIN_UPLOAD_BYTES = 4 * 1024; // 4 KB — below this it is not a photo

/** Photogrammetry degrades badly below this; above it we gain nothing. */
export const MIN_IMAGE_DIMENSION = 512;
export const MAX_IMAGE_DIMENSION = 8192;

export type SupportedImageFormat = "jpeg" | "png" | "webp" | "heic";

export const SUPPORTED_MIME_TYPES: Readonly<
  Record<SupportedImageFormat, string>
> = {
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  heic: "image/heic",
};

export interface ImageDimensions {
  width: number;
  height: number;
}

export interface ValidatedImage {
  format: SupportedImageFormat;
  mimeType: string;
  bytes: Uint8Array;
  sizeBytes: number;
  /** Null for HEIC, whose header we deliberately do not parse. */
  dimensions: ImageDimensions | null;
  /** SHA-256 hex digest — the pipeline's idempotency / cache key. */
  checksum: string;
}

export type ValidationFailureCode =
  | "missing_file"
  | "file_too_large"
  | "file_too_small"
  | "unsupported_format"
  | "declared_type_mismatch"
  | "image_too_small"
  | "image_too_large"
  | "corrupt_image";

export interface ValidationFailure {
  ok: false;
  code: ValidationFailureCode;
  message: string;
}

export type ValidationResult =
  | { ok: true; image: ValidatedImage }
  | ValidationFailure;

function fail(code: ValidationFailureCode, message: string): ValidationFailure {
  return { ok: false, code, message };
}

/* -------------------------------------------------------------------------- */
/*  Magic-byte sniffing                                                        */
/* -------------------------------------------------------------------------- */

function startsWith(bytes: Uint8Array, signature: readonly number[]): boolean {
  if (bytes.length < signature.length) return false;
  return signature.every((byte, index) => bytes[index] === byte);
}

/** Detects the real format from the file header, ignoring the declared type. */
export function sniffFormat(bytes: Uint8Array): SupportedImageFormat | null {
  // JPEG: FF D8 FF
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "jpeg";

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return "png";
  }

  // RIFF....WEBP
  if (
    startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) &&
    bytes.length >= 12 &&
    startsWith(bytes.subarray(8, 12), [0x57, 0x45, 0x42, 0x50])
  ) {
    return "webp";
  }

  // ISO-BMFF `ftyp` box with a HEIC/HEIF brand — the default on modern iPhones.
  if (
    bytes.length >= 12 &&
    startsWith(bytes.subarray(4, 8), [0x66, 0x74, 0x79, 0x70])
  ) {
    const brand = String.fromCharCode(...bytes.subarray(8, 12));
    if (
      ["heic", "heix", "hevc", "heim", "heis", "mif1", "msf1"].includes(brand)
    ) {
      return "heic";
    }
  }

  return null;
}

/* -------------------------------------------------------------------------- */
/*  Dimension parsing (header-only, no image decode)                           */
/* -------------------------------------------------------------------------- */

function readPngDimensions(bytes: Uint8Array): ImageDimensions | null {
  // IHDR is always the first chunk: width at byte 16, height at byte 20.
  if (bytes.length < 24) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

function readJpegDimensions(bytes: Uint8Array): ImageDimensions | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 2; // skip SOI

  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1; // resync past padding
      continue;
    }

    const marker = bytes[offset + 1];
    // Standalone markers carry no length field.
    if (
      marker === 0xd8 ||
      marker === 0x01 ||
      (marker >= 0xd0 && marker <= 0xd7)
    ) {
      offset += 2;
      continue;
    }
    if (marker === 0xd9 || marker === 0xda) break; // EOI / start of scan

    const length = view.getUint16(offset + 2);
    if (length < 2) return null;

    // SOF0..SOF15, excluding the DHT/JPG/DAC markers interleaved in that range.
    const isStartOfFrame =
      marker >= 0xc0 &&
      marker <= 0xcf &&
      marker !== 0xc4 &&
      marker !== 0xc8 &&
      marker !== 0xcc;

    if (isStartOfFrame) {
      if (offset + 9 >= bytes.length) return null;
      return {
        height: view.getUint16(offset + 5),
        width: view.getUint16(offset + 7),
      };
    }

    offset += 2 + length;
  }

  return null;
}

function readWebpDimensions(bytes: Uint8Array): ImageDimensions | null {
  if (bytes.length < 30) return null;
  const chunk = String.fromCharCode(...bytes.subarray(12, 16));
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  if (chunk === "VP8 ") {
    // Lossy: 14-bit dimensions after the 3-byte start code at offset 23.
    return {
      width: view.getUint16(26, true) & 0x3fff,
      height: view.getUint16(28, true) & 0x3fff,
    };
  }

  if (chunk === "VP8L") {
    // Lossless: 14 bits each, packed little-endian from offset 21.
    const packed = view.getUint32(21, true);
    return {
      width: (packed & 0x3fff) + 1,
      height: ((packed >> 14) & 0x3fff) + 1,
    };
  }

  if (chunk === "VP8X") {
    // Extended: 24-bit canvas size minus one, from offset 24.
    const width = (bytes[24] | (bytes[25] << 8) | (bytes[26] << 16)) + 1;
    const height = (bytes[27] | (bytes[28] << 8) | (bytes[29] << 16)) + 1;
    return { width, height };
  }

  return null;
}

export function readDimensions(
  format: SupportedImageFormat,
  bytes: Uint8Array,
): ImageDimensions | null {
  try {
    switch (format) {
      case "png":
        return readPngDimensions(bytes);
      case "jpeg":
        return readJpegDimensions(bytes);
      case "webp":
        return readWebpDimensions(bytes);
      case "heic":
        // HEIC dimensions live in a nested ISO-BMFF box tree; the generator
        // reads them after transcoding, so we skip the check here.
        return null;
    }
  } catch {
    return null;
  }
}

/* -------------------------------------------------------------------------- */
/*  Checksum                                                                   */
/* -------------------------------------------------------------------------- */

/** SHA-256 via WebCrypto — available on both the Node and Edge runtimes. */
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    bytes.slice().buffer as ArrayBuffer,
  );
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/* -------------------------------------------------------------------------- */
/*  Entry point                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Validates one uploaded dish photo end to end: size bounds, real format,
 * declared-vs-actual type agreement, pixel dimensions and checksum.
 */
export async function validateImageUpload(
  file: File | null,
): Promise<ValidationResult> {
  if (!file || typeof file.arrayBuffer !== "function") {
    return fail(
      "missing_file",
      "No image was uploaded under the `image` field.",
    );
  }

  if (file.size > MAX_UPLOAD_BYTES) {
    return fail(
      "file_too_large",
      `Image is ${(file.size / 1024 / 1024).toFixed(1)} MB; the limit is ${MAX_UPLOAD_BYTES / 1024 / 1024} MB.`,
    );
  }

  if (file.size < MIN_UPLOAD_BYTES) {
    return fail(
      "file_too_small",
      `Image is only ${file.size} bytes, too small to reconstruct a mesh from.`,
    );
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const format = sniffFormat(bytes);

  if (!format) {
    return fail(
      "unsupported_format",
      "Unsupported image format. Upload a JPEG, PNG, WebP or HEIC photo.",
    );
  }

  const expectedMime = SUPPORTED_MIME_TYPES[format];
  // A mismatched declared type is a red flag, not just a nuisance.
  if (
    file.type &&
    file.type !== expectedMime &&
    file.type !== "application/octet-stream"
  ) {
    return fail(
      "declared_type_mismatch",
      `Upload declared "${file.type}" but the file is actually ${expectedMime}.`,
    );
  }

  const dimensions = readDimensions(format, bytes);

  if (dimensions) {
    if (dimensions.width <= 0 || dimensions.height <= 0) {
      return fail("corrupt_image", "Image header reports a zero dimension.");
    }
    if (
      dimensions.width < MIN_IMAGE_DIMENSION ||
      dimensions.height < MIN_IMAGE_DIMENSION
    ) {
      return fail(
        "image_too_small",
        `Image is ${dimensions.width}x${dimensions.height}; at least ${MIN_IMAGE_DIMENSION}px on each side is required.`,
      );
    }
    if (
      dimensions.width > MAX_IMAGE_DIMENSION ||
      dimensions.height > MAX_IMAGE_DIMENSION
    ) {
      return fail(
        "image_too_large",
        `Image is ${dimensions.width}x${dimensions.height}; the maximum is ${MAX_IMAGE_DIMENSION}px on each side.`,
      );
    }
  }

  return {
    ok: true,
    image: {
      format,
      mimeType: expectedMime,
      bytes,
      sizeBytes: file.size,
      dimensions,
      checksum: await sha256Hex(bytes),
    },
  };
}
