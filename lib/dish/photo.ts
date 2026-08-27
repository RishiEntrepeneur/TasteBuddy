/**
 * Getting a phone photo ready to send.
 *
 * Three jobs, one mechanism. Drawing the picture onto a canvas and re-encoding
 * it handles all of them at once:
 *
 *   HEIC. iPhones shoot it by default and the API will not take it. Safari can
 *   decode HEIC into a bitmap, so a canvas round-trip converts it without
 *   asking anybody to change a camera setting they should not have to know
 *   about.
 *
 *   Size. A 12-megapixel photo is 4-6 MB and lands right on the upload cap.
 *   Rejecting it is a terrible first experience when shrinking it is free.
 *
 *   Rotation. A portrait photo carries its orientation in EXIF rather than in
 *   its pixels. Drawn naively it arrives sideways, and a sideways menu reads
 *   about as well as you would expect.
 *
 * Stripping EXIF is a fourth thing that falls out of it, and worth having on
 * purpose: a photo taken in a restaurant carries where the restaurant is, and
 * this app has no business sending that anywhere.
 */

/**
 * Claude Opus 5 reads images up to 2576 pixels on the long edge; anything
 * larger is scaled down before it is looked at, so sending more is paying to
 * transmit detail nobody will see.
 *
 * This is deliberately the maximum rather than the cheap default. Halving it
 * would roughly halve the image cost, and on most vision tasks that is the
 * right trade. Not here: the allergens are in the small print under the dish
 * name, and small print is exactly what a downscale destroys first.
 */
const LONG_EDGE = 2576;

/** High enough for text, low enough that the ringing does not eat thin strokes. */
const QUALITY = 0.85;

export interface PreparedPhoto {
  blob: Blob;
  width: number;
  height: number;
  /** Bytes before and after, so the caller can say what it saved. */
  bytesIn: number;
  bytesOut: number;
}

export class PhotoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PhotoError";
  }
}

/**
 * Decodes to a bitmap with EXIF orientation already applied.
 *
 * `createImageBitmap` is the path that gets both the orientation and HEIC
 * right where it exists. The `<img>` fallback is for older browsers, where
 * modern rendering applies EXIF orientation on draw anyway.
 */
async function decode(file: File): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === "function") {
    try {
      return await createImageBitmap(file, { imageOrientation: "from-image" });
    } catch {
      // Fall through: some browsers reject the options bag rather than the
      // file, and the plain path below may still manage it.
    }
  }

  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = "sync";
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("decode failed"));
      img.src = url;
    });
    return img;
  } catch {
    throw new PhotoError(
      "This browser could not open that photo. If it came off an iPhone, open it in Photos and share it as a JPEG.",
    );
  } finally {
    // Revoked after load; the bitmap no longer needs the URL.
    URL.revokeObjectURL(url);
  }
}

function sizeOf(source: ImageBitmap | HTMLImageElement): [number, number] {
  return source instanceof HTMLImageElement
    ? [source.naturalWidth, source.naturalHeight]
    : [source.width, source.height];
}

/** Shrinks, rotates, converts and strips a photo down to what gets sent. */
export async function preparePhoto(file: File): Promise<PreparedPhoto> {
  const source = await decode(file);
  const [sourceWidth, sourceHeight] = sizeOf(source);

  if (!sourceWidth || !sourceHeight) {
    throw new PhotoError("That file does not look like a photo.");
  }

  const scale = Math.min(1, LONG_EDGE / Math.max(sourceWidth, sourceHeight));
  const width = Math.round(sourceWidth * scale);
  const height = Math.round(sourceHeight * scale);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext("2d");
  if (!context) throw new PhotoError("That photo could not be prepared.");

  // A white ground, so a transparent PNG does not become black paper.
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, width, height);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(source, 0, 0, width, height);

  if (!(source instanceof HTMLImageElement)) source.close();

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", QUALITY),
  );

  if (!blob) throw new PhotoError("That photo could not be prepared.");

  return {
    blob,
    width,
    height,
    bytesIn: file.size,
    bytesOut: blob.size,
  };
}
