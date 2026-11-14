# Design 21: Landing page

Status: implemented. Scope: a public front page for logged-out visitors. No backend change.

## Routes

| Address | Logged out | Logged in |
|---|---|---|
| `/` | Landing page | Workspace (as before) |
| `/login` | Login form | Workspace; the address becomes `/` |
| `/login?signup` | Create-account form; the flag is removed from the address bar | Workspace |
| `/?forgot` (reset emails) | Reset request, as before (any query string on `/` skips the landing page) | Workspace |
| `/files`, confirm, reset and signing links | Unchanged | Unchanged |

- Only the first check on a plain `/` shows the landing page. Logging out or a session ending mid-use returns to the login form, as before.
- `Root` passes `landing` to `StaffGate`, and the landing state is opt-in, so existing gate tests are unaffected.
- The server already sends the app page for any non-API address, so `/login` needs no backend work.
- Browser tests that open `/` to log in now open `/login`.

## Content

1. Sticky blurred nav: brand, section links, **Log in**, **Start free**. Section links scroll in script and never change the `#fragment`, because a changed fragment reloads the page (`main.tsx` does that for signing links). A plain anchor made the first click reload to the top, so it took two clicks to reach a section.
2. Hero: headline with a pen stroke that draws itself under "signed.", one-paragraph pitch, **Start free**, three plain claims, and the **timeline demo**.
3. Features: the heading stays on the left, with six items in a ruled two-column list on the right.
4. How it works: three numbered nodes on one track, coloured like the timeline's statuses (blue, amber, green). This is a real sequence, so numbering fits.
5. Security: set as the certificate of completion every signed file ends with. Five rows: signing link, document, timeline, your data, your account.
6. Final call to action and footer.

There are no testimonials, customer logos or usage numbers, because none exist yet and making them up would mislead visitors.

## The timeline demo

The demo is an in-page animation, not a recorded video. It stays sharp at any size, is a few kilobytes, can't drift out of date with the real labels (it uses `EVENT_LABELS` from `files.ts`), and can be tested.

- It plays one fictional file through Created → Sent by email → Email sent → Reminder sent → Opened by signer → Signed → Company notified, at 1.8 s per step. It holds the signed state for 3.2 s, then loops.
- The status pill moves Draft → Sent → Viewed → Signed in the app's status colours, and a signature draws itself into the box.
- Play/pause and a progress bar make it read as a clip. The step counter is announced politely to screen readers.
- With "reduce motion" turned on, the demo opens paused on the finished timeline, and all animation and transitions are off.

## Look

Reworked with the frontend-design guidance after the first version.

- **Tokens:** the app's own paper-and-ink palette and Instrument Sans, so the landing page and the product feel like one thing. Content is up to 1560 px wide, with padding that scales with the screen.
- **One bold moment:** the hero. The pen stroke draws once on load, the demo plays, and the product window tilts toward the mouse with a soft light under the pointer. It's flat on touch screens and when motion is reduced.
- **Everything else is quiet:** sections are a heading on the left and content on the right, separated by hairline rules. Hover states show what's interactive: nav pills, underlined links, buttons that lift, feature icons that fill, step nodes, certificate rows and timeline rows.
- **Removed as generic patterns:** gradient text on one phrase, uppercase labels above sections, the big-number stats strip, the rounded card grid, fade-in on every section, the drifting glow and grid background, arrows on buttons, "·" separators, and the "See it in action" button.

Styles live in `landing.css`, all prefixed `lp-`, so none of them touch the app.

## Tests

- Unit (`Landing.test.tsx`): calls to action link to `/login` and `/login?signup`; no "See it in action"; section links scroll on the first click without changing the address; the window tilts toward the mouse and settles; the clip plays in order to Signed; pause and play; reduced motion; routing for `/`, `/login`, `/?forgot`, logged in at `/`, and log in at `/login` then log out.
- Unit (`LoginPage.test.tsx`): `?signup` opens account creation and is removed from the address bar.
- Browser (`e2e/landing.spec.ts`): the demo reaches Signed, **Start free** opens account creation, **Log in** opens the login form, and each header section link brings its section into view on the first click.
