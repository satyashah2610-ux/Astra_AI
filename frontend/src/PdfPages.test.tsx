import { render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import PdfPages from './PdfPages';

// The PDF never finishes loading in these tests: we check the layout before it arrives.
vi.mock('./pdfjs', () => ({ PDF_ASSETS: {} }));
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
