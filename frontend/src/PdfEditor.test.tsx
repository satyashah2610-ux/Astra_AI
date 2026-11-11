import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import PdfEditor from './PdfEditor';
import type { Agreement, Mark } from './api';
import { pointerCapture, TestPointerEvent } from './test-utils';

// A fake one-page PDF that "renders" instantly, so the editor becomes ready in jsdom.
vi.mock('./pdfjs', () => ({ PDF_OPTIONS: {} }));
vi.mock('./SignaturePad', () => ({
  default: ({ onChange, label }: any) => <button onClick={() => onChange({ method: 'drawn', image: `data:image/png;base64,${(label ?? 'signature').toUpperCase()}` })}>Provide {label ?? 'signature'}</button>,
}));
vi.mock('pdfjs-dist', () => {
  const page = { getViewport: () => ({ width: 612, height: 792 }), render: () => ({ promise: Promise.resolve(), cancel() {} }) };
  return { getDocument: () => ({ promise: Promise.resolve({ numPages: 1, getPage: async () => page }), destroy: async () => {} }) };
});

beforeEach(() => {
  vi.stubGlobal('PointerEvent', TestPointerEvent);
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  Object.assign(HTMLElement.prototype, pointerCapture);
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 600, height: 776, right: 600, bottom: 776, x: 0, y: 0, toJSON() {} } as DOMRect);
});

const agreement: Agreement = { id: 'a1', name: 'Agreement', filename: 'Agreement.pdf', page_count: 1, marks: [], version: 0, created_at: '', updated_at: '' };
const box: Mark = { id: 'box-1', page: 1, x: .2, y: .5, width: .3, height: .08 };
let latest: Mark[] = [];
beforeEach(() => { latest = []; });

function Harness({ initial, signerName }: { initial: Mark[]; signerName?: string }) {
  const [marks, setMarks] = useState(initial);
  return <PdfEditor agreement={agreement} marks={marks} disabled={false} signerName={signerName} onChange={next => { latest = next; setMarks(next); }} />;
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
  await userEvent.click(await screen.findByRole('button', { name: 'Add signature box for client' }));
  const field = await screen.findByTestId('signature-field');
  expect(field).toHaveFocus();
  const before = latest[0].y;
  await userEvent.keyboard('{ArrowDown}');
  expect(latest[0].y).toBeGreaterThan(before);
});

it('the selected-field panel shows the field type and page, not raw percentages', async () => {
  render(<Harness initial={[box]} />);
  fireEvent.focus(await screen.findByTestId('signature-field'));
  expect(screen.getByText('Selected field')).toBeInTheDocument();
  expect(screen.getByText('Field type')).toBeInTheDocument();
  expect(screen.getByText('Page')).toBeInTheDocument();
  expect(screen.queryByText('Width')).not.toBeInTheDocument();
  expect(screen.queryByText('Height')).not.toBeInTheDocument();
});

it('adds company text and a comment, and edits what they say', async () => {
  render(<Harness initial={[]} />);
  await userEvent.click(await screen.findByRole('button', { name: 'Add text' }));
  const text = await screen.findByTestId('text-field');
  expect(text).toHaveFocus();
  const printed = screen.getByLabelText('Text printed on the document');
  await userEvent.clear(printed);
  await userEvent.type(printed, 'Project: Riverside');
  expect(latest).toEqual([expect.objectContaining({ type: 'text', text: 'Project: Riverside' })]);
  expect(text).toHaveTextContent('Project: Riverside');
  expect(screen.getByText(/printed on the document when you send/i)).toBeInTheDocument();
  expect(screen.getByText('Field type').querySelector('strong')).toHaveTextContent('Text');

  await userEvent.click(screen.getByRole('button', { name: 'Add comment' }));
  const note = screen.getByLabelText('Comment for the client');
  await userEvent.clear(note);
  await userEvent.type(note, 'Tick your plan');
  expect(latest[1]).toEqual(expect.objectContaining({ type: 'comment', text: 'Tick your plan' }));
  expect(screen.getByTestId('comment-field')).toHaveTextContent('Tick your plan');
  expect(screen.getByText(/not printed/i)).toBeInTheDocument();
  expect(screen.getByText('Field type').querySelector('strong')).toHaveTextContent('Comment');
});

it('keeps new signature boxes in the original shape, with no type', async () => {
  render(<Harness initial={[]} />);
  await userEvent.click(await screen.findByRole('button', { name: 'Add signature box for client' }));
  expect(latest[0]).not.toHaveProperty('type');
  expect(latest[0]).not.toHaveProperty('text');
});

it('typing a page number and pressing Enter shows that page', async () => {
  render(<PdfEditor agreement={{ ...agreement, page_count: 5 }} marks={[]} disabled={false} onChange={() => {}} />);
  const jump = await screen.findByRole('spinbutton', { name: 'Go to page' });
  await userEvent.clear(jump);
  await userEvent.type(jump, '4{Enter}');
  expect(await screen.findByText('Page 4 of 5', { selector: '.page-caption span' })).toBeInTheDocument();
  await userEvent.clear(jump);
  await userEvent.type(jump, '0{Enter}');  // before the start: the first page
  expect(await screen.findByText('Page 1 of 5', { selector: '.page-caption span' })).toBeInTheDocument();
});

describe('the company fills in and signs its side', () => {
  it('places a tick, a dot, its name and the send date', async () => {
    render(<Harness initial={[]} signerName="Alex Morgan" />);
    for (const tool of ['Tick', 'Dot', 'Name', 'Date']) await userEvent.click(await screen.findByRole('button', { name: tool }));
    expect(latest.map(mark => mark.type)).toEqual(['check', 'dot', 'name', 'date']);
    expect(latest[2].text).toBe('Alex Morgan');
    expect(screen.getAllByTestId('company-field')).toHaveLength(4);
  });

  it('adopts a signature once, then places it on the page; the next one reuses it', async () => {
    render(<Harness initial={[]} signerName="Alex Morgan" />);
    await userEvent.click(await screen.findByRole('button', { name: 'Signature' }));
    expect(latest).toEqual([]);  // nothing is placed before a signature is adopted
    const place = screen.getByRole('button', { name: 'Place on the page' });
    expect(place).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'Provide signature' }));
    await userEvent.click(place);
    expect(latest).toEqual([expect.objectContaining({ type: 'company_signature', image: 'data:image/png;base64,SIGNATURE' })]);
    await userEvent.click(screen.getByRole('button', { name: 'Signature' }));
    expect(latest).toHaveLength(2);
    expect(latest[1]).toEqual(expect.objectContaining({ type: 'company_signature', image: 'data:image/png;base64,SIGNATURE' }));
  });

  it('adopts initials the same way', async () => {
    render(<Harness initial={[]} signerName="Alex Morgan" />);
    await userEvent.click(await screen.findByRole('button', { name: 'Initials' }));
    await userEvent.click(screen.getByRole('button', { name: 'Provide initials' }));
    await userEvent.click(screen.getByRole('button', { name: 'Place on the page' }));
    expect(latest).toEqual([expect.objectContaining({ type: 'initials', image: 'data:image/png;base64,INITIALS' })]);
  });

  it('cancelling the adoption places nothing', async () => {
    render(<Harness initial={[]} signerName="Alex Morgan" />);
    await userEvent.click(await screen.findByRole('button', { name: 'Signature' }));
    await userEvent.click(screen.getByRole('button', { name: 'Provide signature' }));
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(latest).toEqual([]);
    expect(screen.queryByRole('button', { name: 'Place on the page' })).not.toBeInTheDocument();
  });
});

it('a name the PDF cannot print is not prefilled, so the template can still be saved', async () => {
  render(<Harness initial={[]} signerName="Ołeksandr 李" />);
  await userEvent.click(await screen.findByRole('button', { name: 'Name' }));
  expect(latest[0].text).toBe('Your name');
});

it('labels the client’s box clearly and shows the company tools without a "You sign" label', async () => {
  render(<Harness initial={[]} />);
  expect(await screen.findByRole('button', { name: 'Add signature box for client' })).toBeInTheDocument();
  expect(screen.queryByText('You sign')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Tick' })).toBeInTheDocument();
});
