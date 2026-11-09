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
