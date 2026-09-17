import { describe, it, expect } from 'vitest';
import { computeCenterCoverRect, expandFaceBoxToSquare } from '@/lib/face-crop';

describe('computeCenterCoverRect', () => {
  it('preserves aspect ratio for a wider-than-target source (no stretch)', () => {
    // A typical wide phone photo cropped to a square target: height is the
    // limiting dimension, width crops in from both sides — never resized
    // non-uniformly the way the old ctx.drawImage(img, 0, 0, w, h) did.
    const rect = computeCenterCoverRect(400, 300, 1);
    expect(rect.width).toBeCloseTo(300);
    expect(rect.height).toBeCloseTo(300);
    expect(rect.x).toBeCloseTo(50);
    expect(rect.y).toBeCloseTo(0);
  });

  it('preserves aspect ratio for a taller-than-target source (portrait phone photo)', () => {
    const rect = computeCenterCoverRect(300, 400, 1);
    expect(rect.width).toBeCloseTo(300);
    expect(rect.height).toBeCloseTo(300);
    expect(rect.x).toBeCloseTo(0);
    expect(rect.y).toBeCloseTo(50);
  });

  it('is a no-op crop for an already-square source', () => {
    const rect = computeCenterCoverRect(200, 200, 1);
    expect(rect).toEqual({ x: 0, y: 0, width: 200, height: 200 });
  });
});

describe('expandFaceBoxToSquare', () => {
  it('pads a detected face box into a centered square', () => {
    const rect = expandFaceBoxToSquare({ x: 100, y: 100, width: 50, height: 50 }, 1000, 1000, 0.6);
    expect(rect.width).toBeCloseTo(rect.height);
    expect(rect.width).toBeCloseTo(110);
    // Centered on the original face box's center (125, 125).
    expect(rect.x + rect.width / 2).toBeCloseTo(125);
    expect(rect.y + rect.height / 2).toBeCloseTo(125);
  });

  it('clamps the padded box so it never crosses the image bounds', () => {
    const rect = expandFaceBoxToSquare({ x: 190, y: 190, width: 20, height: 20 }, 200, 200, 0.6);
    expect(rect.x).toBeGreaterThanOrEqual(0);
    expect(rect.y).toBeGreaterThanOrEqual(0);
    expect(rect.x + rect.width).toBeLessThanOrEqual(200);
    expect(rect.y + rect.height).toBeLessThanOrEqual(200);
  });

  it('never produces a crop larger than the source image', () => {
    const rect = expandFaceBoxToSquare({ x: 40, y: 40, width: 300, height: 300 }, 400, 400, 0.6);
    expect(rect.width).toBeLessThanOrEqual(400);
    expect(rect.height).toBeLessThanOrEqual(400);
  });
});
