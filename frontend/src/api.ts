import type { Box } from './geometry';
export type Mark = Box & { id: string; page: number };
export type Agreement = { id: string; name: string; filename: string; page_count: number; marks: Mark[]; version: number; created_at: string; updated_at: string };

export async function request<T>(url: string, options?: RequestInit): Promise<T> {
  let response: Response;
  try { response = await fetch(url, options); }
  catch { throw new Error('Cannot reach the server. Check your connection and try again.'); }
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(typeof error.detail === 'string' ? error.detail : 'Something went wrong. Check your document and try again.');
  }
  return response.status === 204 ? undefined as T : response.json();
}
