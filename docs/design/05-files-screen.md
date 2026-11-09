# Design 05: Files screen

Status: implemented.

## Problem

Staff can prepare agreements in the app, but creating, sending and tracking files needs the API docs page. The client thinks in files ("every file must have the agreement signed"), so the second main tab must be where that work happens: create a file, send it, see where it stands, and collect the signed copy.

## High-level design

The **Clients** placeholder tab becomes **Files**. The app keeps exactly two tabs.

```
┌ Files tab ───────────────────────────────────────────────────────────────┐
│ [New file]                                                               │
│ ┌ list ───────────────┐  ┌ selected file ─────────────────────────────┐  │
│ │ search              │  │ title · status badge                       │  │
│ │ All Draft Sent ...  │  │ client · signer · email · agreement        │  │
│ │ ▸ Smith job  Signed │  │ actions (depend on status, see below)      │  │
│ │ ▸ Lee job    Sent   │  │ signing link + Copy (right after sending)  │  │
│ │                     │  │ timeline: created → sent → viewed → signed │  │
│ └─────────────────────┘  └────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────────────┘
```

| Status | Actions |
|---|---|
| Draft | **Send for signature**, Edit, Delete |
| Sent / Viewed | **Reissue link** (confirm: the old link stops working), Delete |
| Signed | **Download signed PDF**. No delete: it is the business record |

- **Create and send in one step.** The new-file form has **Create and send** (primary) and **Save as draft**. The common case, a new job that needs the standard agreement signed, takes one form and one click.
- **Signing link shown once.** The backend stores only a hash of each link's secret (design 02), so the full link is shown right after sending or reissuing, with **Copy link**. If it's lost, **Reissue link** makes a new one. The screen says this plainly.
- **Agreement choice.** Only agreements with at least one signature box can be sent; others appear in the list but can't be chosen, with a hint to add boxes first.
- **Freshness.** The signer works in another browser, so the list reloads when staff return to the window and with a **Refresh** button. No background polling.

### Decisions and trade-offs

| Decision | Chosen | Rejected | Why |
|---|---|---|---|
| Where files live in the UI | The second tab, replacing "Clients" | A separate clients directory | The brief's unit is the file; a client directory adds data entry without helping get agreements signed. |
| Primary action | Create and send | Create, then send separately | Fewest steps for the everyday case; drafts remain available. |
| Link display | Once, with Copy and Reissue | Store the link to show any time | Keeps the stored-hash-only security property from design 02. |
| Email delivery | Staff paste the link into their own email | Send email from the app | No email provider needed for the test; works with any mail setup. Recorded as a later feature. |
| Updates | On window focus and Refresh | Polling or websockets | Simple, no idle server load; staff see changes as soon as they look. |
| Backend changes | None | — | Every needed endpoint already exists (design 02–04). |

## Low-level design

| Unit | Responsibility |
|---|---|
| `files.ts` | Types; `fileApi` client (list, create, update, delete, send, reissue, events); pure helpers `signingUrl(origin, path)`, `STATUS_LABELS`, `validateFile(values)`, `sendable(agreement)`. |
| `FileForm.tsx` | Create/edit form with field errors; Create and send / Save as draft (create) or Save changes (edit). |
| `FilesPage.tsx` | List with search and status filter, detail panel, actions, link panel, timeline, dialogs. |
| `App.tsx` | Tab **Files** renders `FilesPage` with the agreement list; unsaved-template guard still applies when switching tabs. |

Validation in the browser (title, client, signer name required, up to 200 characters; email shape; an agreement with signature boxes chosen) mirrors the backend rules. The backend remains the authority and its messages are shown as they come.

## Test plan (written before the code)

**Unit (`files.test.ts`):** `signingUrl` joins origin and `/sign#…`; `validateFile` catches each missing or malformed field and passes valid input; `sendable` requires signature boxes; every `fileApi` call uses the right method, URL and JSON body.

**Integration (`FilesPage.test.tsx`, in-memory fake backend):** empty state; form errors without a request; create and send shows the file as Sent with the full link, and Copy puts it on the clipboard; save as draft, edit with the version check, then send; agreements without boxes can't be chosen; reissue asks first, then shows a new link; signed file offers the signed PDF download and no delete; timeline labels; delete draft with confirmation; a server error is shown and nothing is lost; search and status filter; refresh on window focus.

**App (`App.test.tsx`):** tabs are Agreements and Files; the unsaved-changes guard applies when switching to Files.

**Browser (Playwright):** the whole loop through the UI: upload the sample, draw a box, save; create and send a file; open the copied link as the client in a second page and sign; back on the staff page the file shows Signed and the signed PDF downloads.
