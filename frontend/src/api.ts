import type { Box } from './geometry';
export type MarkType = 'signature' | 'text' | 'comment';
/** A template item: a signature box for the client, company text (printed when sent) or a comment (shown to the client, never printed). */
export type Mark = Box & { id: string; page: number; type?: MarkType; text?: string };
export type Agreement = { id: string; name: string; filename: string; page_count: number; marks: Mark[]; version: number; created_at: string; updated_at: string };

/** Fired on window when the server says the staff session has ended. */
export const LOGGED_OUT_EVENT = 'astra:logged-out';

/** An error from the API, with the HTTP status (0 when the server couldn't be reached). */
export class ApiError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

/** Fetch, turning network failures and error responses into Errors with the server's message. */
async function send(url: string, options?: RequestInit): Promise<Response> {
  let response: Response;
  try { response = await fetch(url, options); }
  catch { throw new ApiError('Cannot reach the server. Check your connection and try again.', 0); }
  if (!response.ok) {
    // A staff call refused for lack of a login means the session ended: let the app return to the login page.
    if (response.status === 401 && !url.startsWith('/api/auth/')) window.dispatchEvent(new Event(LOGGED_OUT_EVENT));
    const error = await response.json().catch(() => ({}));
    throw new ApiError(typeof error.detail === 'string' ? error.detail : 'Something went wrong. Check your document and try again.', response.status);
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
