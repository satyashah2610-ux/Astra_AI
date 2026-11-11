# Design 17: Filling a new file from an earlier client

Status: implemented.

## Requested

When the same client gets another agreement, staff shouldn't retype the client name, signer name and signer email. All matches are listed (no limit).

## Design

Typing in **Client name** on a new file lists the company's earlier clients whose client or signer name contains the text (case ignored). Each line is one client + signer + email, newest first, each combination once (email case ignored), drafts included. Picking one fills those three fields; the file name, agreement and message stay as they are. Every filled field can still be changed.

| Decision | Chosen | Why |
|---|---|---|
| Source | The company's own files, already loaded on the Files page | No new table, server code or upkeep; only that company's clients can appear. A Clients page (address book) is a possible later step. |
| Fields filled | Client name, signer name, signer email | A new job needs its own name; the agreement and message are usually different. |
| Limit | None; the list scrolls | Requested by the product owner. |
| Where | New file only, not editing a draft | Editing changes one file; there the list would only get in the way. |
| Keyboard and screen readers | ARIA combobox: arrows move, Enter picks (never sends the file), Escape closes | Same rules as the account menu. |

## Tests (written first)

Unit: each combination once, newest first, drafts included, new email is its own line; matching client or signer name ignoring case; no limit. Page: typing lists every earlier signer and a pick fills only the three fields; keyboard and Enter never sending; filled fields editable and no list for a new client; no list when editing. Browser: a pick fills the three fields in a real browser.
