import { GlobalWorkerOptions } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

GlobalWorkerOptions.workerSrc = workerUrl;

/**
 * Options for every PDF this app opens.
 * - Assets are bundled locally, so unfamiliar PDFs render without any third-party service.
 * - isEvalSupported: false stops PDF.js compiling code from a PDF's fonts (defence in depth against
 *   malicious PDFs; uploaded documents are untrusted).
 */
export const PDF_OPTIONS = { cMapUrl: '/pdf-assets/cmaps/', cMapPacked: true, standardFontDataUrl: '/pdf-assets/standard_fonts/', wasmUrl: '/pdf-assets/wasm/', iccUrl: '/pdf-assets/iccs/', isEvalSupported: false };
