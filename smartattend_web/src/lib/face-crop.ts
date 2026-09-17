// Undistorted, face-centered cropping for registration photos.
//
// Root cause of "register on phone → never matches at the Pi": the old
// `normalizeOriginal()` in dataset-store.ts drew the *entire* picked photo
// into a fixed 240x300 canvas with `ctx.drawImage(img, 0, 0, w, h)`. That
// call ignores the source aspect ratio, so a typical 3:4 or 9:16 phone
// photo gets squashed non-uniformly into a 4:5 box. dlib's face encoder
// (used on the Pi) is sensitive to exactly this kind of geometric
// distortion — a stretched face produces a very different 128-d vector
// than the same face captured un-distorted by the Pi's live camera, even
// though it's the same person. Loosening the match tolerance or running
// CLAHE afterwards (both tried previously, per the project report) cannot
// fix a face whose proportions are already wrong.
//
// The fix: find the face in the photo (blazeface, ~400KB, runs client-side
// in well under a second on a phone), crop a square around it with margin
// — preserving aspect ratio, never stretching — and only then resize. If
// no face is found, fall back to an aspect-preserving center-crop instead
// of a distorting stretch, and tell the caller so it can ask the student
// to retake the photo instead of silently enrolling a bad sample.
import * as blazeface from '@tensorflow-models/blazeface';
import * as tf from '@tensorflow/tfjs';

export interface Rect { x: number; y: number; width: number; height: number }

export interface FaceCropResult {
  dataUrl: string;
  faceFound: boolean;
  /** Face box relative to source image width, 0..1. Used to flag tiny/far-away faces. */
  faceWidthRatio: number;
}

let detectorPromise: Promise<blazeface.BlazeFaceModel> | null = null;

function getDetector(): Promise<blazeface.BlazeFaceModel> {
  if (!detectorPromise) {
    detectorPromise = tf.ready().then(() => blazeface.load());
  }
  return detectorPromise;
}

/** Preload the model so the first photo pick doesn't pay the load cost. */
export function warmUpFaceDetector(): void {
  void getDetector().catch(() => {
    // Detector failed to load (offline, unsupported backend, ...) — callers
    // fall back to the center-crop path, so this is not fatal.
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

/**
 * Center "cover" crop rectangle: the largest same-aspect-ratio box centered
 * in the source that doesn't require stretching either dimension.
 * Pure function — no DOM — so it's unit-testable on its own.
 */
export function computeCenterCoverRect(srcW: number, srcH: number, targetAspect = 1): Rect {
  const srcAspect = srcW / srcH;
  let width: number;
  let height: number;
  if (srcAspect > targetAspect) {
    // Source is relatively wider than target → full height, crop width.
    height = srcH;
    width = height * targetAspect;
  } else {
    width = srcW;
    height = width / targetAspect;
  }
  return { x: (srcW - width) / 2, y: (srcH - height) / 2, width, height };
}

/**
 * Expand a detected face box into a padded square crop, clamped to stay
 * inside the source image. `margin` is extra room added on each side as a
 * fraction of the face size (e.g. 0.6 → 60% padding), so the stored crop
 * looks like a normal head-and-shoulders framing rather than a tight
 * bounding box, similar in scale to what the Pi's HOG detector works with.
 */
export function expandFaceBoxToSquare(box: Rect, srcW: number, srcH: number, margin = 0.6): Rect {
  const padded = Math.max(box.width, box.height) * (1 + margin * 2);
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;

  const size = Math.min(padded, srcW, srcH);
  let x = cx - size / 2;
  let y = cy - size / 2;
  x = Math.max(0, Math.min(x, srcW - size));
  y = Math.max(0, Math.min(y, srcH - size));

  return { x, y, width: size, height: size };
}

function renderCrop(img: HTMLImageElement, rect: Rect, outSize: number, quality: number): string {
  const c = document.createElement('canvas');
  c.width = outSize;
  c.height = outSize;
  const ctx = c.getContext('2d')!;
  // Same source and destination aspect ratio (both square) → uniform scale,
  // never a non-uniform stretch that would distort the face.
  ctx.drawImage(img, rect.x, rect.y, rect.width, rect.height, 0, 0, outSize, outSize);
  return c.toDataURL('image/jpeg', quality);
}

async function detectLargestFace(img: HTMLImageElement): Promise<Rect | null> {
  try {
    const detector = await getDetector();
    const predictions = await detector.estimateFaces(img, false);
    if (!predictions.length) return null;

    let best: Rect | null = null;
    let bestArea = 0;
    for (const p of predictions) {
      const [x1, y1] = p.topLeft as [number, number];
      const [x2, y2] = p.bottomRight as [number, number];
      const width = x2 - x1;
      const height = y2 - y1;
      const area = width * height;
      if (area > bestArea) {
        bestArea = area;
        best = { x: x1, y: y1, width, height };
      }
    }
    return best;
  } catch (e) {
    console.warn('face detection failed, falling back to center crop', e);
    return null;
  }
}

/**
 * Produce an undistorted, face-centered square crop of a registration
 * photo. Used for the exact image that gets stored as the "original" and
 * later downloaded by the Pi to build its dlib embedding — the only image
 * that actually matters for cross-device matching (augmented variants are
 * skipped by the Pi).
 */
export async function smartCropFace(
  src: string,
  outSize = 320,
  quality = 0.85,
): Promise<FaceCropResult> {
  const img = await loadImage(src);
  const srcW = img.naturalWidth || img.width;
  const srcH = img.naturalHeight || img.height;

  const faceBox = await detectLargestFace(img);

  if (faceBox) {
    const rect = expandFaceBoxToSquare(faceBox, srcW, srcH);
    return {
      dataUrl: renderCrop(img, rect, outSize, quality),
      faceFound: true,
      faceWidthRatio: faceBox.width / srcW,
    };
  }

  const rect = computeCenterCoverRect(srcW, srcH, 1);
  return {
    dataUrl: renderCrop(img, rect, outSize, quality),
    faceFound: false,
    faceWidthRatio: 0,
  };
}
