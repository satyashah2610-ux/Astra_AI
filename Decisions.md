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

## 2026-11-09 - Development and verification record
- RED: backend API contract suite run against an unimplemented factory: 1 failed, 23 setup errors, all due to the explicit implementation stub.
- RED: five geometry tests run against throwing stubs: 5 failed. Added five React workflow tests and ran both suites against UI stubs: 10 failed.
- GREEN: implemented persistence, validation, upload/download/sample endpoints, geometry, and React workflow. Backend contract tests: 24 passed; frontend tests: 10 passed.
- Added 9 focused backend model/PDF validation tests for nonfinite values, strict page numbers, edge coordinates, duplicate IDs, and page-count limits: backend total 33 passed.
- Browser integration initially found that the test's resize pointer targeted a handle below the scroll viewport. Updated the test to scroll the actual handle into view before dragging; did not relax the resize assertion.
- Final browser run: 3 passed, covering real PDF upload/rendering, draw/move/resize, explicit save, reload restoration, zoom alignment, removal persistence, multi-page fields, keyboard movement, unsaved guard, sample loading, invalid-file errors, and a 390px mobile viewport. Browser tests run in an isolated temporary storage directory.
- Final total: 46 passing tests (33 Python + 10 frontend + 3 browser). TypeScript check and Vite production build passed. Inspected desktop/mobile browser screenshots and both sample PDF pages rendered with Poppler.
- Python package versions are recorded in `backend/requirements.lock.txt`; frontend versions are recorded in `frontend/package-lock.json`. Use the lockfiles for reproducible setup. Pin jsdom to the Node-compatible 26.x line.
- Current nonblocking tool notices: Starlette warns that its httpx TestClient compatibility is deprecated; Vite reports the large PDF renderer bundle. Both are recorded for a future dependency/performance pass, rather than suppressing them.
- Local servers bind only to 127.0.0.1. A production release still needs authentication, organization isolation, durable shared storage, deployment configuration, and the customer signing workflow.
- The embedded preview browser host was unavailable; verification used the successful real Chrome test suite and its screenshots. The local app URL was separately checked for HTTP 200.

## 2026-11-09 - One signature-box interaction
- User requested a single tool for adding and moving boxes. Removed the separate selection arrow and draw mode; dragging empty PDF space creates a box, dragging an existing box moves it, and dragging its corner resizes it.
- Keep one `Add signature box` toolbar button for inserting a default-sized box, including keyboard access. Remove the duplicate sidebar add control. No mode toggle is required before or after any gesture.
- Clicking empty space only deselects the field; tiny drags still create no box. Field and resize pointer events stop propagation so moving/resizing cannot also create a box.
- Updated on-screen instructions and README. Test-first regression: removed the mode-toggle click from the browser workflow and observed failure (expected one box, found zero) before changing implementation.
- Browser coverage now also checks consecutive drawing without toggling, one add control, removal of the old toolbar tools, selection/deselection, and moving without creating an extra box.
- GREEN: all 10 frontend unit/integration tests and 4 real-browser tests pass after the change. TypeScript checking and production build pass; the existing PDF bundle-size warning remains.

## 2026-11-09 - Delete agreements and rename to DocuSign
- User requested deletion of uploaded agreements and the displayed name DocuSign. Updated the header, footer, workspace initial, browser title, API title, package name, and README. Keep the current data directory and `ASTRA_DATA_DIR` environment variable compatible so existing documents remain available.
- Put Delete agreement beside Save template for the selected document. Confirm the named agreement before permanent deletion, including its original PDF, saved fields, and unsaved edits. Cancel and failed requests preserve local work; successful deletion selects the next agreement or the empty upload screen.
- Add DELETE `/api/agreements/{id}` returning 204. SQLite serializes deletion against saves; a filesystem deletion error rolls back the record removal and returns a retryable error. A missing PDF does not prevent deleting the record. Unknown IDs return 404.
- This local implementation coordinates ordinary file errors with a database transaction; SQLite and filesystem changes are not a distributed transaction across abrupt process/disk failures. A production storage lifecycle should handle crash recovery and retention policies.
- Test-first: five backend deletion tests failed with 405 before implementation; three new UI workflow tests failed before the delete control/branding existed. Cover PDF removal, marks removal, restart persistence, preserving other agreements, missing files, filesystem failures, cancellation, last-item deletion, selection of the next agreement, and retry.
- Verification: 38 backend tests, 13 frontend tests, and 5 real-Chrome tests pass (56 total). TypeScript check and production build pass. Reviewed deletion confirmation and mobile screenshots; restarted the local backend and verified the live DELETE route is exposed. Only isolated test documents were deleted during verification.

## 2026-11-09 - Number duplicate agreement names
- User requested `(1)`, `(2)`, etc. for uploads with matching names. Allocate the first available display name on the backend: Agreement, Agreement (1), Agreement (2). Compare case-insensitively; reuse available gaps after deletions. A filename already ending in `(1)` is treated literally, so another copy can be named Agreement (1) (1).
- Store the unique display name in SQLite so the library and editor agree after reload. Preserve original filenames, PDF bytes, IDs, and saved signature fields. Reserve suffix space within the existing 200-character display-name limit.
- Hold a SQLite write lock across name allocation and insertion, preventing simultaneous uploads from selecting the same suffix. Add a case-insensitive unique index as a database constraint.
- Repair pre-existing duplicate names on startup in oldest-first order. Reserve all current names before allocating suffixes to avoid taking an existing numbered name. The operation is idempotent and changes only duplicate display names.
- TDD: all 10 new naming unit/integration tests failed before implementation. Coverage includes suffix numbering, gaps, capitalization, numbered originals, long names, restart persistence, concurrent uploads, and migration without losing documents/markings. Added a browser check for duplicate names in both the library and editor after reload.
- Verification: all 48 backend tests and 6 real-browser tests pass; TypeScript check and production build pass. Restarted the local backend to apply legacy-name repair and verified that the live agreement list contains no duplicate display names.

## 2026-11-09 - Rename to Astra Sign
- "DocuSign" is a registered trademark of an existing e-signature company. The client plans to sell this product to their whole industry, so a product named after a competitor is a legal and commercial risk. Renamed the product to **Astra Sign**, tying it to the first customer while staying neutral for later customers.
- Changed: API title, logger name, browser title, header brand, footer, npm package name, README heading. Unchanged on purpose: `ASTRA_DATA_DIR` and the data directory, so existing agreements stay available. Earlier Decisions entries are kept as history.
- TDD: added `backend/tests/test_branding.py` (OpenAPI title is "Astra Sign" and no schema text mentions DocuSign). Updated the React and Playwright branding assertions first. RED: the backend test failed with `'DocuSign Agreements' == 'Astra Sign'`; the React test failed for the missing brand link.
- GREEN: 49 backend tests and 13 frontend tests pass; production build passes. The Playwright suite could not load pages from the agent's sandboxed shell (navigation timeout on every test, including unchanged ones), so the developer ran it locally. The first run failed 2 tests: changing the package name in package-lock.json invalidated the Vite dependency cache, Vite rebuilt it mid-run, and a reload interrupted the PDF.js worker download. The rerun passed 6 of 6 with no code changes. Lockfile changes therefore need a warm-up dev-server start before browser tests.

## 2026-11-09 - Files and signing links (backend)
- Full design: [docs/design/02-files-and-signing-links.md](docs/design/02-files-and-signing-links.md) (HLD, state machine, table, API, test plan).
- A **file** is the client's unit of work: one job or case, one client, one signer, one agreement. Status follows a state machine (draft → sent → viewed → signed) in `app/lifecycle.py`; every other transition is rejected.
- Sending snapshots the agreement PDF (`data/documents/<file id>.pdf`), its signature boxes, name, page count and SHA-256. A signed contract must match exactly what was sent, even if the template is edited or deleted later.
- Signing links use 256-bit `secrets.token_urlsafe` tokens. Only the SHA-256 hash is stored, so a database copy cannot be used to sign. Trade-off: staff cannot re-display an old link; **Reissue link** creates a new one and revokes the old. The API returns a path (`/sign/<token>`) so the backend does not need to know its public host.
- Delivery is copy-the-link for now: it works with any mail setup and needs no email provider for the test. Signer emails get a simple shape check rather than a new dependency.
- Only drafts can be edited (optimistic `version` check). Signed files cannot be deleted. An agreement used by draft files cannot be deleted (409); sent files are unaffected because they have their own copy.
- Refactor: moved the data directory, SQLite connection and schema into `app/storage.py` so agreements and files share one storage layer. The files API is a separate router (`app/files.py`).
- TDD: wrote 3 unit-test modules (tokens, lifecycle, models) and 22 integration tests first. With interface stubs: 60 failed, 2 passed (the fixed status names, and 404 for unknown files, which is also the default for missing routes). A further 12 errors in an earlier run were caused by a full C: drive, not the code; they disappeared after space was freed.
- GREEN: 111 backend tests pass. The simultaneous-send test passed 15 of 15 repeated runs. Upgrading a copy of the real local database added the `files` table and left all 3 existing agreements unchanged.

## 2026-11-09 - Signing page
- Full design: [docs/design/03-signing-page.md](docs/design/03-signing-page.md).
- Signers never log in: the link secret is their credential. The browser page is `/sign/<token>`, but API calls send the secret in an `X-Signing-Token` header, so it never appears in server access logs. The app sets `Referrer-Policy: no-referrer`. Every bad, revoked or draft link gets the same 404 message, revealing nothing about which links exist.
- Opening the page is recorded by a separate `POST /api/signing/view`, not as a side effect of `GET`, so link previews and prefetchers don't mark files as viewed. Only the first open counts.
- One adopted signature, typed (rendered in a handwriting font) or drawn (mouse, finger, stylus), fills every box, as in mainstream e-signature tools. The browser always sends a PNG, so what the signer previewed is exactly what step 4 stamps. The public endpoint re-validates the image: ≤ 512 KB, strict base64, real PNG fully decoded by Pillow (already installed through reportlab), sensible dimensions. Taps and tiny scribbles do not count as a drawn signature.
- The server owns the consent wording, returns it to the page, requires `consent: true`, and stores the exact text with the signature, plus name, method, image hash, time, IP and browser. A `file_events` table records created, sent, link reissued, viewed and signed for the step 4 certificate page; staff read it at `GET /api/files/{id}/events`.
- Signing uses `BEGIN IMMEDIATE` plus the state machine: double clicks or two tabs give exactly one signature. New tables use `CREATE TABLE IF NOT EXISTS`, so existing databases upgrade on start-up.
- Left out on purpose: per-IP rate limiting (256-bit tokens cannot be guessed; revisit when hosting) and trusting `X-Forwarded-For` (only safe behind a known proxy; configure at deployment).
- Frontend: `Root` routes `/sign/<token>` to `SigningPage`, everything else to the staff app. `PdfPages` shows every page stacked and draws each page only as it scrolls near view, which keeps long agreements fast. A shared `pdfjs.ts` now configures PDF.js for both the editor and the viewer.
- TDD: backend unit tests (signature image validation, submission model) and 20 integration tests in `test_signing.py`; with stubs, 42 failed and 5 passed (behaviour the stubs already had, kept as regression guards). Frontend unit tests (`tokenFromPath`, the header-only API client, stroke maths) and 7 React integration tests; with stubs, all 21 new tests failed while the 13 existing tests passed.
- GREEN: 158 backend tests and 34 frontend tests pass; the simultaneous-sign test passed 15 of 15 repeated runs. TypeScript check and production build pass. Added `e2e/signing.spec.ts` (typed signing on desktop, drawn signing on a 390px phone with no sideways scrolling, revoked/invalid links); run on the developer machine because the agent sandbox blocks the browser.
- Browser run on the developer machine: 8 of 9 passed. The phone drawing test failed because the document area was only a loading line until the PDF arrived; when the pages appeared above the signature panel (stacked layout on phones), the panel jumped about 1,000 px and the test's pen strokes landed on the PDF. A real signer starting early would see the same jump. Fix: `PdfPages` now reserves a full-size placeholder for every page from the known page count (and shows the signature boxes) before the PDF loads. Test-first: two new `PdfPages.test.tsx` tests failed, then passed; 36 frontend tests pass. The browser test is unchanged and acts as the regression check.

## 2026-11-09 - Code review of dev
- Reviewed the whole `dev` branch. 8 findings: 6 fixed, 2 deferred.
- Fixed bugs, each with a regression test shown to fail without the fix:
  - `create_file` checked the agreement before taking the write lock, so a simultaneous agreement deletion could leave an orphan draft (got 201, expected 422). Now `BEGIN IMMEDIATE` comes first. Test: `test_write_races.py`.
  - `save_marks` had the same gap: saving to an agreement deleted mid-request said "changed in another tab" (409) instead of "not found" (404). Test: `test_write_races.py`.
  - Typed signatures: while a changed name was still rendering, the previous name's image stayed ready to submit, so "Jane Doe" could be stored with an image of "Jane Do". The pad now withdraws the old image immediately. Test: `SignaturePad.test.tsx`.
- Cleanups: `main.py` uses `Storage.template_pdf` and `utc_now` instead of rebuilding paths and timestamps; one shared `boxStyle` in `geometry.ts` replaces two copies; removed the unused `EVENT_TYPES` list (the database CHECK constraint is the real list).
- Deferred: a `database(write=True)` helper so write transactions can't be forgotten (the two concrete races are fixed directly; revisit before adding more write endpoints), and sharing the page-render pipeline between `PdfEditor` and `PdfPages` (a refactor with no behaviour change).
- Verification: 160 backend tests and 39 frontend tests pass; production build passes.

## 2026-11-09 - Keyboard focus for signature boxes; simpler field panel
- Bug: arrow keys did nothing after clicking a box. The pointer handler calls `preventDefault()` (needed for dragging), which also blocks the browser's focus change, so the box looked selected but had no keyboard focus. Newly drawn or added boxes had the same problem. The browser test missed it because it called `field.focus()` instead of clicking.
- Fix: clicking, drawing or adding a box now gives it keyboard focus (without scrolling), so arrow keys move it and Shift + arrows resize it immediately.
- Removed Width and Height from the selected-field panel. Page-relative percentages mean nothing to staff and resizing is done by dragging; Field type and Page remain.
- TDD: new `PdfEditor.test.tsx` (fake PDF.js, plus a small PointerEvent shim because jsdom lacks one). All 3 tests failed without the fix and pass with it; 42 frontend tests pass, type check and build pass. The browser test now clicks the box like a user and checks focus after adding and after clicking. (Its first run failed only because `getByText('Width')` also matched the zoom menu's "Fit width"; the check now uses an exact match.)
