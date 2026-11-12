# Design 20: How the link reaches the client

## Request
With "Email the link to the signer" unticked, the file's timeline still said **Sent**, as if the client had been emailed. Requested: name what happened, let staff choose whether an emailed link gets reminders, and grey out what only applies to an email.

## Decisions
| Decision | Choice | Why |
|---|---|---|
| Timeline when emailed | **Sent by email** (event `sent`), followed as before by Email sent / not delivered | Says how the client got it. |
| Timeline when not emailed | **Link created, not emailed** (new event `link_created`), the same on the certificate | True in every case: staff chose to share it, or email was asked for but couldn't go out (email not set up, or the daily limit reached); and true whichever staff member reads it. |
| File status | Unchanged: **Sent** for both | The file has left drafts and is waiting for the client either way; changing statuses would touch every screen and filter. |
| Reminders | A second checkbox under the email box, **Remind them every day for up to 7 days if it isn't signed**, ticked by default; sent to the API as `reminders` | Some staff want one email and no follow-ups. |
| Without the email | The reminder box and the personal message are disabled and greyed out; the message's hint says it only travels in the email. Sending without the email drops a message typed earlier | Neither does anything without an email; a kept message would go out unseen in a later emailed reissue. |
| Where | The new-file form, **Send for signature** on a draft, and the **Reissue link** dialog (one shared `DeliveryChoice` component) | The same choice everywhere a link is issued. |
| Details check | "Yes, with a daily reminder for up to 7 days", "Yes, without reminders" or "No, you will share the link yourself"; the personal message row only when emailed | The last check matches what will happen. |
| Earlier files | Migration 0011 renames past `sent` events that no email followed (before any reissue) to `link_created` | Older timelines tell the truth too. |

## API
`POST /api/files/{id}/send` and `POST /api/files/{id}/link` accept `{"email": bool, "reminders": bool}` (both default true; `reminders` only applies when the link is emailed).

## Tests
Backend integration: emailed is "sent", shared is "link_created", an email that couldn't go out is "link_created", reminders on by default, emailed without reminders (send and reissue), `reminders` must be a boolean, certificate labels, the migration renames only sends no email followed. Frontend: the reminder box is on by default and greys out with the message when the email is unticked; emailing without reminders; the timeline wording; the same choice on a draft and in the reissue dialog; the API body never asks for reminders without an email. Browser: the greyed-out fields, the details check and the timeline for a shared link.
