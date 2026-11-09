import { describe, expect, it } from 'vitest';
import { drawBox, moveBox, resizeBox } from './geometry';

describe('PDF coordinates stay proportional and inside the page', () => {
  it('draws the same box in either direction', () => {
    expect(drawBox({ x: .5, y: .7 }, { x: .2, y: .6 })).toEqual({ x: .2, y: .6, width: .3, height: expect.closeTo(.1) });
  });
  it('clamps a drawn box to the page', () => {
    expect(drawBox({ x: -.1, y: .9 }, { x: 1.2, y: 1.2 })).toEqual({ x: 0, y: .9, width: 1, height: expect.closeTo(.1) });
  });
  it('rejects accidental clicks and very small fields', () => {
    expect(drawBox({ x: .2, y: .2 }, { x: .201, y: .201 })).toBeNull();
  });
  it('keeps moved fields within page edges', () => {
    expect(moveBox({ x: .2, y: .2, width: .3, height: .1 }, { x: 2, y: -1 })).toEqual({ x: .7, y: 0, width: .3, height: .1 });
  });
  it('clamps resizing to page bounds and minimum size', () => {
    expect(resizeBox({ x: .8, y: .9, width: .1, height: .05 }, { x: 1, y: 1 })).toEqual({ x: .8, y: .9, width: expect.closeTo(.2), height: expect.closeTo(.1) });
    const small = resizeBox({ x: .2, y: .2, width: .3, height: .1 }, { x: -1, y: -1 });
    expect(small.width).toBeGreaterThanOrEqual(.04);
    expect(small.height).toBeGreaterThanOrEqual(.025);
  });
});
