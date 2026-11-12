import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Loader2, MessageSquare, PenLine } from 'lucide-react';
import { getDocument, type PDFDocumentProxy } from 'pdfjs-dist';
import { PDF_OPTIONS } from './pdfjs';
import { boxStyle as position } from './geometry';
import type { Mark } from './api';
import PageJump from './PageJump';

type Source = { url: string; httpHeaders: Record<string, string> };
export type Comment = { id: string; page: number; x: number; y: number; width: number; height: number; text: string };
export type PageSize = { width: number; height: number; points: number };  // displayed px, and the page's real width in PDF points
type Props = {
  source: Source; marks: Mark[]; pageCount: number; signature?: string | null;
  comments?: Comment[];  // the company's notes to the signer: shown, never printed
  renderOverlay?: (page: number, size: PageSize) => ReactNode;  // the signer's own layer, drawn above everything else
  toolbar?: ReactNode;  // shown in the same sticky bar as the page box, so the two never cover each other
};

/**
 * Read-only document: every page stacked, signature boxes highlighted, pages drawn as they scroll into view.
 * Every page's space is reserved from the known page count before the PDF arrives, so the layout never jumps.
 */
export default function PdfPages({ source, marks, pageCount, signature, comments = [], renderOverlay, toolbar }: Props) {
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [error, setError] = useState('');
  const [width, setWidth] = useState(640);
  const [current, setCurrent] = useState(1);  // the page across the middle of the screen
  const container = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const task = getDocument({ ...source, ...PDF_OPTIONS });
    let live = true;
    task.promise.then(document => { if (live) setPdf(document); }).catch(() => { if (live) setError('This document could not be displayed. Ask the sender to check the PDF.'); });
    return () => { live = false; void task.destroy(); };
  }, [source.url, source.httpHeaders['X-Signing-Token']]);

  useEffect(() => {
    if (!container.current) return;
    const observer = new ResizeObserver(entries => setWidth(Math.max(260, Math.min(820, Math.floor(entries[0].contentRect.width)))));
    observer.observe(container.current);
    return () => observer.disconnect();
  }, []);

  const total = pdf?.numPages ?? pageCount;
  const sheets = () => Array.from(container.current?.querySelectorAll<HTMLElement>('.signing-sheet') ?? []);
  const jumping = useRef<{ page: number; until: number } | null>(null);  // a jump in progress: pages passed on the way don't count

  useEffect(() => {  // the page box follows scrolling: whichever page crosses the middle of the screen
    const all = sheets();
    const observer = new IntersectionObserver(entries => {
      const crossing = entries.filter(entry => entry.isIntersecting).at(-1);
      if (!crossing) return;
      const page = all.indexOf(crossing.target as HTMLElement) + 1;
      const jump = jumping.current;
      if (jump && page !== jump.page && Date.now() < jump.until) return;
      jumping.current = null;
      setCurrent(page);
    }, { rootMargin: '-50% 0px -50% 0px' });
    all.forEach(sheet => observer.observe(sheet));
    const ownScroll = (event: Event) => {  // the signer scrolls by hand: follow them again at once (typing in a field isn't scrolling)
      if (!(event.target instanceof Element && event.target.closest('input, textarea, select'))) jumping.current = null;
    };
    const events = ['wheel', 'touchstart', 'keydown'] as const;
    events.forEach(type => window.addEventListener(type, ownScroll, { passive: true }));
    return () => { observer.disconnect(); events.forEach(type => window.removeEventListener(type, ownScroll)); };
  }, [total, error]);

  function goTo(page: number) {
    jumping.current = { page, until: Date.now() + 1500 };  // long enough for the smooth scroll to finish
    setCurrent(page);
    sheets()[page - 1]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  const pageBox = !error && total > 1 && <PageJump current={current} total={total} onGo={goTo} />;
  return <div className="signing-pages" ref={container}>
    {(toolbar || pageBox) && <div className="pages-bar">{toolbar}{pageBox}</div>}
    {error ? <div className="pdf-error" role="alert">{error}</div>
      : Array.from({ length: pdf?.numPages ?? pageCount }, (_, index) => <PdfPage key={index} pdf={pdf} page={index + 1} width={width} marks={marks.filter(mark => mark.page === index + 1)} comments={comments.filter(note => note.page === index + 1)} renderOverlay={renderOverlay} signature={signature} total={pdf?.numPages ?? pageCount} />)}
  </div>;
}

function PdfPage({ pdf, page, width, marks, comments, renderOverlay, signature, total }: { pdf: PDFDocumentProxy | null; page: number; width: number; marks: Mark[]; comments: Comment[]; renderOverlay?: Props['renderOverlay']; signature?: string | null; total: number }) {
  const [ratio, setRatio] = useState(792 / 612);
  const [points, setPoints] = useState(612);
  const [visible, setVisible] = useState(false);
  const [ready, setReady] = useState(false);
  const sheet = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!pdf) return;
    let live = true;
    pdf.getPage(page).then(p => { if (live) { const v = p.getViewport({ scale: 1 }); setRatio(v.height / v.width); setPoints(v.width); } }).catch(() => {});
    return () => { live = false; };
  }, [pdf, page]);

  useEffect(() => {
    if (!sheet.current) return;
    const observer = new IntersectionObserver(entries => { if (entries.some(entry => entry.isIntersecting)) setVisible(true); }, { rootMargin: '600px 0px' });
    observer.observe(sheet.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!visible || !pdf) return;
    let cancelled = false;
    let task: { cancel: () => void } | undefined;
    void (async () => {
      try {
        const pdfPage = await pdf.getPage(page);
        const base = pdfPage.getViewport({ scale: 1 });
        const viewport = pdfPage.getViewport({ scale: width / base.width * Math.min(window.devicePixelRatio || 1, 2) });
        const scratch = document.createElement('canvas');
        scratch.width = Math.ceil(viewport.width); scratch.height = Math.ceil(viewport.height);
        const render = pdfPage.render({ canvas: scratch, viewport });
        task = render;
        await render.promise;
        if (cancelled || !canvas.current) return;
        canvas.current.width = scratch.width; canvas.current.height = scratch.height;
        canvas.current.getContext('2d')?.drawImage(scratch, 0, 0);
        setReady(true);
      } catch { /* a cancelled render is replaced by the next one */ }
    })();
    return () => { cancelled = true; task?.cancel(); };
  }, [pdf, page, width, visible]);

  return <section className="pdf-sheet signing-sheet" ref={sheet} style={{ width, height: width * ratio }} aria-label={`Page ${page} of ${total}`} data-testid="signing-page">
    <canvas ref={canvas} aria-hidden="true" style={{ width: '100%', height: '100%', opacity: ready ? 1 : 0 }} />
    {!ready && <div className="pdf-loading"><Loader2 className="spin" size={20} />Loading page {page}...</div>}
    {marks.map(mark => <div key={mark.id} id={`sign-box-${mark.id}`} className={`sign-here ${signature ? 'adopted' : ''}`} style={position(mark)} data-testid="sign-here">
      {signature ? <img src={signature} alt="Your signature" /> : <><PenLine size={14} /><span>Sign here</span></>}
    </div>)}
    {comments.map(note => <aside key={note.id} className="company-note" style={position(note)} aria-label="Note from the sender"><MessageSquare size={13} /><span>{note.text}</span></aside>)}
    {renderOverlay?.(page, { width, height: width * ratio, points })}
  </section>;
}
