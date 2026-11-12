# Astra Sign

**Demo video:** https://drive.google.com/file/d/1W6PCquzQNcDFwfXVf1faQwS4HA0875HR/view?usp=sharing

**Live app:** https://app.signwithastra.com

Astra Sign is an e-signature app that lets a business send agreements to its clients and get them signed online. Staff prepare an agreement once as a reusable template, send it to any client in under a minute, follow it live until it is signed, and keep a signed PDF that serves as proof of the whole signing record.

## Contents

1. [The problem it solves](#the-problem-it-solves)
2. [Try it in 5 minutes](#try-it-in-5-minutes)
3. [Features](#features)
4. [How it works](#how-it-works)
5. [Tech stack](#tech-stack)
6. [Project structure](#project-structure)
7. [Run it locally](#run-it-locally)
8. [Data and storage](#data-and-storage)
9. [Security](#security)
10. [Testing](#testing)
11. [Hosting](#hosting)
12. [Features left out, and why](#features-left-out-and-why)
13. [Limits](#limits)
14. [Design notes and decisions](#design-notes-and-decisions)

## The problem it solves

A business sends similar agreements to many clients. Without a tool, that means printing, signing, scanning and emailing PDFs back and forth, then chasing clients who forget to sign. Astra Sign turns this into a few clicks:

- **Prepare once:** upload the agreement, mark where the client signs, and sign the company's side.
- **Send in under a minute:** enter the client's details, check them, and send. The client gets an email with a secure link.
- **No account for the client:** they sign on a phone or computer.
- **Nothing to chase:** the app reminds the client daily and tells staff the moment the agreement is signed.
- **Proof:** the signed PDF carries a certificate of completion with the full signing record.

## Try it in 5 minutes

On the [live app](https://app.signwithastra.com):

1. **Create an account.** Click **Create an account** and enter a company name, your name, your email and a password (10+ characters). Open the confirmation email and click the link; you are logged in.
2. **Prepare an agreement.** On **Agreements**, click **Try a sample agreement** or upload your own PDF. Then:
   - Click **Add signature box for client** and drag the box where the client should sign.
   - Optionally, add the company's side with **Tick**, **Name**, **Date**, **Initials** or **Signature**. The signature starts from your sign-up name, which you can change.
   - Click **Save template**.
3. **Send it.** On **Files**, click **New file** and enter a job name, client name, signer name and **your own email** as the signer's email. Pick the agreement and click **Create and send**. Check the details on the confirmation screen, then click **Confirm and send**.
4. **Sign as the client.** Open the email, click **Review and sign**, and on the signing page:
   - Use **Go to signature boxes** to jump to each box, and add any ticks, text or a date you like.
   - Type or draw a signature, tick the consent box and click **Sign agreement**.
5. **See the result.** Back on **Files**, the file shows **Signed** with a timeline of every step, and you get a "signed" email. Click **Download signed PDF** to see your signature stamped in, plus the certificate page at the end.

## Features

### Company accounts
- **Getting in:** sign-up with email confirmation, login, and forgot-password by email (a one-time link valid for 1 hour).
- **Data isolation:** each company sees only its own agreements and files.
- **Logout:** automatic after 10 idle minutes, or via **Log out** in the account menu. **Delete account** in the same menu permanently removes the company and all its data, after a typed confirmation.
- **Login protection:** 5 wrong passwords for one email (or 20 from one network address) within 15 minutes lock logins for 15 minutes. A password reset unlocks the account.

### Agreements (templates)
- **Upload:** a PDF up to 20 MB and 100 pages, or the built-in sample.
- **For the client:**
  - signature boxes;
  - **text** printed onto the document;
  - **comments** the client sees next to a spot while signing, which are never printed.
- **For the company's side:** a tick, a dot, the name (pre-filled from sign-up), the date (the send date), initials and the company's signature. Initials and signature are adopted once, typed or drawn. All of them are printed onto the document when a file is sent.
- **Editing:**
  - drag to move and pull the corner to resize;
  - keyboard: arrow keys move, Shift + arrows resize;
  - zoom, and jump to a page by typing its number;
  - unsaved-change warnings.
- **Library:** search agreements by name. **Rename** an agreement; duplicate names get " (1)", " (2)". Delete an agreement after confirmation.

### Files (one per job)
- **Create:** a file holds the job name, client, signer, the signer's email, the agreement and an optional personal message.
- **Earlier clients:** typing a client or signer name suggests earlier clients and fills in their details.
- **Send:**
  - **Save as draft** (drafts can be edited), or **Create and send**.
  - A final **Check the details before sending** screen shows everything before anything goes out.
  - Sending **freezes** a copy of the agreement, so later template edits never change what the client signs.
- **Status and timeline:**
  - Status moves Draft → Sent → Viewed → Signed.
  - The timeline records created, sent, email sent or not delivered, every link opened by the signer, reminders, signed, and the company notified.
  - Status and timeline update by themselves every few seconds.
- **Links:** the signing link is shown once with **Copy link**. **Reissue link** makes a new one and stops the old one from working.
- **Search** by file, client or signer, and **filter** by status.
- **Download signed PDF** once signed, or **Delete file** before then.

### Signing page (for the client)
- **No account:** the client opens a secure link on any device.
- **Reading:** they read every page, with signature boxes highlighted and the company's comments shown. **Go to signature boxes** steps through every box from top to bottom and loops. The **Page n of N** box follows scrolling and jumps to a typed page.
- **Adding items:** the client can place ticks, dots, text, their name, the date (their own time zone), initials and their signature anywhere, then move, resize or remove them.
- **Signature:** typed (drawn in a handwriting font) or drawn with a finger or mouse.
- **Consent:** an electronic-signature consent checkbox, plus a notice that IP address, browser and signing time are recorded.
- **After signing:** a confirmation page and **Download signed copy**. Reopening the link later shows that it is already signed.

### Signed PDF and certificate
- **The document:** the exact document that was sent, with the company's items and everything the client added stamped in. Rotated pages are handled.
- **The certificate of completion**, appended at the end, records:
  - signer name and email, and signing method;
  - the consent wording, IP address and browser;
  - the full timeline;
  - the **SHA-256 fingerprint** of the sent document, so any later change to it can be detected.
- It is built once and never changes.

### Email (through Resend)
- **Signing email:** sent from "*staff name* via Astra Sign". It contains the personal message and a **Review and sign** button, and replies go to the staff member.
- **Reminders:** every 24 hours, for up to **7 days per emailed link**. Each reminder carries a fresh link.
- **"Signed" email:** sent to the staff member who sent the file.
- **Account emails:** confirmation and password reset.
- **Limits:** 50 signing emails and 100 reminders per company per day. Past the limit, sending still works and staff copy the link themselves.

## How it works

```
 Staff browser ─┐                                   ┌─► PostgreSQL (Neon)
                ├─► HTTPS ─► FastAPI app (Docker) ──┤   accounts, agreements, files, events
 Client browser ┘   app.signwithastra.com           ├─► Disk: PDFs, signature images, signed PDFs
                                                    └─► Resend: signing emails, reminders, notices
```

- **One container:** a single Docker container on Render serves both the API (`/api/...`) and the built React app.
- **Frontend:** draws PDFs with PDF.js, places items as fractions of the page (so they line up at any zoom or screen size), and talks to the API with JSON.
- **Sending:** the backend copies the agreement PDF, prints the company's items onto it, stores its SHA-256 hash, and creates a random link secret. Only a hash of that secret is kept.
- **Signing:** the backend validates the signature image, records the event with time, IP and browser, then builds the signed PDF with ReportLab and pypdf and appends the certificate.
- **Reminders:** a background task in the app sends due reminders. Each reminder is claimed under a database lock, so it is never sent twice.
- **Database changes:** versioned SQL migrations in `backend/app/schema/` run automatically when the app starts.

## Tech stack

| Area | Technology |
|---|---|
| Frontend | React 19, TypeScript, Vite, PDF.js (pdfjs-dist), Lucide icons |
| Backend | Python 3.14, FastAPI, Uvicorn, Pydantic |
| PDF | ReportLab and pypdf (stamping and certificate), Pillow (image checks) |
| Database | PostgreSQL on Neon, psycopg 3 with a connection pool, versioned SQL migrations |
| Email | Resend |
| Hosting | Docker on Render (Starter plan with a persistent disk), Cloudflare DNS, custom domain `app.signwithastra.com` |
| Testing | pytest (backend), Vitest and React Testing Library (frontend), Playwright (end-to-end in real Chrome) |
| Source control | GitHub: work on `dev`, releases merged to `main`, which Render deploys |

## Project structure

```
backend/
  app/                FastAPI app
    main.py           app setup, routes for agreements and the web pages
    auth.py           sign-up, login, sessions, password reset, account deletion
    files.py          files: create, edit, send, reissue, delete, timeline
    signing.py        the public signing API (link secret in a header)
    signed_pdf.py     stamping items into the PDF and building the certificate
    reminders.py      the reminder loop and the "signed" email
    security.py       host allow-list, cross-site checks, body size limits, headers
    email.py          email content and sending through Resend
    schema/           numbered SQL migrations
  tests/              pytest unit and integration tests
  scripts/            helper to start the backend for end-to-end tests
frontend/
  src/                React app: App (agreements), FilesPage, SigningPage, PdfEditor, PdfPages, SignaturePad, ...
  src/*.test.tsx      Vitest unit tests
  e2e/                Playwright end-to-end tests
docs/design/          one design note per feature
examples/             sample agreement PDF
Decisions.md          every design decision and the reason for it
Dockerfile            the production container
```

## Run it locally

Requirements: Python 3.14, Node.js 24, and a PostgreSQL database (a free Neon project works). The commands are for Windows PowerShell; on macOS or Linux, use `.venv/bin/python` and `npm`.

Install once, from the repository root:

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r backend\requirements.lock.txt
cd frontend; npm.cmd ci; cd ..
```

Create `.env.local` in the repository root. It is git-ignored; never commit it.

```
DATABASE_URL=postgresql://USER:PASSWORD@HOST/DATABASE?sslmode=require
```

Start the backend and the frontend, each in its own terminal:

```powershell
.\.venv\Scripts\python.exe -m uvicorn app.main:create_app --factory --app-dir backend --host 127.0.0.1 --port 8000
```

```powershell
cd frontend; npm.cmd run dev
```

Open **http://127.0.0.1:5173**. The backend creates its tables on first start. Without email configured, new accounts are confirmed at once and signing links are shown on screen to copy. API documentation is at http://127.0.0.1:8000/docs.

### Settings

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | PostgreSQL connection (required) |
| `RESEND_API_KEY`, `ASTRA_EMAIL_FROM` | Send email through Resend, e.g. `ASTRA_EMAIL_FROM="Astra Sign <sign@mail.yourdomain.com>"` (domain verified in Resend) |
| `ASTRA_EMAIL_OUTBOX` | Write emails to this folder instead of sending them (used by the end-to-end tests) |
| `ASTRA_APP_URL` | The address used in email links; set it in production |
| `ASTRA_ALLOWED_HOSTS` | Host names the backend answers to (default `127.0.0.1,localhost`) |
| `ASTRA_SECURE_COOKIES=1` | When served over HTTPS |
| `ASTRA_TRUSTED_PROXIES` | Number of proxies in front of the app (`1` on Render), used to read the visitor's real address |
| `ASTRA_DATA_DIR` | Where PDFs and signature images are stored (default `backend/data/`) |
| `ASTRA_REMINDER_MINUTES` | Minutes between reminders (default 1440; `2` to watch them locally) |

## Data and storage

- **PostgreSQL** holds:
  - companies and users;
  - sessions (hashed) and login attempts;
  - agreements and the positions of their boxes and items;
  - files, link hashes and the timeline of events;
  - signatures and the items each client placed.
- **Files on disk** (`ASTRA_DATA_DIR`, a persistent disk on Render) hold:
  - original agreement PDFs;
  - the frozen copy sent on each file;
  - signature and initials images;
  - finished signed PDFs.
- **Backups:** back up the database and that folder together.

## Security

- **Accounts:**
  - Passwords are stored as salted scrypt hashes.
  - The session is an HttpOnly, SameSite=Lax, Secure cookie, stored on the server only as a hash.
  - Failed-login limits, email confirmation, and logout after 10 idle minutes.
- **Company isolation:** every query is limited to the logged-in company. Another company's IDs return "not found".
- **Signing links:**
  - The secret is a long random token placed after `#` in the URL (`/sign#<token>`), so browsers never send it to a server and it never appears in logs. The page sends it to the API in a header.
  - Only a SHA-256 hash of each secret is stored. Reissuing a link stops the old one.
- **Request checks:**
  - Requests forged from other websites are refused (`Origin` / `Sec-Fetch-Site` checks).
  - Only allowed host names are answered, which protects against DNS rebinding.
  - Upload sizes are limited while the data streams in.
- **Content:**
  - Signature images are decoded and checked on the server.
  - Responses forbid framing, caching, content sniffing and referrers.
  - PDF.js runs with code evaluation disabled.
- **Secrets:** the database password never appears in errors or logs. Secrets live only in git-ignored files locally and in Render's dashboard in production.
- **Privacy:** signers are told that their IP address, browser and signing time are recorded.

## Testing

**How the app was built:**
- **Test-first:** for every change, the tests were written first and seen to fail, then the code was written to make them pass.
- **Reviews:** each change was code-reviewed before it was pushed to `dev`. Each release was security-reviewed, after the end-to-end tests passed, before it was merged to `main`.

| Kind | Count | Tool | What it checks |
|---|---|---|---|
| Backend unit and integration | about 620 | pytest | API rules, permissions, company isolation, links, reminders, emails, PDF stamping, migrations, security checks |
| Frontend unit | 211 | Vitest | Every screen and component in a simulated browser |
| End-to-end | 29 | Playwright | The whole app in real Chrome, from sign-up to the signed PDF, including phone layouts |

All tests use a **separate test database**, never the app's own. Put its direct (non-pooled) URL in `.env.test.local` (git-ignored):

```
ASTRA_TEST_DATABASE_URL=postgresql://USER:PASSWORD@HOST/DATABASE?sslmode=require
```

With Neon, use a branch named `test`. The tests refuse to run against the app's own database server and only touch their own schemas. To run them, from the repository root:

```powershell
.\.venv\Scripts\python.exe -m pytest -q backend          # backend unit and integration tests
npm.cmd --prefix frontend test                          # frontend unit tests
npm.cmd --prefix frontend run test:e2e                  # end-to-end tests in real Chrome
```

The end-to-end tests build the app, start their own backend and frontend (ports 8011 and 5174), write emails to a temporary folder instead of sending them, and drive Google Chrome. Screenshots and traces of any failure go to `frontend/test-results/`.

## Hosting

The app runs on **Render** as one Docker container, with a persistent disk for files. Full design: [docs/design/15-hosting.md](docs/design/15-hosting.md).

- **Service:** **New → Web Service**, repo `Astra_AI`, branch `main`, language **Docker**, instance **Starter**. Add a disk at `/var/data` (1 GB).
- **Environment:**
  - Secrets, entered only in Render: `DATABASE_URL`, `RESEND_API_KEY` and `ASTRA_EMAIL_FROM`.
  - Settings: `ASTRA_DATA_DIR=/var/data`, `ASTRA_APP_URL=https://app.signwithastra.com`, `ASTRA_ALLOWED_HOSTS=<service>.onrender.com,app.signwithastra.com`, `ASTRA_SECURE_COOKIES=1` and `ASTRA_TRUSTED_PROXIES=1`.
- **Health check path:** leave it empty. Render checks with an internal host name, which the host allow-list refuses.
- **Custom domain:** add `app.signwithastra.com` in Render, then add the CNAME it shows in Cloudflare DNS, set to **DNS only** (grey cloud).
- **Deploys:** every merge to `main` deploys automatically. Database migrations run when the app starts.

## Features left out, and why

1. **AI features.** Agreements often contain sensitive personal and business information (names, prices, contract terms). Until it is agreed what may be shared with a third-party AI provider, all agreement data stays inside the app.
2. **A document assistant chatbot for clients.** A chatbot on the signing page could explain clauses before the client signs. It needs careful guardrails first:
   - answer only from the document;
   - never give legal advice or invent terms;
   - make clear it is no substitute for reading the agreement;
   - protect the data in the document.
3. **Automated agreement filling with n8n (future idea).**
   - **Trigger:** an n8n form where staff upload the agreement.
   - **Reading:** AI reads it and finds the client-specific details needed (name, email, cost, hours, timelines). What it looks for is set by a general prompt or an agreement-specific one. Prompts written for each customer's own agreements could become a paid offering.
   - **Asking:** the workflow emails staff for those details. Their reply resumes the workflow through webhooks.
   - **Sending:** the workflow fills in the agreement and sends it to the client.
   - **Record:** a spreadsheet keeps a record of each agreement's activity.
   - **Why it waits:** it depends on the same AI and data-privacy decisions as point 1, and the core signing flow came first.
4. **Load testing.** How the app behaves with, say, 1,000 people at once was not tested. The database is on Neon's free tier, and a realistic load test would use much of its monthly compute allowance and could take the live app offline. Before a real launch, load tests would run on a separate paid staging copy.
5. **Team features.** Inviting colleagues to a company account, and roles, are not built yet. Each company currently has one login.
6. **Payments and subscriptions (Stripe).** If the app is taken further, billing would be a subscription model on Stripe:
   - plans per company (for example Free, Pro and Business), monthly or yearly, with a free trial;
   - plan limits, such as agreements sent per month, staff users and templates;
   - Stripe Checkout to pay, and the Stripe Customer Portal to upgrade, downgrade, change card or cancel;
   - Stripe webhooks to keep each company's plan status up to date.

   Card details would stay with Stripe and never be stored in the app. It was left out because pricing isn't decided yet and the core signing product came first.

## Limits

- **PDFs:** must be unencrypted, up to 20 MB and 1–100 pages.
- **Printed text:** supports Western European characters. Other scripts are refused with a clear message rather than printed as empty boxes.
- **Accessibility:** PDF pages are drawn as images, so the document's own text can't be selected or read by screen readers.
- **One server:** the app runs as a single instance. A deploy causes a few seconds of downtime. Running more than one instance would need object storage (for example Cloudflare R2) instead of the disk.

## Design notes and decisions

- [docs/design/](docs/design/) has one design note per feature: files and signing links, the signing page, the signed PDF, accounts, email, reminders, hosting, and more.
- [Decisions.md](Decisions.md) records each design decision and the reason for it, in the order they were made.
