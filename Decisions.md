# Decisions

## 2026-11-09 - Scope and workflow
- Build the first requested feature: upload multiple PDFs and place, move, resize, remove, save, and reopen signature locations.
- Use exactly two main tabs: Agreements and Clients. Clients is an explicit upcoming feature; client sending and actual signing are outside this iteration.
- Python FastAPI backend and React with TypeScript frontend, as requested. Local development first because the selected Sites hosting runtime does not run this Python backend.

## 2026-11-09 - Persistence
- SQLite stores agreement metadata, optimistic-lock version, and saved signature rectangles. PDF bytes live in a local data directory under generated UUID filenames. Both survive process restart.
- SQLite requires no separate database service for the first local version. Before a hosted multi-company release, add organization authentication/isolation, managed database/storage, and migrations.
- Preserve uploaded PDFs byte-for-byte. Store signature placement as editable overlays, not destructive PDF modifications. Actual signed PDF generation belongs to the customer signing feature.
- Store positions as fractions of the rendered page, with a one-based page number and a top-left origin. This keeps fields aligned across zoom levels, display sizes, page sizes, and PDF rotation.
- Save explicitly, show unsaved changes, and require a choice before discarding edits. Use a version check to prevent an older browser tab overwriting newer saves.

## 2026-11-09 - Validation and tests
- Accept valid unencrypted PDFs only, at most 20 MiB and 100 pages. Reject invalid field coordinates, duplicate IDs, and nonexistent page numbers on the server.
- Use a generated two-page fictional sample agreement with no real personal data.
- Test-driven development: write and run failing backend contract tests and frontend geometry tests before implementation. Add UI integration and real-browser workflow coverage before completing the feature.
- Use pytest with temporary SQLite/file storage for backend integration; Vitest for unit and React integration tests; Playwright for actual PDF rendering, pointer interactions, and persistence after reload.
- Consulted FastAPI testing/upload documentation and React-PDF/PDF.js worker guidance. Bundle PDF.js and its worker locally so PDF content is not sent to a third-party rendering service.

## 2026-11-09 - Interaction and rendering
- Use PDF.js directly with a React-managed canvas and an HTML signature overlay. Render only the selected page to control memory usage. Use the actual PDF viewport so rotated and mixed-size pages retain their native proportions.
- Ship PDF.js character maps, standard fonts, image-decoder WASM, and color profiles with the frontend. This supports unfamiliar PDFs without a hosted PDF rendering API. Build/dev/postinstall copy those assets from the locked dependency version.
- Draw boxes in either direction; clamp movement and resizing to page bounds. Ignore tiny accidental drags. A selected box exposes a lower-right resize handle and a remove control.
- Provide a default-size Add Signature action and keyboard movement/resizing/deletion in addition to pointer drawing. Pointer cancellation restores the state from before the gesture.
- Keep saving explicit. Uploads are saved immediately as drafts; modified fields show an unsaved indicator. Protect tab/document switches and page unload from accidental loss. On save errors, retain local edits for retry. Offer a saved-version reload for version conflicts.
- Include a two-page fictional services agreement in `examples/sample-agreement.pdf` and through a one-click sample action. The sample is not a preloaded record: users choose when to add it.
- Preserve exactly two navigation tabs. The Clients tab explains the next phase without pretending to send agreements or store clients.
- Use a restrained green/cream interface with a library, central document, and field controls. Collapse the controls beneath the document on smaller screens; keep the PDF scrollable at higher zoom.
- The frontend uses Google Fonts for display typography with system fallbacks. Document rendering assets remain local. Font requests do not include document contents.

## 2026-11-09 - One signature-box interaction
- User requested a single tool for adding and moving boxes. Removed the separate selection arrow and draw mode; dragging empty PDF space creates a box, dragging an existing box moves it, and dragging its corner resizes it.
- Keep one `Add signature box` toolbar button for inserting a default-sized box, including keyboard access. Remove the duplicate sidebar add control. No mode toggle is required before or after any gesture.
- Clicking empty space only deselects the field; tiny drags still create no box. Field and resize pointer events stop propagation so moving/resizing cannot also create a box.
- Updated on-screen instructions and README. Test-first regression: removed the mode-toggle click from the browser workflow and observed failure (expected one box, found zero) before changing implementation.
- Browser coverage now also checks consecutive drawing without toggling, one add control, removal of the old toolbar tools, selection/deselection, and moving without creating an extra box.

## 2026-11-09 - Delete agreements
- Put Delete agreement beside Save template for the selected document. Confirm the named agreement before permanent deletion, including its original PDF, saved fields, and unsaved edits. Cancel and failed requests preserve local work; successful deletion selects the next agreement or the empty upload screen.
- Add DELETE `/api/agreements/{id}` returning 204. SQLite serializes deletion against saves; a filesystem deletion error rolls back the record removal and returns a retryable error. A missing PDF does not prevent deleting the record. Unknown IDs return 404.
- This local implementation coordinates ordinary file errors with a database transaction; SQLite and filesystem changes are not a distributed transaction across abrupt process/disk failures. A production storage lifecycle should handle crash recovery and retention policies.

## 2026-11-09 - Number duplicate agreement names
- User requested `(1)`, `(2)`, etc. for uploads with matching names. Allocate the first available display name on the backend: Agreement, Agreement (1), Agreement (2). Compare case-insensitively; reuse available gaps after deletions. A filename already ending in `(1)` is treated literally, so another copy can be named Agreement (1) (1).
- Store the unique display name in SQLite so the library and editor agree after reload. Preserve original filenames, PDF bytes, IDs, and saved signature fields. Reserve suffix space within the existing 200-character display-name limit.
- Hold a SQLite write lock across name allocation and insertion, preventing simultaneous uploads from selecting the same suffix. Add a case-insensitive unique index as a database constraint.
- Repair pre-existing duplicate names on startup in oldest-first order. Reserve all current names before allocating suffixes to avoid taking an existing numbered name. The operation is idempotent and changes only duplicate display names.

## 2026-11-09 - Rename to Astra Sign
- "DocuSign" is a registered trademark of an existing e-signature company. The client plans to sell this product to their whole industry, so a product named after a competitor is a legal and commercial risk. Renamed the product to **Astra Sign**, tying it to the first customer while staying neutral for later customers.
- Changed: API title, logger name, browser title, header brand, footer, npm package name, README heading. Unchanged on purpose: `ASTRA_DATA_DIR` and the data directory, so existing agreements stay available. Earlier Decisions entries are kept as history.

## 2026-11-09 - Files and signing links (backend)
- Full design: [docs/design/02-files-and-signing-links.md](docs/design/02-files-and-signing-links.md) (HLD, state machine, table, API, test plan).
- A **file** is the client's unit of work: one job or case, one client, one signer, one agreement. Status follows a state machine (draft → sent → viewed → signed) in `app/lifecycle.py`; every other transition is rejected.
- Sending snapshots the agreement PDF (`data/documents/<file id>.pdf`), its signature boxes, name, page count and SHA-256. A signed contract must match exactly what was sent, even if the template is edited or deleted later.
- Signing links use 256-bit `secrets.token_urlsafe` tokens. Only the SHA-256 hash is stored, so a database copy cannot be used to sign. Trade-off: staff cannot re-display an old link; **Reissue link** creates a new one and revokes the old. The API returns a path (`/sign/<token>`) so the backend does not need to know its public host.
- Delivery is copy-the-link for now: it works with any mail setup and needs no email provider for the test. Signer emails get a simple shape check rather than a new dependency.
- Only drafts can be edited (optimistic `version` check). Signed files cannot be deleted. An agreement used by draft files cannot be deleted (409); sent files are unaffected because they have their own copy.
- Refactor: moved the data directory, SQLite connection and schema into `app/storage.py` so agreements and files share one storage layer. The files API is a separate router (`app/files.py`).

## 2026-11-09 - Signing page
- Full design: [docs/design/03-signing-page.md](docs/design/03-signing-page.md).
- Signers never log in: the link secret is their credential. The browser page is `/sign/<token>`, but API calls send the secret in an `X-Signing-Token` header, so it never appears in server access logs. The app sets `Referrer-Policy: no-referrer`. Every bad, revoked or draft link gets the same 404 message, revealing nothing about which links exist.
- Opening the page is recorded by a separate `POST /api/signing/view`, not as a side effect of `GET`, so link previews and prefetchers don't mark files as viewed. Only the first open counts.
- One adopted signature, typed (rendered in a handwriting font) or drawn (mouse, finger, stylus), fills every box, as in mainstream e-signature tools. The browser always sends a PNG, so what the signer previewed is exactly what step 4 stamps. The public endpoint re-validates the image: ≤ 512 KB, strict base64, real PNG fully decoded by Pillow (already installed through reportlab), sensible dimensions. Taps and tiny scribbles do not count as a drawn signature.
- The server owns the consent wording, returns it to the page, requires `consent: true`, and stores the exact text with the signature, plus name, method, image hash, time, IP and browser. A `file_events` table records created, sent, link reissued, viewed and signed for the step 4 certificate page; staff read it at `GET /api/files/{id}/events`.
- Signing uses `BEGIN IMMEDIATE` plus the state machine: double clicks or two tabs give exactly one signature. New tables use `CREATE TABLE IF NOT EXISTS`, so existing databases upgrade on start-up.
- Left out on purpose: per-IP rate limiting (256-bit tokens cannot be guessed; revisit when hosting) and trusting `X-Forwarded-For` (only safe behind a known proxy; configure at deployment).
- Frontend: `Root` routes `/sign/<token>` to `SigningPage`, everything else to the staff app. `PdfPages` shows every page stacked and draws each page only as it scrolls near view, which keeps long agreements fast. A shared `pdfjs.ts` now configures PDF.js for both the editor and the viewer.
- Browser run on the developer machine: 8 of 9 passed. The phone drawing test failed because the document area was only a loading line until the PDF arrived; when the pages appeared above the signature panel (stacked layout on phones), the panel jumped about 1,000 px and the test's pen strokes landed on the PDF. A real signer starting early would see the same jump. Fix: `PdfPages` now reserves a full-size placeholder for every page from the known page count (and shows the signature boxes) before the PDF loads. Test-first: two new `PdfPages.test.tsx` tests failed, then passed; 36 frontend tests pass. The browser test is unchanged and acts as the regression check.

## 2026-11-09 - Keyboard focus for signature boxes; simpler field panel
- Bug: arrow keys did nothing after clicking a box. The pointer handler calls `preventDefault()` (needed for dragging), which also blocks the browser's focus change, so the box looked selected but had no keyboard focus. Newly drawn or added boxes had the same problem. The browser test missed it because it called `field.focus()` instead of clicking.
- Fix: clicking, drawing or adding a box now gives it keyboard focus (without scrolling), so arrow keys move it and Shift + arrows resize it immediately.
- Removed Width and Height from the selected-field panel. Page-relative percentages mean nothing to staff and resizing is done by dragging; Field type and Page remain.

## 2026-11-09 - Security review of dev
- `/security-review` compares a branch with the remote default branch; with only `dev` on GitHub there was nothing to compare, so the whole codebase was reviewed by hand. Dependencies: `npm audit` 0 vulnerabilities; FastAPI 0.162, Starlette 1.10, pypdf 6.21, Pillow 13 are current.
- Threat model: staff login does not exist yet and the API runs on the staff member's computer, so the main attacker is a malicious website open in the same browser; the public signing endpoints face the internet once hosted.
- Fixed (new `app/security.py` middleware, each with tests that failed first):
  1. **Cross-site requests**: a website could make the browser upload a PDF, send a file or reissue a link (multipart and body-less POSTs need no CORS preflight). State-changing requests with a foreign `Origin`, `Origin: null` or `Sec-Fetch-Site: cross-site` now get 403. Non-browser clients and same-origin requests are unaffected.
  2. **DNS rebinding**: a website could point its own domain at 127.0.0.1 and read every agreement and signed document. The backend now serves only allowed host names (`ASTRA_ALLOWED_HOSTS`, default `127.0.0.1,localhost`), otherwise 400.
  3. **Unbounded uploads**: a chunked upload without `Content-Length` was spooled to disk in full before any size check. The body is now counted as it streams and stopped at 21 MB (1 MB for `/api/signing`), returning 413 before anything is saved.
  4. **Signing secret in logs**: `/sign/<token>` put the secret in the page path, which web servers, proxies and CDNs log. Links are now `/sign#<token>`: browsers never send the fragment anywhere. The page reloads if the fragment changes, so pasting a second link into the same tab works.
  5. **Hardening**: every API response sends `X-Frame-Options: DENY`, `Content-Security-Policy: frame-ancestors 'none'` and `Referrer-Policy: no-referrer` (plus the existing nosniff / no-store). PDF.js runs with `isEvalSupported: false` because uploaded PDFs are untrusted.
- Found while verifying: Vite's proxy shorthand rewrites `Host` to the backend address, which would have made every save from the UI look cross-site. The dev proxy now keeps the browser's `Host` (`changeOrigin: false`); production proxies must do the same (documented in the README).
- Deliberately not fixed here: staff login (plan step 6; until then run only on 127.0.0.1, now stated in the README), per-IP rate limiting on signing (256-bit secrets cannot be guessed), and a full Content-Security-Policy for the HTML pages (set by whichever server hosts the built frontend; part of deployment).

## 2026-11-09 - Signed PDF and certificate
- Full design: [docs/design/04-signed-pdf.md](docs/design/04-signed-pdf.md).
- The signature is stamped into every box of the frozen snapshot (never the editable template) with a reportlab overlay merged by pypdf, keeping the original text and vectors. A certificate of completion is appended: document name and SHA-256 of the sent PDF, file reference, signer name and email, the name and method they signed with, the signature, consent wording, IP address, browser and the full timeline in UTC.
- Coordinates are mapped from the page as PDF.js displays it (crop box plus `/Rotate`), so rotated scans and offset crop boxes are stamped in the right place and upright. Tests read the image's real position and direction back from the PDF content stream; removing the rotation step made 6 of them fail.
- Built right after the signature is committed and stored in `data/signed/`; never rebuilt, so every download is byte-identical. If building fails (an unusual PDF) the signature is still recorded, the failure is logged, and the next download retries; a download that still can't build returns a clear 503. Builds are serialized and written atomically.
- Untrusted text (names, document names, browser strings) is escaped before layout, so `<b>&` prints literally. Known limitation: the certificate uses Helvetica, so non-Latin names may not render there (the stamped signature image is unaffected).
- Downloads: staff `GET /api/files/{id}/signed.pdf`; signer `GET /api/signing/signed.pdf` with the header token. The confirmation page and a reopened signed link both offer "Download signed copy". The secret never goes into a URL.
- Not done: cryptographic PDF signing with a certificate authority (PKI). The SHA-256 on the certificate proves which document was signed; PKI can be added later.

## 2026-11-09 - Files screen
- Full design: [docs/design/05-files-screen.md](docs/design/05-files-screen.md). The "Clients" placeholder tab became **Files**; the app keeps exactly two tabs. The brief's unit of work is the file, so a separate client directory was left out: it adds data entry without getting agreements signed faster.
- **Create and send** is the primary action (one form, one click for the everyday case); **Save as draft** remains. Drafts can be edited (version-checked) and deleted; sent files can have their link reissued (after a confirmation that the old link stops working); signed files offer **Download signed PDF** and cannot be deleted.
- The signing link is shown once, right after sending or reissuing, with **Copy link**, because only its hash is stored (design 02). The screen says so and points to Reissue. If the browser blocks clipboard access, the link is selected for manual copying.
- Agreements without signature boxes are listed but can't be chosen. The form checks the same rules as the server first, for instant field-level messages; the server stays the authority and its messages are shown as-is.
- The list reloads when staff return to the window and via **Refresh** (the signer works elsewhere); no polling. No backend changes were needed.
- Email delivery from the app is deliberately left out for now: staff paste the link into their own email, which needs no email provider and works with any mail setup.

## 2026-11-09 - Company text and comments; signer-placed items
- Full design: [docs/design/06-text-comments-and-signer-items.md](docs/design/06-text-comments-and-signer-items.md). Product decisions from the client: the **client places** their own items (agreements are fixed PDFs made elsewhere); a **comment** is a note shown to the client, not printed; **company text** lives on the template. Per-file company text and company-defined required fields are later work.
- Company text is printed into the frozen snapshot at send time, so what the client reads is exactly what is hashed and signed. Comments travel as notes; signature boxes are unchanged. Sending still needs at least one signature box. Template boxes without a `type` are signature boxes, and plain boxes are stored without new keys, so every existing template keeps working unchanged.
- Client tools: Tick, Dot, Text, Name, Date, Initials, Signature: tap to place, drag to move, corner to resize, × to remove. The tool switches off after each placement so a finger can still scroll the page (the layer only blocks touch scrolling while a tool is active). Name and Date values come from the server (Date = signing date in the client's time zone, offset limited to ±14 h), never from the browser. Initials are adopted once, typed from the name or drawn, and only requested when an initials item exists.
- The server validates everything again: item types, pages within the document, positions inside the page, sizes, ≤ 200 items, unique ids, text only on text items (≤ 500 characters), initials image like the signature image.
- Printed text uses the PDF's built-in Helvetica, which prints non-Western scripts as ■ boxes (checked by rendering Hindi and Chinese). Rather than produce a broken signed document, printed text and printed names must be Windows-1252; other text is refused with a clear message. Comments, which are never printed, accept any script. Bundling a Unicode font is the planned fix.
- Stamping was generalised: one pass draws images, wrapped and shrunk-to-fit text, vector ticks and filled-circle dots in each item's displayed frame, so rotated pages work for every item. The certificate gains a "Completed by the signer" table and can run to more than one page.
- Deferred: (1) company text is printed inside the send transaction, so sending a very large template holds the database write lock for a moment. Fine for one company's local use; revisit with the hosting/database step. (2) A missing initials image fails the signed-PDF build loudly, the same as a missing signature image, rather than silently dropping initials. (3) A client text item is a single-line input on screen, while the PDF wraps and shrinks long text to fit; acceptable for short entries such as names, addresses and reference numbers.

## 2026-11-09 - Signing page greeting
- The greeting now reads "…Your signature will be placed in the highlighted box." for one box and "…in all the highlighted boxes." for several. The Full name field stays pre-filled from the name the company entered on the file (the user considered an empty field and a confirmation dialog, then chose to keep the current behaviour).

## 2026-11-09 - Typed signature clipping; greeting wording
- Bug: in the typed-signature preview the last letter was cut off (e.g. the "l" in "Nihal"). Handwriting fonts draw swashes past a letter's advance width, and the preview text had `overflow: hidden` with no padding. The preview now has 0.3 em of room on each side; long names still end in "…". A browser-test check asserts the room exists (CSS isn't loaded in unit tests).
- The code review found the same problem in the **signature image stamped into the PDF**: names were sized by advance width only, so a long name's final swash could be cut at the image edge. The name is now shrunk until its measured ink width also fits. A new unit test (a fake font whose ink is wider than its advance) fails without the fix.
- Greeting now: "…Your signature will be placed in the highlighted box." (one) / "…in the highlighted boxes." (several).
- Review notes not acted on: the typed signature's smallest size (28 px) can still clip a 60+ character name. Raising it is a product choice (cap the name length or warn); recorded for later.

## 2026-11-09 - PostgreSQL on Neon
- Full design: [docs/design/07-postgresql.md](docs/design/07-postgresql.md). For hundreds of users across companies the app moves from one SQLite file to managed PostgreSQL (Neon free tier: backups, branching, no server to run). PDFs stay on disk for now; object storage comes with hosting.
- psycopg 3 with a small connection pool, not an ORM: the code already used explicit SQL, so queries stayed the same apart from `%s` placeholders. Prepared statements are off and per-transaction settings use `SET LOCAL`, because Neon's pooled endpoint (PgBouncer) supports neither prepared statements across transactions nor startup options.
- SQLite's `BEGIN IMMEDIATE` became a transaction-scoped advisory lock taken at exactly the same points, with a 15 s lock timeout. Proven: removing it from file creation makes the race test fail again (orphan draft, 201 instead of 422), as it did on SQLite.
- Schema is versioned: numbered `.sql` files in `backend/app/schema/` applied once at start-up, recorded in `schema_migrations`, under a lock so two servers starting together can't both migrate (tested with two concurrent runners). A ~40-line runner instead of Alembic, which is built around SQLAlchemy models we don't use.
- Kept ISO-8601 text timestamps and JSON text columns so API output is unchanged; `timestamptz`/`jsonb` can be a later migration. `rowid` ordering became an identity column. Case-insensitive unique names became a unique index on `lower(name)`; the old SQLite duplicate-name repair was dropped because the index makes duplicates impossible (a test now proves the database refuses them).
- Configuration: `DATABASE_URL` from the environment; for local development `.env.local` / `.env` (git-ignored) fill in missing settings and never override real ones. Starting without a database URL fails with a clear message. The Neon CLI wrote `.env.local` for the `production` branch, as the user chose.
- Tests: the C: drive had no room for Docker, so tests use a separate Neon branch named `test` (`.env.test.local`, direct connection). Safety in layers: tests refuse to run if the test URL reaches the same server as `DATABASE_URL`; each run creates its own `astra_test_<random>` schema, migrates it once, empties its tables before every test, and drops it at the end, so nothing outside that schema is ever touched; tests never read the real `.env` files. Browser tests reset an `astra_e2e` schema on the test branch, and the URL is passed in-process, never on a command line. `docker-compose.yml` remains for anyone with a local PostgreSQL.
- Fresh start: existing local SQLite data is not copied; a one-off import can be written if needed.
- Deferred: deleting a PDF from disk before the database commit could, if the commit to the remote database fails, leave a record without its PDF. This is addressed when PDFs move to object storage with hosting. Also deferred: a cheaper positional row lookup (minor).

## 2026-11-09 - Accounts, companies and login
- Full design: [docs/design/08-accounts-and-login.md](docs/design/08-accounts-and-login.md). Product decisions: **email + password** (no sign-in-by-email links), and no email domain for now, so nothing in login or signing depends on email delivery. Signers still never log in.
- Sign-up creates a company (organization) and its first user. Agreements and files belong to one organization and every staff query filters by it; another company's ids return 404 (not 403), so ids reveal nothing. Agreement names are unique per company. Rows created before accounts are kept under a placeholder company nobody can log in to.
- Passwords: `hashlib.scrypt` (memory-hard, standard library, no new dependency), random salt, constant-time check; at least 10 characters. Login answers "Email or password is incorrect." for both a wrong email and a wrong password, and does the same hashing work either way.
- Sessions: a random 256-bit token in an HttpOnly, SameSite=Lax cookie (Secure over HTTPS or with `ASTRA_SECURE_COOKIES=1`); only its SHA-256 is stored, as with signing links. 14 days, extended at most once a day; logout deletes it on the server. Server-side sessions rather than JWTs so logout and expiry take effect immediately.
- Frontend: a login / create-account page in front of the staff app; the header shows company and user with **Log out** (with the unsaved-changes guard); any staff call answered 401 returns to the login page. The signing page never checks a login.
- Left out for now: inviting colleagues, roles and password reset (they need email delivery, so a domain), and login rate limiting (scrypt slows guessing; add with hosting).
- Deferred, with reasons: a session ending mid-edit returns to the login page and the unsaved template marks are lost (any save would fail anyway; a "log in again without leaving" dialog is future polish); sign-up's "an account with this email already exists" reveals that an email is registered (normal for B2B sign-up; with email verification it can become a neutral "check your inbox"); each staff request uses two pooled connections, one for the session check and one for the work (fine at this scale; merge later if latency matters).

## 2026-11-09 - Forgot password and the email module
- Full design: [docs/design/09-forgot-password.md](docs/design/09-forgot-password.md). Possible now that `mail.signwithastra.com` is verified in Resend (the product owner bought `signwithastra.com`; 1 year, auto-renew off).
- A one-time link, valid 1 hour, with the secret in the URL fragment (`/reset-password#…`) so it never reaches server logs; only its SHA-256 is stored. Using a link marks every outstanding link for that user as used and deletes all their sessions, then signs in on that browser.
- No account enumeration: `/api/auth/forgot` gives the same 202 message for known and unknown emails, when limits are hit, and when sending fails; the email is sent after the response so timing doesn't reveal it either. Limits stored in PostgreSQL: 3 requests per email and 10 per IP address per hour.
- Links in emails use `ASTRA_APP_URL`, or the request's own host, which the middleware has already checked against the allow-list, so links can't be pointed at another site via a forged header.
- Email module (`app/email.py`): Resend through its HTTPS API with the standard library (no SDK dependency), a file outbox for local development and browser tests, or nothing when unconfigured. Errors never include the API key. Tests clear all email settings, and browser tests use an outbox and skip the `.env` files, so tests can never send real email. The Resend key lives in the git-ignored `.env` (not `.env.local`, which `neon env pull` rewrites).
- Emails greet by the escaped full name, include a plain-text part and a copyable link, and are built from one layout reused later for signing emails.
- Deferred, with reasons: (1) behind a proxy every request shares the proxy's IP, so the per-IP limit becomes global; this needs trusted forwarded headers, configured with hosting. (2) Anyone can use up an account's 3 reset emails per hour and so delay that person's own reset; avoiding it needs a CAPTCHA or similar, out of scope. (3) The per-IP limit is skipped when the server can't see a client address (rare; not on uvicorn). (4) "Request a new link" appears for any reset error, not only an expired link.

## 2026-11-09 - Security review before main: Host header and reset links
- `/security-review` of everything on `dev` since the last merge (PostgreSQL, accounts and login, forgot password) found one real issue, confirmed by an independent check (8/10): **password-reset link poisoning**. The Host check kept only the text before the last `:`, so `Host: localhost:x@evil.example` passed the allow-list as `localhost`, and the raw header was used to build the emailed link, which a browser opens at `evil.example` (the part before `@` is read as a user name). An attacker could request a reset for a victim, the victim would get a genuine email, and the attacker's page could read the link's secret and take over the account. The earlier note that "the allow-list makes this safe" was wrong.
- Fix: the Host header is now accepted only as an exact `name[:port]` (numeric port up to 65535, or a bracketed IPv6 address); anything else gets 400 before reaching the app. Email links are rebuilt from the parsed name and port, never copied from the raw header, and `ASTRA_APP_URL` is recommended for production. Tests (written first, 10 failing before the fix): forged hosts with `@`, `/`, `?`, `#`, non-numeric or out-of-range ports are refused everywhere; a forged host can't trigger a reset email; the link's host, port and (absent) user name are exactly the checked values; normal hosts still work.
- Everything else the review checked held up: every staff endpoint requires a login and is scoped to the company (including follow-on queries); the dynamic `UPDATE` uses only model field names; sessions and reset links store only hashes; reset links are single-use and bound to their user; no response or log contains secrets or password hashes; email HTML is escaped.

## 2026-11-09 - Browser tests run against the built app
- Playwright now builds the frontend and serves it with `vite preview` on port 5174 (same `/api` proxy, since `preview.proxy` defaults to `server.proxy`) instead of the dev server. No dependency re-optimisation or reload can happen mid-run, so the earlier note that lockfile changes need a warm-up dev-server start no longer applies.
- The build (`tsc -b && vite build`) runs first, so a type error stops the browser tests; the frontend server's stdout is shown so the error is visible. The web-server timeout is 3 minutes to cover the build.

## 2026-11-09 - Personalised signing email
- Full design: [docs/design/10-signing-email.md](docs/design/10-signing-email.md). Sending (and reissuing) a file now emails the signer the link, with an optional personal message stored on the file (up to 2,000 characters, editable while draft). A checkbox, on by default, lets staff skip the email and share the link another way; **Copy link** stays.
- From "<staff name> via Astra Sign" at our verified address, Reply-To the staff member: sending as the staff member's own address would fail SPF/DKIM and land in spam. The display name is quoted with `formataddr` and line breaks are removed, so a name can't add email headers. The message is HTML-escaped (line breaks kept) and plain in the text part.
- The email goes out after the response (a background task, like password resets): the file is sent whatever the provider does. The result is recorded on the timeline as `email_sent` / `email_failed` with the recipient (new `file_events.detail` column, migration 0004). The response says `"sending"`, `"off"` or `"not_configured"`, and the screen explains each; the Files page looks at the timeline again 2.5 s after sending so the delivery shows up.
- `app_url()` moved from auth to `app/links.py`, so reset and signing links are built by the same audited code (Host-header fix).
- Not in this step: an email to staff when the client signs (not requested).
- Left, with reasons: the timeline is checked once 2.5 s after sending (a slow provider shows on the next refresh); very long non-ASCII sender names rely on Resend's header encoding; the form's email checkbox doesn't carry over to a draft sent later (that send has its own checkbox, on by default); an explicit `null` message is refused (send an empty string to clear it).

## 2026-11-09 - Log in after sign-up and after a password reset
- Product owner's request: after creating an account, show "Account created. Log in to continue." on the login form (email filled in) instead of opening the workspace; after a reset, show "Password reset" with a **Go to log in** link.
- The server matches: sign-up and reset no longer start a session (they return a message), so a reload can't skip the message, and the first login confirms the new password works. Reset still ends every existing session.
- Login page: the email box now spans the form like the password box (it sat in a wrapper that didn't stretch); a browser test compares their widths.
- Browser test fixes from the last run: the branding test expected the removed "Agreements" label, and the signing test expected an exact timeline that now also contains "Email sent" (it now sends without email; emails have their own test).
- Also in this step: the sign-up screen no longer says "One account per company to start" (it read like a permanent limit; colleague invites are not built yet), and the Files status filters (All, Draft, Sent, Viewed, Signed) stay on one row in the sidebar.

## 2026-11-09 - Account menu and deleting an account
- Full design: [docs/design/11-account-menu-and-deletion.md](docs/design/11-account-menu-and-deletion.md). The log-out arrow is gone; the initials open a menu with **Log out** and **Delete account**.
- Deleting removes the whole company (one login per company, so the data would otherwise be unreachable; confirmed by the product owner): every row it owns in one transaction under the write lock, then its stored PDFs and images. The user must type exactly `I want to delete account` (shown in quotes; same capitals, no extra spaces); the server checks the phrase too (422 otherwise). No password re-entry (not requested). Afterwards the login page says "Your account has been deleted."; the same email can sign up again.
- The account menu now shows at every width: below 1100 px the whole account area, including the only way to log out, used to be hidden; now only the company and user names are hidden.
- Left, with reasons: (1) file-scoped tables have no foreign keys, so deletion lists them by hand (a cascade migration is a separate change; the deletion test counts every table so a missed one fails); (2) a request already waiting for the write lock when the account is deleted can end in a 500 instead of 401/404 (rare race, nothing is corrupted); (3) a 422 from the server shows a generic message (only if the two copies of the phrase ever drift apart); (4) the test spells the phrase out on purpose, as a contract check. The build lock is per process: with several app processes, object storage (planned with hosting) replaces this file cleanup.

## 2026-11-09 - Login protection: failed-login limits and email confirmation
- Full design: [docs/design/12-login-protection.md](docs/design/12-login-protection.md). Closes two items deferred earlier: unlimited password guessing, and sign-ups with someone else's address sending signing emails from our domain.
- Limits: 5 failed logins per email or 20 per network address within 15 minutes lock logins (429) until older failures leave the window, even with the right password; failures are counted for any email, so the lock reveals nothing about which emails have accounts. A password reset unlocks. The per-address limit has the proxy caveat already recorded (it needs trusted forwarded headers once hosted).
- Confirmation: sign-up emails a one-time link (24 hours, only its hash stored); login answers 403 "Confirm your email address first" only after the right password, with **Send a new confirmation link** (generic 202 answer, at most 3 links per account per hour). A password reset also confirms the email. Existing accounts are marked confirmed by migration 0006; without email configured, new accounts are confirmed at once.
- Left for later: an unconfirmed sign-up keeps its email reserved until a cleanup job exists (a second sign-up with it gets 409).
- Left, with reasons: (1) **must fix when hosting**: behind a proxy every request shares one address, so the per-address limit would lock everyone; needs trusted forwarded headers with the hosting step; (2) anyone can keep a known user locked out by repeating 5 wrong passwords (the usual lockout trade-off; a reset unlocks; progressive delays could replace hard locks later); (3) resend has no per-address limit and its timing could hint at unconfirmed accounts; (4) the link-token helpers are duplicated between reset and confirm.

## 2026-11-10 - Redesign: "paper and ink"
- Requested: make the app look like a complete, production-grade product. Scope chosen by the product owner: redesign the existing screens only (no new features); look: "paper and ink".
- Layout: a left sidebar (logo, Agreements, Files, account menu at the bottom) replaces the top tabs; each page has a plain heading and one sentence saying what it is for. At ≤1280 px the sidebar becomes an icon rail; on phones a compact top bar.
- Look: cool paper background, PDF pages shown as white sheets on a grey desk, deep ink-blue text, one green for actions; one typeface (Instrument Sans, Caveat kept for signatures); smallest text 12 px with darker grey for contrast. Status seals use the same colours everywhere: Draft slate, Sent blue, Viewed amber, Signed green.
- Removed: marketing headlines, all-caps eyebrow labels, footers, decorative arrows and "·" separators. Agreements in the library show "N pages" and "Ready to send" / "No signature box yet"; file rows also show the signer.
- Changed from the plan: Files was going to become a table; with the sidebar and the detail panel there wasn't room, so it stays a list beside the detail panel. Phones use a top bar, not a bottom bar.
- Full design: [docs/design/13-redesign.md](docs/design/13-redesign.md).

## 2026-11-10 - Signing reminders and the "signed" email
- Full design: [docs/design/14-reminders-and-signed-notice.md](docs/design/14-reminders-and-signed-notice.md). Requested: remind the client every 24 hours until they sign, track it per file, and email the company when the client signs; 2 minutes for a local demo.
- Reminders follow only an emailed link (if staff share the link themselves, we don't start emailing the client). Each reminder carries a fresh link and earlier links keep working, because links are stored only as hashes and the original can't be re-sent; reissuing still revokes every link. Reminders have their own daily allowance of 100 per company (sends and reissues keep their 50), so the total stays bounded and waiting files can never block new sends; when it's full the reminder waits an hour.
- The interval is `ASTRA_REMINDER_MINUTES` (default 1440). A background loop in the app sends due reminders, each claimed under the database write lock, so two processes never send the same one. Reminders only go out while the app is running (a sleeping free host delays them).
- When the client signs, the staff member who sent (or last reissued) the file gets an email; the timeline records Reminder sent / not delivered and Company notified / not delivered, and the file shows how many reminders went out and when the next is due.
- Left for later: turning reminders off per file, and a cap on how many are sent.

## 2026-11-10 - The visitor's real address behind the host's proxy
- Closes the item recorded with login protection as "must fix when hosting": behind a proxy every request arrives from the proxy's address, so 20 failed logins from anyone would lock everyone out, and the signing audit trail (timeline and certificate) would record the proxy's address instead of the signer's.
- `ASTRA_TRUSTED_PROXIES` = how many proxies sit in front of the app (default 0). Each proxy appends the address it received the request from to `X-Forwarded-For`, so the visitor is the Nth entry from the right. Entries further left are written by the visitor and never used, so an address can't be faked by sending the header. With 0, or a missing, short or malformed header, the connection's own address is used.
- Chosen over trusting the leftmost entry (fakeable) and over the web server's proxy-header option (it trusts by the proxy's IP address, which hosts don't publish and can change).

## 2026-11-10 - Telling signers what is recorded
- The signing page now says, under the consent checkbox: "Your IP address, browser and signing time are recorded as part of the signing record." The checkbox points to it (`aria-describedby`), so screen readers announce it too.
- Why: IP addresses (and, with them, browser details) are personal data under GDPR, UK GDPR and CCPA. Recording them is normal for e-signatures (legitimate interest: evidence of who signed, when and from where), but the person must be told. This was the one missing piece; access (only the sending company and the signer's own copy) and deletion (with the account) were already in place.
- Not changed: what is recorded. IP and browser stay in the record as supporting evidence. They aren't proof alone (shared networks, mobile carriers and VPNs show a shared address; a browser can misreport itself); the evidence is the combination of the emailed link, consent, time, IP, browser and the document's SHA-256.

## 2026-11-10 - Hosting on Render with a persistent disk
- Full design: [docs/design/15-hosting.md](docs/design/15-hosting.md). Chosen by the product owner: Render Starter ($7/month, always on) with a 1 GB persistent disk ($0.25/month) for stored PDFs and signature images, instead of object storage for now. Free instances were ruled out: they sleep (slow first visit, late reminders) and can't have a disk.
- One Docker container serves the API and the built pages (`ASTRA_FRONTEND_DIR`), so the app has one address. Missing built files are 404s (a script never receives HTML), `/api` stays JSON, nothing outside the build folder is served, and script types are set explicitly because `nosniff` makes browsers refuse wrong ones (Windows maps `.js` to text/plain).
- Left for later: object storage (Cloudflare R2) to run more than one instance and avoid the few seconds of downtime per deploy; a non-root container user (Render mounts the disk for root).

## 2026-11-10 - The database password never appears in errors or logs
- Found on the first Render deploy: a `DATABASE_URL` pasted with quotes made the database driver log "invalid connection option" with the whole address, password included. The password was rotated.
- Now: surrounding spaces and quotes are removed from a `postgresql://` address (a dashboard keeps them; the key=value form is left alone since it can end in a quote); a malformed address stops the app with a message that names the problem but never the value (`raise ... from None`, so the parser's message isn't chained); and the driver's and pool's log lines show `***` instead of the password, both decoded and as written in the address (`%40` for `@`).

## 2026-11-10 - Logged in by the confirmation link; logged out after 10 idle minutes
- Full design: [docs/design/16-confirm-login-and-idle-logout.md](docs/design/16-confirm-login-and-idle-logout.md). Requested: the confirmation link logs the user in the first time, a used link only leads to the login page; inactive users are logged out after 10 minutes.
- The confirm page still asks for the password once (product owner chose this over one click, which would let someone who signed up with your address get you into their account); confirming then logs straight in. A used or expired link is detected before asking anything and goes to the login page with the reason.
- The 10-minute limit is enforced by the server (a session not used for 10 minutes is deleted) and by the browser (logs out and says why). Activity in any tab of the app counts, and while active the page tells the server about once a minute, so working without saving never times out.
- Left for later: a warning a minute before the logout (unsaved template changes are lost).

## 2026-11-10 - A failed password check is "try again", not "wrong password"
- Found while investigating 11 failing browser tests on a full disk: when checking a password itself failed (scrypt needs ~16 MB; with no memory to spare it raises), the app answered 401 "wrong email or password" and counted the attempt toward the 5-failure lock. That would also happen on a small server under memory pressure.
- Now only a damaged stored hash counts as "doesn't match"; a failure while checking withdraws that attempt from the lock count, is logged, and answers 503 "Couldn't check the password right now. Try again in a moment." (login and the confirm page).

## 2026-11-10 - Filling a new file from an earlier client
- Full design: [docs/design/17-earlier-clients.md](docs/design/17-earlier-clients.md). Requested: when the same client gets another agreement, don't retype the client name, signer name and email; list every match (no limit).
- Typing in Client name on a new file lists the company's earlier client + signer + email combinations (newest first, each once, drafts included) matching the client or signer name; picking one fills only those three fields. Built from the files the page already loads: no new table or server code, and only the company's own clients appear.
- Not filled: the file name (a new job gets its own name), the agreement and the message. Not offered when editing a draft. A Clients page (address book) is a possible later step.

## 2026-11-11 - The company signs too; page box; send check; refresh, go-to and live updates
- Full design: [docs/design/18-company-signing-and-workspace-updates.md](docs/design/18-company-signing-and-workspace-updates.md). Six requests from the product owner.
- The company signs on the template: tick, dot, name, date, initials and its own signature ("You sign" in the editor), printed onto the document when the file is sent, like company text. Initials and signature are adopted once with the client's pad and stored as a checked PNG on the item. The date is the send date on the sender's calendar. A new type `company_signature` keeps `signature` meaning the client's box. Assumption: one countersignature per template; signing per file is a possible later step.
- Page box ("Page [n] of N", Enter) in the editor and on the signing page. "Create and send" and "Send for signature" show every detail in a last-check dialog first. The open tab is kept in the address (`/files`), so a refresh stays there. "Go to signature" cycles through every box, top to bottom. The Files page reloads the list and timeline every 5 seconds while shown (polling, not server push: no new infrastructure).

## 2026-11-11 - Renaming agreements; clearer editor labels
- Requested: rename an agreement; a taken name gets " (1)", " (2)" beside it; "Add signature box" becomes "Add signature box for client"; the "You sign" label goes (the company's tools stay).
- `PATCH /api/agreements/{id}` `{name}`: trimmed, 1-200 characters, this company only; a name taken by another of the company's agreements (case ignored) is numbered with the same rule as uploads; keeping its own name (even in other capitals) adds no number. It changes neither the boxes nor the version, so unsaved box edits in the editor can still be saved. Files already sent keep the name they were sent with.
- Editor: a pencil beside the agreement's name; Enter or clicking away saves, Escape cancels.

## 2026-11-11 - "Opened by signer" for every link, not just the first
- Reported: after **Reissue link**, opening the new link added nothing to the timeline. Only the file's first open was recorded (the 2026-11-09 rule "Only the first open counts"), and a reissue leaves the file Viewed.
- Now the first open of **each issued link** is recorded, with time and IP: the original, each reissued link, and each reminder's link. Reloads of a link already opened add nothing, and the file's status and first-viewed time are unchanged. This replaces the earlier rule.
- Tracked per link, not guessed from the timeline: `files.link_opened_at` for the current link (cleared by a reissue) and `signing_links.opened_at` for reminder links (migration 0009). A first draft compared the latest events instead; the code review showed it miscounted an old link reopened after a reminder and raced with reminder emails, so it was replaced. Links already opened before this deploy count as opened.
- The certificate now says "Opened by signer", like the timeline, instead of "Viewed".

## 2026-11-11 - Reminders stop after seven; signing page and signature layout fixes
- Reminders: at most 7 per emailed link, one a day, so they stop 7 days after the email (design 19). Emailing a reissued link starts a new 7. Counted in reminders rather than days so the 2-minute demo setting also stops after 7. Files already being reminded get what is left of their 7 (migration 0010). Replaces "every 24 hours until signed" from design 14.
- Signing page: the page box and the signer's tools are one sticky bar, so the page box no longer covers Text, Name and Date; the page number follows scrolling.
- Editor: a long typed name shrinks to fit the signature preview instead of being cut off; the adopt panel's buttons wrap inside the narrow panel.

## 2026-11-11 - Staff type the name they sign with; signer tools on one line; wider browser tests
- The company's signature and initials panel has a "Your full name" box, starting with the sign-up name; the typed signature and initials are made from it (design 19, follow-up). It is not saved to the account: it only shapes the adopted image.
- Signing page: the tools take the whole top row of the bar so Signature sits beside Initials; the page box moved to the hint line.

## 2026-11-11 - Let the free database sleep between reminder checks
- The reminder loop queried every 30 seconds and the pool held a connection open, so the free Neon database never slept (about 6 compute hours a day; the free plan has 100 a month). Now it checks at most every 15 minutes, keeps no idle connection (unused ones close within about 2 minutes) and checks each connection before use (design 19). A full batch of 20 is followed at once by another check, and the first check is 30 seconds after a start or deploy. Reminders may be up to 15 minutes late, which doesn't matter for daily reminders; the 2-minute demo setting is unchanged.
- Code review (8 findings): fixed 4, each with a test that failed first except where noted. Idle connections could live 4 to 8 minutes, because the pool shrinks on a fixed tick, one connection per tick; now `max_idle=60`. A full batch now triggers another check at once. The first check now comes 30 s after start instead of a whole interval. Connections are checked before use (that test already passed: the pool coped, but the check is kept as a safeguard). Left: whether Neon's connection pooler keeps the database awake by itself can only be seen on the live app (Neon's Branches page should show Idle between checks).
