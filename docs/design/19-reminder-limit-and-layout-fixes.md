# Design 19: Seven reminders at most; signing page and signature layout fixes

## Requests
1. Reminders should be sent for 7 days only.
2. On the signing page the "Page n of N" box covered the signer's tools (Text, Name, Date), and it did not change while scrolling.
3. In the editor's "Your signature" panel a long name was cut off ("Satya Sh...") and Cancel was pushed out of the panel.

## Reminders: at most 7 per emailed link
| Decision | Choice | Why |
|---|---|---|
| What "7 days" counts | 7 reminders after each emailed link (send, or reissue by email), then none | At the default daily interval that is exactly the 7 days after the email. Counting reminders, not calendar days, also keeps a 2-minute demo interval to 7 emails instead of thousands. |
| Reissue | Emailing a reissued link starts a new 7 | Reissue sends a new link; its client gets the same week of reminders. A reissue that isn't emailed stops reminders (unchanged). |
| Held back by the daily allowance | Doesn't use one up | The reminder wasn't sent. |
| Failed delivery | Uses one | It was attempted and recorded on the timeline; the next one follows on schedule. |
| After the seventh | `remind_at` cleared, so the file shows no "Next" date | Nothing more is coming. |

**Migration `0010_reminder_limit.sql`:** `files.reminders_left INTEGER NOT NULL DEFAULT 0`. Files already being reminded get 7 minus the reminders attempted (delivered or not) since their latest send or reissue, at least 0; those with none left stop now.

**Backend:** `MAX_REMINDERS = 7` in `app/reminders.py`; `schedule_reminders` sets it when a link is emailed, 0 otherwise; each sent reminder takes one and clears `remind_at` after the last.

**Frontend wording:** "a reminder every day for up to 7 days" (new-file form) and "Yes, with a daily reminder for up to 7 days" (send check).

## Signing page: one bar for the tools and the page box
- Both were separate sticky bars pinned at the same place, so the page box sat on top of the tools. `PdfPages` now takes a `toolbar` and draws it with the page box in one sticky bar: the tools on the left, the page box on the right (it wraps below on narrow screens).
- The page box follows scrolling: an `IntersectionObserver` with a zero-height band across the middle of the screen reports which page crosses it. Typing a number and pressing Enter still jumps there; during that jump (up to 1.5 s, or until the signer scrolls by hand) pages passed on the way are ignored, so the box ends on the page asked for even when it can't reach the middle (the last page). The number is never replaced while the signer is typing in the box.

## Editor: signature preview and buttons
- The typed preview's font shrinks with the name's length (`--chars`, using container width units), from 40px down to 14px; a name too long even then wraps instead of being cut off. The image placed on the page was already fitted; only the preview cut names off. The same pad on the client's signing page benefits too.
- The adopt panel's Cancel / Place buttons wrap and share the panel's width.

## Tests
Integration (backend): the migration gives existing files what is left of seven for their current link (failed attempts count); stops after seven and shows no next date; the seventh is still sent; emailing a reissued link starts a new seven; a reminder held back by the daily allowance doesn't count. Frontend: reminder wording (2); the page box follows scrolling; the page box shares the tools' bar; scrolling never overwrites a number being typed; pages passed during a jump do not change the box; the preview scales with the name length. Browser: scrolling back updates the page box; the page box overlaps no tool; adopt buttons stay inside the panel; a long name fits the preview.

## Follow-up: the staff member's own name; tools on one line
- The "Your signature" / "Your initials" panel has a **Your full name** box. It starts with the name used at sign-up; whatever staff type there is the name the typed signature (and the initials, from its first letters) is made from, and it is kept for the next adoption while that agreement is open. Nothing about the account changes.
- Signing page: the tool buttons get the whole top row of the bar (Signature stays beside Initials); the page box sits at the right of the hint line below. Below 760px wide the page box takes its own line.
- Browser tests added (`e2e/lifecycle.spec.ts`): draft, edit, search and status filters, send with the details check, the first link recorded once despite reloads, reissue (old link refused, new link opens and is recorded), delete (link refused); finding agreements by name; signing with a typed name. `updates.spec.ts` checks every signer tool sits on one line.

## Follow-up: letting the free Neon database sleep
- Problem: on the always-on Render plan, the reminder loop queried the database every 30 seconds and the pool kept one connection open, so Neon (which sleeps after 5 idle minutes) never slept. At the smallest size that is about 6 compute hours a day, more than the free plan's 100 a month.
- The loop now checks every quarter of the reminder interval, at most every 15 minutes (every 15 minutes with daily reminders; still every 30 seconds with the 2-minute demo setting). A reminder can be up to 15 minutes late.
- The pool keeps no connection open while idle (`min_size=0`). Unused ones close within about 2 minutes (`max_idle=60`; the pool shrinks on a fixed tick, so up to two ticks), well inside Neon's 5 idle minutes. Each connection is checked before use, since one left from before the database slept may have been dropped. The first request after a quiet spell takes about a second longer while the database wakes.
- After a check that sends a full batch (20) the loop checks again at once, so a large backlog is not spread over many 15-minute waits. The first check comes 30 seconds after the app starts, so a deploy never delays reminders by a whole interval.
- To confirm on the live app: Neon's Branches page should show production as **Idle** between checks when nobody is using the site. If it never does (for example if Neon's connection pooler holds the database connection open), the next step is a direct connection for the reminder loop.
- Expected idle use: about one 5-minute wake every 15 minutes, roughly a third of the time awake, so about 2 compute hours a day instead of 6.
