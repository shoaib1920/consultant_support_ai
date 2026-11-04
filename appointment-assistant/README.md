# Appointment Assistant

A simple tool for study-visa consultancies to **manage visa-appointment data and fill official forms faster**. It has two parts that share one list of students:

1. **Web dashboard** (`dashboard.html`) — add students one at a time or import a whole list, track each appointment, see reminders, and open a copy-paste **booking data sheet** per student.
2. **Chrome extension** — on the official site that *you* have opened and logged into, click once to **fill the visible form fields** with the selected student's data.

## What it does and does not do

**It does:** store student data on your computer, keep appointment status and reminders, and fill the fields of a form you have open so staff don't retype the same details for every student.

**It never does:** book or submit anything, click "next"/"confirm", search or refresh for available slots, open tabs by itself, run in the background, or get past any check (including photo/selfie/liveness or captcha). **A staff member always opens the site, reviews the filled form, and clicks "book" themselves.** This is deliberate: automatically grabbing appointment slots breaks the embassy/VFS rules and is illegal in many places, and it would put the consultancy (and us) at risk. This tool only removes the typing, not the human.

## Sign in, free trial, and blocking non-payers

The app requires a sign-in. Each consultancy gets its own account, so you control who can use it.

- **14-day free trial.** The first time an account signs in, a 14-day trial starts automatically. The top bar shows how many days are left. When the 14 days are up, the app shows a "Free trial ended" screen and the dashboard is locked until you activate them.
- **Mark an account as paid.** In the [Firebase console](https://console.firebase.google.com) → Firestore → `apptLicenses` → the account's document, set `status` to `paid`. That account now has full access with no time limit.
- **Block someone who won't pay.** In the same place, set `status` to `blocked`. Next time they open the app (it checks on every launch), they are locked out with a "contact your provider" message.
- **This cannot be bypassed by editing the app.** The trial length and the paid/blocked switch live in Firestore, and the security rules let a client *read* its own licence and *start* its trial once — but never set itself to `paid`, move the trial start, or un-block itself. So even someone who opens the app's code cannot unlock it.

Accounts are created by you (no public sign-up), the same way as VisaGuard users — in the Firebase console → Authentication → Add user, or through your VisaGuard admin.

## Set up Firebase (one time)

This app uses the **same Firebase project as VisaGuard**, but its own separate collection (`apptLicenses`), so it never touches VisaGuard's data. Student data is **not** uploaded — it stays on each consultancy's computer.

1. **Paste your keys.** Open `firebase-config.js` and fill in the five values from your VisaGuard `.env.local` (`NEXT_PUBLIC_FIREBASE_*`). These are public by design.
2. **Publish the rules.** The licence rule was added to `firestore.rules` in the project root. From the project root run:

   ```bash
   firebase deploy --only firestore:rules
   ```

Until the keys are pasted, the app opens with a "Not set up yet" message instead of the login page.

## Run the web dashboard

No build needed. Open `login.html` in Chrome, sign in, and the dashboard opens. Data is saved in that browser on that computer.

To use it on a phone or another computer over your network, from this folder run:

```bash
python -m http.server 8777
```

then open `http://<this-computer-ip>:8777/login.html`.

## Install the Chrome extension

1. Open `chrome://extensions` in Chrome.
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and choose this `appointment-assistant` folder.
4. Pin the extension. Its dashboard (from the popup's **Dashboard** button) and the website share the same student list.

## Daily use

1. **Add students** — type one in, or paste a CSV/JSON list into "Import many students at once". Columns like `Full Name, Passport Number, Date of Birth, Nationality, Email, Phone` are recognised automatically.
2. **Check readiness** — the table shows whether each student's key details and photo/documents are ready before booking.
3. **Book an appointment** — open the official site yourself and log in. Click the extension, pick the student, and press **Fill the open form**. Review every field, then click the site's own book button. (No extension? Open the student's **Data sheet** on the dashboard and copy each value.)
4. **Track and remember** — set the status, date, location and reference on the dashboard. The Reminders panel shows what is overdue or due within 7 days.

## Files

| File | What it is |
|---|---|
| `core.js` | All the data logic (import parsing, booking sheet, readiness, reminders, field matching) **and the pure trial/licence rule**. No DOM or network. |
| `storage.js` | Saves the student list on this computer (extension storage, or the browser's localStorage). |
| `login.html` / `login.js` | The sign-in page (Firebase email/password). |
| `firebase-config.js` | Your Firebase keys (public). Paste your values once. |
| `firebase-glue.js` | Sign-in and the trial/licence record in Firestore (`apptLicenses/<uid>`). |
| `gate.js` | Runs before the dashboard: not signed in → login; trial over / paused → block screen. |
| `dashboard.html` / `dashboard.js` / `styles.css` | The dashboard. |
| `manifest.json` / `popup.html` / `popup.js` | The extension popup. |
| `content-fill.js` | Injected only when you click "Fill"; fills fields and stops. Never clicks anything. |
| `main.js` / `package.json` | Desktop (.exe) wrapper — opens the same dashboard as a program. |
| `vendor/firebase-*-compat.js` | The Firebase SDK, bundled locally so the app works without a CDN. |
| `tests/core.test.js` | Logic tests, licence rule included. Run `node --test` in this folder (no dependencies). |
| `tests/demo-form.html` | A fake visa form for trying the fill safely. |

## Tests

```bash
node --test
```

## Desktop app (.exe)

The app also runs as a Windows program. It opens the same login and dashboard in its own window — same sign-in, same trial, same licence check.

**Run it in development:**

```bash
npm install
npm start
```

**Build the distributable .exe:**

```bash
npm run dist
```

This produces `dist/AppointmentAssistant.exe` — a single portable file you can send to a consultancy; they just double-click it, no install. (On a machine with little free space on `C:`, point the build caches elsewhere first: set `ELECTRON_CACHE`, `ELECTRON_BUILDER_CACHE` and `npm_config_cache` to a folder on a drive with room.)

`node_modules/` and `dist/` are git-ignored, so they are never committed.
