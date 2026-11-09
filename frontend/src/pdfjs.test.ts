import { expect, it, vi } from 'vitest';
import { PDF_OPTIONS } from './pdfjs';

vi.mock('pdfjs-dist', () => ({ GlobalWorkerOptions: {} }));

it('never lets a PDF run script through PDF.js code evaluation', () => {
  expect(PDF_OPTIONS.isEvalSupported).toBe(false);
});

it('loads fonts, character maps and colour profiles from this app, not a third-party service', () => {
  for (const url of [PDF_OPTIONS.cMapUrl, PDF_OPTIONS.standardFontDataUrl, PDF_OPTIONS.wasmUrl, PDF_OPTIONS.iccUrl]) expect(url).toMatch(/^\/pdf-assets\//);
});
