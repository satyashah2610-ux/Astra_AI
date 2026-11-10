# Astra Sign

A local agreement template editor: upload a PDF, draw signature fields, move or resize them, and save the template for reuse. Python FastAPI backend, React/TypeScript frontend, and PostgreSQL (Neon) persistence.

## Run on Windows

From the repository root, install dependencies once:

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r backend\requirements.lock.txt
cd frontend
npm.cmd ci
cd ..
```

Point the app at its PostgreSQL database. Create `.env.local` in the repository root (git-ignored; never commit it):

```
DATABASE_URL=postgresql://USER:PASSWORD@HOST/DATABASE?sslmode=require
```

With a Neon project this file is written for you by `neon env pull`. Variables already set in the environment always win over the file. On first start the backend creates its tables (versioned migrations in `backend/app/schema/`).

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

On macOS/Linux use `.venv/bin/python` and `npm` instead. Node.js 24 and Python 3.14 were used for development. The only external service is PostgreSQL (`DATABASE_URL`).

## Try the feature

1. On the login page click **Create an account**: your company name, your name, work email and a password of at least 10 characters. You'll get an email with a link to confirm your address (valid 24 hours; without email configured, accounts are confirmed at once); then log in. (Signers never need an account.)
1. Click **Try a sample agreement**, or upload `examples/sample-agreement.pdf` (or your own PDF).
2. For the sample, use **Next page** to reach the signature area on page 2.
3. Click and drag on an empty part of the PDF to draw a signature box. Alternatively, click **Add signature box** in the toolbar for a default-sized box. Drawing and moving work together without switching tools.
4. Drag a field to move it; drag its lower-right handle to resize it. Select **Remove field** to remove a field.
5. Click **Save template**. Reload or reopen the agreement: saved fields return in their original positions.

To remove an uploaded agreement, select it in the library and click **Delete agreement** beside Save template. Confirm **Delete permanently** to remove its PDF and all saved signature boxes. Cancel keeps the agreement and any unsaved edits. Deleting the last agreement returns to the upload screen.

Repeated uploads are named **Agreement**, **Agreement (1)**, **Agreement (2)**, etc. Matching ignores capitalization and chooses the first available number. Existing duplicate library names are numbered automatically when the backend starts, preserving the oldest original name and any names already using a number. The source filename, PDF contents, and saved fields are retained.

Tab to a field and use arrow keys to move it. Shift + arrow keys resize it; Delete/Backspace removes it. Zoom and page navigation are available above the document. Unsaved changes prompt before switching agreements/tabs or leaving the page.

## Storage

PostgreSQL stores agreement metadata, editable signature coordinates, files, signatures and the audit trail. Files on disk live in `backend/data/`: `uploads/` stores original template PDFs, `documents/` stores the frozen copy sent on each file, `signatures/` stores each signer's signature image, and `signed/` stores each finished signed PDF. Back up the database and `backend/data/` together (moving PDFs to object storage is planned before hosting). To choose another directory, set `ASTRA_DATA_DIR` before starting the backend.

## Security

- **Staff accounts.** Every staff page and API needs a login (email + password). Each company sees only its own agreements and files; another company's ids return 404. Passwords are stored as salted scrypt hashes; the session is an HttpOnly, SameSite=Lax cookie whose value is stored only as a hash, valid 14 days and ended by **Log out** (click your initials in the header). **Delete account** in the same menu, after typing `I want to delete account`, permanently deletes the company, its login, agreements, files and signed PDFs; see [docs/design/11-account-menu-and-deletion.md](docs/design/11-account-menu-and-deletion.md). Set `ASTRA_SECURE_COOKIES=1` when serving over HTTPS behind a proxy. Signers use their link only, never an account. See [docs/design/08-accounts-and-login.md](docs/design/08-accounts-and-login.md).
- The backend only answers requests addressed to an allowed host name (default `127.0.0.1,localhost`), which blocks DNS-rebinding attacks from other websites. When deploying, set `ASTRA_ALLOWED_HOSTS` to the public host name, e.g. `ASTRA_ALLOWED_HOSTS=sign.example.com`.
- State-changing requests from other websites are rejected (`Origin` / `Sec-Fetch-Site` checks). Any proxy in front of the backend must pass the browser's `Host` header through unchanged; the Vite dev proxy is configured this way.
- Request bodies are size-limited while they stream in: 21 MB for uploads, 1 MB for the public signing endpoints.
- Signing links put the secret after `#` (`/sign#<token>`). Browsers never send that part to a server, so it stays out of every log; API calls send it in a header. Only a SHA-256 hash of each secret is stored.
- API responses forbid framing, caching, content sniffing and referrers. PDF.js runs with code evaluation disabled.

Coordinates are fractions of the displayed PDF page, with a top-left origin and one-based page numbers. Original PDFs are preserved. The **Original PDF** download does not include signature placement overlays; the app restores those from the database. Signed document generation is part of the future customer signing feature.

## Tests

Backend unit and integration tests run against a **separate test database**, never the app's own. Put its *direct* (non-pooled) URL in `.env.test.local` (git-ignored):

```
ASTRA_TEST_DATABASE_URL=postgresql://USER:PASSWORD@HOST/DATABASE?sslmode=require
```

With Neon, use a branch named `test` (`neon branches create --name test`, then `neon connection-string test`). Tests refuse to start if this URL points at the same server as `DATABASE_URL`, and they only create, empty and drop their own `astra_test_…` schema. A local PostgreSQL also works: `docker compose up -d` starts one on port 54329 (`postgresql://astra:astra@127.0.0.1:54329/postgres`). Browser tests reset an `astra_e2e` schema on the same test database each run.

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

The Vite development server proxies `/api` to port 8000. `API_TARGET` overrides that proxy target. The browser tests run against the built app with `vite preview`, which reuses the same `server.proxy` setting, so keep `/api` proxying in `server.proxy`. A future production deployment must serve the built frontend and proxy `/api` to the Python service, with durable storage; uploading the frontend alone is insufficient.

## Current scope

- Implemented: PDF library, search, upload/drop, page navigation, zoom, editable signature fields, explicit save, restart persistence, validation, stale-save protection, sample PDF, responsive layout, and keyboard controls.
- Files (backend): a file is one job or case for one client. Create a draft file with a client, a signer and an agreement, then send it to get a signing link. Sending freezes a copy of the agreement PDF and its signature boxes, so later template edits never change what was sent. Only a hash of each link's secret is stored; **Reissue link** revokes the old one. See [docs/design/02-files-and-signing-links.md](docs/design/02-files-and-signing-links.md) for the API.
- Signing page: the client opens `/sign#<token>` with no account, reads every page of the frozen document with the signature boxes highlighted, types or draws a signature, ticks the electronic-signature consent and signs. The file moves Sent → Viewed → Signed, and each step is recorded with time, IP address and browser (`GET /api/files/{id}/events`). Already-signed and invalid/replaced links show a clear message. See [docs/design/03-signing-page.md](docs/design/03-signing-page.md).
- Signed PDF: when the client signs, the app stamps their signature into every box of the exact document that was sent (rotated pages included) and appends a **certificate of completion**: signer, email, method, consent wording, IP address, browser, the full timeline and the SHA-256 of the sent document. It is built once and never changes. The client downloads it from the confirmation page (or by reopening their link); staff download it from `GET /api/files/{id}/signed.pdf`. See [docs/design/04-signed-pdf.md](docs/design/04-signed-pdf.md).
- Files tab: a file is one job for one client. **New file** → fill in the job, client, signer and agreement → **Create and send** (or **Save as draft**). Add an optional **personal message**; with **Email the link to the signer** ticked (the default), the signer gets an email from "<your name> via Astra Sign" with your message and a **Review and sign** button, and replies go to you. The timeline shows **Email sent** or **Email not delivered**. The signing link also appears with **Copy link** for sending another way. It is shown only once (only a hash is stored); **Reissue link** makes a new one and stops the old one. Each file shows its status (Draft, Sent, Viewed, Signed), a timeline, and **Download signed PDF** once signed. The list refreshes when you return to the window, or with **Refresh**. See [docs/design/05-files-screen.md](docs/design/05-files-screen.md).
- Company text and comments: in the agreement editor, **Add text** places text that is printed onto the document when it is sent (the document hash covers it); **Add comment** places a note the client sees next to that spot while signing, never printed.
- Client items: on the signing page the client picks **Tick, Dot, Text, Name, Date, Initials or Signature** and taps anywhere on any page; items can be dragged, resized and removed. Name and Date are filled in by the server (the signing date in the client's time zone). Initials are adopted once, like the signature. Everything is stamped into the signed PDF and listed on the certificate. Printed text supports Western European characters; other scripts are refused with a clear message rather than printed as boxes. See [docs/design/06-text-comments-and-signer-items.md](docs/design/06-text-comments-and-signer-items.md).
- **Forgot password:** "Forgot password?" on the login page emails a one-time link (valid 1 hour) to choose a new password; saving it signs out every session and shows **Password reset** with a link to log in. The answer never reveals whether an email has an account, and requests are limited (3 per account, 10 per network address, per hour). See [docs/design/09-forgot-password.md](docs/design/09-forgot-password.md).
- **Email:** sent through [Resend](https://resend.com) when `RESEND_API_KEY` and `ASTRA_EMAIL_FROM` are set (put them in the git-ignored `.env`, e.g. `ASTRA_EMAIL_FROM="Astra Sign <sign@mail.yourdomain.com>"` with that domain verified in Resend). `ASTRA_EMAIL_OUTBOX=<folder>` writes emails to files instead (used by the browser tests; nothing is sent). `ASTRA_APP_URL` sets the address used in email links; **set it in production** (e.g. `https://app.signwithastra.com`). Without it, links use the request's own host name and port, accepted only as an exact allow-listed `name[:port]`. Without configuration, nothing is sent.
- **Signing emails:** see [docs/design/10-signing-email.md](docs/design/10-signing-email.md). Without email configured, or past the limit of 50 signing emails per company per day, sending still works and the screen asks you to copy the link.
- **Login protection:** 5 wrong passwords for one email (or 20 from one network address) within 15 minutes lock logins for that email or address until the 15 minutes pass; a password reset unlocks. New accounts must confirm their email before logging in. See [docs/design/12-login-protection.md](docs/design/12-login-protection.md).
- Not built yet: an email to staff when the client signs, inviting colleagues, and hosting.
- This first version is a local single-workspace app. Authentication and company data isolation must be added before hosting it for multiple companies.
- PDFs must be unencrypted, no larger than 20 MiB, and contain 1–100 pages. PDF pages are rendered as a canvas; selectable PDF text and screen-reader transcription of document contents are not included yet.

See [Decisions.md](Decisions.md) for design choices, the TDD record, and verification notes.

## References

- [FastAPI file upload documentation](https://fastapi.tiangolo.com/tutorial/request-files/)
- [FastAPI testing documentation](https://fastapi.tiangolo.com/tutorial/testing/)
- [PDF.js API](https://mozilla.github.io/pdf.js/api/)
