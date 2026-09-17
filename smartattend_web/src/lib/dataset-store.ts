// Face dataset store (localStorage-backed)
// Each student's dataset = 5 poses × (1 original + 10 augmented) = 55 images

import { smartCropFace, type FaceCropResult } from '@/lib/face-crop';

export type Pose = 'front' | 'up' | 'down' | 'left' | 'right';

export interface PoseSample {
  pose: Pose;
  label: string;
  original: string;      // dataURL (the captured photo)
  augmented: string[];   // 10 dataURLs
  capturedAt: string;
}

export interface FaceDataset {
  studentId: string;         // internal user id
  studentCode?: string;      // "67543210064-1"
  studentName: string;
  email?: string;
  samples: PoseSample[];
  totalImages: number;       // 60
  createdAt: string;
  updatedAt: string;
}

const INDEX_KEY = 'dataset.index';
const key = (id: string) => `dataset.${id}`;

export const getDatasetIndex = (): string[] => {
  try { return JSON.parse(localStorage.getItem(INDEX_KEY) || '[]'); } catch { return []; }
};

export const getDataset = (studentId: string): FaceDataset | null => {
  try {
    const raw = localStorage.getItem(key(studentId));
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
};

export const getAllDatasets = (): FaceDataset[] => {
  return getDatasetIndex()
    .map(id => getDataset(id))
    .filter((d): d is FaceDataset => !!d)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
};

export const saveDataset = (ds: FaceDataset) => {
  try {
    localStorage.setItem(key(ds.studentId), JSON.stringify(ds));
    const idx = getDatasetIndex();
    if (!idx.includes(ds.studentId)) {
      idx.push(ds.studentId);
      localStorage.setItem(INDEX_KEY, JSON.stringify(idx));
    }
    window.dispatchEvent(new Event('dataset:update'));
  } catch (e) {
    console.warn('dataset save failed (quota?)', e);
  }
};

export const deleteDataset = (studentId: string) => {
  localStorage.removeItem(key(studentId));
  const idx = getDatasetIndex().filter(id => id !== studentId);
  localStorage.setItem(INDEX_KEY, JSON.stringify(idx));
  window.dispatchEvent(new Event('dataset:update'));
};

// ---------- Pending upload tracking (photos captured but not yet in the cloud DB) ----------

const PENDING_KEY = 'dataset.pendingUpload';

export const getPendingUploads = (): string[] => {
  try { return JSON.parse(localStorage.getItem(PENDING_KEY) || '[]'); } catch { return []; }
};
export const isPendingUpload = (studentId: string): boolean => getPendingUploads().includes(studentId);
export const setPendingUpload = (studentId: string, pending: boolean) => {
  const list = new Set(getPendingUploads());
  if (pending) list.add(studentId); else list.delete(studentId);
  localStorage.setItem(PENDING_KEY, JSON.stringify([...list]));
  window.dispatchEvent(new Event('dataset:update'));
};

// ---------- Data Augmentation ----------

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

/**
 * Generate `count` augmented variants of the source image using canvas transforms:
 *  - random rotation, scale, translation, horizontal flip
 *  - random brightness/contrast/hue via canvas filters
 *  - light gaussian-like noise overlay
 */
export async function augmentImage(src: string, count = 10, size = { w: 160, h: 200 }): Promise<string[]> {
  const img = await loadImage(src);
  const { w: W, h: H } = size;
  const out: string[] = [];

  for (let i = 0; i < count; i++) {
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const ctx = c.getContext('2d')!;

    // Deterministic-ish variety across the 10 samples
    const rot = ((i - 5) / 5) * 0.22 + (Math.random() - 0.5) * 0.08;   // ~ ±14°
    const scale = 0.9 + ((i % 3) * 0.05) + Math.random() * 0.05;
    const tx = (Math.random() - 0.5) * 12;
    const ty = (Math.random() - 0.5) * 12;
    const flip = i === 4 || i === 9; // flip a couple
    const brightness = 0.8 + Math.random() * 0.4;
    const contrast = 0.9 + Math.random() * 0.25;
    const hue = Math.floor((Math.random() - 0.5) * 20);
    const saturate = 0.9 + Math.random() * 0.2;

    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);
    ctx.save();
    ctx.translate(W / 2 + tx, H / 2 + ty);
    ctx.rotate(rot);
    ctx.scale(flip ? -scale : scale, scale);
    // @ts-ignore filter is supported in modern browsers
    ctx.filter = `brightness(${brightness}) contrast(${contrast}) hue-rotate(${hue}deg) saturate(${saturate})`;
    ctx.drawImage(img, -W / 2, -H / 2, W, H);
    ctx.restore();

    // Light noise
    if (i % 2 === 0) {
      const noise = ctx.getImageData(0, 0, W, H);
      const d = noise.data;
      for (let p = 0; p < d.length; p += 4) {
        const n = (Math.random() - 0.5) * 18;
        d[p] = Math.max(0, Math.min(255, d[p] + n));
        d[p + 1] = Math.max(0, Math.min(255, d[p + 1] + n));
        d[p + 2] = Math.max(0, Math.min(255, d[p + 2] + n));
      }
      ctx.putImageData(noise, 0, 0);
    }

    out.push(c.toDataURL('image/jpeg', 0.55));
  }
  return out;
}

/**
 * Normalize a captured/picked registration photo for storage.
 *
 * This used to draw the whole source image into a fixed 240x300 box with
 * `ctx.drawImage(img, 0, 0, w, h)`, which stretches every photo to that
 * exact aspect ratio regardless of its own — a 3:4 or 9:16 phone photo gets
 * squashed non-uniformly. That distortion is enough by itself to push the
 * dlib face embedding the Raspberry Pi computes from this same stored image
 * far away from the embedding it computes for the same person live at the
 * camera, which is what caused "registered via app, never matches at the
 * Pi." Now it detects the face and produces an undistorted, face-centered
 * square crop instead (see face-crop.ts); if no face is found it falls
 * back to an aspect-preserving center crop rather than a stretch.
 */
export async function normalizeOriginal(src: string, outSize = 320): Promise<string> {
  const { dataUrl } = await smartCropFace(src, outSize);
  return dataUrl;
}

/** Same as `normalizeOriginal` but also reports whether a face was actually
 * found, so callers can warn the student instead of silently enrolling a
 * center-cropped photo that may not even contain their face. */
export async function normalizeOriginalDetailed(src: string, outSize = 320): Promise<FaceCropResult> {
  return smartCropFace(src, outSize);
}
