import { useEffect, useRef, useState } from 'react';

/** "Page [n] of N": type a page number and press Enter to go there. Numbers outside the document go to the nearest page. */
export default function PageJump({ current, total, disabled, onGo }: { current: number; total: number; disabled?: boolean; onGo: (page: number) => void }) {
  const [typed, setTyped] = useState(String(current));
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { if (document.activeElement !== input.current) setTyped(String(current)); }, [current]);  // never over what's being typed

  function go() {
    const number = Number.parseInt(typed, 10);
    if (Number.isNaN(number)) { setTyped(String(current)); return; }
    const page = Math.min(Math.max(number, 1), total);
    setTyped(String(page));
    input.current?.blur();  // done typing: from here the box follows the page again
    onGo(page);
  }

  return <label className="page-jump">Page
    <input ref={input} type="number"inputMode="numeric" min={1} max={total} aria-label="Go to page" value={typed} disabled={disabled}
      onChange={e => setTyped(e.target.value)} onFocus={e => e.target.select()} onBlur={() => setTyped(String(current))}
      onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); go(); } }} />
    of {total}</label>;
}
