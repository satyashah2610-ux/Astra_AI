import type { Point } from './geometry';

/** Minimum total pen travel, as a fraction of the pad, that counts as a signature. */
export const MIN_INK = .15;

/** Length of one stroke in pad-relative units (points are 0–1 fractions of the pad). */
export function strokeLength(stroke: Point[]): number {
  let length = 0;
  for (let i = 1; i < stroke.length; i++) length += Math.hypot(stroke[i].x - stroke[i - 1].x, stroke[i].y - stroke[i - 1].y);
  return length;
}

/** True when the strokes are more than a tap or an accidental scribble. */
export function hasInk(strokes: Point[][]): boolean {
  return strokes.reduce((total, stroke) => total + strokeLength(stroke), 0) >= MIN_INK;
}
