# MY RUNNER PROFILE — Pixel Race Portfolio + CMS

An interactive pixel-art (8/16-bit retro arcade) portfolio of running races, with a
horizontally-scrolling world, an animated runner sprite, and a simple CMS to manage
race data. Data is dynamic — served from a small Express API backed by a local JSON file.

## Tech stack

| Layer      | Choice                          | Why |
|------------|---------------------------------|-----|
| Runtime    | Node.js 24 (ESM)                | Already installed locally; native `fetch`, `--watch`. |
| Backend    | Express 4                       | Minimal REST API + static file serving. |
| Storage    | Local JSON file (`data/races.json`) | Zero setup, easy to back up/version, perfect for this scale. Swap for SQLite/Supabase later if needed. |
| Frontend   | Vanilla HTML/CSS/JS             | No build step. Pixel art done in pure CSS. |
| CMS/Admin  | Vanilla page at `/admin`        | Full CRUD + reorder, race manager, and a Theme Creator. |

Storage is intentionally JSON files. If you later outgrow it, the data layers are
isolated in `server/db.js` (races) and `server/themes.js` (themes) — you can replace
them with SQLite (`node:sqlite`) or a hosted DB (Supabase) without touching the API
routes or frontend.

## Project structure

```
RunningPortos/
├─ package.json
├─ data/
│  ├─ races.json          # races (edit via CMS, or by hand)
│  ├─ themes.json         # unified themes (6 editable presets seeded on first run)
│  ├─ media.json          # uploaded-asset registry (reference counts)
│  ├─ character.json      # runner sprite colors
│  └─ profile.json        # runner profile (name, PBs, bio, links)
├─ server/
│  ├─ index.js            # Express app + REST API + image upload
│  ├─ db.js               # races data layer (atomic writes, validation)
│  ├─ themes.js           # unified themes data layer (+ preset seeding)
│  ├─ media.js            # media library: reference counting + cleanup
│  ├─ character.js        # runner sprite color config data layer
│  ├─ profile.js          # runner profile data layer
│  └─ auth.js             # .env-based auth: env loader, signed sessions, middleware
├─ .env                   # your credentials + session secret (not committed)
├─ .env.example           # template — copy to .env and change the values
└─ public/
   ├─ index.html          # profile homepage + race timeline
   ├─ script.js           # fetches races/themes/character/profile, renders stages
   ├─ style.css           # all the pixel-art styling
   ├─ admin.html          # CMS page (Races / Theme Creator / Character / Runner Profile)
   ├─ admin.js            # CMS logic
   └─ uploads/            # uploaded assets (incl. landmark PNGs)
```

## Run it locally

Requires Node.js 20+ (tested on Node 24).

```bash
npm install
cp .env.example .env      # then edit .env and set your own credentials
npm start
```

Then open:

- Public portfolio: http://localhost:3000/
- CMS / Admin:       http://localhost:3000/admin  (requires login)

Dev mode with auto-restart on file changes:

```bash
npm run dev
```

> **Windows note:** if `npm` is blocked by PowerShell's execution policy
> (`running scripts is disabled on this system`), either run the commands from
> `cmd.exe`, or allow scripts for your user once:
> `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`.

## Authentication

The CMS and all data-changing APIs are protected by a simple username/password login.

- Credentials live in `.env`: `ADMIN_USERNAME`, `ADMIN_PASSWORD`, and `SESSION_SECRET`
  (used to sign session cookies). `SESSION_HOURS` controls how long a login lasts
  (default 12). **Change these before deploying** — never ship the defaults.
- Generate a strong secret with:
  `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
- Visiting `/admin` shows a retro pixel login form. On success the server sets an
  HTTP-only, signed session cookie; the dashboard then loads.
- The public page and read-only APIs (`GET /api/races`, `GET /api/themes`, `GET /api/meta`)
  stay open so the portfolio works without logging in. Everything that writes data —
  race/theme create, update, delete, reorder, uploads, and the media library — requires
  a valid session and returns `401` otherwise.

No auth libraries are used; sessions are stateless HMAC-signed tokens (no DB or session
store needed). This is intended for a single admin; for multi-user or production-grade
auth, swap `server/auth.js` for a real identity provider.

## Managing races (CMS)

Open `/admin`. You can:

- **Add** a new race (+ NEW RACE).
- **Edit** any race (EDIT) — the form fills in, save to update.
- **Delete** a race (DEL, with confirmation).
- **Reorder** chronologically with the ▲ / ▼ buttons, or set an explicit
  **Order** number in the form.

Every race supports these fields, all editable from the CMS:

| Field        | Notes |
|--------------|-------|
| Name         | Race title. |
| Date         | Date picker (stored ISO `YYYY-MM-DD`, shown in Indonesian on the public page). |
| Category     | `5K`, `10K`, `HM` (21K), `FM` (42K), `OTHER`. |
| Status       | `Finished`, `Upcoming`, `DNF` (Did Not Finish), or `DNS` (Did Not Start) — each shows a colored pixel badge on the card + timeline node. |
| Theme        | Any built-in or custom theme (see Theme Creator below). Dropdown is grouped. |
| Finish/PB    | Optional; shown as a highlighted row when set. |
| Personal Best | Checkbox. When on, a glowing gold "PERSONAL BEST" ribbon appears above the race card on the public page. |
| Certificate  | Optional PDF/image file (upload or Media Library) or link. A "📜 SERTIFIKAT" button shows on the public card — only for `FINISHED` races — opening the certificate in a new tab. |
| Target/Note  | Optional free text. |

The **Theme** dropdown lists the 6 built-in themes plus any custom themes you make
in the Theme Creator, and controls the pixel background + landmark the public page
renders for that race.

## Theme Creator (CMS → "Theme Creator" tab)

Build your own pixel themes without touching code. Each theme has:

| Attribute        | Notes |
|------------------|-------|
| Name             | Shown in the race form dropdown. |
| Primary / Secondary color | Drive the landmark, lane markings, and neon glow. |
| Sky gradient (top/bottom) | The stage background gradient. |
| Track / Road style | `Asphalt`, `Dirt`, `Synthetic Red`, `Synthetic Blue`. |
| Atmosphere       | `Daytime`, `Sunset`, `Night / Neon`, `Rain`, `Confetti`. |
| Background image | Optional pixel sky/landscape (URL or upload). |
| Landmark image   | Optional ornament (URL or upload); falls back to a colored block. |

Themes are **unified** — there is no built-in vs custom split. The 6 original themes
(GBK, Monas, Modern City, Tangerang, Gedung Sate, Marathon Festival) ship as editable
**preset defaults** seeded into `data/themes.json` on first run, each pointing at a
transparent landmark PNG in the Media Library.
Every theme — preset or new — can be edited or deleted like any other.

A **live mini preview** updates in real time as you change colors, track, atmosphere,
or assets — showing the runner sprite over your theme.

**Image Cropper:** when you upload a background or landmark image, a cropper opens
(Cropper.js) with a suggested aspect ratio (16:9 for backgrounds, 1:1 for landmarks)
and quick ratio buttons. Crop & Upload applies the crop; Use Original skips it.
Recommended sizes are shown next to each field (background 1920×1080, landmark 512×512 PNG).

**Media Library:** the LIBRARY button next to each image field opens a gallery of every
uploaded asset (with dimensions and file size). Click one to reuse it without
re-uploading. Unused assets can be deleted from here; assets still in use show a
reference badge and are protected.

## Media & storage cleanup

Uploads are reference-counted in `data/media.json`:

- When a theme stops referencing an image (you change or clear the field, or delete
  the theme), the file is automatically removed from disk once nothing else uses it.
- On startup the server reconciles the `uploads/` folder — any file physically present
  but untracked gets registered, then orphans (referenced by nothing) are swept. This
  keeps the folder from accumulating stale files.
- `POST /api/media/cleanup` triggers the same sweep on demand.

## Public Settings (⚙ gear, top-right)

- **SFX** — 8-bit sound effects on click/navigation.
- **Music** — a generated chiptune background track (no audio file needed).
- **Race Info position** — Top / Middle / Bottom placement of the race card.

All three preferences are saved to `localStorage` and restored on the next visit.
Audio starts after the PRESS START screen (browsers require a user gesture).

## Character Customizer (CMS → "Character" tab)

The runner sprite is a proportioned pixel human assembled from CSS blocks (head, hair,
torso/jersey, arms with hands, shorts, legs, shoes) with natural idle and running
animations. Its look is a single config stored in `data/character.json` and applied
to the runner everywhere on the public page.

In the CMS Character tab you can set the **skin tone**, **hair/cap color**,
**jersey color**, and **shorts color** — each via a color picker + hex field with
quick preset swatches. The legs are two-segment (thigh + calf) so the running cycle
shows a natural knee bend. The default pixel sprite is always used; there is no
sprite-sheet upload.

A **live preview** shows both the idle and running animations and updates instantly as
you change colors. Colors are validated server-side (invalid hex falls back to the
default). The public page reads `GET /api/character`; saving requires login.

## Runner Profile + Homepage

The public landing page is a **profile homepage**: the customized runner sprite on a
track, the runner's name + tagline, a Personal Best table (5K / 10K / HM / FM), a short
bio, and Strava / social links. Clicking **ENTER RACE TIMELINE** plays the sprite's run
animation, then fades out seamlessly into the race timeline.

The bottom race timeline auto-scrolls to keep the active race centered. On mobile it
caps to ~4 visible nodes and slides within a fixed-width window so the `◄`/`►`
navigation arrows are never pushed off-screen.

Edit it in the CMS **Runner Profile** tab (name, tagline, bio, the four PBs, and
Strava / Instagram / Website links). Only `http(s)` links are accepted; empty links are
hidden on the homepage. `GET /api/profile` is public; `PUT` requires login.

**A theme in use** by a race cannot be deleted until you reassign those races (the API
returns `409` and lists the races using it).

**Image uploads** are saved to `public/uploads/` and served from `/uploads/...`.
Allowed types: png, jpg, jpeg, gif, webp. Max size: 3 MB.

## REST API

Base URL: `http://localhost:3000/api`

Endpoints marked **🔒** require an authenticated session (login first).

| Method | Path                | Body                        | Description |
|--------|---------------------|-----------------------------|-------------|
| POST   | `/login`            | `{ username, password }`    | Log in; sets the session cookie. |
| POST   | `/logout`           | —                           | Clear the session. |
| GET    | `/session`          | —                           | `{ authenticated, user }`. |
| GET    | `/character`        | —                           | Runner sprite config (colors + optional sprite sheet). |
| PUT    | `/character` 🔒     | character fields            | Save the runner config (colors). |
| GET    | `/profile`          | —                           | Runner profile (name, tagline, bio, PBs, links). |
| PUT    | `/profile` 🔒       | profile fields              | Save the runner profile. |
| GET    | `/meta`             | —                           | Categories, statuses, track styles, atmospheres, and the full theme list. |
| GET    | `/races`            | —                           | All races, sorted by `order`. |
| GET    | `/races/:id`        | —                           | One race. |
| POST   | `/races` 🔒         | race fields                 | Create. |
| PUT    | `/races/:id` 🔒     | race fields                 | Update. |
| DELETE | `/races/:id` 🔒     | —                           | Delete. |
| POST   | `/races/reorder` 🔒 | `{ "order": ["id1","id2"] }`| Set chronological order. |
| GET    | `/themes`           | —                           | All themes (unified list). |
| GET    | `/themes/:id`       | —                           | One theme. |
| POST   | `/themes` 🔒        | theme fields                | Create a theme. |
| PUT    | `/themes/:id` 🔒    | theme fields                | Update a theme. |
| DELETE | `/themes/:id` 🔒    | —                           | Delete a theme (`409` if a race still uses it). |
| POST   | `/upload?name=file.pdf` 🔒 | raw file bytes       | Upload an image (png/jpg/gif/webp) or PDF (race certificate, up to 8 MB); registers it in the media library and returns its metadata. |
| GET    | `/media` 🔒         | —                           | All tracked uploads (newest first). |
| DELETE | `/media?url=/uploads/x.png` 🔒 | —                | Delete an unused asset (`409` if still referenced). |
| POST   | `/media/cleanup` 🔒 | —                           | Reconcile + sweep orphaned uploads. |

## Themes & landmark assets

All themes live in one store (`data/themes.json`) and are fully editable in the CMS —
there is no code-level theme anymore. The 6 preset themes are seeded on first run,
each with a landmark PNG already included in `public/uploads/`.

To restyle a preset, edit its colors/atmosphere in the Theme Creator, or replace its
landmark image with your own upload.
