# Carol & Ranel — wedding website setup

Everything here is free: **Netlify (free plan)** hosts the site, and a **Google Sheet** with a free Google Apps Script stores the guest list and the RSVPs.

```
Guest's phone ──search name──▶ Google Apps Script ──reads──▶ Google Sheet (Guests)
              ──send RSVP───▶ Google Apps Script ──writes─▶ Status / Attending / Message
```

---

## 1. Google Sheet (guest list + RSVPs)

**One row per person.** Everyone gets their own seat, so each guest is a row.

1. Create a new Google Sheet, e.g. **"Carol & Ranel RSVP"**.
2. Rename the first tab (bottom left) to exactly **`Guests`**.
3. Put these headers in **row 1**:

   | ID | Invitation | Guest Name | Status | Answered By | Message | Responded At | Table |
   |----|------------|------------|--------|-------------|---------|--------------|-------|

   *Easiest: File → Import → Upload your guest list CSV → "Replace current sheet", then rename the tab to `Guests`.*
4. Fill in **Invitation** and **Guest Name** for every guest:

   | Invitation | Guest Name |
   |---|---|
   | Cristina, RB & Winnie | Cristina Ramos |
   | Cristina, RB & Winnie | RB Ramos |
   | Cristina, RB & Winnie | Winnie Tuano |
   | The Aquino Family | Cecile Aquino |
   | The Aquino Family | Eric Aquino |
   | Ana Santos | Ana Santos |

   - **Invitation** groups people who share one invitation. Type it **exactly the same** on each row; guests see it as the title of their card.
   - Seats = number of names in the invitation (counted automatically).
   - Leave **ID, Status, Answered By, Message, Responded At** empty. The website fills them in.
   - **Table**: leave empty for now. When you arrange seating after the RSVPs, type the table number and guests will see it on the site.
   - **Extra unnamed seat**: add a row with Guest Name `One additional seat`. Guests see it as "Additional guest", it can't be searched, and whoever answers for the invitation answers for it.

**How guests answer**
- Searching any name opens the shared invitation with every name listed.
- They can answer for themselves and anyone else on it, and leave the rest for those people to answer later.
- An answered name is locked. To change it, clear that person's **Status** cell (or type the new answer yourself).

**Watching RSVPs live:** open the sheet in Google Drive (computer or the Google Sheets app). Each answer appears in its row within seconds: Status, who answered, their message and the time. You don't need to refresh; Google Sheets updates on its own.

**Handy formulas** (put them in another tab):
- Attending: `=COUNTIF(Guests!D:D,"Attending")`
- Not attending: `=COUNTIF(Guests!D:D,"Not attending")`
- Not answered yet: `=COUNTA(Guests!C2:C)-COUNTA(Guests!D2:D)`

## 2. Connect the Sheet to the website (Apps Script)

1. In the Sheet: **Extensions → Apps Script**.
2. Delete what's in `Code.gs` and paste everything from [`google-apps-script/Code.gs`](google-apps-script/Code.gs). Click 💾 **Save**.
3. Click **Deploy → New deployment**.
   - Gear icon ⚙ → **Web app**
   - Execute as: **Me**
   - Who has access: **Anyone**
   - Click **Deploy**, then **Authorize access**, choose your Google account.
     If you see *"Google hasn't verified this app"*, click **Advanced → Go to … (unsafe)**. That warning appears because it's your own script; it only accesses this one sheet.
4. Copy the **Web app URL** (ends in `/exec`).
5. Paste it into [`config.js`](config.js):
   ```js
   scriptUrl: "https://script.google.com/macros/s/XXXX/exec",
   ```
   Until this is set, the site runs in **demo mode** with sample names.

> If you later edit `Code.gs`, use **Deploy → Manage deployments → ✏ Edit → Version: New version → Deploy** so the URL stays the same.

Guests can only search (3+ letters, max 5 results). They can't see the full list or other people's answers.

## 3. Photos and music

Upload these on GitHub (**Add file → Upload files**) into these folders. Use these exact names:

| File | Where |
|---|---|
| `photo-1.jpg` | `assets/photos/` (first screen, portrait works best) |
| `photo-2.jpg` | `assets/photos/` (arch frame) |
| `photo-3.jpg` | `assets/photos/` (closing photo) |
| `music.mp3`   | `assets/audio/` (background music; keep under ~5 MB) |

Tip: resize photos to about 1600 px on the long side (under 500 KB) so the site loads fast on mobile data.

## 4. Put it online (Netlify, free)

1. Log in at <https://app.netlify.com>.
2. **Add new project → Import an existing project → GitHub**, and allow access to the `carol-ranel-wedding` repository.
3. Pick the repository. Settings:
   - Branch to deploy: `main`
   - Build command: *(leave empty)*
   - Publish directory: `.`
4. Click **Deploy**.
5. **Project configuration → Change project name** → `carol-and-ranel`.
   Your site is now **https://carol-and-ranel.netlify.app**.

Every change pushed to `main` re-publishes automatically.

## 5. Before sending to guests

- [ ] Search a test name on your phone and submit an RSVP. Check that the Sheet updates, then clear that test row's Status.
- [ ] Make the QR code on the printed invitation point to `https://carol-and-ranel.netlify.app`.
- [ ] RSVP closes automatically after **Oct 30, 2026** (set in `config.js` *and* `Code.gs`).
