export type Point = { x: number; y: number };
export type Box = Point & { width: number; height: number };
export const clamp = (n: number, min = 0, max = 1) => Math.min(max, Math.max(min, n));
export function drawBox(start: Point, end: Point): Box | null {
  const x = Math.min(clamp(start.x), clamp(end.x));
  const y = Math.min(clamp(start.y), clamp(end.y));
  const width = Math.abs(clamp(end.x) - clamp(start.x));
  const height = Math.abs(clamp(end.y) - clamp(start.y));
  return width < .04 || height < .025 ? null : { x, y, width, height };
}
export function moveBox(box: Box, delta: Point): Box {
  return { ...box, x: clamp(box.x + delta.x, 0, 1 - box.width), y: clamp(box.y + delta.y, 0, 1 - box.height) };
}
export function resizeBox(box: Box, delta: Point): Box {
  return { ...box, width: clamp(box.width + delta.x, .04, 1 - box.x), height: clamp(box.height + delta.y, .025, 1 - box.y) };
}
