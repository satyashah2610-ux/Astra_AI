# Design 03: Signing page

Status: implemented. The signed PDF with the signature stamped in is step 4.

## Problem

A sent file has a secret link, but nothing happens when a signer opens it. The signer (the client) must be able to open the link with no account, read the exact document they are asked to sign, see where they sign, adopt a signature and submit it. Staff must later be able to prove who signed what and when.

## High-level design

```
Signer's browser                         Backend                              Storage
────────────────                         ───────                              ───────
/sign#<token> (React page)
  GET  /api/signing      ──token hdr──►  find file by sha256(token) ──────►  files
  POST /api/signing/view ──────────────► sent → viewed + event      ──────►  file_events
  GET  /api/signing/pdf  ──────────────► frozen snapshot PDF        ◄──────  documents/<id>.pdf
  POST /api/signing/sign ──────────────► validate PNG + consent
                                          sent/viewed → signed      ──────►  signatures, signatures/<id>.png,
                                                                              file_events
```

- **Public, token-only access.** The link's secret is the signer's only credential. No login.
- **The token travels in a header (`X-Signing-Token`), not the API path.** Server access logs record request paths, so a token in `/api/signing/<token>` would be written to every log. The browser page URL still contains it (that is the link), but API traffic does not. The page sets `Referrer-Policy: no-referrer` so the URL is never sent to other sites.
- **One adopted signature.** The signer types their name (rendered in a handwriting font) or draws with mouse, finger or stylus. The same image goes in every signature box. This is how mainstream e-signature tools behave and is fastest for the signer. The browser always sends a PNG, so step 4 stamps one format.
- **Explicit consent.** The server owns the consent wording, returns it to the page, requires `consent: true`, and stores the exact text that was shown. That evidence matters if the signature is ever disputed.
- **Audit trail.** A `file_events` log records created, sent, link reissued, viewed and signed, with time, and for signer actions the IP address and browser. Step 4 prints it on the signed PDF's certificate page.

### Decisions and trade-offs

| Decision | Chosen | Rejected | Why |
|---|---|---|---|
| Token location in API | `X-Signing-Token` header | Token in path | Keeps secrets out of access logs and proxies. |
| Recording a view | Separate `POST /view` | Side effect on `GET` | `GET` stays safe and repeatable; link previews and prefetchers don't mark files viewed. |
| Signature input | Typed or drawn, sent as PNG | Typed text rendered by the server | One format to validate and stamp; what the signer previewed is exactly what gets stamped. |
| Signature per box | One adopted signature for all boxes | Sign each box | Fewer steps for the signer; boxes are already placed by staff. |
| Image validation | Size ≤ 512 KB, real PNG decoded by Pillow, sane dimensions | Trust the browser | The endpoint is public. Pillow is already installed through reportlab. |
| Invalid or revoked link | 404 with one generic message | Distinct messages | Doesn't reveal whether a link ever existed. |
| Double submit | `BEGIN IMMEDIATE` + state machine check | — | Two clicks or two tabs give exactly one signature. |
| Rate limiting | Not added | Per-IP limiter | 256-bit tokens can't be guessed; add with hosting (step 6) if needed. |
| Client IP | `request.client.host` | `X-Forwarded-For` | Trusting forwarded headers is only safe behind a known proxy; configure that when deploying. |

## Low-level design

### New tables

`file_events`: `id INTEGER PK AUTOINCREMENT, file_id TEXT, type TEXT CHECK (created|sent|link_reissued|viewed|signed), at TEXT, ip TEXT, user_agent TEXT`. Index on `file_id`. Deleted with its file.

`signatures`: `file_id TEXT PK, method TEXT CHECK (typed|drawn), name TEXT, image_sha256 TEXT, consent_text TEXT, signed_at TEXT, ip TEXT, user_agent TEXT`. The image is stored at `data/signatures/<file id>.png`.

New tables are created with `CREATE TABLE IF NOT EXISTS`, so existing databases upgrade on start-up without migrating `files`.

### Modules

| Module | Responsibility |
|---|---|
| `app/signatures.py` | `decode_signature_png(data_url) -> bytes`: strict base64, size, PNG signature, Pillow decode, dimensions. Pure, unit-tested. |
| `app/events.py` | `record_event(db, file_id, type, request=None)` and `list_events(db, file_id)`. |
| `app/signing.py` | `/api/signing` router. Resolves the token header to a file; view, PDF and sign endpoints. |
| `app/files.py` | Records created / sent / link_reissued events; new `GET /api/files/{id}/events`; deletes events with the file. |
| `app/models.py` | `SignSubmission`: name, method, image (≤ 700,000 chars), `consent: Literal[True]`. |

### API (signer)

All requests carry `X-Signing-Token`. A missing, unknown or revoked token gives 404 `"This signing link is invalid or has been replaced. Ask the sender for a new link."`

| Method & path | Body | Success | Errors |
|---|---|---|---|
| `GET /api/signing` | — | `{document_name, signer_name, page_count, marks, status, sent_at, signed_at, consent_text}` | 404 |
| `POST /api/signing/view` | — | same view; sent → viewed once, later calls change nothing | 404 |
| `GET /api/signing/pdf` | — | frozen snapshot PDF | 404 |
| `POST /api/signing/sign` | `{name, method, image, consent: true}` | view with `status: signed` | 404, 409 already signed, 422 invalid image / no consent |

Signer responses never include the signer's email, the internal file title, or other files' data.

### API (staff)

`GET /api/files/{id}/events` → events oldest first: `{type, at, ip, user_agent}`.

### Frontend

| Unit | Responsibility |
|---|---|
| `main.tsx` / `Root.tsx` | Renders `SigningPage` for `/sign#<token>`, otherwise the staff `App`. |
| `signing.ts` | `tokenFromPath(path)`; API client that adds the header. Pure / unit-tested. |
| `strokes.ts` | Drawing-pad maths: `hasInk(strokes)` (enough movement to count as a signature). Unit-tested. |
| `PdfPages.tsx` | Read-only viewer: all pages stacked, signature boxes highlighted. Loads the PDF with the token header. |
| `SignaturePad.tsx` | Type / Draw tabs; produces a PNG data URL, or `null` until there is a usable signature. |
| `SigningPage.tsx` | Loading, invalid link, already signed, sign form (name, signature, consent), submit, success. |

## Test plan (written before the code)

**Backend unit:** PNG decoding accepts a real PNG; rejects a wrong prefix, bad base64, non-PNG bytes, PNG header with corrupt body, oversize data, and tiny or huge dimensions. `SignSubmission` requires `consent: true`, a valid method, a non-empty name, and no unknown fields.

**Backend integration (`test_signing.py`):** missing, unknown and revoked tokens give 404; the view never leaks email or title; `/view` moves sent → viewed exactly once and records one event; the PDF is the frozen snapshot; signing stores the signature, PNG file, consent text, IP and browser, and sets `signed_at`; signing straight from `sent` works; a second sign gives 409; simultaneous signs give exactly one success; draft files have no usable link; invalid images and missing consent change nothing; the staff events timeline lists created → sent → viewed → signed; deleting an unsigned file removes its events; everything survives a restart.

**Frontend unit:** `tokenFromLocation` accepts only `/sign#<token>`; `hasInk` rejects taps and accepts real strokes; the API client sends the header and surfaces server errors.

**Frontend integration (`SigningPage.test.tsx`):** invalid link message; marks as viewed on load; sign button disabled until there is a signature, a name and consent; successful submission shows the confirmation; an already-signed file shows the signed state with no form; server errors keep the form.

**Browser (Playwright):** staff prepares and sends a file through the API; the signer opens the link, sees the document and boxes, types a signature, consents and signs; the file is `signed` and the timeline is complete. A second test draws a signature on a phone-sized screen.
