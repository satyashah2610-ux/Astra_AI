import { expect, it } from 'vitest';
import { hasInk, strokeLength } from './strokes';

it('measures a stroke in pad-relative units', () => {
  expect(strokeLength([{ x: 0, y: 0 }, { x: .3, y: .4 }])).toBeCloseTo(.5);
  expect(strokeLength([{ x: .5, y: .5 }])).toBe(0);
});

it('treats taps and tiny scribbles as no signature', () => {
  expect(hasInk([])).toBe(false);
  expect(hasInk([[{ x: .5, y: .5 }]])).toBe(false);
  expect(hasInk([[{ x: .5, y: .5 }, { x: .52, y: .5 }], [{ x: .1, y: .1 }, { x: .1, y: .12 }]])).toBe(false);
});

it('accepts a real signature made of one or more strokes', () => {
  expect(hasInk([[{ x: .1, y: .5 }, { x: .4, y: .3 }]])).toBe(true);
  expect(hasInk([[{ x: .1, y: .5 }, { x: .2, y: .5 }], [{ x: .3, y: .5 }, { x: .4, y: .5 }]])).toBe(true);
});
