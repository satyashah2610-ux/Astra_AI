# Design 15: Hosting on Render

Status: implemented (deploy settings); first deploy pending.

## High-level design

```
Browser ──HTTPS──► Render load balancer ──► one container (Docker)
                                              uvicorn: /api/* (FastAPI) + built web pages (frontend/dist)
                                              files on a persistent disk at /var/data
                                              ──► PostgreSQL on Neon (production branch)
                                              ──► Resend (email)
```

| Decision | Chosen | Why |
|---|---|---|
| Host | Render, Starter instance ($7/month) + 1 GB persistent disk ($0.25/month) | Always on (no 30-second first load; reminders on time), deploys from GitHub, HTTPS for the custom domain. Free instances sleep and can't have a disk. |
| Stored files | Persistent disk at `/var/data` (`ASTRA_DATA_DIR`) | No code change; enough for a demo. Limits: one instance, a few seconds of downtime per deploy. Object storage (Cloudflare R2) is the next step for more than one instance. |
| One service | The backend also serves the built pages (`ASTRA_FRONTEND_DIR`) | One address: no CORS, cookies and relative `/api` paths work as in development. |
| Build | Dockerfile (Node builds the pages, Python runs the app) | The page build needs Node; Docker makes the build the same everywhere. |
| Visitor address | `ASTRA_TRUSTED_PROXIES=1`, uvicorn `--no-proxy-headers`, Cloudflare DNS-only | See design 12 / Decisions: only proxies every request must pass through are counted. |
| Container user | root | Render mounts the disk for root; a non-root user might not be able to write to it. |

## Page serving rules

Built files are served as they are (correct script types set explicitly, since `nosniff` makes browsers refuse wrong ones). Any other address gets `index.html`, which shows the right screen. A missing file (its name has an extension) is a 404, so a script never receives HTML; `/api/...` stays a JSON 404; nothing outside the build folder is served. A build folder without `index.html` stops the app at startup.

## Tests (written first)

Pages for every screen address, built files with the right types, 404s for missing files and unknown API addresses, path traversal refused, the API unaffected, nothing extra served in development, a broken build refused. A one-off check served the real build and loaded every file it refers to.
