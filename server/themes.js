// ============================================================
// Unified Theme data layer for RUN QUEST 2026
// - ONE store: data/themes.json holds every theme (no built-in/custom split).
// - The 6 original themes are seeded as editable PRESET defaults on first run;
//   they can be edited or deleted like any other theme.
// - Landmarks are transparent PNGs in the media library (landmarkImage url).
// ============================================================
import { readFile, writeFile, rename, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, "..", "data");
const THEMES_FILE = join(DATA_DIR, "themes.json");

// Enums shared with the Theme Creator UI
export const TRACK_STYLES = ["asphalt", "dirt", "synthetic-red", "synthetic-blue"];
export const ATMOSPHERES = ["daytime", "sunset", "night-neon", "rain", "confetti"];

// Seed presets (formerly the "built-in" themes). Full editable schema now,
// each pointing at its transparent landmark PNG (see scripts/gen-landmarks.mjs).
export const PRESET_THEMES = [
  { id: "gbk",       name: "GBK / Senayan Stadium",      primaryColor: "#6ee7ff", secondaryColor: "#ffd23f", skyTop: "#0b1e3a", skyBottom: "#24476b", trackStyle: "asphalt", atmosphere: "night-neon", backgroundImage: "", landmarkImage: "/uploads/landmark-gbk.png" },
  { id: "monas",     name: "Monas / Jakarta",            primaryColor: "#ffd23f", secondaryColor: "#f77f6b", skyTop: "#fdb44b", skyBottom: "#7a4ca0", trackStyle: "asphalt", atmosphere: "sunset",     backgroundImage: "", landmarkImage: "/uploads/landmark-monas.png" },
  { id: "smartfren", name: "Modern City (Magenta)",      primaryColor: "#ff4dc4", secondaryColor: "#4cc9f0", skyTop: "#2a0a3a", skyBottom: "#d81b8c", trackStyle: "asphalt", atmosphere: "night-neon", backgroundImage: "", landmarkImage: "/uploads/landmark-smartfren.png" },
  { id: "tangerang", name: "Tangerang City Park",        primaryColor: "#2e8b3d", secondaryColor: "#d64550", skyTop: "#56ccf2", skyBottom: "#b8e994", trackStyle: "asphalt", atmosphere: "daytime",    backgroundImage: "", landmarkImage: "/uploads/landmark-tangerang.png" },
  { id: "bandung",   name: "Gedung Sate / Bandung",      primaryColor: "#ffd23f", secondaryColor: "#4cc9f0", skyTop: "#a8e063", skyBottom: "#245414", trackStyle: "asphalt", atmosphere: "daytime",    backgroundImage: "", landmarkImage: "/uploads/landmark-bandung.png" },
  { id: "jrf",       name: "Marathon Festival / Finish", primaryColor: "#ffd23f", secondaryColor: "#38f56b", skyTop: "#1a1a40", skyBottom: "#ff6b6b", trackStyle: "asphalt", atmosphere: "confetti",   backgroundImage: "", landmarkImage: "/uploads/landmark-jrf.png" }
];

let writeChain = Promise.resolve();
let seeded = false;

async function ensureStore() {
  if (!existsSync(DATA_DIR)) await mkdir(DATA_DIR, { recursive: true });
  if (!existsSync(THEMES_FILE)) await writeFile(THEMES_FILE, "[]", "utf8");
  // Seed the presets once, if the store is empty.
  if (!seeded) {
    seeded = true;
    const raw = await readFile(THEMES_FILE, "utf8").catch(() => "[]");
    let list;
    try { list = JSON.parse(raw || "[]"); } catch { list = []; }
    if (!Array.isArray(list) || list.length === 0) {
      const presets = PRESET_THEMES.map((p) => normalizeTheme(p));
      await writeFile(THEMES_FILE, JSON.stringify(presets, null, 2), "utf8");
    }
  }
}

async function readRaw() {
  await ensureStore();
  const raw = await readFile(THEMES_FILE, "utf8");
  let list;
  try { list = JSON.parse(raw || "[]"); } catch { list = []; }
  return Array.isArray(list) ? list : [];
}

function persist(list) {
  writeChain = writeChain.then(async () => {
    const tmp = `${THEMES_FILE}.${randomUUID()}.tmp`;
    await writeFile(tmp, JSON.stringify(list, null, 2), "utf8");
    await rename(tmp, THEMES_FILE);
  });
  return writeChain;
}

// ---------- Helpers ----------
function slugify(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 60);
}
const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;
function color(v, fallback) {
  v = String(v || "").trim();
  return HEX.test(v) ? v : fallback;
}
// Allow only same-origin upload paths or http(s) URLs for image assets
function safeAsset(v) {
  v = String(v || "").trim();
  if (!v) return "";
  if (v.startsWith("/uploads/")) return v;
  if (/^https?:\/\//i.test(v)) return v;
  return ""; // reject data: URIs / traversal
}

// ---------- Normalization / validation ----------
export function normalizeTheme(input, existing = {}) {
  const t = { ...existing, ...input };
  return {
    id: existing.id || slugify(input.id) || slugify(t.name) || randomUUID(),
    name: String(t.name || "").trim(),
    primaryColor: color(t.primaryColor, "#4cc9f0"),
    secondaryColor: color(t.secondaryColor, "#ffd23f"),
    skyTop: color(t.skyTop, "#1a1a3a"),
    skyBottom: color(t.skyBottom, "#5a2340"),
    trackStyle: TRACK_STYLES.includes(t.trackStyle) ? t.trackStyle : "asphalt",
    atmosphere: ATMOSPHERES.includes(t.atmosphere) ? t.atmosphere : "daytime",
    backgroundImage: safeAsset(t.backgroundImage),
    landmarkImage: safeAsset(t.landmarkImage)
  };
}

export function validateTheme(theme) {
  const errors = [];
  if (!theme.name) errors.push("name is required");
  if (!HEX.test(theme.primaryColor)) errors.push("invalid primaryColor");
  if (!HEX.test(theme.secondaryColor)) errors.push("invalid secondaryColor");
  if (!TRACK_STYLES.includes(theme.trackStyle)) errors.push("invalid trackStyle");
  if (!ATMOSPHERES.includes(theme.atmosphere)) errors.push("invalid atmosphere");
  return errors;
}

// ---------- Reads ----------
export async function listThemes() {
  return readRaw();
}
// Back-compat aliases (index.js may still import these until updated)
export const listAllThemes = listThemes;
export const listCustomThemes = listThemes;

export async function getTheme(id) {
  const list = await readRaw();
  return list.find((t) => t.id === id) || null;
}

export async function themeExists(id) {
  const list = await readRaw();
  return list.some((t) => t.id === id);
}

// No more built-in concept — nothing is protected.
export function isBuiltin() { return false; }

// ---------- CRUD ----------
export async function createTheme(input) {
  const list = await readRaw();
  const theme = normalizeTheme(input);
  const errors = validateTheme(theme);
  if (errors.length) return { error: errors };

  if (list.some((t) => t.id === theme.id)) {
    theme.id = `${theme.id}-${Math.random().toString(36).slice(2, 6)}`;
  }
  list.push(theme);
  await persist(list);
  return { theme };
}

export async function updateTheme(id, input) {
  const list = await readRaw();
  const idx = list.findIndex((t) => t.id === id);
  if (idx === -1) return { notFound: true };

  const theme = normalizeTheme(input, list[idx]);
  theme.id = id; // immutable
  const errors = validateTheme(theme);
  if (errors.length) return { error: errors };

  list[idx] = theme;
  await persist(list);
  return { theme };
}

export async function deleteTheme(id) {
  const list = await readRaw();
  const idx = list.findIndex((t) => t.id === id);
  if (idx === -1) return { notFound: true };
  const [removed] = list.splice(idx, 1);
  await persist(list);
  return { theme: removed };
}

// All landmark/background asset urls across every theme (for media refcount)
export async function themeAssetUrls() {
  const list = await readRaw();
  const urls = [];
  for (const t of list) {
    if (t.backgroundImage) urls.push(t.backgroundImage);
    if (t.landmarkImage) urls.push(t.landmarkImage);
  }
  return urls;
}
