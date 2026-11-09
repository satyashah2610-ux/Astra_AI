import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { Eraser, Keyboard, PenTool } from 'lucide-react';
import { clamp, type Point } from './geometry';
import { hasInk } from './strokes';
import type { Signature } from './signing';

type Props = { name: string; onChange: (signature: Signature | null) => void };
const PAD = { width: 600, height: 200 };
const TYPED = { width: 600, height: 160 };
const SCRIPT_FONT = '"Caveat", "Segoe Script", "Brush Script MT", cursive';

/** Render a typed name in a handwriting font as a transparent PNG. */
export async function renderTypedSignature(name: string): Promise<string | null> {
  const canvas = document.createElement('canvas');
  canvas.width = TYPED.width; canvas.height = TYPED.height;
  const context = canvas.getContext('2d');
  if (!context) return null;
  await document.fonts?.load(`64px ${SCRIPT_FONT}`).catch(() => undefined);
  let size = 72;
  do { context.font = `500 ${size}px ${SCRIPT_FONT}`; size -= 4; } while (size > 24 && context.measureText(name).width > TYPED.width - 40);
  context.fillStyle = '#1d2c4d';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText(name, TYPED.width / 2, TYPED.height / 2 + 6);
  return canvas.toDataURL('image/png');
}

/** Type or draw a signature. Reports a PNG data URL, or null until the signature is usable. */
export default function SignaturePad({ name, onChange }: Props) {
  const [mode, setMode] = useState<'typed' | 'drawn'>('typed');
  const [strokes, setStrokes] = useState<Point[][]>([]);
  const canvas = useRef<HTMLCanvasElement>(null);
  const drawing = useRef<Point[] | null>(null);
  const report = useRef(onChange);
  report.current = onChange;

  useEffect(() => {
    if (mode !== 'typed') return;
    let live = true;
    const trimmed = name.trim();
    report.current(null);  // the previous name's image must not be submitted while this one renders
    if (!trimmed) return;
    void renderTypedSignature(trimmed).then(image => { if (live) report.current(image ? { method: 'typed', image } : null); });
    return () => { live = false; };
  }, [mode, name]);

  function choose(next: 'typed' | 'drawn') {
    if (next === mode) return;
    setMode(next);
    clear();
  }
  function clear() {
    setStrokes([]); drawing.current = null;
    canvas.current?.getContext('2d')?.clearRect(0, 0, PAD.width, PAD.height);
    report.current(null);
  }
  function point(event: PointerEvent<HTMLCanvasElement>): Point {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: clamp((event.clientX - rect.left) / rect.width), y: clamp((event.clientY - rect.top) / rect.height) };
  }
  function line(from: Point, to: Point) {
    const context = canvas.current?.getContext('2d');
    if (!context) return;
    context.strokeStyle = '#1d2c4d'; context.lineWidth = 3; context.lineCap = 'round'; context.lineJoin = 'round';
    context.beginPath(); context.moveTo(from.x * PAD.width, from.y * PAD.height); context.lineTo(to.x * PAD.width, to.y * PAD.height); context.stroke();
  }
  function down(event: PointerEvent<HTMLCanvasElement>) {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const start = point(event);
    drawing.current = [start];
    line(start, start);
  }
  function move(event: PointerEvent<HTMLCanvasElement>) {
    const stroke = drawing.current;
    if (!stroke) return;
    const next = point(event);
    line(stroke[stroke.length - 1], next);
    stroke.push(next);
  }
  function up(event: PointerEvent<HTMLCanvasElement>) {
    const stroke = drawing.current;
    if (!stroke) return;
    drawing.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    const all = [...strokes, stroke];
    setStrokes(all);
    report.current(hasInk(all) && canvas.current ? { method: 'drawn', image: canvas.current.toDataURL('image/png') } : null);
  }

  return <div className="signature-pad">
    <div className="pad-tabs" role="tablist" aria-label="How to sign">
      <button role="tab" aria-selected={mode === 'typed'} onClick={() => choose('typed')}><Keyboard size={14} />Type</button>
      <button role="tab" aria-selected={mode === 'drawn'} onClick={() => choose('drawn')}><PenTool size={14} />Draw</button>
    </div>
    {mode === 'typed'
      ? <div className="typed-preview" aria-label="Signature preview">{name.trim() ? <span>{name.trim()}</span> : <small>Enter your full name above</small>}</div>
      : <div className="draw-area">
        <canvas ref={canvas} width={PAD.width} height={PAD.height} aria-label="Draw your signature" data-testid="signature-canvas" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} />
        <span className="draw-line" aria-hidden="true" />
        {strokes.length === 0 && <small className="draw-hint">Sign here with your mouse, finger or stylus</small>}
        <button className="text-button clear-pad" onClick={clear} disabled={strokes.length === 0}><Eraser size={13} />Clear</button>
      </div>}
  </div>;
}
