# Notification Mirror

See your S24 Ultra's notifications on your Mac, grouped by app and saved in Google Sheets. Costs nothing.

```
Phone (MacroDroid) ──POST──► Apps Script ──► Google Sheet ◄──GET── docs/index.html on the Mac
```

| Piece | File |
|---|---|
| Backend (stores and serves notifications) | `apps-script/Code.gs` |
| Mac web app | `docs/index.html` |

---

## 1. Google Sheet + Apps Script (about 5 min)

1. Go to **sheets.new** and name the sheet `Notification Mirror`.
2. **Extensions → Apps Script**. Delete the sample code, paste in all of `apps-script/Code.gs`, and press **Save** (⌘S).
3. In the function dropdown at the top, pick **`setup`** and click **Run**.
   - Google will ask for permission. Click **Review permissions**, choose your account, then **Advanced → Go to … (unsafe)** → **Allow**.
     The warning shows up because you wrote the script yourself and Google hasn't reviewed it. It only gets access to this one sheet.
   - The **Execution log** at the bottom will show `Your secret token: ...`. **Copy that token.**
4. **Deploy → New deployment** → click the gear icon → **Web app**
   - Execute as: **Me**
   - Who has access: **Anyone** *(MacroDroid can't sign in to Google. The token keeps everyone else out.)*
   - Click **Deploy**, then copy the **Web app URL** (it ends in `/exec`).
5. Test it from the Mac Terminal (replace the two placeholders):
   ```bash
   curl -L "YOUR_EXEC_URL?token=YOUR_TOKEN" \
     -H "Content-Type: application/json" \
     -d '{"app":"Test","package":"test","title":"Hello","text":"From my Mac"}'
   ```
   You should get `{"ok":true}`, and a new row should show up in the **Notifications** tab.

> **Changing the script later:** use **Deploy → Manage deployments → ✏️ → Version: New version → Deploy**.
> This keeps the same URL. "New deployment" creates a *new* URL.

---

## 2. MacroDroid on the S24 Ultra (about 10 min)

1. Install **MacroDroid** from the Play Store. The free version allows 5 macros, and you only need one.
2. **Add Macro** and name it `Mirror notifications`.
3. **Trigger:** tap + → **Device Events → Notification** (or search for "Notification") → **Notification Received**
   - Applications: **Any application**. You can also pick specific apps, or use *exclude* to leave some out.
   - Content: **Any**
   - If you see **Ignore ongoing notifications**, turn it on. It skips music players, downloads and navigation.
   - When MacroDroid asks for **Notification access**, grant it.
4. **Action:** tap + → **Web Interactions → HTTP Request**
   - Method: **POST**
   - URL: `YOUR_EXEC_URL?token=YOUR_TOKEN`
   - Content body / content type: **application/json**
   - Body (type the outline, then insert each `[...]` value with the **magic text** button so the names come out exactly right):
     ```json
     {"app":"{not_app_name}","package":"{not_app_package}","title":"{not_title}","text":"{notification}","big":"{not_big_text}","lines":"{not_text_lines}"}
     ```
     In the magic text list these are *Notification app name*, *Notification app package*, *Notification title*, *Notification text*,
     *Notification big text* and *Notification text lines*. Each `{...}` should be the magic text item alone, with no extra `[ ]` around it.
     WhatsApp group messages arrive in *big text* / *text lines* with *text* empty. The script keeps whichever field has the most content.
     **Keep the keys in this exact order.** The script uses the order to recover messages that contain quotes or line breaks.
   - Leave "block next actions" and "save response" off.
5. No constraints are needed. **Save** the macro.
6. Test it: send yourself a WhatsApp message or email. A row should appear in the sheet within a few seconds.
   (MacroDroid's log may say the request "failed" because Google answers with a redirect. If the row showed up in the sheet, it worked.)

### Stop Samsung from killing it (important)

One UI shuts down background apps aggressively. If you skip this, logging will quietly stop after a while.

- **Settings → Apps → MacroDroid → Battery → Unrestricted**
- **Settings → Device care → Battery → Background usage limits → Never sleeping apps → add MacroDroid**
- In MacroDroid's own settings, keep its persistent notification turned on.

---

## 3. The Mac web app

**Live at https://simplyrks.github.io/notification-mirror/** (published from `docs/index.html` with GitHub Pages).
The page is public, but it holds no data: your Apps Script URL and token are saved only in your own browser.

1. Open the link above and bookmark it. In Safari you can use **File → Add to Dock** so it behaves like an app.
2. Click ⚙️ and paste the **Web app URL** and **token**. Click **Test connection**, then **Save**.
3. Use it:
   - The sidebar lists every app with its count and a blue badge for unseen notifications. Click an app to see its timeline.
   - Time range: last 24 h, 7 days, 30 days, or everything loaded.
   - Press **/** to search across all titles and messages.
   - It checks for new notifications every 30 seconds (you can change this in settings), and again whenever you switch back to the tab.
   - The browser tab title shows the unseen count, e.g. `(3) Notifications`.
   - Click any notification to read it in large text (← → move between notifications, A−/A+ change the size).
4. **Mac notifications:** click the 🔔 button in the top bar and allow notifications. Each new phone notification then
   pops up on your Mac, and clicking it opens the large-text view. This works while the page is open, even in a background
   tab or minimized. Background tabs are checked about once a minute, so notifications can arrive up to a minute late.
   For banners that stay on screen until you dismiss them, go to **System Settings → Notifications → your browser** and choose **Alerts**.

Your URL and token are stored only in this browser's local storage, never in the file. That means you can put the file on GitHub Pages without exposing them.

Click **Try demo data** on the start screen to preview the app before anything is connected.

---

## Tuning

| Want to… | Do this |
|---|---|
| Never store certain apps (banking, OTP) | Add their package names to `BLOCKLIST` in `Code.gs`, then deploy a new version. You can also exclude them in the MacroDroid trigger. |
| Find an app's package name | Look at the `package` column in the sheet |
| Change duplicate handling | `DEDUPE_SECONDS` in `Code.gs`. An identical app + title + text within 90 s is stored once, which hides Android's repeated updates of the same notification. |
| Clear old data | Delete rows in the sheet. The web app picks this up on its next full reload. |

## Limits worth knowing

- A sheet holds about 10M cells. At 6 columns that's about 1.6M notifications, which is years of normal use.
- The web app loads the newest 5,000 notifications. Older ones stay in the sheet.
- Notification content is stored in plain text in **your** Google Drive. Use the blocklist for anything you'd rather not keep.
