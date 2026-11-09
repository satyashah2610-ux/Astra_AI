import type { Box } from './geometry';
export type Mark = Box & { id: string; page: number };
export type Agreement = { id: string; name: string; filename: string; page_count: number; marks: Mark[]; version: number; created_at: string; updated_at: string };

/** Fetch, turning network failures and error responses into Errors with the server's message. */
async function send(url: string, options?: RequestInit): Promise<Response> {
  let response: Response;
  try { response = await fetch(url, options); }
  catch { throw new Error('Cannot reach the server. Check your connection and try again.'); }
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(typeof error.detail === 'string' ? error.detail : 'Something went wrong. Check your document and try again.');
  }
  return response;
}

export async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await send(url, options);
  return response.status === 204 ? undefined as T : response.json();
}

/** Fetch a file (such as a PDF) as a Blob. */
export async function requestFile(url: string, options?: RequestInit): Promise<Blob> {
  return (await send(url, options)).blob();
}

/** Save a Blob as a download with the given file name. */
export function saveFile(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
