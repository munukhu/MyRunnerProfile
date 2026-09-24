/* ============================================================
   RUN QUEST 2026 — Public page (dynamic, API-driven)
   ============================================================ */

/* Themes are now fully data-driven (landmark PNG + colours). No hard-coded
   CSS landmarks remain — every theme renders the same way. */

/* Shared runner sprite body-part markup (used by homepage sprite; the in-game
   runner uses the same structure). Redesigned as a jointed pixel athlete:
   arms bend at the elbow (.lower forearm + .hand), legs bend at the knee
   (.lower calf + .shoe foot). Back-side limbs render first (behind torso),
   front-side limbs last (in front). */
const SPRITE_HTML = `
  <span class="rp arm arm-back"><span class="lower"><span class="hand"></span></span></span>
  <span class="rp leg leg-back"><span class="lower"><span class="shoe"></span></span></span>
  <span class="rp hair"></span>
  <span class="rp head"></span>
  <span class="rp face"></span>
  <span class="rp neck"></span>
  <span class="rp torso"></span>
  <span class="rp shorts"></span>
  <span class="rp leg leg-front"><span class="lower"><span class="shoe"></span></span></span>
  <span class="rp arm arm-front"><span class="lower"><span class="hand"></span></span></span>`;

/* ---------- Category code -> display label ---------- */
const CATEGORY_LABELS = {
  "5K": "5K",
  "10K": "10K",
  "HM": "HALF MARATHON (HM · 21K)",
  "FM": "MARATHON (FM · 42K)",
  "OTHER": "SPECIAL"
};

/* ---------- Date (ISO or free text) -> Indonesian display ---------- */
const ID_MONTHS = ["JANUARI","FEBRUARI","MARET","APRIL","MEI","JUNI",
  "JULI","AGUSTUS","SEPTEMBER","OKTOBER","NOVEMBER","DESEMBER"];
function formatDate(value) {
  if (!value) return "TBA";
  // ISO yyyy-mm-dd
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (m) {
    const [, y, mo, d] = m;
    return `${parseInt(d, 10)} ${ID_MONTHS[parseInt(mo, 10) - 1]} ${y}`;
  }
  return value.toUpperCase();
}

// Short date for the nav timeline popup, e.g. "20 Sep 2026" (or the raw value if unparseable)
const ID_MONTHS_SHORT = ["Jan","Feb","Mar","Apr","Mei","Jun",
  "Jul","Agu","Sep","Okt","Nov","Des"];
function shortDate(value) {
  if (!value) return "TBA";
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value).trim());
  if (m) {
    const [, y, mo, d] = m;
    return `${parseInt(d, 10)} ${ID_MONTHS_SHORT[parseInt(mo, 10) - 1]} ${y}`;
  }
  return String(value);
}
// Retro ellipsis wrap for the timeline indicator, e.g. "..20 Sep 2026.."
function ellipsisDate(value) {
  return `..${shortDate(value)}..`;
}
// Timeline node date: DD-MMM-YY, uppercase, 2-digit year -> e.g. "14 JUN 26"
function tlDate(value) {
  if (!value) return "TBA";
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value).trim());
  if (m) {
    const [, y, mo, d] = m;
    const mon = ID_MONTHS_SHORT[parseInt(mo, 10) - 1].toUpperCase();
    return `${String(parseInt(d, 10)).padStart(2, "0")} ${mon} ${y.slice(2)}`;
  }
  return String(value).toUpperCase();
}

function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/* ---------- Track style -> road color (custom themes) ---------- */
/* Asphalt is now near-black (street asphalt) as the default track. */
const TRACK_COLORS = {
  "asphalt": "#14141a",
  "dirt": "#6b4a2a",
  "synthetic-red": "#c8384a",
  "synthetic-blue": "#2f6fb0"
};

/* ---------- Race status -> label + badge class ---------- */
const STATUS_META = {
  finished: { label: "FINISHED", cls: "st-finished" },
  upcoming: { label: "UPCOMING", cls: "st-upcoming" },
  dnf:      { label: "DNF",      cls: "st-dnf" },
  dns:      { label: "DNS",      cls: "st-dns" }
};
function statusMeta(s) { return STATUS_META[s] || STATUS_META.upcoming; }

/* ---------- Theme registry, keyed by id ---------- */
let THEMES_BY_ID = {};

/* ---------- DOM refs ---------- */
const track       = document.getElementById("track");
const world       = document.getElementById("world");
const runner      = document.getElementById("runner");
const dots        = document.getElementById("stage-dots");
const prevBtn     = document.getElementById("prev-btn");
const nextBtn     = document.getElementById("next-btn");
const stageNum    = document.getElementById("stage-num");
const stageTotal  = document.getElementById("stage-total");
const clearedCnt  = document.getElementById("cleared-count");
const clearedTot  = document.getElementById("cleared-total");
const hudTitle    = document.getElementById("hud-title");
const raceStatus  = document.getElementById("race-status");
const timeline    = document.getElementById("timeline-indicator");
const bootScreen  = document.getElementById("boot-screen");
const startBtn    = document.getElementById("start-btn");
const loadingEl   = document.getElementById("loading");
const emptyEl     = document.getElementById("empty");
// Settings modal
const settingsBtn   = document.getElementById("settings-btn");
const settingsModal = document.getElementById("settings-modal");
const settingsClose = document.getElementById("settings-close");
const setSfxBtn     = document.getElementById("set-sfx");
const setMusicBtn   = document.getElementById("set-music");
const setLandmarkBtn = document.getElementById("set-landmark");
const setPosition   = document.getElementById("set-position");

let RACES = [];
let current = 0;
let animating = false;
let soundOn = false;
let musicOn = false;
let showLandmark = true;
let infoPosition = "middle";

/* ============================================================
   8-bit sound engine (Web Audio, no assets needed)
   ============================================================ */
let audioCtx = null;
function ensureAudio() {
  if (!audioCtx) {
    try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); }
    catch (e) { audioCtx = null; }
  }
  if (audioCtx && audioCtx.state === "suspended") audioCtx.resume();
}
function beep(freq, dur = 0.08, type = "square", vol = 0.12) {
  if (!soundOn || !audioCtx) return;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(vol, audioCtx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + dur);
  osc.connect(gain).connect(audioCtx.destination);
  osc.start();
  osc.stop(audioCtx.currentTime + dur);
}
function sfxMove() {
  if (!soundOn) return;
  [440, 660, 880].forEach((f, i) => setTimeout(() => beep(f, 0.07, "square"), i * 45));
}
function sfxStep() { beep(180 + Math.random() * 40, 0.04, "square", 0.06); }
function sfxClick() { beep(520, 0.05, "square", 0.1); }
function sfxStart() {
  if (!soundOn) return;
  [330, 440, 550, 660, 880].forEach((f, i) =>
    setTimeout(() => beep(f, 0.09, "square"), i * 70));
}
let stepTimer = null;
function startStepLoop() {
  stopStepLoop();
  stepTimer = setInterval(() => { if (soundOn) sfxStep(); }, 130);
}
function stopStepLoop() { if (stepTimer) { clearInterval(stepTimer); stepTimer = null; } }

/* ============================================================
   Sky cosmetics — random pixel-art objects drifting in the sky
   ------------------------------------------------------------
   Objects spawn one at a time into the CURRENTLY VISIBLE stage's
   .sky-cosmetics layer, at randomised intervals, then animate
   across the sky and self-remove. The object palette is chosen to
   match the stage's atmosphere (day vs night vs festive).
   ============================================================ */

/* Per-atmosphere object pools with diverse varieties.
   `dir` = travel direction: "ltr"/"rtl" horizontal, "diag" falling meteor, "static" sun/moon, "twinkle" star.
   Durations are base seconds; scaled dynamically by the parallax depth engine. */
const SKY_OBJECTS = {
  // Daytime pool: birds, flocks, airliner, retro biplane, colorful balloons, blimp, glowing sun
  day: [
    { type: "bird",    weight: 4, dir: "rtl", min: 10, max: 15, top: [8, 36] },
    { type: "bird",    weight: 3, dir: "ltr", min: 10, max: 15, top: [10, 38] },
    { type: "flock",   weight: 3, dir: "rtl", min: 12, max: 17, top: [6, 28] },
    { type: "flock",   weight: 2, dir: "ltr", min: 12, max: 17, top: [8, 30] },
    { type: "plane",   weight: 2, dir: "ltr", min: 16, max: 22, top: [6, 20] },
    { type: "biplane", weight: 3, dir: "rtl", min: 14, max: 20, top: [8, 24] },
    { type: "balloon", weight: 3, dir: "rtl", min: 20, max: 28, top: [10, 44] },
    { type: "balloon", weight: 2, dir: "ltr", min: 20, max: 28, top: [12, 46] },
    { type: "blimp",   weight: 2, dir: "ltr", min: 24, max: 32, top: [6, 22] },
    { type: "sun",     weight: 1, dir: "static", top: [6, 14], side: "right" }
  ],
  // Sunset pool: warm silhouettes, birds, flocks, biplane, sunset planes, balloons, blimp, giant glowing sunset sun
  sunset: [
    { type: "bird",    weight: 4, dir: "rtl", min: 10, max: 15, top: [8, 36] },
    { type: "flock",   weight: 3, dir: "rtl", min: 12, max: 17, top: [6, 28] },
    { type: "balloon", weight: 4, dir: "rtl", min: 20, max: 28, top: [10, 44] },
    { type: "balloon", weight: 3, dir: "ltr", min: 20, max: 28, top: [12, 46] },
    { type: "plane",   weight: 2, dir: "ltr", min: 16, max: 22, top: [6, 20] },
    { type: "biplane", weight: 2, dir: "rtl", min: 14, max: 20, top: [8, 26] },
    { type: "blimp",   weight: 2, dir: "rtl", min: 24, max: 32, top: [6, 22] },
    { type: "sun",     weight: 1, dir: "static", top: [8, 16], side: "right" }
  ],
  // Night pool: bright meteors, glowing moon, twinkling stars, UFO, supersonic night jet, night blimp
  night: [
    { type: "meteor",  weight: 5, dir: "diag", min: 1.1, max: 1.9, top: [2, 24] },
    { type: "star",    weight: 6, dir: "twinkle", min: 2.0, max: 3.8, top: [4, 42] },
    { type: "moon",    weight: 1, dir: "static", top: [5, 14], side: "right" },
    { type: "ufo",     weight: 2, dir: "ltr", min: 12, max: 18, top: [8, 24] },
    { type: "jet",     weight: 2, dir: "rtl", min: 8,  max: 13, top: [6, 20] },
    { type: "blimp",   weight: 1, dir: "ltr", min: 24, max: 32, top: [6, 22] }
  ],
  // Festive/confetti pool: multi-color balloons, twinkling stars, flock, airship, biplane
  festive: [
    { type: "balloon", weight: 5, dir: "rtl", min: 18, max: 26, top: [8, 44] },
    { type: "balloon", weight: 4, dir: "ltr", min: 18, max: 26, top: [10, 46] },
    { type: "star",    weight: 4, dir: "twinkle", min: 1.8, max: 3.2, top: [4, 36] },
    { type: "flock",   weight: 3, dir: "rtl", min: 11, max: 16, top: [8, 30] },
    { type: "biplane", weight: 2, dir: "ltr", min: 14, max: 20, top: [8, 24] },
    { type: "blimp",   weight: 2, dir: "ltr", min: 22, max: 30, top: [6, 22] }
  ]
};

/* Map an atmosphere name to an object pool. */
function skyPoolFor(atm) {
  if (atm === "night-neon") return SKY_OBJECTS.night;
  if (atm === "confetti")   return SKY_OBJECTS.festive;
  if (atm === "sunset")     return SKY_OBJECTS.sunset;
  return SKY_OBJECTS.day;                             // daytime / rain / default
}

function randRange(min, max) { return min + Math.random() * (max - min); }
function pickWeighted(pool) {
  const total = pool.reduce((s, o) => s + (o.weight || 1), 0);
  let r = Math.random() * total;
  for (const o of pool) { r -= (o.weight || 1); if (r <= 0) return o; }
  return pool[pool.length - 1];
}

let skyTimer = null;
const SKY_REDUCED = window.matchMedia
  && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/* Build the inner pixel markup for a given object type. Kept as small nested
   spans so everything stays crisp pixel art driven by CSS. */
function skyObjectInner(type) {
  switch (type) {
    case "bird":    return '<span class="w1"></span><span class="w2"></span>';
    case "flock":   return '<span class="fb fb1"><span class="w1"></span><span class="w2"></span></span>' +
                           '<span class="fb fb2"><span class="w1"></span><span class="w2"></span></span>' +
                           '<span class="fb fb3"><span class="w1"></span><span class="w2"></span></span>';
    case "plane":   return '<span class="body"></span><span class="wing"></span><span class="tail"></span>';
    case "biplane": return '<span class="prop"></span><span class="body"></span><span class="wing-t"></span><span class="wing-b"></span><span class="tail"></span>';
    case "blimp":   return '<span class="hull"></span><span class="cabin"></span><span class="fin-t"></span><span class="fin-b"></span><span class="beacon"></span>';
    case "jet":     return '<span class="body"></span><span class="wing"></span><span class="tail"></span><span class="afterburner"></span>';
    case "balloon": return '<span class="envelope"></span><span class="basket"></span>';
    case "sun":     return '<span class="ray"></span>';
    case "moon":    return '<span class="crater c-a"></span><span class="crater c-b"></span>';
    case "meteor":  return '<span class="trail"></span><span class="rock"></span>';
    case "ufo":     return '<span class="dome"></span><span class="hull"></span>';
    case "star":    return '';
    default:        return '';
  }
}

/* Spawn one object into the active stage's sky layer. */
function spawnSkyObject() {
  const stage = track.children[current];
  if (!stage) return;
  const layer = stage.querySelector(".sky-cosmetics");
  if (!layer) return;
  // Increased density cap to 10 objects for a rich and vibrant sky
  if (layer.childElementCount > 10) return;

  const pool = skyPoolFor(stage.dataset.atm || "daytime");
  const spec = pickWeighted(pool);

  const el = document.createElement("div");
  el.className = "sky-obj so-" + spec.type + " dir-" + spec.dir;
  el.innerHTML = skyObjectInner(spec.type);

  // Random Scaling: 1.0x to 2.0x for parallax depth effect
  const scale = Number(randRange(1.0, 2.0).toFixed(2));
  const scaleT = (scale - 1.0) / (2.0 - 1.0); // 0.0 (distant) to 1.0 (foreground)
  el.style.setProperty("--scale", scale);

  // Parallax layer: larger objects appear in front (higher z-index)
  el.style.zIndex = Math.round(3 + scaleT * 12);

  // Distance haze: distant objects (1.0x) slightly softer, foreground (2.0x) crisp and full
  if (spec.dir !== "static" && spec.dir !== "twinkle") {
    el.style.opacity = (0.80 + scaleT * 0.20).toFixed(2);
  }

  // Balloon colorful palettes variation
  if (spec.type === "balloon") {
    const pal = pickWeighted([
      { env: "#ff4d6d", stripe: "#ffffff", weight: 3 },
      { env: "#ffd23f", stripe: "#ff4d6d", weight: 3 },
      { env: "#4cc9f0", stripe: "#ffd23f", weight: 3 },
      { env: "#a855f7", stripe: "#38f56b", weight: 2 },
      { env: "#ff7849", stripe: "#ffffff", weight: 3 },
      { env: "#38f56b", stripe: "#1a1a2e", weight: 2 }
    ]);
    el.style.setProperty("--balloon-env", pal.env);
    el.style.setProperty("--balloon-stripe", pal.stripe);
  }

  const topPct = randRange(spec.top[0], spec.top[1]);
  el.style.top = topPct + "%";

  let life;
  if (spec.dir === "static") {
    // Sun / moon: park in top corner, gentle fade in-out, scale 1.0x - 1.6x
    const sunMoonScale = Number(randRange(1.0, 1.6).toFixed(2));
    el.style.setProperty("--scale", sunMoonScale);
    el.style[spec.side === "right" ? "right" : "left"] = randRange(6, 16) + "%";
    life = randRange(14, 20) * 1000;
    el.style.animationDuration = "6s";
  } else if (spec.dir === "twinkle") {
    // Stars: fixed position, blink a few times, random scale
    el.style.left = randRange(5, 95) + "%";
    const dur = randRange(spec.min, spec.max);
    el.style.animationDuration = dur + "s";
    life = dur * 1000 * randRange(1.3, 2.5);
  } else {
    // Moving objects (birds, planes, biplanes, blimps, meteors, ufo, etc.):
    // PARALLAX EFFECT:
    // Scale 1.0x (distant) moves slower (speedMultiplier ~0.78x -> duration ~1.28x)
    // Scale 2.0x (close) moves faster (speedMultiplier ~1.45x -> duration ~0.69x)
    const speedMult = 0.78 + scaleT * 0.67; // 0.78 at 1.0x, 1.45 at 2.0x
    const baseDur = randRange(spec.min, spec.max);
    const dur = Number((baseDur / speedMult).toFixed(2));
    el.style.animationDuration = dur + "s";
    life = dur * 1000 + 500;
  }

  layer.appendChild(el);
  // Self-remove after its life, or when the CSS animation ends.
  const kill = () => el.remove();
  el.addEventListener("animationend", kill, { once: true });
  setTimeout(kill, life + 300);
}

/* Randomised spawn loop: schedules the next spawn 1.4–3.2s out so the sky is lively */
function scheduleSkyObject() {
  const delay = randRange(1400, 3200);
  skyTimer = setTimeout(() => {
    if (document.visibilityState === "visible") spawnSkyObject();
    scheduleSkyObject();
  }, delay);
}
function startSkyCosmetics() {
  if (SKY_REDUCED || skyTimer) return;
  // A few quick initial staggered spawns so the sky is populated right away
  setTimeout(spawnSkyObject, 250);
  setTimeout(spawnSkyObject, 900);
  setTimeout(spawnSkyObject, 1800);
  scheduleSkyObject();
}
function stopSkyCosmetics() {
  if (skyTimer) { clearTimeout(skyTimer); skyTimer = null; }
}
// Pause spawning while the tab is hidden (saves work + avoids pile-up).
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") stopSkyCosmetics();
  else startSkyCosmetics();
});

/* ============================================================
   Build stages + dots from RACES
   ============================================================ */
function buildStages() {
  track.innerHTML = "";
  dots.innerHTML = "";

  RACES.forEach((race, i) => {
    const stage = document.createElement("section");
    stage.className = "stage";
    stage.dataset.index = i;

    const theme = THEMES_BY_ID[race.theme] || null;

    // "View Cert" button — only for FINISHED races that have a certificate
    const certBtn = (race.status === "finished" && race.certificate)
      ? `<button class="cert-btn pixel-btn" data-cert="${esc(race.certificate)}" title="View race certificate">📜 SERTIFIKAT</button>`
      : "";

    // "Gallery" button — any race with a gallery link (external URL, opens new tab)
    const galleryBtn = race.galleryLink
      ? `<a class="gallery-btn pixel-btn" href="${esc(race.galleryLink)}" target="_blank" rel="noopener noreferrer" title="Lihat galeri foto">🖼 GALERI</a>`
      : "";

    // PB star badge — fancy tilted SVG star with "PB" centred, glowing
    const pbBadge = race.personalBest
      ? `<div class="pb-badge" aria-label="Personal Best">
           <svg class="pb-star-svg" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
             <defs>
               <radialGradient id="pb-grad" cx="50%" cy="38%" r="62%" fx="50%" fy="28%">
                 <stop offset="0%"   stop-color="#fffbe0"/>
                 <stop offset="35%"  stop-color="#ffd23f"/>
                 <stop offset="72%"  stop-color="#e0a41f"/>
                 <stop offset="100%" stop-color="#b8730a"/>
               </radialGradient>
             </defs>
             <!-- outer dark stroke (pixel border) -->
             <polygon class="pb-star-shadow" points="50,3 62,35 97,35 70,56 80,90 50,69 20,90 30,56 3,35 38,35"/>
             <!-- main gold star -->
             <polygon class="pb-star-fill"   points="50,3 62,35 97,35 70,56 80,90 50,69 20,90 30,56 3,35 38,35"/>
             <!-- inner bright highlight (top-half sheen) -->
             <polygon class="pb-star-shine"  points="50,10 60,37 88,37 66,52 74,80 50,63 26,80 34,52 12,37 40,37"/>
             <!-- "PB" label -->
             <text class="pb-star-text" x="50" y="60">PB</text>
           </svg>
         </div>`
      : "";
    if (race.personalBest) stage.classList.add("has-pb");
    const catLabel = CATEGORY_LABELS[race.category] || race.category;

    // Landmark: image if the theme has one, else a colored placeholder block
    let landmark;
    if (theme && theme.landmarkImage) {
      landmark = `<img class="landmark landmark-img" src="${esc(theme.landmarkImage)}" alt="" />`;
    } else {
      const pc = theme ? theme.primaryColor : "#4cc9f0";
      const sc = theme ? theme.secondaryColor : "#ffd23f";
      landmark = `<div class="landmark landmark-fallback" style="background:${esc(pc)};color:${esc(sc)}"></div>`;
    }

    // Every theme renders the same way; atmosphere drives the FX layer.
    stage.dataset.theme = "custom";
    const atm = theme ? theme.atmosphere : "daytime";
    stage.dataset.atm = atm;                 // used by the sky-cosmetics engine
    if (theme) stage.classList.add("atm-" + atm);

    const finishRow = race.finishTime
      ? `<div class="card-row finish">
           <span class="row-label">Finish Time</span>
           <span class="row-value">${esc(race.finishTime)}</span>
         </div>`
      : "";
    const noteRow = race.note
      ? `<div class="card-note">${esc(race.note)}</div>` : "";

    // Optional background image layer + atmosphere FX (for every theme)
    const bgLayer = theme && theme.backgroundImage
      ? `<div class="bg-image" style="background-image:url('${esc(theme.backgroundImage)}')"></div>`
      : "";
    const fxLayer = `<div class="atm-fx"></div>`;

    stage.innerHTML = `
      <div class="sky"></div>
      ${bgLayer}
      <div class="sky-cosmetics"></div>
      <div class="clouds">
        <div class="cloud"></div>
        <div class="cloud c2"></div>
        <div class="cloud c3"></div>
      </div>
      <div class="landmark-wrap">${landmark}</div>
      ${fxLayer}
      <div class="card pixel-border">
        <div class="card-header">
          <div class="card-title">${esc(race.name)}</div>
          <div class="status-badge ${statusMeta(race.status).cls}">${statusMeta(race.status).label}</div>
        </div>
        <div class="card-row">
          <span class="row-label">Tanggal</span>
          <span class="row-value">${formatDate(race.date)}</span>
        </div>
        <div class="card-row">
          <span class="row-label">Kategori</span>
          <span class="row-value">${esc(catLabel)}</span>
        </div>
        ${finishRow}
        ${noteRow}
        <div class="card-foot">
          <span class="card-cat">RACE ${i + 1} / ${RACES.length}</span>
          ${certBtn}
          ${galleryBtn}
        </div>
        ${pbBadge}
      </div>
      <div class="ground">
        <div class="track-lane"></div>
        <div class="lane-line"></div>
      </div>
    `;
    track.appendChild(stage);

    // Apply theme colors inline for every stage
    if (theme) {
      // expose the theme accent so sky cosmetics (e.g. balloons) match it
      stage.style.setProperty("--accent", theme.primaryColor);
      const sky = stage.querySelector(".sky");
      sky.style.background = `linear-gradient(180deg, ${theme.skyTop} 0%, ${theme.skyBottom} 100%)`;
      const ground = stage.querySelector(".ground");
      ground.style.background = TRACK_COLORS[theme.trackStyle] || TRACK_COLORS.asphalt;
      const lane = stage.querySelector(".track-lane");
      lane.style.background = theme.secondaryColor;
      const laneLine = stage.querySelector(".lane-line");
      laneLine.style.background =
        `repeating-linear-gradient(90deg, ${theme.primaryColor} 0 24px, transparent 24px 48px)`;
    }
  });

  buildTimeline();
}

// Open a race certificate (PNG) in the built-in in-page preview modal
const certModal = document.getElementById("cert-modal");
const certImg   = document.getElementById("cert-img");
function openCertModal(url) {
  if (!certModal || !certImg || !url) return;
  certImg.src = url;
  certModal.classList.add("show");
  certModal.setAttribute("aria-hidden", "false");
}
function closeCertModal() {
  if (!certModal) return;
  certModal.classList.remove("show");
  certModal.setAttribute("aria-hidden", "true");
  if (certImg) certImg.src = "";
}
track.addEventListener("click", (e) => {
  const btn = e.target.closest(".cert-btn");
  if (!btn) return;
  openCertModal(btn.dataset.cert);
});
if (certModal) {
  document.getElementById("cert-close").addEventListener("click", closeCertModal);
  certModal.addEventListener("click", (e) => { if (e.target === certModal) closeCertModal(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeCertModal(); });
}

/* ============================================================
   Horizontal timeline (replaces the old per-dot popups)
   A single track line with a date marker per race. No overlap
   with the runner: it lives in the footer strip.
   ============================================================ */
let tlTrack = null;
function buildTimeline() {
  dots.innerHTML = "";
  tlTrack = document.createElement("div");
  tlTrack.className = "tl-track";
  RACES.forEach((race, i) => {
    const marker = document.createElement("button");
    marker.className = "tl-node st-" + race.status;
    marker.setAttribute("aria-label", `${race.name} — ${shortDate(race.date)}`);
    marker.innerHTML = `
      <span class="tl-dot"></span>
      <span class="tl-date">${esc(tlDate(race.date))}</span>`;
    marker.addEventListener("click", () => goTo(i));
    tlTrack.appendChild(marker);
  });
  dots.appendChild(tlTrack);
}

// Slide the inner track so the active node is centered in the viewport.
function scrollTimeline() {
  if (!tlTrack) return;
  const node = tlTrack.children[current];
  if (!node) return;
  const viewport = dots.clientWidth;
  const nodeCenter = node.offsetLeft + node.offsetWidth / 2;
  let offset = viewport / 2 - nodeCenter;
  // clamp so we don't scroll past the ends
  const maxScroll = Math.max(0, tlTrack.scrollWidth - viewport);
  offset = Math.min(0, Math.max(-maxScroll, offset));
  tlTrack.style.transform = `translateX(${offset}px)`;
}

/* ============================================================
   Navigation
   ============================================================ */
function updateHUD() {
  const race = RACES[current];
  if (!race) return;
  if (stageNum) stageNum.textContent = current + 1;
  if (stageTotal) stageTotal.textContent = RACES.length;
  if (hudTitle) hudTitle.textContent = race.name;
  const cleared = RACES.filter(r => r.status === "finished").length;
  if (clearedCnt) clearedCnt.textContent = cleared;
  if (clearedTot) clearedTot.textContent = RACES.length;

  // Status is shown on the card badge + timeline node now; keep footer slot clear.
  if (raceStatus) { raceStatus.textContent = ""; raceStatus.className = "status-badge hidden"; }

  // Highlight the active timeline node + slide it into view
  if (tlTrack) {
    [...tlTrack.children].forEach((d, i) => d.classList.toggle("active", i === current));
    scrollTimeline();
  }

  prevBtn.disabled = current === 0;
  nextBtn.disabled = current === RACES.length - 1;
}

function scrollToCurrent() {
  track.style.transform = `translateX(${-current * 100}vw)`;
}

function goTo(index, viaButton = false) {
  index = Math.max(0, Math.min(RACES.length - 1, index));
  if (index === current || animating) {
    if (index === current && viaButton) sfxClick();
    return;
  }
  animating = true;
  const direction = index > current ? 1 : -1;

  runner.classList.remove("idle");
  runner.classList.add("run");
  runner.style.transform = direction === 1
    ? "translateX(-50%) scaleX(1)"
    : "translateX(-50%) scaleX(-1)";

  sfxMove();
  startStepLoop();

  runner.style.left = direction === 1 ? "62%" : "38%";

  current = index;
  scrollToCurrent();
  updateHUD();

  const settle = () => {
    runner.style.left = "50%";
    runner.style.transform = "translateX(-50%) scaleX(1)";
    runner.classList.remove("run");
    runner.classList.add("idle");
    stopStepLoop();
    animating = false;
  };
  clearTimeout(goTo._t);
  goTo._t = setTimeout(settle, 620);
}

function next() { goTo(current + 1, true); }
function prev() { goTo(current - 1, true); }

/* ============================================================
   Settings — SFX, Music (BGM), race-info position
   Persisted to localStorage.
   ============================================================ */
const SETTINGS_KEY = "runquest.settings";

// Default race-info card position: Top on mobile, Middle on desktop.
function defaultInfoPosition() {
  return (window.matchMedia && window.matchMedia("(max-width: 560px)").matches) ? "top" : "middle";
}
function loadSettings() {
  try {
    const s = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}");
    soundOn = !!s.sfx;
    musicOn = !!s.music;
    showLandmark = s.showLandmark !== false;
    // Respect a saved choice; otherwise pick the viewport-appropriate default.
    infoPosition = ["top", "middle", "bottom"].includes(s.position)
      ? s.position : defaultInfoPosition();
  } catch {
    soundOn = false; musicOn = false; showLandmark = true; infoPosition = defaultInfoPosition();
  }
}
function saveSettings() {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({
      sfx: soundOn, music: musicOn, showLandmark: showLandmark, position: infoPosition
    }));
  } catch { /* ignore */ }
}

function applyToggleBtn(btn, on) {
  btn.dataset.on = String(on);
  btn.textContent = on ? "ON" : "OFF";
}
function applyInfoPosition(pos) {
  infoPosition = pos;
  document.body.classList.remove("info-top", "info-middle", "info-bottom");
  document.body.classList.add("info-" + pos);
  [...setPosition.children].forEach((b) =>
    b.classList.toggle("active", b.dataset.pos === pos));
}

function applyLandmark(on) {
  showLandmark = on;
  if (setLandmarkBtn) applyToggleBtn(setLandmarkBtn, on);
  document.body.classList.toggle("hide-landmark", !on);
}

function setLandmark(on) {
  applyLandmark(on);
  if (soundOn) sfxClick();
  saveSettings();
}

function setSound(on) {
  soundOn = on;
  applyToggleBtn(setSfxBtn, on);
  if (on) { ensureAudio(); sfxClick(); }
  saveSettings();
}

function setMusic(on) {
  musicOn = on;
  applyToggleBtn(setMusicBtn, on);
  if (on) { ensureAudio(); startBGM(); } else { stopBGM(); }
  saveSettings();
}

// Apply loaded settings to the UI + world
function applySettings() {
  applyToggleBtn(setSfxBtn, soundOn);
  applyToggleBtn(setMusicBtn, musicOn);
  applyLandmark(showLandmark);
  applyInfoPosition(infoPosition);
}

/* ---------- Chiptune BGM (Web Audio, generated — no asset) ---------- */
let bgmTimer = null;
let bgmStep = 0;
// A simple looping square-wave melody + bass (C minor pentatonic-ish vibe)
const BGM_MELODY = [523, 0, 659, 784, 0, 659, 523, 587, 659, 0, 784, 659, 587, 0, 523, 0];
const BGM_BASS   = [131, 131, 165, 165, 196, 196, 165, 147];
function bgmNote(freq, dur, type, vol) {
  if (!audioCtx || freq <= 0) return;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0.0001, audioCtx.currentTime);
  gain.gain.exponentialRampToValueAtTime(vol, audioCtx.currentTime + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + dur);
  osc.connect(gain).connect(audioCtx.destination);
  osc.start();
  osc.stop(audioCtx.currentTime + dur);
}
function startBGM() {
  if (!audioCtx || bgmTimer) return;
  const tempo = 200; // ms per step
  bgmStep = 0;
  bgmTimer = setInterval(() => {
    if (!musicOn) return;
    const m = BGM_MELODY[bgmStep % BGM_MELODY.length];
    bgmNote(m, 0.18, "square", 0.05);
    if (bgmStep % 2 === 0) {
      const b = BGM_BASS[(bgmStep / 2) % BGM_BASS.length];
      bgmNote(b, 0.22, "triangle", 0.08);
    }
    bgmStep++;
  }, tempo);
}
function stopBGM() {
  if (bgmTimer) { clearInterval(bgmTimer); bgmTimer = null; }
}

/* ---------- Settings modal open/close + controls ---------- */
function openSettings() { settingsModal.classList.add("show"); }
function closeSettings() { settingsModal.classList.remove("show"); }

settingsBtn.addEventListener("click", () => { ensureAudio(); openSettings(); });
settingsClose.addEventListener("click", closeSettings);
settingsModal.addEventListener("click", (e) => { if (e.target === settingsModal) closeSettings(); });
setSfxBtn.addEventListener("click", () => setSound(!soundOn));
setMusicBtn.addEventListener("click", () => setMusic(!musicOn));
if (setLandmarkBtn) setLandmarkBtn.addEventListener("click", () => setLandmark(!showLandmark));
setPosition.addEventListener("click", (e) => {
  const b = e.target.closest("button[data-pos]");
  if (!b) return;
  applyInfoPosition(b.dataset.pos);
  saveSettings();
  if (soundOn) sfxClick();
});

/* ============================================================
   Gestures / wheel / keyboard
   ============================================================ */
let touchStartX = 0, touchStartY = 0, touching = false;
world.addEventListener("touchstart", e => {
  touching = true;
  touchStartX = e.touches[0].clientX;
  touchStartY = e.touches[0].clientY;
}, { passive: true });
world.addEventListener("touchend", e => {
  if (!touching) return;
  touching = false;
  const dx = e.changedTouches[0].clientX - touchStartX;
  const dy = e.changedTouches[0].clientY - touchStartY;
  if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) {
    if (dx < 0) next(); else prev();
  }
}, { passive: true });

let wheelLock = false;
world.addEventListener("wheel", e => {
  const amount = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
  if (Math.abs(amount) < 20 || wheelLock) return;
  wheelLock = true;
  if (amount > 0) next(); else prev();
  setTimeout(() => { wheelLock = false; }, 700);
}, { passive: true });

document.addEventListener("keydown", e => {
  if (e.key === "ArrowRight") next();
  else if (e.key === "ArrowLeft") prev();
  else if (e.key === "m" || e.key === "M") setSound(!soundOn);
});

/* ============================================================
   Data load + boot
   ============================================================ */
async function loadRaces() {
  const res = await fetch("/api/races");
  if (!res.ok) throw new Error(`API ${res.status}`);
  return res.json();
}

async function loadThemes() {
  try {
    const res = await fetch("/api/themes");
    if (!res.ok) return {};
    const list = await res.json();
    const map = {};
    list.forEach((t) => { map[t.id] = t; });
    return map;
  } catch {
    return {}; // themes are optional; built-in CSS themes still work
  }
}

async function loadCharacter() {
  try {
    const res = await fetch("/api/character");
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

async function loadProfile() {
  try {
    const res = await fetch("/api/profile");
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

// Render the profile homepage from /api/profile
function renderProfile(p) {
  if (!p) return;
  const setText = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  setText("home-name", p.name || "RUNNER");
  const tag = document.getElementById("home-tagline");
  if (tag) { tag.textContent = p.tagline || ""; tag.style.display = p.tagline ? "" : "none"; }
  const bio = document.getElementById("home-bio");
  if (bio) { bio.textContent = p.bio || ""; bio.style.display = p.bio ? "" : "none"; }

  // PBs
  document.querySelectorAll("#home-pbs .pb-v").forEach((el) => {
    const k = el.getAttribute("data-pb");
    const v = p.pbs && p.pbs[k];
    el.textContent = v ? v : "—";
    el.classList.toggle("has", !!v);
  });

  // Social links (only render the ones that are set)
  const links = document.getElementById("home-links");
  if (links) {
    links.innerHTML = "";
    const entries = [
      ["STRAVA", p.strava],
      ["INSTAGRAM", p.instagram],
      ["WEBSITE", p.website]
    ].filter(([, url]) => url);
    entries.forEach(([label, url]) => {
      const a = document.createElement("a");
      a.className = "home-link pixel-btn";
      a.href = url; a.target = "_blank"; a.rel = "noopener noreferrer";
      a.textContent = label;
      links.appendChild(a);
    });
  }
}

// Apply character colours as CSS vars on :root so BOTH the in-game runner and
// the start-screen sprite stay in sync.
function applyCharacter(c) {
  if (!c) return;
  const root = document.documentElement;
  root.style.setProperty("--skin", c.skinTone);
  root.style.setProperty("--hair", c.hairColor);
  root.style.setProperty("--jersey", c.jerseyColor);
  root.style.setProperty("--shorts", c.shortsColor);
  if (c.shoesColor) root.style.setProperty("--shoe", c.shoesColor);
}

async function init() {
  prevBtn.addEventListener("click", prev);
  nextBtn.addEventListener("click", next);

  // Load + apply persisted settings before anything renders
  loadSettings();
  applySettings();

  startBtn.addEventListener("click", () => {
    if (bootScreen.dataset.starting === "1") return;
    bootScreen.dataset.starting = "1";
    ensureAudio();                 // audio can only start after a user gesture
    if (soundOn) sfxStart();
    if (musicOn) startBGM();       // resume BGM if it was left on

    // Play the "runner sprints into the track" intro, then reveal race 1.
    const bootRunner = document.getElementById("boot-runner");
    startBtn.disabled = true;
    bootScreen.classList.add("launching");   // hides button/hint, keeps sprite
    if (bootRunner) {
      bootRunner.classList.remove("idle");
      bootRunner.classList.add("run");        // running animation
    }
    if (soundOn) startStepLoop();

    // after the run-across, fade the homepage out seamlessly, then reveal timeline
    setTimeout(() => {
      stopStepLoop();
      bootScreen.classList.add("fade");        // opacity -> 0 (CSS transition)
      if (runner) { runner.classList.remove("idle"); runner.classList.add("run"); }
      setTimeout(() => {
        bootScreen.classList.add("hidden");
        // settle the in-game runner back to idle shortly after
        setTimeout(() => {
          if (runner) { runner.classList.remove("run"); runner.classList.add("idle"); }
        }, 500);
      }, 450);                                  // matches the fade duration
    }, 1000);
  });

  // Inject the runner sprite body parts into the homepage sprite
  const bootSprite = document.getElementById("boot-sprite");
  if (bootSprite) bootSprite.innerHTML = SPRITE_HTML;

  try {
    const [racesData, themesMap, character, profile] = await Promise.all([
      loadRaces(), loadThemes(), loadCharacter(), loadProfile()
    ]);
    RACES = racesData;
    THEMES_BY_ID = themesMap;
    applyCharacter(character);
    renderProfile(profile);
  } catch (err) {
    loadingEl.innerHTML = `<div>⚠ FAILED TO LOAD</div>
      <div style="font-size:9px;line-height:1.6">Is the server running?<br>${esc(err.message)}</div>`;
    return;
  }

  loadingEl.classList.add("hidden");

  if (!RACES.length) {
    emptyEl.classList.remove("hidden");
    return;
  }

  buildStages();
  current = 0;
  updateHUD();
  scrollToCurrent();
  runner.classList.add("idle");
  startSkyCosmetics();   // begin the random sky object spawns
}

document.addEventListener("DOMContentLoaded", init);
