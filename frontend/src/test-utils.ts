/** Read a Blob as text; jsdom's Blob has no .text(), but its FileReader works. */
export function blobText(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = reject; reader.readAsText(blob); });
}

/** jsdom has no PointerEvent; without it fireEvent sends a plain Event with no `button`, `clientX` or `pointerId`. */
export class TestPointerEvent extends MouseEvent {
  pointerId: number;
  constructor(type: string, init: PointerEventInit = {}) { super(type, init); this.pointerId = init.pointerId ?? 0; }
}

/** Pointer capture is not implemented in jsdom either. */
export const pointerCapture = { setPointerCapture() {}, releasePointerCapture() {}, hasPointerCapture: () => false };
