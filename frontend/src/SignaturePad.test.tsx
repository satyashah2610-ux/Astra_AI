import { render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import SignaturePad from './SignaturePad';

// jsdom has no canvas: fake one that "renders" the text it was given into the data URL.
beforeEach(() => {
  let drawn = '';
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    font: '', fillStyle: '', textAlign: '', textBaseline: '',
    measureText: () => ({ width: 100 }),
    fillText: (text: string) => { drawn = text; },
  } as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockImplementation(() => `data:image/png;base64,${btoa(drawn)}`);
});
afterEach(() => vi.restoreAllMocks());

const imageOf = (name: string) => `data:image/png;base64,${btoa(name)}`;

it('reports the typed signature image for the current name', async () => {
  const onChange = vi.fn();
  render(<SignaturePad name="Jane Doe" onChange={onChange} />);
  await waitFor(() => expect(onChange).toHaveBeenLastCalledWith({ method: 'typed', image: imageOf('Jane Doe') }));
});

it('withdraws the old image immediately when the name changes, so a stale signature cannot be submitted', async () => {
  const onChange = vi.fn();
  const view = render(<SignaturePad name="Jane Do" onChange={onChange} />);
  await waitFor(() => expect(onChange).toHaveBeenLastCalledWith({ method: 'typed', image: imageOf('Jane Do') }));
  view.rerender(<SignaturePad name="Jane Doe" onChange={onChange} />);
  expect(onChange).toHaveBeenLastCalledWith(null);
  await waitFor(() => expect(onChange).toHaveBeenLastCalledWith({ method: 'typed', image: imageOf('Jane Doe') }));
});

it('reports no signature for a blank name', async () => {
  const onChange = vi.fn();
  render(<SignaturePad name="   " onChange={onChange} />);
  expect(onChange).toHaveBeenLastCalledWith(null);
});

it('shrinks a typed name until its ink, including swashes past the last letter, fits the signature image', async () => {
  // Like a handwriting font: the drawn ink is wider than the letters' advance width (the final swash overhangs).
  const fonts: string[] = [];
  const context = {
    font: '', fillStyle: '', textAlign: '', textBaseline: '',
    measureText(this: { font: string }) {
      const size = parseFloat(this.font.split(' ')[1]);
      return { width: size * 7.5, actualBoundingBoxLeft: size * 4, actualBoundingBoxRight: size * 4.5 };  // ink = 8.5 x size
    },
    fillText(this: { font: string }) { fonts.push(this.font); },
  };
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context as unknown as CanvasRenderingContext2D);
  const onChange = vi.fn();
  render(<SignaturePad name="Nihal" onChange={onChange} />);
  await waitFor(() => expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ method: 'typed' })));
  const size = parseFloat(fonts.at(-1)!.split(' ')[1]);
  expect(size * 8.5).toBeLessThanOrEqual(560);  // ink fits inside the 600px image with a 20px margin each side
});

it('a long typed name is shrunk to fit the preview, never cut off', () => {
  const long = 'Satya Shah Venkataraman Subramaniam';
  const { getByLabelText, rerender } = render(<SignaturePad name={long} onChange={() => {}} />);
  const text = getByLabelText('Signature preview').querySelector('span')!;
  expect(text).toHaveTextContent(long);
  expect(text.style.getPropertyValue('--chars')).toBe(String(long.length));  // the font size scales down with the length
  rerender(<SignaturePad name="Jo" onChange={() => {}} />);
  expect(getByLabelText('Signature preview').querySelector('span')!.style.getPropertyValue('--chars')).toBe('2');
});
