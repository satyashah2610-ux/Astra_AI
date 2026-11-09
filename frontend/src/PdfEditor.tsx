import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { ChevronLeft, ChevronRight, Download, Grip, Loader2, PenLine, Trash2 } from 'lucide-react';
import { getDocument, type PDFDocumentProxy } from 'pdfjs-dist';
import { PDF_OPTIONS } from './pdfjs';
import { boxStyle as position, clamp, drawBox, moveBox, resizeBox, type Box, type Point } from './geometry';
import type { Agreement, Mark } from './api';

type Props = { agreement: Agreement; marks: Mark[]; onChange: (marks: Mark[]) => void; disabled: boolean };
type Gesture = { kind: 'draw' | 'move' | 'resize'; start: Point; box?: Mark; original: Mark[] };

export default function PdfEditor({ agreement, marks, onChange, disabled }: Props) {
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [page, setPage] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [fitWidth, setFitWidth] = useState(600);
  const [ratio, setRatio] = useState(792 / 612);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [preview, setPreview] = useState<Box | null>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const scrollArea = useRef<HTMLDivElement>(null);
  const overlay = useRef<HTMLDivElement>(null);
  const gesture = useRef<Gesture | null>(null);
  const fields = useRef(new Map<string, HTMLDivElement>());
  const focusNext = useRef<string | null>(null);
  const width = Math.round(fitWidth * zoom);
  const current = marks.find(mark => mark.id === selected);
  const pageMarks = marks.filter(mark => mark.page === page);

  useEffect(() => {
    const task = getDocument({ url: `/api/agreements/${agreement.id}/pdf`, ...PDF_OPTIONS });
    let live = true;
    task.promise.then(document => { if (live) setPdf(document); }).catch(() => { if (live) setError('This PDF could not be displayed. Try exporting it as a new PDF.'); });
    return () => { live = false; void task.destroy(); };
  }, [agreement.id]);

  useEffect(() => {
    if (!scrollArea.current) return;
    const observer = new ResizeObserver(entries => setFitWidth(Math.max(180, Math.min(760, entries[0].contentRect.width - 48))));
    observer.observe(scrollArea.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!pdf) return;
    let cancelled = false;
    let task: { cancel: () => void } | undefined;
    setReady(false); setError('');
    void (async () => {
      try {
        const pdfPage = await pdf.getPage(page);
        if (cancelled) return;
        const base = pdfPage.getViewport({ scale: 1 });
        setRatio(base.height / base.width);
        const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
        const viewport = pdfPage.getViewport({ scale: width / base.width * pixelRatio });
        const scratch = document.createElement('canvas');
        scratch.width = Math.ceil(viewport.width); scratch.height = Math.ceil(viewport.height);
        const render = pdfPage.render({ canvas: scratch, viewport });
        task = render;
        await render.promise;
        if (cancelled || !canvas.current) return;
        canvas.current.width = scratch.width; canvas.current.height = scratch.height;
        canvas.current.getContext('2d')?.drawImage(scratch, 0, 0);
        setReady(true);
      } catch (e) { if (!cancelled) setError('Unable to render this PDF page. Try another PDF.'); }
    })();
    return () => { cancelled = true; task?.cancel(); };
  }, [pdf, page, width]);

  // Keyboard focus follows selection, so arrow keys work right after a click, draw or add.
  useEffect(() => {
    const id = focusNext.current;
    if (id && fields.current.has(id)) { focusNext.current = null; fields.current.get(id)!.focus({ preventScroll: true }); }
  });

  function point(event: PointerEvent): Point {
    const rect = overlay.current!.getBoundingClientRect();
    return { x: clamp((event.clientX - rect.left) / rect.width), y: clamp((event.clientY - rect.top) / rect.height) };
  }
  function start(event: PointerEvent, kind: Gesture['kind'], box?: Mark) {
    if (disabled || !ready || event.button !== 0) return;
    event.preventDefault(); event.stopPropagation();  // preventDefault also blocks the browser's own focus change...
    setSelected(box?.id ?? null);
    if (box) fields.current.get(box.id)?.focus({ preventScroll: true });  // ...so focus the box ourselves
    gesture.current = { kind, start: point(event), box, original: marks };
    overlay.current!.setPointerCapture(event.pointerId);
  }
  function move(event: PointerEvent) {
    const action = gesture.current;
    if (!action) return;
    const end = point(event);
    if (action.kind === 'draw') setPreview(drawBox(action.start, end));
    else if (action.box) {
      const delta = { x: end.x - action.start.x, y: end.y - action.start.y };
      const changed = action.kind === 'move' ? moveBox(action.box, delta) : resizeBox(action.box, delta);
      onChange(action.original.map(mark => mark.id === action.box!.id ? { ...mark, ...changed } : mark));
    }
  }
  function finish(event: PointerEvent) {
    const action = gesture.current;
    if (!action) return;
    if (action.kind === 'draw') {
      const box = drawBox(action.start, point(event));
      if (box) { const mark = { ...box, page, id: crypto.randomUUID() }; onChange([...marks, mark]); setSelected(mark.id); focusNext.current = mark.id; }
    } else move(event);
    gesture.current = null; setPreview(null);
    if (overlay.current?.hasPointerCapture(event.pointerId)) overlay.current.releasePointerCapture(event.pointerId);
  }
  function cancelGesture() {
    if (gesture.current) onChange(gesture.current.original);
    gesture.current = null; setPreview(null);
  }
  function remove() { if (selected) { onChange(marks.filter(mark => mark.id !== selected)); setSelected(null); } }
  function add() {
    const mark = { id: crypto.randomUUID(), page, x: .15, y: .65, width: .35, height: .075 };
    onChange([...marks, mark]); setSelected(mark.id); focusNext.current = mark.id;
  }

  return <div className="pdf-editor">
    <div className="editor-tools"><div className="tool-group"><button className="tool active-tool" disabled={!ready || disabled} onClick={add} title="Add a signature box, then drag it to position it"><PenLine size={16} />Add signature box</button></div><div className="page-tools"><button className="icon-button" aria-label="Previous page" disabled={page <= 1 || disabled} onClick={() => { setPage(page - 1); setSelected(null); }}><ChevronLeft size={16} /></button><span>Page <strong>{page}</strong> of {agreement.page_count}</span><button className="icon-button" aria-label="Next page" disabled={page >= agreement.page_count || disabled} onClick={() => { setPage(page + 1); setSelected(null); }}><ChevronRight size={16} /></button><span className="tool-divider" /><select aria-label="PDF zoom" value={zoom} disabled={disabled} onChange={e => setZoom(Number(e.target.value))}><option value={.75}>75%</option><option value={1}>Fit width</option><option value={1.25}>125%</option><option value={1.5}>150%</option></select></div></div>
    <div className="editor-body"><div className="document-area" ref={scrollArea}>
      <div className="document-hint"><span className="hint-dot" />Drag on the page to add a box. Drag a box to move it.</div>
      {error ? <div className="pdf-error" role="alert">{error}</div> : <div className="pdf-sheet" style={{ width, height: width * ratio }}>
        <canvas ref={canvas} aria-label={`PDF page ${page}`} style={{ width: '100%', height: '100%', opacity: ready ? 1 : 0 }} />
        {!ready && <div className="pdf-loading"><Loader2 className="spin" size={24} />Loading page...</div>}
        {ready && <div ref={overlay} className="pdf-overlay drawing" data-testid="pdf-overlay" aria-label="Signature placement area" onPointerDown={event => start(event, 'draw')} onPointerMove={move} onPointerUp={finish} onPointerCancel={cancelGesture}>
          {pageMarks.map((mark) => <div key={mark.id} ref={element => { if (element) fields.current.set(mark.id, element); else fields.current.delete(mark.id); }} data-testid="signature-field" className={`signature-field ${selected === mark.id ? 'selected' : ''}`} style={position(mark)} role="button" tabIndex={disabled ? -1 : 0} aria-label={`Signature field ${marks.indexOf(mark) + 1}`} onFocus={() => setSelected(mark.id)} onPointerDown={event => start(event, 'move', mark)} onKeyDown={event => {
            if (disabled) return;
            if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); onChange(marks.filter(m => m.id !== mark.id)); setSelected(null); }
            const directions: Record<string, Point> = { ArrowLeft: { x: -.005, y: 0 }, ArrowRight: { x: .005, y: 0 }, ArrowUp: { x: 0, y: -.005 }, ArrowDown: { x: 0, y: .005 } };
            if (directions[event.key]) { event.preventDefault(); const delta = directions[event.key]; const box = event.shiftKey ? resizeBox(mark, delta) : moveBox(mark, delta); onChange(marks.map(m => m.id === mark.id ? { ...m, ...box } : m)); }
          }}><PenLine size={16} /><span>Signature</span>{selected === mark.id && <span className="resize-handle" role="button" aria-label="Resize signature field" onPointerDown={event => start(event, 'resize', mark)}><Grip size={10} /></span>}</div>)}
          {preview && <div className="signature-field preview-field" style={position(preview)}><PenLine size={14} /><span>Signature</span></div>}
        </div>}
      </div>}
      <p className="page-caption">{agreement.filename} <span>·</span> Page {page} of {agreement.page_count}</p>
    </div>
    <aside className="field-panel"><div className="tiny-eyebrow">SIGNATURE FIELDS</div><h3>Make room for a signature.</h3><p>Mark the spot where your client should sign.</p><div className="field-divider" />
      {current ? <><div className="field-section-title">SELECTED FIELD<span className="count">{marks.indexOf(current) + 1}</span></div><div className="selected-details"><span>Field type<strong>Signature</strong></span><span>Page<strong>{current.page}</strong></span></div><p className="field-help">Drag the box to move it. Pull the corner to resize.<br />Arrow keys move it; Shift + arrows resize it.</p><button className="delete-field" disabled={disabled} onClick={remove}><Trash2 size={15} />Remove field</button></> : <><div className="tiny-eyebrow">HOW IT WORKS</div><ol className="instructions"><li><span>1</span><p>Drag on an empty area of the PDF, or click <strong>Add signature box.</strong></p></li><li><span>2</span><p>Drag the box to move it. Pull its corner to resize it.</p></li><li><span>3</span><p>Click <strong>Save template</strong> to keep your changes.</p></li></ol></>}
      <div className="field-bottom"><div className="saved-note"><CheckNote /><span>Your saved fields will be here next time.</span></div><a className="text-button" href={`/api/agreements/${agreement.id}/pdf`} download={agreement.filename} target="_blank" rel="noreferrer"><Download size={14} />Original PDF</a></div>
    </aside></div>
  </div>;
}

function CheckNote() { return <span className="note-check">✓</span>; }
