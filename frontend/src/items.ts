import { clamp, type Box, type Point } from './geometry';
import type { Mark } from './api';

export type ItemType = 'signature' | 'initials' | 'name' | 'date' | 'text' | 'check' | 'dot';
export type SignerItem = Box & { id: string; page: number; type: ItemType; text?: string };

/** The tools the signer can use, in toolbar order. */
export const ITEM_TOOLS: { type: ItemType; label: string }[] = [
  { type: 'check', label: 'Tick' }, { type: 'dot', label: 'Dot' }, { type: 'text', label: 'Text' }, { type: 'name', label: 'Name' },
  { type: 'date', label: 'Date' }, { type: 'initials', label: 'Initials' }, { type: 'signature', label: 'Signature' },
];
export const ITEM_LABELS = Object.fromEntries(ITEM_TOOLS.map(tool => [tool.type, tool.label])) as Record<ItemType, string>;

/** Default size as fractions of the page width (and height for non-square items). */
const SIZES: Record<ItemType, { width: number; height?: number }> = {
  check: { width: .03 }, dot: { width: .025 }, initials: { width: .07 },  // square on screen
  text: { width: .3, height: .025 }, name: { width: .3, height: .025 }, date: { width: .18, height: .025 }, signature: { width: .3, height: .06 },
};

/** A new item of `type` centred on the tapped point, kept inside the page. `aspect` is page height / width. */
export function placeItem(type: ItemType, point: Point, aspect: number): Box {
  const size = SIZES[type];
  const width = size.width;
  const height = size.height ?? width / aspect;  // square on screen whatever the page shape
  return { x: clamp(point.x - width / 2, 0, 1 - width), y: clamp(point.y - height / 2, 0, 1 - height), width, height };
}

/** "Jordan A. Smith" -> "JAS": first letters of up to three words. */
export function initialsFrom(name: string): string {
  return name.trim().split(/\s+/).filter(Boolean).slice(0, 3).map(word => word[0]!.toUpperCase()).join('');
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "09 Sep 2026": the same format the server prints into Date items. */
export function formatSigningDate(date: Date): string {
  return `${String(date.getDate()).padStart(2, '0')} ${MONTHS[date.getMonth()]} ${date.getFullYear()}`;
}

/**
 * Text size on screen (px) matching what the server prints: 70% of the box height, at most 14pt.
 * `pageWidth`/`pageHeight` are the displayed page size in px; `pointsWidth` is the page's real width in PDF points.
 */
export function printedTextSize(boxHeight: number, pageWidth: number, pageHeight: number, pointsWidth = 612): number {
  return Math.max(6, Math.min(boxHeight * pageHeight * 0.7, 14 * pageWidth / pointsWidth));
}

/** Template marks saved before text and comments existed have no type: they are signature boxes. */
export function isSignatureMark(mark: Mark): boolean {
  return (mark.type ?? 'signature') === 'signature';
}

/** Every text item must say something before the agreement can be signed. */
export function itemsReady(items: SignerItem[]): boolean {
  return items.every(item => item.type !== 'text' || Boolean(item.text?.trim()));
}
