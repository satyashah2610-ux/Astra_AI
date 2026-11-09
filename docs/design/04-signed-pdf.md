# Design 04: Signed PDF and certificate

Status: implemented.

## Problem

After signing, the app holds the signature image and an audit trail, but there is no signed document anyone can keep. The client's outcome is a signed agreement on every file, so the product must produce one PDF that shows the signature in every box and carries its own evidence.

## High-level design

```
frozen snapshot PDF ─┐
signature PNG ───────┼─► build_signed_pdf ──► signed/<file id>.pdf ──► staff download  GET /api/files/{id}/signed.pdf
signature boxes ─────┤      (pure function)        (written once)  └─► signer download GET /api/signing/signed.pdf
evidence + timeline ─┘
```

1. **Stamp.** Each box is filled with the signature image on the matching page of the *frozen snapshot*, never the editable template.
2. **Certificate of completion.** One page is appended: document name and SHA-256 of the sent PDF, signer name and email, signing method, consent wording, IP address and browser, and the full timeline (created, sent, reissued, viewed, signed) in UTC.
3. **Generated once, kept.** The PDF is built right after the signature is committed and stored. Downloads return the same bytes every time. If building fails (an unusual PDF), the signature is still recorded and the build is retried on the next download, so a PDF problem never loses a signature.

### Decisions and trade-offs

| Decision | Chosen | Rejected | Why |
|---|---|---|---|
| When to build | Right after the signing commit, retried lazily on download | Inside the signing transaction | A rendering problem with an unseen PDF must not block or undo a signature. |
| Regenerate? | Never once written | Rebuild per download | The certificate has a generation time; the signed file must be byte-stable. |
| Stamping method | reportlab overlay merged with pypdf | Rasterize pages | Keeps the original text, vectors and links; files stay small. Both libraries are already installed. |
| Coordinates | Map from the displayed page (crop box + `/Rotate`) | Assume an unrotated media box | Boxes were placed on PDF.js's displayed page, which applies the crop box and rotation. Rotated scans must still be stamped in the right place, upright. |
| Certificate text | reportlab Platypus with escaped text | Raw string drawing | Wraps long browser strings; names containing `<` or `&` can't break the layout. |
| Signer download | Header-authenticated fetch, saved as a file | Link with token in URL | Keeps the secret out of URLs and logs, as with the rest of the signing API. |
| Integrity | SHA-256 of the sent PDF printed on the certificate | Digital certificate signing (PKI) | Proves which document was signed without buying a signing certificate. PKI signing can be added later. |

Known limitation: the certificate uses Helvetica, so names in non-Latin scripts may not render on the certificate page (the stamped signature image is unaffected). A Unicode font can be bundled later.

## Low-level design

### Coordinate mapping (`app/signed_pdf.py: display_box_to_user`)

Boxes are fractions of the displayed page with a top-left origin. With crop box `(llx, lly, urx, ury)`, `w = urx - llx`, `h = ury - lly`, and rotation `r` (clockwise, normalized to 0/90/180/270):

| r | Displayed size | Displayed point (u, v) → user space (x, y) |
|---|---|---|
| 0 | w × h | (llx + u·w, ury − v·h) |
| 90 | h × w | (llx + v·w, lly + u·h) |
| 180 | w × h | (urx − u·w, lly + v·h) |
| 270 | h × w | (urx − v·w, ury − u·h) |

The image is drawn at the user-space point of the box's displayed bottom-left corner, in a frame rotated counter-clockwise by `r`, with the box's displayed width and height in points. It appears upright once the viewer applies `/Rotate`.

### Modules

| Module | Responsibility |
|---|---|
| `app/signed_pdf.py` | Pure: `display_box_to_user`, `build_signed_pdf(original, marks, signature_png, certificate) -> bytes`. |
| `app/signed_documents.py` | `ensure_signed_pdf(storage, file_id) -> Path`: gathers snapshot, signature, evidence and events; builds once under a lock; writes atomically. |
| `app/signing.py` | After a successful signature, builds the PDF (failures logged); `GET /api/signing/signed.pdf`. |
| `app/files.py` | `GET /api/files/{id}/signed.pdf`. |
| `frontend/src/signing.ts` | `downloadSigned()`: header-authenticated fetch returning a Blob. |
| `frontend/src/SigningPage.tsx` | "Download signed copy" on the signed screen. |

### API

| Method & path | Success | Errors |
|---|---|---|
| `GET /api/files/{id}/signed.pdf` | 200 PDF, `attachment; filename="<document> - signed.pdf"` | 404 unknown or not signed |
| `GET /api/signing/signed.pdf` (`X-Signing-Token`) | same | 404 bad link or not signed |

## Test plan (written before the code)

**Unit (`test_signed_pdf.py`):** coordinate mapping for 0/90/180/270 and an offset crop box; the stamped image's real position (read back from the PDF content stream) lies inside the expected rectangle on normal and rotated pages; pages without boxes get no image; original page text survives; a certificate page is appended with signer, email, document hash, consent wording, method, IP, browser and every timeline event; names with `<b>&` are printed literally; PDF metadata names Astra Sign.

**Integration (`test_signed_documents.py`):** both downloads return 404 before signing; after signing both return the same PDF with one extra page; repeated downloads are byte-identical; a build failure during signing still records the signature and the next download builds it; a deleted template doesn't matter; survives restart; bad links get 404.

**Frontend:** the signed screen offers "Download signed copy" (also when reopening a signed link); clicking it fetches with the header, never the URL, and saves a file; a failed download shows an error.

**Browser:** after signing, the download button delivers a real PDF; staff can download the same document.
