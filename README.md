# Astra Sign

A local agreement template editor: upload a PDF, draw signature fields, move or resize them, and save the template for reuse. Python FastAPI backend, React/TypeScript frontend, and SQLite persistence.

## Run on Windows

From the repository root, install dependencies once:

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r backend\requirements.lock.txt
cd frontend
npm.cmd ci
cd ..
```

Start the backend in one terminal:

```powershell
.\.venv\Scripts\python.exe -m uvicorn app.main:create_app --factory --app-dir backend --host 127.0.0.1 --port 8000
```

Start the frontend in another terminal:

```powershell
cd frontend
npm.cmd run dev
```

Open **http://127.0.0.1:5173**. API documentation: http://127.0.0.1:8000/docs.

On macOS/Linux use `.venv/bin/python` and `npm` instead. Node.js 24 and Python 3.14 were used for development. The application does not require API keys or a separate database service.

## Try the feature

1. Click **Try a sample agreement**, or upload `examples/sample-agreement.pdf` (or your own PDF).
2. For the sample, use **Next page** to reach the signature area on page 2.
3. Click and drag on an empty part of the PDF to draw a signature box. Alternatively, click **Add signature box** in the toolbar for a default-sized box. Drawing and moving work together without switching tools.
4. Drag a field to move it; drag its lower-right handle to resize it. Select **Remove field** to remove a field.
5. Click **Save template**. Reload or reopen the agreement: saved fields return in their original positions.

To remove an uploaded agreement, select it in the library and click **Delete agreement** beside Save template. Confirm **Delete permanently** to remove its PDF and all saved signature boxes. Cancel keeps the agreement and any unsaved edits. Deleting the last agreement returns to the upload screen.

Repeated uploads are named **Agreement**, **Agreement (1)**, **Agreement (2)**, etc. Matching ignores capitalization and chooses the first available number. Existing duplicate library names are numbered automatically when the backend starts, preserving the oldest original name and any names already using a number. The source filename, PDF contents, and saved fields are retained.

Tab to a field and use arrow keys to move it. Shift + arrow keys resize it; Delete/Backspace removes it. Zoom and page navigation are available above the document. Unsaved changes prompt before switching agreements/tabs or leaving the page.

## Storage

The backend automatically creates `backend/data/agreements.sqlite3` and `backend/data/uploads/`. SQLite stores agreement metadata, editable signature coordinates and files; `uploads/` stores original template PDFs, `documents/` stores the frozen copy sent on each file, and `signatures/` stores each signer's signature image. Keep both together when backing up. To choose another directory, set `ASTRA_DATA_DIR` before starting the backend.

## Security

- **Staff login is not built yet.** Run the backend only on `127.0.0.1` (as above) until it is. Anyone who can reach the API can manage agreements and files.
- The backend only answers requests addressed to an allowed host name (default `127.0.0.1,localhost`), which blocks DNS-rebinding attacks from other websites. When deploying, set `ASTRA_ALLOWED_HOSTS` to the public host name, e.g. `ASTRA_ALLOWED_HOSTS=sign.example.com`.
- State-changing requests from other websites are rejected (`Origin` / `Sec-Fetch-Site` checks). Any proxy in front of the backend must pass the browser's `Host` header through unchanged; the Vite dev proxy is configured this way.
- Request bodies are size-limited while they stream in: 21 MB for uploads, 1 MB for the public signing endpoints.
- Signing links put the secret after `#` (`/sign#<token>`). Browsers never send that part to a server, so it stays out of every log; API calls send it in a header. Only a SHA-256 hash of each secret is stored.
- API responses forbid framing, caching, content sniffing and referrers. PDF.js runs with code evaluation disabled.

Coordinates are fractions of the displayed PDF page, with a top-left origin and one-based page numbers. Original PDFs are preserved. The **Original PDF** download does not include signature placement overlays; the app restores those from the database. Signed document generation is part of the future customer signing feature.

## Tests

Backend unit and integration tests (isolated temporary storage):

```powershell
cd backend
..\.venv\Scripts\python.exe -m pytest -q
```

Frontend geometry unit tests and React integration tests:

```powershell
cd frontend
npm.cmd test
```

Real-browser integration tests:

```powershell
cd frontend
npm.cmd run test:e2e
```

Playwright uses installed Google Chrome, starts isolated backend/frontend servers on ports 8011/5174, and stores test uploads in a unique system temporary directory. Tests exercise real PDF rendering, drawing, moving, resizing, zoom, persistence, deletion, unsaved-change protection, validation, and mobile layout. They do not use your normal application database. Failure screenshots/traces appear in `frontend/test-results/`.

Production frontend build:

```powershell
cd frontend
npm.cmd run build
```

The Vite development server proxies `/api` to port 8000. `API_TARGET` overrides that proxy target. A future production deployment must serve the built frontend and proxy `/api` to the Python service, with durable storage; uploading the frontend alone is insufficient.

## Current scope

- Implemented: PDF library, search, upload/drop, page navigation, zoom, editable signature fields, explicit save, restart persistence, validation, stale-save protection, sample PDF, responsive layout, and keyboard controls.
- Files (backend): a file is one job or case for one client. Create a draft file with a client, a signer and an agreement, then send it to get a signing link. Sending freezes a copy of the agreement PDF and its signature boxes, so later template edits never change what was sent. Only a hash of each link's secret is stored; **Reissue link** revokes the old one. See [docs/design/02-files-and-signing-links.md](docs/design/02-files-and-signing-links.md) for the API.
- Signing page: the client opens `/sign#<token>` with no account, reads every page of the frozen document with the signature boxes highlighted, types or draws a signature, ticks the electronic-signature consent and signs. The file moves Sent → Viewed → Signed, and each step is recorded with time, IP address and browser (`GET /api/files/{id}/events`). Already-signed and invalid/replaced links show a clear message. See [docs/design/03-signing-page.md](docs/design/03-signing-page.md).
- Not built yet: the signed PDF with the signature stamped in, the Files screen in the UI (the Clients tab is still a placeholder; use the API at http://127.0.0.1:8000/docs to create and send files for now), email delivery and staff login.
- This first version is a local single-workspace app. Authentication and company data isolation must be added before hosting it for multiple companies.
- PDFs must be unencrypted, no larger than 20 MiB, and contain 1–100 pages. PDF pages are rendered as a canvas; selectable PDF text and screen-reader transcription of document contents are not included yet.

See [Decisions.md](Decisions.md) for design choices, the TDD record, and verification notes.

## References

- [FastAPI file upload documentation](https://fastapi.tiangolo.com/tutorial/request-files/)
- [FastAPI testing documentation](https://fastapi.tiangolo.com/tutorial/testing/)
- [PDF.js API](https://mozilla.github.io/pdf.js/api/)
