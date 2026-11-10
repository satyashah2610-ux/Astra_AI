# Design 13: Redesign ("paper and ink")

Status: implemented. Scope: the existing screens only; no new features.

## Goal

Look and read like a product a company could buy today: calm, legible, consistent, with nothing decorative that doesn't carry information.

## Layout

```
Desktop (>1280 px)                    Laptop (≤1280 px)          Phone (≤760 px)
┌──────────┬──────────────────────┐   ┌──┬────────────────┐      ┌───────────────────┐
│ Logo     │ Page title    [Act.] │   │◆ │ Page title     │      │◆ Agreements Files PT│
│ Agreements│ one-line purpose     │   │▤ │ ┌────┬───────┐ │      ├───────────────────┤
│ Files    │ ┌──────┬───────────┐ │   │▢ │ │list│detail │ │      │ Page title         │
│          │ │ list │  detail / │ │   │  │ └────┴───────┘ │      │ list, then detail  │
│ PT Company│ │      │  editor   │ │   │PT│                │      │ (stacked)          │
└──────────┴─┴──────┴───────────┘─┘   └──┴────────────────┘      └───────────────────┘
```

- The sidebar holds the logo, the two sections and the account menu. The laptop rail shows icons only; each tab has a hover title.
- Every page starts with a title, one sentence on what it's for, and its main action on the right.
- Lists and the detail panel sit side by side. Files was planned as a table, but a table plus the detail panel didn't fit, so it stays a list; rows show the file, client and signer (the signer only when not the client).

## Tokens

| Token | Value | Use |
|---|---|---|
| paper | #f5f6f8 | page background |
| desk | #e9ecf1 | behind PDF pages |
| ink | #16233a | text |
| green | #1f5c46 | primary actions, Signed |
| rule | #dce1e8 | borders |

Status seals use the same colours in lists, details and the timeline: Draft slate, Sent blue, Viewed amber, Signed green. One typeface (Instrument Sans) for everything; Caveat only for typed signatures. Smallest text 12 px.

## Principles

- Borders, not shadows; one radius scale; no gradients.
- No all-caps eyebrows, no "·" separators, no arrows on buttons, no footers.
- PDF pages look like white sheets on a desk, which is the one memorable element.
- The PDF and signature-box geometry is unchanged, so placement and signing behave exactly as before.

## Tests

Unit tests for the new labels (Ready to send / No signature box yet), hover titles on the tabs, and file rows (client, signer, no duplicate). Browser tests cover all screens, including phone layouts with no sideways scrolling.
