# Design 18: The company signs too, and six workspace improvements

Status: implemented.

## Requested

1. The company gets the client's tools (tick, dot, name, date, initials, signature) so it can sign the contract too.
2. A page box on both the editor and the signing page: type a page number, press Enter, go there.
3. "Create and send" (and sending a draft) first shows every detail entered, as a last check.
4. A refresh stays on the page you were on (Files stays Files).
5. "Go to signature" visits every signature box in turn, top to bottom, then starts again.
6. A file's details and timeline update by themselves, without refreshing.

## 1. The company signs its side

The company's items live on the **agreement template**, next to the client's signature boxes, and are **printed onto the document when a file is sent**, the same way company text already is. The client sees them on the document they sign; the signed PDF contains both sides.

| Decision | Chosen | Why |
|---|---|---|
| Where the company signs | On the template, in the editor ("You sign" tools) | One place to prepare everything; a countersigned template is reused for every file. Signing per file is a possible later step. |
| Item types | `check`, `dot`, `name`, `date`, `initials`, `company_signature` (plus the existing `text`) | Same tools the client has. `company_signature` is separate from `signature`, which stays the client's box, so stored templates keep their meaning. |
| Initials and signature | Adopted once (typed or drawn, the client's pad), stored as a PNG on the item; later items reuse it; "Adopt a new …" swaps it everywhere | Same pad and the same image checks as the client's signature (`decode_signature_png`). |
| Name | Text, prefilled with the logged-in user's name, editable | The person whose signature is on the template. |
| Date | The send date, on the sender's calendar (`utc_offset_minutes` on send) | "Signed by the company on" = when it was sent. Same format as the client's date. |
| Ink | Black (company), as company text | The client's items stay dark blue. |
| What the file keeps | Only the client's boxes and comments; company items are part of the frozen PDF and its SHA-256 | The client can't move or remove them. |

## 2. Page box
`PageJump` ("Page [n] of N"): Enter goes to the page; numbers outside the document go to the first or last page. The editor shows that page; the signing page scrolls to it (sticky bar above the pages, multi-page documents only).

## 3. Last check before sending
`SendCheck` dialog: file name, client, signer, email, agreement, message, and whether the link is emailed (with daily reminders). **Go back and edit** keeps everything; **Confirm and send** sends. Used by "Create and send" and by "Send for signature" on a draft. "Save as draft" is not checked: nothing goes out.

## 4. Refresh keeps the page
The open tab is in the address (`/agreements`, `/files`, set with `replaceState`); the server already returns the app for any page address. The selected agreement or file is not kept (a possible later step).

## 5. Go to signature
Boxes sorted by page, then top, then left; each press goes to the next one and wraps to the first. "Box 2 of 4" shows where you are.

## 6. Live updates
While the Files tab is shown and the browser tab is visible, the list and the open file's timeline reload every 5 seconds (plus on focus, as before). Polling was chosen over server push: one small request pair, no new infrastructure, and the existing stale-answer guard already protects local edits.

## Tests (written first)
Backend: printing every company item; saving and refusing invalid items (text on a date, image on a tick, missing or broken image, unprintable name); a company-only template can't be sent; sending prints them dated in the sender's time zone; the signer sees only their box. Frontend: page box in both viewers; company tools and adoption; send check from both places; tab in the address; go-to loop; live updates. Browser: one end-to-end test of all six.
