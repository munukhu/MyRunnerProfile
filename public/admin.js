/* ============================================================
   RUN QUEST 2026 — CMS Admin logic
   Talks to the REST API in server/index.js
   ============================================================ */

// Fallback swatch colors (only used if a theme somehow lacks a primaryColor)
const BUILTIN_SWATCH = {
  gbk: "#24476b", monas: "#f77f6b", smartfren: "#d81b8c",
  tangerang: "#8fd3a0", bandung: "#56ab2f", jrf: "#4b2c78"
};
// Populated from /api/meta: id -> theme object
let themeById = {};
function themeName(id) { return themeById[id]?.name || id; }
function themeSwatch(id) {
  const t = themeById[id];
  if (t && t.primaryColor) return t.primaryColor;
  return BUILTIN_SWATCH[id] || "#444";
}

const CATEGORY_LABELS = {
  "5K": "5K",
  "10K": "10K",
  "HM": "Half Marathon (21K)",
  "FM": "Full Marathon (42K)",
  "OTHER": "Other / Special"
};
const STATUS_LABELS = {
  finished: "Finished",
  upcoming: "Upcoming",
  dnf: "DNF (Did Not Finish)",
  dns: "DNS (Did Not Start)"
};
// Badge tint per status for the admin race list
const STATUS_TAG_STYLE = {
  finished: "background:var(--good);color:#04210f",
  upcoming: "background:var(--accent-2);color:#fff",
  dnf: "background:#ff8c1a;color:#2a1400",
  dns: "background:#6a6a86;color:#fff"
};

/* ---------- DOM ---------- */
const $ = (id) => document.getElementById(id);
const form      = $("race-form");
const formTitle = $("form-title");
const listEl    = $("race-list");
const listEmpty = $("list-empty");
const countEl   = $("count");
const errEl     = $("form-err");
const toastEl   = $("toast");

const fId       = $("f-id");
const fName     = $("f-name");
const fDate     = $("f-date");
const fCategory = $("f-category");
const fStatus   = $("f-status");
const fTheme    = $("f-theme");
const fFinish   = $("f-finish");
const fOrder    = $("f-order");
const fNote     = $("f-note");
const fPb       = $("f-pb");
const fCert     = $("f-cert");
const fGallery  = $("f-gallery");

let races = [];
let meta = { themes: [], categories: [], statuses: [], trackStyles: [], atmospheres: [] };
let editingId = null;

/* ---------- Helpers ---------- */
function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function toast(msg, isErr = false) {
  toastEl.textContent = msg;
  toastEl.className = "toast show" + (isErr ? " err" : "");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => (toastEl.className = "toast"), 2200);
}
async function api(path, opts = {}) {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...opts
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) {
    // Session expired or missing — bounce to the login gate.
    showLoginGate();
    throw new Error("Please log in again.");
  }
  if (!res.ok) {
    const msg = Array.isArray(data.error) ? data.error.join(", ") : (data.error || `Error ${res.status}`);
    throw new Error(msg);
  }
  return data;
}
function fillSelect(sel, values, labels) {
  sel.innerHTML = "";
  values.forEach((v) => {
    const opt = document.createElement("option");
    opt.value = v;
    opt.textContent = labels[v] || v;
    sel.appendChild(opt);
  });
}

/* ---------- Load meta + races ---------- */
async function loadMeta() {
  meta = await api("/api/meta");
  fillSelect(fCategory, meta.categories, CATEGORY_LABELS);
  fillSelect(fStatus, meta.statuses, STATUS_LABELS);
  buildThemeMap(meta.themes || []);
  buildThemeDropdown();
}

// Build id -> theme lookup from the combined theme list
function buildThemeMap(themes) {
  themeById = {};
  themes.forEach((t) => { themeById[t.id] = t; });
}

// Grouped dropdown: Built-in themes + Custom themes
function buildThemeDropdown() {
  const themes = meta.themes || [];
  const prev = fTheme.value;
  fTheme.innerHTML = "";
  themes.forEach((t) => {
    const opt = document.createElement("option");
    opt.value = t.id;
    opt.textContent = t.name;
    fTheme.appendChild(opt);
  });
  if (prev && themeById[prev]) fTheme.value = prev;
}
async function loadRaces() {
  races = await api("/api/races");
  renderList();
}

/* ---------- Render list ---------- */
function renderList() {
  listEl.innerHTML = "";
  countEl.textContent = races.length ? `(${races.length})` : "";
  listEmpty.style.display = races.length ? "none" : "block";

  races.forEach((r, i) => {
    const item = document.createElement("div");
    item.className = "race-item";
    item.innerHTML = `
      <span class="order-badge">${r.order ?? i + 1}</span>
      <div class="swatch" style="background:${esc(themeSwatch(r.theme))}" title="${esc(themeName(r.theme))}"></div>
      <div class="info">
        <div class="rname">${esc(r.name)}</div>
        <div class="rmeta">
          <span class="tag" style="${STATUS_TAG_STYLE[r.status] || STATUS_TAG_STYLE.upcoming}">${(STATUS_LABELS[r.status] || r.status).toUpperCase().replace(/ \(.*/, "")}</span>
          ${r.personalBest ? `<span class="tag" style="background:var(--accent);color:#2a1a00">★ PB</span>` : ""}
          ${esc(r.date)} · ${esc(CATEGORY_LABELS[r.category] || r.category)}${r.finishTime ? " · " + esc(r.finishTime) : ""}
        </div>
      </div>
      <div class="ops">
        <button class="pixel-btn ghost" data-act="up"   data-id="${esc(r.id)}" ${i === 0 ? "disabled" : ""}>▲</button>
        <button class="pixel-btn ghost" data-act="down" data-id="${esc(r.id)}" ${i === races.length - 1 ? "disabled" : ""}>▼</button>
        <button class="pixel-btn ghost" data-act="edit" data-id="${esc(r.id)}">EDIT</button>
        <button class="pixel-btn warn ghost" data-act="del" data-id="${esc(r.id)}">DEL</button>
      </div>
    `;
    listEl.appendChild(item);
  });
}

/* ---------- List actions (event delegation) ---------- */
listEl.addEventListener("click", async (e) => {
  const btn = e.target.closest("button[data-act]");
  if (!btn) return;
  const id = btn.dataset.id;
  const act = btn.dataset.act;

  try {
    if (act === "edit") {
      startEdit(id);
    } else if (act === "del") {
      const race = races.find((r) => r.id === id);
      if (!confirm(`Delete "${race?.name || id}"? This cannot be undone.`)) return;
      await api(`/api/races/${id}`, { method: "DELETE" });
      if (editingId === id) resetForm();
      await loadRaces();
      toast("Race deleted");
    } else if (act === "up" || act === "down") {
      await move(id, act === "up" ? -1 : 1);
    }
  } catch (err) {
    toast(err.message, true);
  }
});

async function move(id, delta) {
  const idx = races.findIndex((r) => r.id === id);
  const target = idx + delta;
  if (idx < 0 || target < 0 || target >= races.length) return;
  const ids = races.map((r) => r.id);
  [ids[idx], ids[target]] = [ids[target], ids[idx]];
  races = await api("/api/races/reorder", {
    method: "POST",
    body: JSON.stringify({ order: ids })
  });
  renderList();
  toast("Order updated");
}

/* ---------- Form: create / edit ---------- */
function resetForm() {
  editingId = null;
  form.reset();
  fId.value = "";
  errEl.textContent = "";
  formTitle.textContent = "ADD RACE";
  // sensible defaults
  fStatus.value = "upcoming";
  fTheme.value = (meta.themes && meta.themes[0]?.id) || "gbk";
  fCategory.value = "10K";
}

function startEdit(id) {
  const r = races.find((x) => x.id === id);
  if (!r) return;
  editingId = id;
  fId.value = r.id;
  fName.value = r.name;
  fDate.value = r.date;
  fCategory.value = r.category;
  fStatus.value = r.status;
  fTheme.value = r.theme;
  fFinish.value = r.finishTime || "";
  fOrder.value = r.order || "";
  fNote.value = r.note || "";
  fPb.checked = !!r.personalBest;
  fCert.value = r.certificate || "";
  fGallery.value = r.galleryLink || "";
  formTitle.textContent = `EDIT: ${r.name}`;
  errEl.textContent = "";
  window.scrollTo({ top: 0, behavior: "smooth" });
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  errEl.textContent = "";

  const payload = {
    name: fName.value.trim(),
    date: fDate.value,
    category: fCategory.value,
    status: fStatus.value,
    theme: fTheme.value,
    finishTime: fFinish.value.trim(),
    note: fNote.value.trim(),
    personalBest: fPb.checked,
    certificate: fCert.value.trim(),
    galleryLink: fGallery.value.trim()
  };
  if (fOrder.value) payload.order = Number(fOrder.value);

  if (!payload.name) { errEl.textContent = "Race name is required."; return; }
  if (!payload.date) { errEl.textContent = "Date is required."; return; }

  try {
    if (editingId) {
      await api(`/api/races/${editingId}`, { method: "PUT", body: JSON.stringify(payload) });
      toast("Race updated");
    } else {
      await api("/api/races", { method: "POST", body: JSON.stringify(payload) });
      toast("Race created");
    }
    resetForm();
    await loadRaces();
  } catch (err) {
    errEl.textContent = err.message;
  }
});

$("new-btn").addEventListener("click", () => {
  resetForm();
  window.scrollTo({ top: 0, behavior: "smooth" });
});
$("cancel-btn").addEventListener("click", resetForm);

/* ============================================================
   TABS
   ============================================================ */
document.querySelectorAll(".tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
    document.querySelectorAll(".view").forEach((v) => v.classList.remove("active"));
    tab.classList.add("active");
    $("view-" + tab.dataset.view).classList.add("active");
  });
});

/* ============================================================
   THEME CREATOR
   ============================================================ */
const TRACK_LABELS = {
  "asphalt": "Asphalt (black)",
  "dirt": "Dirt / Trail (brown)",
  "synthetic-red": "Synthetic Track (red)",
  "synthetic-blue": "Synthetic Track (blue)"
};
const TRACK_COLORS = {
  "asphalt": "#14141a",
  "dirt": "#6b4a2a",
  "synthetic-red": "#c8384a",
  "synthetic-blue": "#2f6fb0"
};
const ATMOSPHERE_LABELS = {
  "daytime": "Daytime",
  "sunset": "Sunset",
  "night-neon": "Night / Neon",
  "rain": "Rain",
  "confetti": "Confetti / Festive"
};

const tForm       = $("theme-form");
const tFormTitle  = $("theme-form-title");
const tErr        = $("theme-err");
const tGrid       = $("theme-grid");
const tEmpty      = $("theme-empty");
const tCount      = $("theme-count");

const tId         = $("t-id");
const tName       = $("t-name");
const tPrimary    = $("t-primary");
const tSecondary  = $("t-secondary");
const tSkyTop     = $("t-skytop");
const tSkyBottom  = $("t-skybottom");
const tTrack      = $("t-track");
const tAtmosphere = $("t-atmosphere");
const tBg         = $("t-bg");
const tLandmark   = $("t-landmark");

// mini preview refs
const mini        = $("mini-preview");
const mSky        = mini.querySelector(".m-sky");
const mBg         = mini.querySelector(".m-bg");
const mLandImg    = mini.querySelector(".m-landmark");
const mLandFb     = mini.querySelector(".m-landmark-fallback");
const mGround     = mini.querySelector(".m-ground");
const mLane       = mini.querySelector(".m-lane");

let customThemes = [];
let editingThemeId = null;

// Sync each color text field with its color picker
function linkColor(textId, pickerId) {
  const text = $(textId);
  const picker = $(pickerId);
  picker.addEventListener("input", () => { text.value = picker.value; updatePreview(); });
  text.addEventListener("input", () => {
    if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(text.value)) picker.value = text.value;
    updatePreview();
  });
}
linkColor("t-primary", "t-primary-c");
linkColor("t-secondary", "t-secondary-c");
linkColor("t-skytop", "t-skytop-c");
linkColor("t-skybottom", "t-skybottom-c");
[tTrack, tAtmosphere, tBg, tLandmark].forEach((el) =>
  el.addEventListener("input", updatePreview));

function currentThemeFromForm() {
  return {
    name: tName.value.trim(),
    primaryColor: tPrimary.value.trim(),
    secondaryColor: tSecondary.value.trim(),
    skyTop: tSkyTop.value.trim(),
    skyBottom: tSkyBottom.value.trim(),
    trackStyle: tTrack.value,
    atmosphere: tAtmosphere.value,
    backgroundImage: tBg.value.trim(),
    landmarkImage: tLandmark.value.trim()
  };
}

// Refresh whichever previews exist (theme + character) after an image pick/upload
function refreshPreviews() {
  try { updatePreview(); } catch { /* theme preview may not be relevant */ }
  try { updateCharPreview(); } catch { /* character preview may not be ready */ }
}

// Live preview — mirrors how the public page renders a custom theme
function updatePreview() {
  const t = currentThemeFromForm();
  mSky.style.background = `linear-gradient(180deg, ${t.skyTop} 0%, ${t.skyBottom} 100%)`;

  if (t.backgroundImage) {
    mBg.style.backgroundImage = `url("${t.backgroundImage}")`;
    mBg.style.display = "block";
  } else {
    mBg.style.backgroundImage = "";
    mBg.style.display = "none";
  }

  if (t.landmarkImage) {
    mLandImg.src = t.landmarkImage;
    mLandImg.hidden = false;
    mLandFb.style.display = "none";
  } else {
    mLandImg.hidden = true;
    mLandFb.style.display = "block";
    mLandFb.style.background = t.primaryColor;
    mLandFb.style.color = t.secondaryColor; // used for neon glow
  }

  const trackColor = TRACK_COLORS[t.trackStyle] || "#3a3a44";
  mGround.style.background = trackColor;
  mLane.style.background = t.secondaryColor;

  // atmosphere class
  mini.className = "mini atm-" + t.atmosphere;
}

async function loadCustomThemes() {
  customThemes = await api("/api/themes/custom");
  renderThemeGrid();
}

function renderThemeGrid() {
  tGrid.innerHTML = "";
  tCount.textContent = customThemes.length ? `(${customThemes.length})` : "";
  tEmpty.style.display = customThemes.length ? "none" : "block";

  customThemes.forEach((t) => {
    const card = document.createElement("div");
    card.className = "theme-card";
    const grad = `linear-gradient(180deg, ${esc(t.skyTop)}, ${esc(t.skyBottom)})`;
    const track = TRACK_COLORS[t.trackStyle] || "#3a3a44";
    card.innerHTML = `
      <div class="tc-preview" style="background:${grad}">
        <div style="position:absolute;bottom:0;left:0;right:0;height:14px;background:${track};border-top:3px solid #000"></div>
        <div style="position:absolute;bottom:14px;left:50%;transform:translateX(-50%);width:22px;height:26px;background:${esc(t.primaryColor)};border:3px solid #000"></div>
      </div>
      <div class="tc-body">
        <div class="tc-name">${esc(t.name)}</div>
        <div class="tc-meta">${esc(TRACK_LABELS[t.trackStyle] || t.trackStyle)} · ${esc(ATMOSPHERE_LABELS[t.atmosphere] || t.atmosphere)}</div>
        <div class="tc-ops">
          <button class="pixel-btn ghost" data-tact="edit" data-id="${esc(t.id)}">EDIT</button>
          <button class="pixel-btn warn ghost" data-tact="del" data-id="${esc(t.id)}">DEL</button>
        </div>
      </div>
    `;
    tGrid.appendChild(card);
  });
}

tGrid.addEventListener("click", async (e) => {
  const btn = e.target.closest("button[data-tact]");
  if (!btn) return;
  const id = btn.dataset.id;
  try {
    if (btn.dataset.tact === "edit") {
      startThemeEdit(id);
    } else if (btn.dataset.tact === "del") {
      const t = customThemes.find((x) => x.id === id);
      if (!confirm(`Delete theme "${t?.name || id}"?`)) return;
      await api(`/api/themes/${id}`, { method: "DELETE" });
      if (editingThemeId === id) resetThemeForm();
      await loadCustomThemes();
      toast("Theme deleted");
    }
  } catch (err) {
    // 409 = theme in use; api() flattens .error but we want the race names too
    toast(err.message, true);
  }
});

function resetThemeForm() {
  editingThemeId = null;
  tForm.reset();
  tId.value = "";
  tErr.textContent = "";
  tFormTitle.textContent = "CREATE THEME";
  // restore defaults + sync pickers
  const defaults = {
    "t-primary": "#4cc9f0", "t-secondary": "#ffd23f",
    "t-skytop": "#1a1a3a", "t-skybottom": "#5a2340"
  };
  for (const [id, val] of Object.entries(defaults)) {
    $(id).value = val;
    $(id + "-c").value = val;
  }
  tTrack.value = "asphalt";
  tAtmosphere.value = "daytime";
  updatePreview();
}

function startThemeEdit(id) {
  const t = customThemes.find((x) => x.id === id);
  if (!t) return;
  editingThemeId = id;
  tId.value = t.id;
  tName.value = t.name;
  const setC = (base, val) => { $(base).value = val; $(base + "-c").value = val; };
  setC("t-primary", t.primaryColor);
  setC("t-secondary", t.secondaryColor);
  setC("t-skytop", t.skyTop);
  setC("t-skybottom", t.skyBottom);
  tTrack.value = t.trackStyle;
  tAtmosphere.value = t.atmosphere;
  tBg.value = t.backgroundImage || "";
  tLandmark.value = t.landmarkImage || "";
  tFormTitle.textContent = `EDIT: ${t.name}`;
  tErr.textContent = "";
  updatePreview();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

tForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  tErr.textContent = "";
  const payload = currentThemeFromForm();
  if (!payload.name) { tErr.textContent = "Theme name is required."; return; }

  try {
    if (editingThemeId) {
      await api(`/api/themes/${editingThemeId}`, { method: "PUT", body: JSON.stringify(payload) });
      toast("Theme updated");
    } else {
      await api("/api/themes", { method: "POST", body: JSON.stringify(payload) });
      toast("Theme created");
    }
    resetThemeForm();
    await loadCustomThemes();
    // refresh the race form dropdown so the new theme is selectable
    await loadMeta();
  } catch (err) {
    tErr.textContent = err.message;
  }
});

$("new-theme-btn").addEventListener("click", () => {
  resetThemeForm();
  window.scrollTo({ top: 0, behavior: "smooth" });
});
$("theme-cancel-btn").addEventListener("click", resetThemeForm);

/* ============================================================
   IMAGE UPLOAD + CROPPER + MEDIA LIBRARY
   ============================================================ */

// Upload raw bytes (Blob or File) to the server; returns the media url.
async function uploadBlob(blob, name) {
  const res = await fetch(`/api/upload?name=${encodeURIComponent(name)}`, {
    method: "POST",
    headers: { "Content-Type": blob.type || "application/octet-stream" },
    body: blob
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Upload failed (${res.status})`);
  return data.url;
}

/* ---------- Cropper modal ---------- */
const cropModal  = $("crop-modal");
const cropImage  = $("crop-image");
const cropTitle  = $("crop-title");
const cropHint   = $("crop-hint");
let cropper = null;
let cropTargetInput = null;   // which field (tBg / tLandmark) the result fills
let cropSourceName = "image.png";

function openCropper(file, targetInput, opts) {
  cropTargetInput = targetInput;
  cropSourceName = file.name || "image.png";
  cropTitle.textContent = opts.title;
  cropHint.innerHTML = opts.hint;

  const reader = new FileReader();
  reader.onload = () => {
    cropImage.src = reader.result;
    cropModal.classList.add("show");
    if (cropper) { cropper.destroy(); cropper = null; }
    cropper = new Cropper(cropImage, {
      viewMode: 1,
      autoCropArea: 1,
      background: false,
      aspectRatio: opts.ratio
    });
  };
  reader.readAsDataURL(file);
}

function closeCropper() {
  if (cropper) { cropper.destroy(); cropper = null; }
  cropModal.classList.remove("show");
  cropImage.src = "";
  cropTargetInput = null;
}

// Aspect-ratio quick buttons
document.querySelectorAll("#crop-modal .crop-ratios button").forEach((b) => {
  b.addEventListener("click", () => {
    if (!cropper) return;
    const r = b.dataset.ratio;
    cropper.setAspectRatio(r === "free" ? NaN : (() => {
      const [w, h] = r.split(":").map(Number); return w / h;
    })());
  });
});

async function applyCrop(useOriginal) {
  if (!cropper || !cropTargetInput) return;
  const target = cropTargetInput;
  try {
    toast("Uploading...");
    let blob;
    if (useOriginal) {
      // upload the untouched source
      blob = await (await fetch(cropImage.src)).blob();
    } else {
      const canvas = cropper.getCroppedCanvas({ imageSmoothingEnabled: false });
      blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
    }
    const name = cropSourceName.replace(/\.[^.]+$/, "") + ".png";
    const url = await uploadBlob(blob, name);
    target.value = url;
    refreshPreviews();
    toast("Uploaded");
  } catch (err) {
    toast(err.message, true);
  } finally {
    closeCropper();
  }
}

$("crop-apply").addEventListener("click", () => applyCrop(false));
$("crop-skip").addEventListener("click", () => applyCrop(true));
$("crop-cancel").addEventListener("click", closeCropper);
cropModal.addEventListener("click", (e) => { if (e.target === cropModal) closeCropper(); });

// Wire an upload button -> file picker -> cropper
function wireUpload(btnId, fileId, targetInput, opts) {
  const btn = $(btnId);
  const file = $(fileId);
  btn.addEventListener("click", () => file.click());
  file.addEventListener("change", () => {
    if (file.files && file.files[0]) openCropper(file.files[0], targetInput, opts);
    file.value = "";
  });
}
wireUpload("t-bg-upload-btn", "t-bg-file", tBg, {
  title: "CROP BACKGROUND",
  ratio: 16 / 9,
  hint: "<b>Recommended:</b> 1920×1080px (16:9). Drag to frame the pixel landscape."
});
wireUpload("t-landmark-upload-btn", "t-landmark-file", tLandmark, {
  title: "CROP LANDMARK",
  ratio: 1,
  hint: "<b>Recommended:</b> transparent PNG, 512×512px (1:1)."
});

/* ---------- Media Library modal ---------- */
const mediaModal = $("media-modal");
const mediaGrid  = $("media-grid");
const mediaEmpty = $("media-empty");
let mediaTargetInput = null;   // which field the picked image fills

async function openMediaLibrary(targetInput) {
  mediaTargetInput = targetInput;
  mediaModal.classList.add("show");
  await renderMediaGrid();
}
function closeMediaLibrary() {
  mediaModal.classList.remove("show");
  mediaTargetInput = null;
}

async function renderMediaGrid() {
  let list = [];
  try { list = await api("/api/media"); }
  catch (err) { toast(err.message, true); }
  mediaGrid.innerHTML = "";
  mediaEmpty.style.display = list.length ? "none" : "block";

  list.forEach((m) => {
    const dims = m.width && m.height ? `${m.width}×${m.height}` : "";
    const kb = m.size ? Math.round(m.size / 1024) + "KB" : "";
    const item = document.createElement("div");
    item.className = "media-item";
    item.innerHTML = `
      ${m.refCount > 0 ? `<span class="mi-ref">×${m.refCount}</span>` : ""}
      <span class="mi-del" data-del="${esc(m.url)}" title="Delete unused">✕</span>
      <img class="thumb" src="${esc(m.url)}" alt="" loading="lazy" />
      <div class="mi-meta">${dims}${dims && kb ? " · " : ""}${kb}</div>
    `;
    item.addEventListener("click", (e) => {
      if (e.target.closest("[data-del]")) return; // handled below
      if (mediaTargetInput) {
        mediaTargetInput.value = m.url;
        refreshPreviews();
        toast("Image selected");
        closeMediaLibrary();
      }
    });
    mediaGrid.appendChild(item);
  });
}

mediaGrid.addEventListener("click", async (e) => {
  const del = e.target.closest("[data-del]");
  if (!del) return;
  e.stopPropagation();
  const url = del.dataset.del;
  if (!confirm("Delete this image from storage? (Only allowed if unused.)")) return;
  try {
    await api(`/api/media?url=${encodeURIComponent(url)}`, { method: "DELETE" });
    toast("Image deleted");
    await renderMediaGrid();
  } catch (err) {
    toast(err.message, true); // 409 if in use
  }
});

$("media-close").addEventListener("click", closeMediaLibrary);
mediaModal.addEventListener("click", (e) => { if (e.target === mediaModal) closeMediaLibrary(); });
$("t-bg-lib-btn").addEventListener("click", () => openMediaLibrary(tBg));
$("t-landmark-lib-btn").addEventListener("click", () => openMediaLibrary(tLandmark));

/* ---------- Race certificate upload (direct — no cropper, PDFs allowed) ---------- */
$("f-cert-lib-btn").addEventListener("click", () => openMediaLibrary(fCert));
$("f-cert-clear-btn").addEventListener("click", () => { fCert.value = ""; });
$("f-gallery-clear-btn").addEventListener("click", () => { fGallery.value = ""; });
$("f-cert-upload-btn").addEventListener("click", () => $("f-cert-file").click());
$("f-cert-file").addEventListener("change", async () => {
  const file = $("f-cert-file").files && $("f-cert-file").files[0];
  if (!file) return;
  try {
    toast("Uploading...");
    const url = await uploadBlob(file, file.name);
    fCert.value = url;
    toast("Uploaded");
  } catch (err) {
    toast(err.message, true);
  } finally {
    $("f-cert-file").value = "";
  }
});

/* ============================================================
   CHARACTER CUSTOMIZER
   ============================================================ */
const CHAR_DEFAULTS = {
  skinTone: "#ffcf8b", hairColor: "#2b2b3a",
  jerseyColor: "#4cc9f0", shortsColor: "#2b3a55", shoesColor: "#e8e8f0"
};
// Body-part markup shared by both preview stages (two-segment legs)
const SPRITE_PARTS = `
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

const cForm    = $("char-form");
const cErr     = $("char-err");
const cSkin    = $("c-skin");
const cHair    = $("c-hair");
const cJersey  = $("c-jersey");
const cShorts  = $("c-shorts");
const cShoes   = $("c-shoes");
const charView = $("view-character");
const cpIdle   = $("cp-idle");
const cpRun    = $("cp-run");

// inject sprite body parts into both preview stages once
cpIdle.innerHTML = SPRITE_PARTS;
cpRun.innerHTML = SPRITE_PARTS;

// Link color picker <-> hex text (reuse the same pattern as themes)
["c-skin", "c-hair", "c-jersey", "c-shorts", "c-shoes"].forEach((id) => {
  const text = $(id);
  const picker = $(id + "-c");
  picker.addEventListener("input", () => { text.value = picker.value; updateCharPreview(); });
  text.addEventListener("input", () => {
    if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(text.value)) picker.value = text.value;
    updateCharPreview();
  });
});

// Preset swatch clicks
charView.querySelectorAll(".swatches").forEach((row) => {
  const targetId = row.dataset.target;
  row.querySelectorAll(".sw").forEach((sw) => {
    sw.addEventListener("click", () => {
      $(targetId).value = sw.dataset.c;
      $(targetId + "-c").value = sw.dataset.c;
      updateCharPreview();
    });
  });
});

function currentCharacter() {
  return {
    skinTone: cSkin.value.trim(),
    hairColor: cHair.value.trim(),
    jerseyColor: cJersey.value.trim(),
    shortsColor: cShorts.value.trim(),
    shoesColor: cShoes.value.trim()
  };
}

function updateCharPreview() {
  const c = currentCharacter();
  // colors are scoped via #view-character CSS vars
  charView.style.setProperty("--skin", c.skinTone);
  charView.style.setProperty("--hair", c.hairColor);
  charView.style.setProperty("--jersey", c.jerseyColor);
  charView.style.setProperty("--shorts", c.shortsColor);
  charView.style.setProperty("--shoe", c.shoesColor);
}

function fillCharForm(c) {
  const set = (base, val) => { $(base).value = val; $(base + "-c").value = val; };
  set("c-skin", c.skinTone);
  set("c-hair", c.hairColor);
  set("c-jersey", c.jerseyColor);
  set("c-shorts", c.shortsColor);
  set("c-shoes", c.shoesColor);
  updateCharPreview();
}

async function loadCharacter() {
  try {
    const c = await api("/api/character");
    fillCharForm(c);
  } catch (err) {
    toast("Failed to load character: " + err.message, true);
  }
}

cForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  cErr.textContent = "";
  try {
    await api("/api/character", { method: "PUT", body: JSON.stringify(currentCharacter()) });
    toast("Character saved");
  } catch (err) {
    cErr.textContent = err.message;
  }
});

$("char-reset-btn").addEventListener("click", () => {
  fillCharForm(CHAR_DEFAULTS);
  toast("Reset to defaults (not saved yet)");
});

/* ============================================================
   RUNNER PROFILE
   ============================================================ */
const profForm = $("profile-form");
const profErr  = $("profile-err");
const pName    = $("p-name");
const pTagline = $("p-tagline");
const pBio     = $("p-bio");
const pStrava  = $("p-strava");
const pInsta   = $("p-instagram");
const pWebsite = $("p-website");
const pPb = { "5k": $("p-pb-5k"), "10k": $("p-pb-10k"), hm: $("p-pb-hm"), fm: $("p-pb-fm") };

function fillProfileForm(p) {
  pName.value = p.name || "";
  pTagline.value = p.tagline || "";
  pBio.value = p.bio || "";
  pStrava.value = p.strava || "";
  pInsta.value = p.instagram || "";
  pWebsite.value = p.website || "";
  const pbs = p.pbs || {};
  pPb["5k"].value = pbs["5k"] || "";
  pPb["10k"].value = pbs["10k"] || "";
  pPb.hm.value = pbs.hm || "";
  pPb.fm.value = pbs.fm || "";
}

async function loadRunnerProfile() {
  try {
    const p = await api("/api/profile");
    fillProfileForm(p);
  } catch (err) {
    toast("Failed to load profile: " + err.message, true);
  }
}

profForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  profErr.textContent = "";
  const payload = {
    name: pName.value.trim(),
    tagline: pTagline.value.trim(),
    bio: pBio.value.trim(),
    strava: pStrava.value.trim(),
    instagram: pInsta.value.trim(),
    website: pWebsite.value.trim(),
    pbs: {
      "5k": pPb["5k"].value.trim(),
      "10k": pPb["10k"].value.trim(),
      hm: pPb.hm.value.trim(),
      fm: pPb.fm.value.trim()
    }
  };
  try {
    await api("/api/profile", { method: "PUT", body: JSON.stringify(payload) });
    toast("Profile saved");
  } catch (err) {
    profErr.textContent = err.message;
  }
});

/* ============================================================
   AUTH — login gate + session
   ============================================================ */
const loginGate = $("login-gate");
const appEl     = $("app");
const loginForm = $("login-form");
const loginErr  = $("login-err");
const whoEl     = $("who");

function showLoginGate() {
  appEl.classList.add("app-hidden");
  loginGate.classList.add("show");
  $("login-user").focus();
}
function showApp(user) {
  loginGate.classList.remove("show");
  appEl.classList.remove("app-hidden");
  if (whoEl) whoEl.textContent = user ? `@${user}` : "";
}

async function checkSession() {
  try {
    const s = await api("/api/session");
    return s.authenticated ? s.user : null;
  } catch {
    return null;
  }
}

loginForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  loginErr.textContent = "";
  const username = $("login-user").value.trim();
  const password = $("login-pass").value;
  try {
    const res = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Login failed");
    $("login-pass").value = "";
    showApp(data.user);
    await bootDashboard();
    toast("Welcome, " + data.user);
  } catch (err) {
    loginErr.textContent = err.message;
  }
});

$("logout-btn").addEventListener("click", async () => {
  try { await fetch("/api/logout", { method: "POST" }); } catch { /* ignore */ }
  showLoginGate();
  toast("Logged out");
});

/* ============================================================
   Boot
   ============================================================ */
let dashboardLoaded = false;
async function bootDashboard() {
  if (dashboardLoaded) return;
  try {
    await loadMeta();
    await loadRaces();
    resetForm();

    // Theme Creator init
    fillSelect(tTrack, meta.trackStyles || [], TRACK_LABELS);
    fillSelect(tAtmosphere, meta.atmospheres || [], ATMOSPHERE_LABELS);
    await loadCustomThemes();
    resetThemeForm();

    // Character Customizer init
    await loadCharacter();

    // Runner Profile init
    await loadRunnerProfile();

    dashboardLoaded = true;
  } catch (err) {
    toast("Failed to load: " + err.message, true);
  }
}

(async function init() {
  const user = await checkSession();
  if (user) {
    showApp(user);
    await bootDashboard();
  } else {
    showLoginGate();
  }
})();
