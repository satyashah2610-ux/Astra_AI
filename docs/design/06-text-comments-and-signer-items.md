# Design 06: Company text and comments, signer-placed items

Status: implemented.

## Problem

Agreements are fixed PDFs made elsewhere (Word, another firm's template). They have no form fields, but they still ask the client to tick boxes, choose options, write their name, date or initial clauses. Staff also need to add a line of text to the PDF or leave the client an instruction. Signature boxes alone can't cover "any agreement".

## Decisions taken with the client (product owner)

1. **The client places their own items** anywhere on any page: Signature, Initials, Name, Date signed, Text, Tick (✓) and Dot (●). The company's signature boxes must still be signed.
2. **Company comment** = a note pinned to a spot, shown to the client while signing, **not printed** on the signed PDF.
3. **Company text** is added on the **template**, so it goes out on every file using that agreement. Per-file company text comes later.

## High-level design

```
Template editor (staff)                 Send                               Signing page (client)              Signed PDF
───────────────────────                 ────                               ─────────────────────              ──────────
signature boxes  ─────────────────────► kept as boxes ───────────────────► must be signed ──────────────────► signature image
text             ─────────────────────► PRINTED into the frozen PDF ─────► part of the document they read ──► (already in the PDF)
comments         ─────────────────────► kept as notes ───────────────────► shown as pinned notes ───────────► not printed
                                                                           client places ✓ ● text name ─────► stamped + listed on
                                                                           date initials signature            the certificate
```

- **Company text is burned into the frozen copy at send time.** The client reads exactly what will be signed, and the document's SHA-256 on the certificate covers the company text too.
- **Client items are stamped with the signature** using the same displayed-page coordinate mapping as design 04 (crop box and rotation), so they land where the client put them, upright.
- **The server fills Name and Date.** Name uses the full name the client signs with; Date is the signing date in the client's time zone (offset sent by the browser, limited to ±14 h). The client can't type a different date into a "Date signed" item, which keeps it trustworthy evidence.
- **Initials are adopted once**, like the signature (typed from the name, e.g. "JS", or drawn), and only asked for when an initials item is placed.
- **Validation lives on the server:** item types, page numbers, positions inside the page, sizes, text length, at most 200 items, unique ids. Text that will be printed must use characters the PDF font can draw.

### Decisions and trade-offs

| Decision | Chosen | Rejected | Why |
|---|---|---|---|
| Who places client items | The client, anywhere | Only company-defined fields | Agreements made elsewhere rarely have fields; the client knows which option they are choosing. Company-placed required fields can be added later. |
| Company text | Printed into the snapshot at send | Overlaid at signing | What the client reads is exactly what is hashed and signed. |
| Comments | Shown, not printed | Printed | Instructions ("tick your plan here") aren't contract terms. |
| Date field | Filled by the server at signing | Typed by the client | A signing date the signer could edit would be weak evidence. |
| Tick and dot | Free marks, no grouping | Radio groups with one-choice rules | With client placement there is no predefined group; the client marks the option printed on the page. Company-defined radio groups can come later. |
| Characters in printed text | Western European (Windows-1252) only; others rejected with a clear message | Bundle a Unicode font now | The built-in PDF font prints other scripts as ■ boxes; refusing is better than a broken signed document. A Unicode font is a later improvement. |
| Drawing on the signing page | Pick a tool, tap the page; drag to move; corner to resize; × to remove | Drag-and-drop from a palette | Works the same with mouse, finger and stylus. |

## Low-level design

### Template marks (`agreements.marks`, `files.marks`)
`{id, page, x, y, width, height, type: "signature" | "text" | "comment", text?}`. A missing `type` means `"signature"`, so existing templates keep working. `text` is required (1–1000 characters, trimmed) for text and comments and not allowed on signature boxes; printed text must be Windows-1252. Sending requires at least one signature box. After sending, `files.marks` keeps signature boxes and comments; text marks are already printed.

### Signer submission (`POST /api/signing/sign`)
Adds `items: [{id, type, page, x, y, width, height, text?}]` (types `signature, initials, name, date, text, check, dot`; `text` only for `text`, 1–500 characters, Windows-1252), `initials: {method, image}` (required when an initials item exists), and `utc_offset_minutes` (−840..840, default 0). Items on a page beyond the document are rejected. Stored in a new `signer_items` table (`file_id`, items JSON, initials method and hash, date text); the initials image goes in `signatures/<id>-initials.png`.

### Signer view (`GET /api/signing`)
`marks` now lists signature boxes only; a new `comments` list carries `{id, page, x, y, width, height, text}`.

### PDF (`app/signed_pdf.py`)
One stamping pass draws each item in its displayed frame: images (signature, initials), text (Helvetica, wrapped to the box, shrunk to fit, top-aligned), tick (stroked check path) and dot (filled circle), centred in the box. `print_text_marks(original, marks)` uses the same text drawing to produce the snapshot at send. The certificate gains a "Completed by the signer" table: page, item and value.

### Frontend
| Unit | Change |
|---|---|
| `PdfEditor.tsx` | **Add text** and **Add comment** next to **Add signature box**; text and notes rendered in place; the side panel edits the selected item's text. |
| `items.ts` | Pure helpers: default size per item type, `placeItem(type, point, pageAspect)`, `initialsFrom(name)`, `formatSigningDate(date)`, `isMarkSignature`. |
| `SignerLayer.tsx` | Per-page interactive layer on the signing page: place, select, move, resize, remove, edit text. |
| `PdfPages.tsx` | Shows comments; accepts a per-page overlay from the signing page. |
| `SigningPage.tsx` | Tool bar (Tick, Dot, Text, Name, Date, Initials, Signature), initials adoption when needed, submission with items. |

## Test plan (written before the code)

**Backend unit:** template mark rules per type; signer item rules (types, text only on text items, geometry, unique ids, ≤ 200, Windows-1252); every item type is stamped inside its box on normal and rotated pages (ticks and dots as vector paths, text extractable); company text printed into the snapshot and comments not printed; certificate lists items.

**Backend integration:** send prints text and changes the document hash; the signer view lists comments and only signature boxes; send needs a signature box (text or comment alone isn't enough); signing with items stores them; name and date come from the server, the date in the signer's time zone; initials required when initials items exist; items on missing pages, unsupported characters and oversize lists are rejected with nothing stored; the signed PDF contains the values; older templates without `type` still send and sign.

**Frontend unit:** item placement and clamping, square ticks and dots on any page shape, initials, date format.

**Frontend integration:** the editor adds and edits text and comments; the signing page places a tick with a tap, moves and removes it, types into a text item, shows comments, asks for initials only when needed, sends the expected items, and keeps Sign disabled until text items are filled.

**Browser:** staff add text and a comment; the client sees both, places a tick, a dot, text, name, date and initials, signs, and downloads the signed PDF.
