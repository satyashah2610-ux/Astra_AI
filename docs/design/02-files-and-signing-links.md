# Design 02: Files and signing links

Status: implemented (backend). The UI is covered by step 5.

## Problem

The client's unit of work is a **file**: one job or case for one client. The same agreement must be signed on every file before work starts. Today the app can only prepare agreement templates. Nothing connects a template to a client, and nothing can be sent.

This step adds the file record and a secure signing link. The signing page itself (step 3) and the signed PDF (step 4) build on it.

## High-level design

```
 Staff (company)                                      Signer (client)
 ───────────────                                      ───────────────
 Agreement template ──(chosen for)──► File ──(send)──► Signing link /sign/<token>
   PDF + signature boxes              client, signer,      (step 3: view + sign)
   (editable, reusable)               status, snapshot
```

- **Agreement** (exists): a reusable template, a PDF plus signature-box positions. Staff can keep editing it.
- **File** (new): one case. It records the client, the person who signs, which agreement they sign, and the status.
- **Send** freezes the file's document. The agreement PDF is copied into the file's own storage, and the signature boxes are copied into the file record. Later template edits or deletion never change what a client was asked to sign. This also gives the evidence trail a fixed document hash.
- **Signing link**: a random secret URL. Signers never log in (staff login comes later). Only a SHA-256 hash of the token is stored, so a leaked database copy cannot be used to sign.

### Status lifecycle (state machine)

```
draft ──send──► sent ──signer opens──► viewed ──signer signs──► signed
                  └──────────────signer signs─────────────────────┘
```

| Transition | Trigger | Step |
|---|---|---|
| draft → sent | Staff sends the file | 2 |
| sent → viewed | Signer opens the link | 3 |
| sent/viewed → signed | Signer submits | 3–4 |

Every other transition is rejected. Only drafts can be edited. Signed files cannot be deleted: they are the business record.

### Decisions and trade-offs

| Decision | Chosen | Rejected | Why |
|---|---|---|---|
| Document on send | Copy PDF + boxes (snapshot) | Reference the live template | A signed contract must match exactly what was sent, even if the template changes later. |
| Token storage | SHA-256 hash only | Raw token in DB | A database leak cannot be turned into signing access. Cost: staff cannot re-display an old link, so **Reissue link** creates a new one and revokes the old. |
| Token strength | `secrets.token_urlsafe(32)` (256 bits) | UUID4 (122 bits) | Unguessable. The link is the signer's only credential. |
| Link format | API returns a path `/sign/<token>` | Full URL | The backend does not need to know its public host; the UI adds its origin. |
| Delivery | Staff copy the link | Built-in email | Works with any mail setup and needs no email provider keys for the test. Email can come later. |
| Signer email check | Simple shape check | `email-validator` dependency | Enough to catch typos without adding a dependency; nothing is emailed yet. |
| Agreement deletion | Blocked while **draft** files use it | Cascade or orphan | Sent files have their own copy and are unaffected; drafts would otherwise break silently. |
| Concurrency | `BEGIN IMMEDIATE` + conditional `UPDATE ... WHERE status = ?` | Locks in Python | SQLite serializes writers, so two sends of one file cannot both succeed. |
| Edits | Optimistic `version` check | Last write wins | Matches the existing agreement editor and protects against stale tabs. |

## Low-level design

### Modules

| Module | Responsibility |
|---|---|
| `app/storage.py` | Data directory layout, SQLite connection, schema creation. Shared by every router. |
| `app/tokens.py` | `new_token()` and `hash_token(token)`. Pure functions. |
| `app/lifecycle.py` | `FileStatus` enum and `can_transition(current, target)`. Pure state machine. |
| `app/models.py` | `FileCreate`, `FileUpdate` request models (trimmed, length-limited, extra fields forbidden). |
| `app/files.py` | `/api/files` router. HTTP handling only; rules come from the modules above. |
| `app/main.py` | App factory. Wires storage and routers. Agreement deletion now checks draft files. |

### Table `files`

| Column | Type | Notes |
|---|---|---|
| id | TEXT PK | UUID4 |
| title | TEXT NOT NULL | File reference, e.g. "Smith — kitchen remodel" (1–200 chars) |
| client_name | TEXT NOT NULL | 1–200 chars |
| signer_name | TEXT NOT NULL | 1–200 chars |
| signer_email | TEXT NOT NULL | 3–254 chars, simple shape check |
| agreement_id | TEXT NOT NULL | Template chosen. Kept as history after the template is deleted |
| status | TEXT NOT NULL | `CHECK` in draft/sent/viewed/signed |
| document_name | TEXT | Snapshot of agreement name at send |
| document_sha256 | TEXT | Hash of the snapshot PDF |
| page_count | INTEGER | Snapshot |
| marks | TEXT | Snapshot JSON of signature boxes |
| token_hash | TEXT UNIQUE | NULL until sent |
| version | INTEGER | Optimistic lock, +1 on each change |
| created_at, updated_at, sent_at, viewed_at, signed_at | TEXT | ISO-8601 UTC |

Snapshot PDFs live in `<data>/documents/<file id>.pdf`. Index on `agreement_id` for the deletion check; index on `status` for the dashboard.

### API

| Method & path | Body | Success | Errors |
|---|---|---|---|
| `POST /api/files` | title, client_name, signer_name, signer_email, agreement_id | 201 file (draft) | 422 invalid fields or unknown agreement |
| `GET /api/files` | — | 200 list, newest first | — |
| `GET /api/files/{id}` | — | 200 file | 404 |
| `PATCH /api/files/{id}` | version + any editable field | 200 file | 404, 409 not draft / stale version, 422 |
| `DELETE /api/files/{id}` | — | 204 (also removes snapshot PDF and revokes link) | 404, 409 signed |
| `POST /api/files/{id}/send` | — | 200 `{file, signing_path}` | 404, 409 not draft / no signature boxes, 422 template missing |
| `POST /api/files/{id}/link` | — | 200 `{file, signing_path}` new token, old revoked | 404, 409 draft or signed |
| `GET /api/files/{id}/pdf` | — | 200 snapshot PDF | 404 draft (no snapshot yet) |
| `DELETE /api/agreements/{id}` | (existing) | 204 | **new:** 409 while draft files use it |

File responses never include the token or its hash. `field_count` is included for the dashboard.

## Test plan (written before the code)

**Unit tests**
- `test_tokens.py`: tokens are unique, URL-safe, at least 43 characters; hash is deterministic 64-char hex and differs from the token.
- `test_lifecycle.py`: every allowed transition is accepted; every other pair (including backwards and self-transitions) is rejected.
- `test_file_models.py`: whitespace is trimmed; empty, too-long, badly shaped email and unknown fields are rejected; an update must change at least one field.

**Integration tests** (`test_files.py`, real FastAPI app, temporary SQLite and files)
- Create, list, get; responses never expose token data.
- Unknown agreement and invalid fields are rejected with nothing stored.
- Draft edits, stale-version conflict, edits after sending rejected.
- Send: requires signature boxes; sets status and `sent_at`; returns a signing path; stores only the token hash; snapshot hash equals the agreement PDF hash.
- Snapshot independence: editing the template's boxes and deleting the template leave the sent file and its PDF unchanged.
- Sending twice, and two sends at the same moment, produce exactly one success.
- Reissue link: new path, old token hash gone; rejected for drafts.
- Agreement deletion blocked by draft files, allowed after the draft is removed or sent.
- File deletion removes the snapshot PDF; signed files cannot be deleted.
- Everything survives an app restart.
