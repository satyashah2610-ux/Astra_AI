import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it, vi } from 'vitest';
import PdfPages from './PdfPages';

// The PDF never finishes loading in these tests: we check the layout before it arrives.
vi.mock('./pdfjs', () => ({ PDF_OPTIONS: {} }));
vi.mock('pdfjs-dist', () => ({ getDocument: () => ({ promise: new Promise(() => {}), destroy: async () => {} }) }));

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  vi.stubGlobal('IntersectionObserver', class { observe() {} disconnect() {} });
});

const source = { url: '/api/signing/pdf', httpHeaders: { 'X-Signing-Token': 'token' } };
const marks = [{ id: 'box-1', page: 2, x: .1, y: .55, width: .35, height: .08 }];

it('reserves a full-size space for every page before the PDF has loaded, so the layout does not jump', () => {
  render(<PdfPages source={source} marks={marks} pageCount={3} />);
  const pages = screen.getAllByTestId('signing-page');
  expect(pages).toHaveLength(3);
  for (const page of pages) expect(parseFloat(page.style.height)).toBeGreaterThan(300);
  expect(screen.getByLabelText('Page 2 of 3')).toContainElement(screen.getByTestId('sign-here'));
});

it('shows the signature box locations before the PDF has loaded', () => {
  render(<PdfPages source={source} marks={marks} pageCount={2} signature="data:image/png;base64,AAAA" />);
  expect(screen.getByRole('img', { name: 'Your signature' })).toBeInTheDocument();
});

it('shows company comments as notes and the signer’s own layer on each page', () => {
  const comments = [{ id: 'c1', page: 2, x: .5, y: .1, width: .2, height: .05, text: 'Tick your plan here' }];
  render(<PdfPages source={source} marks={marks} pageCount={2} comments={comments} renderOverlay={page => <span>Layer for page {page}</span>} />);
  expect(screen.getByLabelText('Page 2 of 2')).toHaveTextContent('Tick your plan here');
  expect(screen.getByText('Layer for page 1')).toBeInTheDocument();
  expect(screen.getByText('Layer for page 2')).toBeInTheDocument();
});

it('typing a page number and pressing Enter goes straight to that page', async () => {
  const scrolled: string[] = [];
  Element.prototype.scrollIntoView = function (this: Element) { scrolled.push(this.getAttribute('aria-label') ?? ''); };
  render(<PdfPages source={source} marks={marks} pageCount={5} />);
  const jump = screen.getByRole('spinbutton', { name: 'Go to page' });
  await userEvent.clear(jump);
  await userEvent.type(jump, '4{Enter}');
  expect(scrolled).toEqual(['Page 4 of 5']);
  await userEvent.clear(jump);
  await userEvent.type(jump, '99{Enter}');  // past the end: the last page
  expect(scrolled.at(-1)).toBe('Page 5 of 5');
  expect(jump).toHaveValue(5);
});
