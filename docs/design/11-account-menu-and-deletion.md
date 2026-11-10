# Design 11: Account menu and deleting an account

Status: implemented.

## Problem

The header had a separate log-out arrow. The product owner wants the avatar (the initials circle) to open a menu with **Log out** and **Delete account**, and deleting must require typing a confirmation phrase.

## Decisions

| Decision | Chosen | Why |
|---|---|---|
| What is deleted | The whole company: its login, agreements, files, signed PDFs, signatures, timelines and email counts; open signing links stop working | Each company has exactly one login (invites aren't built), so deleting the login without the data would leave data nobody can reach. Confirmed by the product owner. |
| Confirmation | Type `I want to delete account` exactly (same capitals, no extra spaces), shown in quotes; checked by the server too, not only the button | A deliberate, hard-to-do-by-accident action; the server check means a stray request can't delete anything. |
| Password | Not asked again | Not requested; the session plus the typed phrase and the cross-site request checks are the protection. |
| Stored PDFs and images | Deleted after the database commit; a file that can't be removed is logged, not shown as an error | The data is already gone from the database (nothing can reach it); undoing the deletion because of one locked file would be worse. With object storage this becomes a bucket-prefix delete. |
| Afterwards | Session cookie cleared; the login page says "Your account has been deleted." | Clear outcome; the same email can sign up again. |

## Low-level design

- `DELETE /api/auth/account`, body `{"confirm": "I want to delete account"}`, needs a login. 422 for a wrong phrase (nothing changes), 204 on success.
- In one transaction under the write lock: delete `signer_items`, `signatures`, `file_events` of the company's files (these tables have no foreign keys), then the organization; `ON DELETE CASCADE` removes users, sessions, reset links, agreements, files and signing-email counts.
- After commit: remove each agreement's template PDF and each file's document, signature and initials images and signed PDF.
- Frontend: the avatar is a button opening a small menu (Log out, Delete account). Delete account opens a dialog with a text box; **Delete account permanently** stays disabled until the phrase matches.

## Tests (written first)

Integration: wrong or missing phrase changes nothing; needs a login; success removes every row and stored file of that company (including a signed file), ends the session, refuses the old login and signing link, keeps another company's data, and lets the email sign up again. Frontend: the menu, the disabled button until the phrase matches, the request, and the message on the login page. Browser: delete from the menu, then the login page and a failed login.
