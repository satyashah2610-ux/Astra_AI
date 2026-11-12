# Astra Sign

Send agreements to clients and get them signed online. Staff upload a PDF once, mark where the client signs, fill in and sign the company's side, and reuse it as a template. Each job is a file: enter the client's details, confirm them, and the client gets an emailed link to sign on any device, with no account. Staff follow each file live (sent, opened, signed), clients get daily reminders, and the signed PDF comes with a certificate of the whole signing record.

Live: **https://app.signwithastra.com**. Python FastAPI backend, React/TypeScript frontend, PostgreSQL (Neon), hosted on Render.

## Features

- **Accounts:** company sign-up with email confirmation, login, forgot password, log out after 10 idle minutes, delete account. Each company sees only its own data. Failed logins are limited: 5 per email, or 20 per network address, in 15 minutes.
- **Agreements (templates):** upload a PDF (up to 20 MB and 100 pages) or try the sample. Then:
  - **For the client:** add signature boxes, plus text printed on the document and comments the client sees while signing.
  - **For the company's side:** tick, dot, name, date, initials and the company's signature, printed onto the document when it's sent.
  - **Editing:** drag, resize, use the keyboard, zoom, jump to a page by number, rename. Duplicate names get " (1)", " (2)".
- **Files:** one per job. Create and send (after a details check) or save as a draft. Fill a new file from an earlier client, add a personal message, search and filter by status. Each file has a live timeline: email sent, opened by signer, reminders, signed. Reissue a link (the old one stops working), delete a file, and download the signed PDF.
- **Signing page:** no account needed. The client reads every page and adds ticks, dots, text, name, date, initials and a typed or drawn signature. "Go to signature" steps through every box. They give electronic-signature consent, sign, and download their copy.
- **Signed PDF:** the exact document that was sent, with every item stamped in, plus a certificate: signer, consent, IP address, browser, the full timeline and the SHA-256 hash of the sent document.
- **Email (Resend):** the signing link with your message, and a reminder every 24 hours for up to 7 days per emailed link. Staff get an email when the client signs. Each company has a daily limit of 50 signing emails, and sending still works past it: you copy the link yourself.

Design notes for each feature are in [docs/design/](docs/design/); decisions and their reasons are in [Decisions.md](Decisions.md).

## Run locally (Windows)

Install once, from the repository root:

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r backend\requirements.lock.txt
cd frontend; npm.cmd ci; cd ..
```

Create `.env.local` in the repository root (git-ignored; never commit it):

```
DATABASE_URL=postgresql://USER:PASSWORD@HOST/DATABASE?sslmode=require
```

The backend creates its tables on first start (migrations in `backend/app/schema/`). Then start each part in its own terminal:

```powershell
.\.venv\Scripts\python.exe -m uvicorn app.main:create_app --factory --app-dir backend --host 127.0.0.1 --port 8000
```

```powershell
cd frontend; npm.cmd run dev
```

Open **http://127.0.0.1:5173**. Without email configured, new accounts are confirmed at once and signing links are shown to copy. On macOS/Linux, use `.venv/bin/python` and `npm`. Developed with Node.js 24 and Python 3.14.

### Settings

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | PostgreSQL connection (required) |
| `RESEND_API_KEY`, `ASTRA_EMAIL_FROM` | Send email through Resend, e.g. `ASTRA_EMAIL_FROM="Astra Sign <sign@mail.yourdomain.com>"` (domain verified in Resend) |
| `ASTRA_EMAIL_OUTBOX` | Write emails to this folder instead of sending them (used by the browser tests) |
| `ASTRA_APP_URL` | The address used in email links; set it in production |
| `ASTRA_ALLOWED_HOSTS` | Host names the backend answers to (default `127.0.0.1,localhost`) |
| `ASTRA_SECURE_COOKIES=1` | When served over HTTPS |
| `ASTRA_TRUSTED_PROXIES` | Number of proxies in front of the app (`1` on Render), used to read the visitor's real address |
| `ASTRA_DATA_DIR` | Where PDFs and signature images are stored (default `backend/data/`) |
| `ASTRA_REMINDER_MINUTES` | Minutes between reminders (default 1440; `2` to watch them locally) |

## Storage

PostgreSQL holds accounts, agreements, box positions, files, signatures and the audit trail. PDFs and signature images are files under `ASTRA_DATA_DIR`: original templates, the frozen copy sent on each file, signature images and finished signed PDFs. Back up the database and that folder together.

## Security

- Staff log in with email and password: salted scrypt hashes, and an HttpOnly, SameSite=Lax session cookie stored only as a hash. Another company's IDs return 404.
- Signing links put the secret after `#` (`/sign#<token>`), so it never reaches a server log. Only a SHA-256 hash of each secret is stored.
- Requests from other websites are refused (`Origin` / `Sec-Fetch-Site`), and only allowed host names are answered (DNS-rebinding protection). Request bodies are size-limited while they stream in.
- Responses forbid framing, caching, content sniffing and referrers. PDF.js runs with code evaluation off. The database password never appears in errors or logs.
- Signers are told that their IP address, browser and signing time are recorded.

## Tests

All tests use a **separate test database**, never the app's own. Put its direct (non-pooled) URL in `.env.test.local` (git-ignored):

```
ASTRA_TEST_DATABASE_URL=postgresql://USER:PASSWORD@HOST/DATABASE?sslmode=require
```

With Neon, use a branch named `test`. The tests refuse to run against the app's own database server, and they only touch their own schemas.

From the repository root:

```powershell
.\.venv\Scripts\python.exe -m pytest -q backend          # backend unit and integration tests
npm.cmd --prefix frontend test                          # frontend unit tests
npm.cmd --prefix frontend run test:e2e                  # end-to-end tests in real Chrome
```

The end-to-end tests build the app, start their own backend and frontend (ports 8011 and 5174) and drive Google Chrome through every main journey. Screenshots and traces of failures go to `frontend/test-results/`.

## Hosting (Render)

One Docker container serves the API and the built pages. Files live on a persistent disk. Full design: [docs/design/15-hosting.md](docs/design/15-hosting.md).

- **New → Web Service:** repo `Astra_AI`, branch `main`, language **Docker**, instance **Starter**. Add a disk at `/var/data` (1 GB).
- **Environment:** `DATABASE_URL`, `RESEND_API_KEY` and `ASTRA_EMAIL_FROM` (secrets, entered only in Render), plus `ASTRA_DATA_DIR=/var/data`, `ASTRA_APP_URL=https://app.signwithastra.com`, `ASTRA_ALLOWED_HOSTS=<service>.onrender.com,app.signwithastra.com`, `ASTRA_SECURE_COOKIES=1` and `ASTRA_TRUSTED_PROXIES=1`.
- **Health check path:** leave it empty. Render checks with an internal host name, which the allow-list refuses.
- **Custom domain:** add `app.signwithastra.com` in Render, then the CNAME it shows in Cloudflare DNS, set to **DNS only** (grey cloud).

## Limits

PDFs must be unencrypted. Printed text supports Western European characters (other scripts are refused with a clear message). PDF pages are drawn as images, so the document's text can't be selected or read by screen readers. Not built yet: inviting colleagues to a company account.
