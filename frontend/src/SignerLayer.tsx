import { useRef, type CSSProperties, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import { Check, PenLine, X } from 'lucide-react';
import { boxStyle, clamp, moveBox, type Box, type Point } from './geometry';
import { ITEM_LABELS, placeItem, printedTextSize, type ItemType, type SignerItem } from './items';
import type { PageSize } from './PdfPages';

type Props = {
  page: number;
  size: PageSize;
  items: SignerItem[];  // this page's items
  tool: ItemType | null;
  selected: string | null;
  focusId: string | null;  // a text item that was just placed: put the cursor in it
  values: { name: string; date: string; signature?: string | null; initials?: string | null };
  disabled?: boolean;
  onAdd: (item: SignerItem) => void;
  onChange: (item: SignerItem) => void;
  onRemove: (id: string) => void;
  onSelect: (id: string | null) => void;
};
type Gesture = { id: string; kind: 'move' | 'resize'; start: Point; original: SignerItem };

const SQUARE: ItemType[] = ['check', 'dot', 'initials'];
const fontSize = (item: SignerItem, size: PageSize) => printedTextSize(item.height, size.width, size.height, size.points);

/** One page's layer of signer items: tap with a tool to place, drag to move, corner to resize, × to remove. */
export default function SignerLayer({ page, size, items, tool, selected, focusId, values, disabled, onAdd, onChange, onRemove, onSelect }: Props) {
  const layer = useRef<HTMLDivElement>(null);
  const gesture = useRef<Gesture | null>(null);
  const aspect = size.height / size.width;

  function point(event: PointerEvent): Point {
    const rect = layer.current!.getBoundingClientRect();
    return { x: clamp((event.clientX - rect.left) / rect.width), y: clamp((event.clientY - rect.top) / rect.height) };
  }
  function place(event: PointerEvent<HTMLDivElement>) {
    if (event.target !== layer.current || event.button !== 0 || disabled) return;
    if (!tool) { onSelect(null); return; }
    event.preventDefault();
    onAdd({ id: crypto.randomUUID(), page, type: tool, ...placeItem(tool, point(event), aspect), ...(tool === 'text' ? { text: '' } : {}) });
  }
  function start(event: PointerEvent, item: SignerItem, kind: Gesture['kind']) {
    if (event.button !== 0 || disabled) return;
    event.preventDefault(); event.stopPropagation();
    onSelect(item.id);
    gesture.current = { id: item.id, kind, start: point(event), original: item };
    layer.current?.setPointerCapture(event.pointerId);
  }
  function move(event: PointerEvent) {
    const action = gesture.current;
    if (!action) return;
    const now = point(event);
    const delta = { x: now.x - action.start.x, y: now.y - action.start.y };
    const box: Box = action.kind === 'move' ? moveBox(action.original, delta) : resize(action.original, delta);
    onChange({ ...action.original, ...box });
  }
  function resize(item: SignerItem, delta: Point): Box {
    const width = clamp(item.width + delta.x, .015, 1 - item.x);
    if (SQUARE.includes(item.type)) {
      const square = Math.min(width, (1 - item.y) * aspect);  // stay square: height = width / aspect must fit below
      return { ...item, width: square, height: square / aspect };
    }
    return { ...item, width, height: clamp(item.height + delta.y, .012, 1 - item.y) };
  }
  function finish(event: PointerEvent) {
    if (!gesture.current) return;
    if (event.type === 'pointercancel') onChange(gesture.current.original);
    gesture.current = null;
    if (layer.current?.hasPointerCapture(event.pointerId)) layer.current.releasePointerCapture(event.pointerId);
  }
  function keys(event: KeyboardEvent, item: SignerItem) {
    if (event.target !== event.currentTarget) return;  // typing inside a text item
    if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); onRemove(item.id); }
  }

  function content(item: SignerItem): ReactNode {
    const style: CSSProperties = { fontSize: fontSize(item, size) };
    const side = Math.min(item.width * size.width, item.height * size.height);
    switch (item.type) {
      case 'check': return <Check size={side * .9} strokeWidth={3} aria-hidden="true" />;
      case 'dot': return <span className="dot-mark" aria-hidden="true" />;
      case 'text': return <input aria-label={`Text on page ${page}`} value={item.text ?? ''} placeholder="Type here" maxLength={500} style={style} disabled={disabled}
        autoFocus={item.id === focusId} onPointerDown={event => { event.stopPropagation(); onSelect(item.id); }} onChange={event => onChange({ ...item, text: event.target.value })} />;
      case 'name': return <span style={style}>{values.name.trim() || 'Your name'}</span>;
      case 'date': return <span style={style}>{values.date}</span>;
      case 'initials': return values.initials ? <img src={values.initials} alt="" /> : <span className="item-placeholder" style={style}>Initials</span>;
      case 'signature': return values.signature ? <img src={values.signature} alt="" /> : <span className="item-placeholder" style={style}><PenLine size={12} />Signature</span>;
    }
  }

  return <div ref={layer} className={`signer-layer ${tool ? 'placing' : ''}`} data-testid={`signer-layer-${page}`}
    onPointerDown={place} onPointerMove={move} onPointerUp={finish} onPointerCancel={finish}>
    {items.map(item => {
      const label = item.type === 'text' ? 'Text box' : ITEM_LABELS[item.type];  // 'Text on page N' names the input inside
      return <div key={item.id} role="button" tabIndex={disabled ? -1 : 0} aria-label={`${label} on page ${page}`}
        className={`signer-item ${item.type} ${selected === item.id ? 'selected' : ''}`} style={boxStyle(item)}
        onPointerDown={event => start(event, item, 'move')} onFocus={() => onSelect(item.id)} onKeyDown={event => keys(event, item)}>
        {content(item)}
        {selected === item.id && !disabled && <>
          <button className="item-remove" aria-label={`Remove ${label}`} onPointerDown={event => event.stopPropagation()} onClick={() => onRemove(item.id)}><X size={11} /></button>
          <span className="item-resize" aria-hidden="true" onPointerDown={event => start(event, item, 'resize')} />
        </>}
      </div>;
    })}
  </div>;
}
