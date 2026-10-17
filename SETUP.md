# Carol & Ranel: wedding website setup

Everything here is free: **Netlify (free plan)** hosts the site and a **Google Sheet** stores the guest list and RSVPs.

```
Guest's phone ──search name──▶ Google Apps Script ──reads──▶ Google Sheet (guest list)
              ──send RSVP───▶ Google Apps Script ──writes─▶ Status / Answered By / Message / Responded At
```

## What's where

| Path | What it is |
|---|---|
| `site/` | The website. Only this folder is published to Netlify. |
| `site/config.js` | Settings: Google Sheet link (`scriptUrl`), wedding date, RSVP deadline, contact numbers |
| `google-apps-script/Code.gs` | The script that connects the Google Sheet to the website |
| `docs/` | Screenshots and notes (not published) |

## 1. The Google Sheet

The sheet **"Carol & Ranel RSVP"** already exists in Google Drive with all 67 seats (one row per person).

| Column | Who fills it |
|---|---|
| ID | Filled automatically the first time someone searches |
| Invitation | You. Same text for everyone on one invitation; guests see it as the card title |
| Guest Name | You. One seat each. `One additional seat` = an unnamed extra seat (shown as "Additional guest", not searchable) |
| Status, Answered By, Message, Responded At | The website |
| Table | You, later, when seating is arranged. Guests then see their table number |

**Changing an answer** (when a guest contacts you): type the new Status yourself, or clear the Status cell so they can answer again.

**Watching RSVPs live:** open the sheet in Google Drive or the Google Sheets app. Each answer appears in its row within seconds.

**Totals** (type these anywhere, e.g. in column J):
- Attending: `=COUNTIF(D:D,"Attending")`
- Not attending: `=COUNTIF(D:D,"Not attending")`
- Not answered yet: `=COUNTA(C2:C)-COUNTA(D2:D)`

## 2. Connect the sheet to the website (once, about 5 minutes)

1. Open the sheet → **Extensions → Apps Script**.
2. Delete what's in `Code.gs`, paste everything from [`google-apps-script/Code.gs`](google-apps-script/Code.gs), click 💾 **Save**.
3. **Deploy → New deployment** → gear icon ⚙ → **Web app**
   - Execute as: **Me**
   - Who has access: **Anyone**
   - **Deploy** → **Authorize access** → choose your account. If Google says *"Google hasn't verified this app"*, click **Advanced → Go to … (unsafe)**. That warning appears because it's your own script; it only accesses this sheet.
4. Copy the **Web app URL** (ends in `/exec`) and send it to Claude, or paste it into `site/config.js`:
   ```js
   scriptUrl: "https://script.google.com/macros/s/XXXX/exec",
   ```

> **If "Anyone" isn't offered** (only "Anyone within your organization"): the sheet is in a work Google account whose admin blocks public scripts, and guests couldn't reach it. Use a personal Gmail instead: in the sheet, **File → Download → CSV**, then in your personal Google Drive **New → File upload**, open it with Google Sheets, and do steps 1–4 there.

> If you edit `Code.gs` later: **Deploy → Manage deployments → ✏ Edit → Version: New version → Deploy** (the URL stays the same).

## 3. Put it online (Netlify, free, once)

The Netlify project **carol-and-ranel** already exists.

1. Open <https://app.netlify.com/projects/carol-and-ranel>.
2. **Project configuration → Build & deploy → Continuous deployment → Link repository → GitHub** → choose **carol-ranel-wedding**.
3. Branch: `claude/wedding-rsvp-ui-design-p02v6q`. Leave the build command empty. The publish folder (`site`) comes from `netlify.toml` automatically.
4. **Deploy.** The site is live at **https://carol-and-ranel.netlify.app**.

From then on every change pushed to that branch re-publishes automatically. Changes outside `site/` (guides, screenshots, the sheet script) are skipped, so they don't use deploy credits.

## 4. Before sending to guests

- [ ] On your phone: search a test name, send an RSVP, check the sheet updates, then clear that row's Status.
- [ ] Make the QR code on the invitation point to `https://carol-and-ranel.netlify.app`.
- [ ] RSVP closes automatically after **Oct 30, 2026** (set in `site/config.js` and `google-apps-script/Code.gs`).
