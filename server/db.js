// ============================================================
// JSON-file data layer for RUN QUEST 2026
// - Reads/writes data/races.json
// - Atomic writes (write temp file then rename) to avoid corruption
// - Simple queue so concurrent writes don't clobber each other
// ============================================================
import { readFile, writeFile, rename, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, "..", "data");
const DATA_FILE = join(DATA_DIR, "races.json");

// Valid enums (kept in sync with the frontend + admin form).
// NOTE: themes now live in their own store (server/themes.js) and can be
// custom, so a race's `theme` is validated only as a non-empty id here.
// The public page falls back gracefully if a referenced theme was deleted.
export const CATEGORIES = ["5K", "10K", "HM", "FM", "OTHER"];
// Race status scheme (v2): finished / upcoming / dnf / dns.
// Legacy value "completed" is migrated to "finished" on read/normalize.
export const STATUSES = ["finished", "upcoming", "dnf", "dns"];
const DEFAULT_THEME = "gbk";

// Map any legacy or aliased status to the current scheme
function normStatus(s) {
  s = String(s || "").trim().toLowerCase();
  if (s === "completed" || s === "complete" || s === "done") return "finished";
  return STATUSES.includes(s) ? s : "upcoming";
}

let writeChain = Promise.resolve();

async function ensureStore() {
  if (!existsSync(DATA_DIR)) await mkdir(DATA_DIR, { recursive: true });
  if (!existsSync(DATA_FILE)) await writeFile(DATA_FILE, "[]", "utf8");
}

export async function readAll() {
  await ensureStore();
  const raw = await readFile(DATA_FILE, "utf8");
  let list;
  try {
    list = JSON.parse(raw || "[]");
  } catch {
    list = [];
  }
  if (!Array.isArray(list)) list = [];
  // Migrate legacy statuses (e.g. "completed" -> "finished") on read
  for (const r of list) { if (r && typeof r === "object") r.status = normStatus(r.status); }
  // Always return sorted by order, then date
  return list.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

// Atomic + serialized write
function persist(list) {
  writeChain = writeChain.then(async () => {
    await ensureStore();
    const tmp = `${DATA_FILE}.${randomUUID()}.tmp`;
    await writeFile(tmp, JSON.stringify(list, null, 2), "utf8");
    await rename(tmp, DATA_FILE);
  });
  return writeChain;
}

// Certificate is a same-origin upload path or an http(s) URL (rejects data:/traversal)
function safeCert(v) {
  v = String(v || "").trim();
  if (!v) return "";
  if (v.startsWith("/uploads/")) return v;
  if (/^https?:\/\//i.test(v)) return v;
  return "";
}

// Gallery link must be an http(s) URL (external only — no uploads)
function safeUrl(v) {
  v = String(v || "").trim();
  if (!v) return "";
  if (/^https?:\/\//i.test(v)) return v;
  return "";
}

// ---------- Validation / normalization ----------
export function normalizeRace(input, existing = {}) {
  const race = { ...existing, ...input };

  const clean = {
    id: existing.id || String(input.id || "").trim() || slugify(race.name) || randomUUID(),
    name: String(race.name || "").trim(),
    date: String(race.date || "").trim(),
    category: CATEGORIES.includes(race.category) ? race.category : "OTHER",
    status: normStatus(race.status),
    theme: String(race.theme || "").trim() || DEFAULT_THEME,
    note: String(race.note ?? "").trim(),
    finishTime: String(race.finishTime ?? "").trim(),
    personalBest: race.personalBest === true || race.personalBest === "true" || race.personalBest === "on",
    certificate: safeCert(race.certificate),
    galleryLink: safeUrl(race.galleryLink),
    order: Number.isFinite(Number(race.order)) ? Number(race.order) : 0
  };
  return clean;
}

export function validateRace(race) {
  const errors = [];
  if (!race.name) errors.push("name is required");
  if (!race.date) errors.push("date is required");
  if (!CATEGORIES.includes(race.category)) errors.push("invalid category");
  if (!STATUSES.includes(race.status)) errors.push("invalid status");
  if (!race.theme) errors.push("theme is required");
  return errors;
}

function slugify(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 60);
}

// ---------- CRUD ----------
export async function listRaces() {
  return readAll();
}

export async function getRace(id) {
  const list = await readAll();
  return list.find((r) => r.id === id) || null;
}

export async function createRace(input) {
  const list = await readAll();
  const race = normalizeRace(input);
  const errors = validateRace(race);
  if (errors.length) return { error: errors };

  // Ensure unique id
  if (list.some((r) => r.id === race.id)) {
    race.id = `${race.id}-${Math.random().toString(36).slice(2, 6)}`;
  }
  // Default order = end of list
  if (!input.order) {
    race.order = list.length ? Math.max(...list.map((r) => r.order || 0)) + 1 : 1;
  }
  list.push(race);
  await persist(list);
  return { race };
}

export async function updateRace(id, input) {
  const list = await readAll();
  const idx = list.findIndex((r) => r.id === id);
  if (idx === -1) return { notFound: true };

  const race = normalizeRace(input, list[idx]);
  race.id = id; // id is immutable on update
  const errors = validateRace(race);
  if (errors.length) return { error: errors };

  list[idx] = race;
  await persist(list);
  return { race };
}

export async function deleteRace(id) {
  const list = await readAll();
  const idx = list.findIndex((r) => r.id === id);
  if (idx === -1) return { notFound: true };
  const [removed] = list.splice(idx, 1);
  await persist(list);
  return { race: removed };
}

// Reorder: accepts an array of ids in the desired order
export async function reorderRaces(idsInOrder) {
  const list = await readAll();
  const byId = new Map(list.map((r) => [r.id, r]));
  let order = 1;
  // First assign order to the ids that were provided (in order)
  for (const id of idsInOrder) {
    const r = byId.get(id);
    if (r) { r.order = order++; }
  }
  // Any leftover races keep their relative order at the end
  for (const r of list) {
    if (!idsInOrder.includes(r.id)) r.order = order++;
  }
  await persist(list);
  return { races: await readAll() };
}
