# Digital Wedding / Engagement Invitation

A shareable single-link, phone-first invitation site. Pure static HTML/CSS/JS
+ Firebase Firestore for RSVPs and a real-time guestbook. No build step.

> **Status:** All 7 stages complete. Paste your Firebase config into `config.js` to enable RSVP + Guestbook.

---

## Quick start (local)

Any of these work — pick one:

```bash
# From the wedding/ folder:
python -m http.server 8000
# then open http://localhost:8000
```

or double-click `index.html` in Explorer to open it directly.

> Note: opening the file directly works because we're not using service workers,
> but the modern `<script type="module">` imports require a modern browser
> (Chrome, Firefox, Safari, Edge — all fine).

---

## Customizing the invitation

**Everything couple-specific lives in `config.js`.** Open it and edit:

| Section | What to change |
|---|---|
| `couple` | Groom & bride names, "Wedding" vs "Engagement", labels |
| `event`  | ISO datetime with timezone offset, welcome/reception times |
| `venue`  | Name, address, Google Maps embed src, deep link |
| `dressCode` | Label + array of hex colors for the palette swatches |
| `blessing` | The short invitation blurb |
| `gallery`  | Paths to photo files under `images/gallery/` |
| `music`    | Path to background track under `audio/` |
| `firebase` | See below |

That's the only file you should need to touch to reuse the site for another couple.

---

## Setting up Firebase (free)

Firestore stores the RSVP submissions and guestbook wishes. The free **Spark**
plan is more than enough.

1. Go to <https://console.firebase.google.com/> and click **Add project**.
2. Give it a name (e.g. `ahmed-sara-wedding`). You can skip Google Analytics.
3. Once the project is created, on the project overview page click the **`</>`
   Web** icon to add a Web app. Name it anything.
4. Firebase shows you a `firebaseConfig` object. **Copy those values.**
5. Open `config.js` in this folder. Paste each value into the `firebase: { … }`
   block, replacing every `"PASTE_YOURS"`.
6. Back in the Firebase console, go to **Build → Firestore Database → Create
   database**. Start in **production mode**, pick a region close to your guests.
7. Under the **Rules** tab, paste these rules and click **Publish** — this lets
   any guest add wishes / RSVPs and read the guestbook, but nobody can edit or
   delete existing entries:

   ```
   rules_version = '2';
   service cloud.firestore {
     match /databases/{database}/documents {
       match /guestbook/{doc} {
         allow read, create: if true;
         allow update, delete: if false;
       }
       match /rsvps/{doc} {
         allow create: if true;
         allow read, update, delete: if false;   // RSVPs are private to you
       }
     }
   }
   ```

8. Reload the site. The red "Firebase not configured" banner disappears once
   the placeholders are gone.

---

## Deploying to the internet (free)

### GitHub Pages
1. Push the `wedding/` folder to a GitHub repo (as the root, or move contents
   to root of a `wedding-site` repo).
2. Repo → **Settings → Pages** → source: `main` branch, `/ (root)`.
3. Wait ~1 min → the URL appears.

### Netlify (drag & drop)
1. Go to <https://app.netlify.com/drop>.
2. Drag the `wedding/` folder onto the page.
3. You get a live URL immediately. Rename the site in the dashboard.

### Vercel
1. `npx vercel` in the folder, follow prompts. Deploys as a static site.

---

## Features

- [x] **Landing / Cover** — animated open transition, background music toggle
- [x] **Announcement** — script-font names, gold corner flourishes, event-type header
- [x] **Photo Gallery** — responsive grid with hero tile, full-screen lightbox (Esc / ← → / click-outside)
- [x] **Event info** — live D/H/M/S countdown, month calendar with event day highlighted, `.ics` file download
- [x] **RSVP** — inline form → Firestore `rsvps` collection
- [x] **Venue map** — embedded Google Maps iframe (no API key) + "Open in Maps" deep link
- [x] **Dress code** — configurable label + circular color swatches
- [x] **Guestbook** — real-time wishes via Firestore `onSnapshot`, Arabic-safe (`dir="auto"`)

## Testing the guestbook

Open the site in two browser tabs side by side. Submit a wish in one — it will
appear at the top of the list in the other tab within a second, with no
manual refresh. Try a wish in Arabic to confirm RTL rendering.

---

## Project layout

```
wedding/
├── index.html
├── config.js          ← edit couple details here
├── README.md
├── css/
│   └── style.css
├── js/
│   ├── firebase-init.js   Firebase bootstrap + placeholder-config banner
│   ├── cover.js           Landing card + music toggle
│   ├── announcement.js    "The Wedding of" + couple names
│   ├── gallery.js         Grid + lightbox
│   ├── event-info.js      Blessing + times
│   ├── countdown.js       Live D/H/M/S timer
│   ├── calendar.js        Month grid, highlights event day
│   ├── ics.js             Add-to-Calendar → .ics download
│   ├── rsvp.js            RSVP form → Firestore
│   ├── venue.js           Map iframe + Open-in-Maps link
│   ├── dress-code.js      Palette swatches
│   ├── guestbook.js       Real-time wishes (onSnapshot)
│   └── reveal.js          Shared scroll-reveal
├── audio/                 drop your ambient track here as ambient.mp3
└── images/
    ├── cover.jpg
    └── gallery/           drop your photos here (1.jpg … 6.jpg)
```

## License

Personal use — customize freely.
