import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it, vi } from 'vitest';
import PdfEditor from './PdfEditor';
import type { Agreement, Mark } from './api';

// A fake one-page PDF that "renders" instantly, so the editor becomes ready in jsdom.
vi.mock('./pdfjs', () => ({ PDF_ASSETS: {} }));
vi.mock('pdfjs-dist', () => {
  const page = { getViewport: () => ({ width: 612, height: 792 }), render: () => ({ promise: Promise.resolve(), cancel() {} }) };
  return { getDocument: () => ({ promise: Promise.resolve({ numPages: 1, getPage: async () => page }), destroy: async () => {} }) };
});

// jsdom has no PointerEvent; without it fireEvent sends a plain Event with no `button`.
class TestPointerEvent extends MouseEvent {
  pointerId: number;
  constructor(type: string, init: PointerEventInit = {}) { super(type, init); this.pointerId = init.pointerId ?? 0; }
}

beforeEach(() => {
  vi.stubGlobal('PointerEvent', TestPointerEvent);
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  Object.assign(HTMLElement.prototype, { setPointerCapture() {}, releasePointerCapture() {}, hasPointerCapture: () => false });
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 600, height: 776, right: 600, bottom: 776, x: 0, y: 0, toJSON() {} } as DOMRect);
});

const agreement: Agreement = { id: 'a1', name: 'Agreement', filename: 'Agreement.pdf', page_count: 1, marks: [], version: 0, created_at: '', updated_at: '' };
const box: Mark = { id: 'box-1', page: 1, x: .2, y: .5, width: .3, height: .08 };
let latest: Mark[] = [];

function Harness({ initial }: { initial: Mark[] }) {
  const [marks, setMarks] = useState(initial);
  return <PdfEditor agreement={agreement} marks={marks} disabled={false} onChange={next => { latest = next; setMarks(next); }} />;
}

it('clicking a box focuses it, so arrow keys move it straight away', async () => {
  render(<Harness initial={[box]} />);
  const field = await screen.findByTestId('signature-field');
  fireEvent.pointerDown(field, { button: 0, pointerId: 1, clientX: 200, clientY: 400 });
  fireEvent.pointerUp(field, { button: 0, pointerId: 1, clientX: 200, clientY: 400 });
  expect(field).toHaveFocus();
  await userEvent.keyboard('{ArrowRight}');
  expect(latest[0].x).toBeGreaterThan(box.x);
  await userEvent.keyboard('{Shift>}{ArrowDown}{/Shift}');
  expect(latest[0].height).toBeGreaterThan(box.height);
});

it('a newly added box is focused, so arrow keys move it without clicking it first', async () => {
  render(<Harness initial={[]} />);
  await userEvent.click(await screen.findByRole('button', { name: 'Add signature box' }));
  const field = await screen.findByTestId('signature-field');
  expect(field).toHaveFocus();
  const before = latest[0].y;
  await userEvent.keyboard('{ArrowDown}');
  expect(latest[0].y).toBeGreaterThan(before);
});

it('the selected-field panel shows the field type and page, not raw percentages', async () => {
  render(<Harness initial={[box]} />);
  fireEvent.focus(await screen.findByTestId('signature-field'));
  expect(screen.getByText('SELECTED FIELD')).toBeInTheDocument();
  expect(screen.getByText('Field type')).toBeInTheDocument();
  expect(screen.getByText('Page')).toBeInTheDocument();
  expect(screen.queryByText('Width')).not.toBeInTheDocument();
  expect(screen.queryByText('Height')).not.toBeInTheDocument();
});
