import { describe, expect, it } from 'vitest';
import { formatSigningDate, initialsFrom, printedTextSize, isSignatureMark, itemsReady, ITEM_TOOLS, placeItem, type SignerItem } from './items';

describe('placeItem', () => {
  it('centres the item on the tapped point', () => {
    const box = placeItem('text', { x: .5, y: .5 }, 1.294);
    expect(box.x + box.width / 2).toBeCloseTo(.5);
    expect(box.y + box.height / 2).toBeCloseTo(.5);
  });
  it('keeps the item inside the page near an edge', () => {
    const box = placeItem('signature', { x: .99, y: .995 }, 1.294);
    expect(box.x + box.width).toBeLessThanOrEqual(1);
    expect(box.y + box.height).toBeLessThanOrEqual(1);
    expect(placeItem('dot', { x: 0, y: 0 }, 1.294)).toMatchObject({ x: 0, y: 0 });
  });
  it.each([['check'], ['dot'], ['initials']] as const)('makes %s square on screen for any page shape', type => {
    for (const aspect of [1.294, 1.414, .773]) {  // letter, A4, landscape
      const box = placeItem(type, { x: .5, y: .5 }, aspect);
      expect(box.height * aspect).toBeCloseTo(box.width);  // height in page-width units equals the width
    }
  });
});

describe('initialsFrom', () => {
  it.each([['Jordan A. Smith', 'JAS'], ['  jordan   smith ', 'JS'], ['Madonna', 'M'], ['', ''], ['Ana María de la Cruz', 'AMD']])('%s -> %s', (name, initials) => {
    expect(initialsFrom(name)).toBe(initials);
  });
});

describe('formatSigningDate', () => {
  it('matches the server format, e.g. 09 Sep 2026', () => {
    expect(formatSigningDate(new Date(2026, 8, 9))).toBe('09 Sep 2026');
    expect(formatSigningDate(new Date(2026, 10, 30))).toBe('30 Nov 2026');
  });
});

describe('marks and readiness', () => {
  it('treats template marks without a type as signature boxes', () => {
    expect(isSignatureMark({ id: 'a', page: 1, x: 0, y: 0, width: .1, height: .1 })).toBe(true);
    expect(isSignatureMark({ id: 'a', page: 1, x: 0, y: 0, width: .1, height: .1, type: 'comment', text: 'x' })).toBe(false);
  });
  it('needs every text item filled in', () => {
    const item = (type: SignerItem['type'], text?: string): SignerItem => ({ id: type, type, page: 1, x: 0, y: 0, width: .1, height: .02, text });
    expect(itemsReady([item('check'), item('text', 'Unit 4B')])).toBe(true);
    expect(itemsReady([item('text', '   ')])).toBe(false);
    expect(itemsReady([])).toBe(true);
  });
  it('offers the seven client tools in order', () => {
    expect(ITEM_TOOLS.map(tool => tool.label)).toEqual(['Tick', 'Dot', 'Text', 'Name', 'Date', 'Initials', 'Signature']);
  });
});

describe('printedTextSize', () => {
  it('uses 70% of the box height while the text is small', () => {
    expect(printedTextSize(.02, 612, 792, 612)).toBeCloseTo(792 * .02 * .7);
  });
  it('caps at 14pt measured against the real page width', () => {
    expect(printedTextSize(.2, 612, 792, 612)).toBeCloseTo(14);          // Letter shown at 1px per point
    expect(printedTextSize(.2, 600, 464, 792)).toBeCloseTo(14 * 600 / 792);  // landscape Letter shown 600px wide
    expect(printedTextSize(.2, 1190, 1684, 595)).toBeCloseTo(28);       // A4 shown at 2px per point
  });
  it('never goes below 6px so it stays readable', () => {
    expect(printedTextSize(.001, 300, 400, 612)).toBe(6);
  });
});
