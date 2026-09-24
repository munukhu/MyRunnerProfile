// ============================================================
// MY RUNNER PROFILE — Express server
// - Serves the public pixel-art page and the admin CMS
// - REST API for race CRUD + reorder (data/races.json)
// - REST API for custom themes (data/themes.json) + image uploads
// ============================================================
import express from "express";
import { fileURLToPath } from "node:url";
import { dirname, join, extname } from "node:path";
import { writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import {
  listRaces, getRace, createRace, updateRace, deleteRace, reorderRaces,
  CATEGORIES, STATUSES
} from "./db.js";
import {
  listThemes, getTheme, createTheme, updateTheme, deleteTheme,
  themeAssetUrls, TRACK_STYLES, ATMOSPHERES
} from "./themes.js";
import {
  readMedia, registerUpload, syncReferences, cleanupOrphans, deleteMedia,
  reconcileUploads
} from "./media.js";
import {
  checkCredentials, createToken, setSessionCookie, clearSessionCookie,
  getSession, requireAuth
} from "./auth.js";
import { getCharacter, saveCharacter, characterAssetUrls } from "./character.js";
import { getProfile, saveProfile } from "./profile.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(__dirname, "..", "public");
const UPLOAD_DIR = join(PUBLIC_DIR, "uploads");
const PORT = process.env.PORT || 3000;

const app = express();
app.use(express.json());

// Recompute media reference counts from all themes + races, then delete
// any orphaned managed files. `keepUrls` protects freshly uploaded assets
// that aren't referenced yet (e.g. a crop the user just uploaded but hasn't saved).
async function syncAllReferences(keepUrls = []) {
  const [themeUrls, charUrls, races] = await Promise.all([
    themeAssetUrls(), characterAssetUrls(), listRaces()
  ]);
  const certUrls = races.map((r) => r.certificate).filter(Boolean);
  const urls = [...themeUrls, ...charUrls, ...certUrls];
  await syncReferences(urls);
  return cleanupOrphans(keepUrls);
}

// ---------- API ----------
const api = express.Router();

// ---------- Auth ----------
api.post("/login", (req, res) => {
  const { username, password } = req.body || {};
  if (!checkCredentials(username, password)) {
    return res.status(401).json({ error: "invalid username or password" });
  }
  const token = createToken(username);
  setSessionCookie(res, token);
  res.json({ ok: true, user: username });
});

api.post("/logout", (req, res) => {
  clearSessionCookie(res);
  res.json({ ok: true });
});

// ---------- Character (runner sprite) ----------
// Public read so the portfolio can render the customized runner.
api.get("/character", async (req, res) => {
  res.json(await getCharacter());
});

// Auth-only save.
api.put("/character", requireAuth, async (req, res) => {
  const saved = await saveCharacter(req.body || {});
  res.json(saved);
});

// ---------- Runner Profile ----------
api.get("/profile", async (req, res) => {
  res.json(await getProfile());
});
api.put("/profile", requireAuth, async (req, res) => {
  res.json(await saveProfile(req.body || {}));
});

// Report auth status (used by the admin page to decide login vs dashboard)
api.get("/session", (req, res) => {
  const session = getSession(req);
  res.json({ authenticated: !!session, user: session ? session.u : null });
});

// Enums + full theme list so the admin form stays in sync with the backend
api.get("/meta", async (req, res) => {
  res.json({
    categories: CATEGORIES,
    statuses: STATUSES,
    trackStyles: TRACK_STYLES,
    atmospheres: ATMOSPHERES,
    themes: await listThemes()
  });
});

// ---------- Races ----------
api.get("/races", async (req, res) => {
  res.json(await listRaces());
});

api.get("/races/:id", async (req, res) => {
  const race = await getRace(req.params.id);
  if (!race) return res.status(404).json({ error: "not found" });
  res.json(race);
});

api.post("/races", requireAuth, async (req, res) => {
  const result = await createRace(req.body || {});
  if (result.error) return res.status(400).json({ error: result.error });
  // A new race may reference a freshly-uploaded certificate.
  await syncAllReferences(result.race.certificate ? [result.race.certificate] : []);
  res.status(201).json(result.race);
});

api.put("/races/:id", requireAuth, async (req, res) => {
  const result = await updateRace(req.params.id, req.body || {});
  if (result.notFound) return res.status(404).json({ error: "not found" });
  if (result.error) return res.status(400).json({ error: result.error });
  // Certificate may have changed; keep the new one, clean any now-orphaned upload.
  await syncAllReferences(result.race.certificate ? [result.race.certificate] : []);
  res.json(result.race);
});

api.delete("/races/:id", requireAuth, async (req, res) => {
  const result = await deleteRace(req.params.id);
  if (result.notFound) return res.status(404).json({ error: "not found" });
  // The deleted race's certificate may now be orphaned.
  await syncAllReferences();
  res.json({ ok: true, deleted: result.race });
});

// Reorder — body: { order: ["id1","id2", ...] }
api.post("/races/reorder", requireAuth, async (req, res) => {
  const ids = Array.isArray(req.body?.order) ? req.body.order : [];
  if (!ids.length) return res.status(400).json({ error: "order[] required" });
  const result = await reorderRaces(ids);
  res.json(result.races);
});

// ---------- Themes ----------
// Unified list — every theme (used by race form dropdown + Theme Creator + public)
api.get("/themes", async (req, res) => {
  res.json(await listThemes());
});
// Back-compat alias (admin still calls /themes/custom): returns all themes now
api.get("/themes/custom", async (req, res) => {
  res.json(await listThemes());
});

api.get("/themes/:id", async (req, res) => {
  const theme = await getTheme(req.params.id);
  if (!theme) return res.status(404).json({ error: "not found" });
  res.json(theme);
});

api.post("/themes", requireAuth, async (req, res) => {
  const result = await createTheme(req.body || {});
  if (result.error) return res.status(400).json({ error: result.error });
  // Keep the just-referenced assets; clean anything now orphaned.
  await syncAllReferences([result.theme.backgroundImage, result.theme.landmarkImage].filter(Boolean));
  res.status(201).json(result.theme);
});

api.put("/themes/:id", requireAuth, async (req, res) => {
  const result = await updateTheme(req.params.id, req.body || {});
  if (result.notFound) return res.status(404).json({ error: "not found" });
  if (result.error) return res.status(400).json({ error: result.error });
  // Old assets that are no longer referenced get cleaned up here.
  await syncAllReferences([result.theme.backgroundImage, result.theme.landmarkImage].filter(Boolean));
  res.json(result.theme);
});

api.delete("/themes/:id", requireAuth, async (req, res) => {
  // Any theme can be deleted now — but block if a race still uses it.
  const races = await listRaces();
  const inUse = races.filter((r) => r.theme === req.params.id).map((r) => r.name);
  if (inUse.length) {
    return res.status(409).json({ error: "theme in use", races: inUse });
  }
  const result = await deleteTheme(req.params.id);
  if (result.notFound) return res.status(404).json({ error: "not found" });
  // The deleted theme's assets may now be orphaned.
  await syncAllReferences();
  res.json({ ok: true, deleted: result.theme });
});

// ---------- File upload ----------
// Raw-body upload (no multipart dep). Client sends the file bytes as the body
// with ?name=<filename>. Returns { url: "/uploads/<file>" }.
// Images (theme/landmark) + PDF (race certificates) are allowed.
const ALLOWED_EXT = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".pdf"]);
const MAX_UPLOAD = 8 * 1024 * 1024; // 8 MB (certificates can be larger)

api.post(
  "/upload",
  requireAuth,
  express.raw({ type: "*/*", limit: MAX_UPLOAD }),
  async (req, res) => {
    try {
      const original = String(req.query.name || "asset");
      let ext = extname(original).toLowerCase();
      if (!ALLOWED_EXT.has(ext)) {
        // fall back to content-type
        const ct = String(req.headers["content-type"] || "");
        if (ct.includes("png")) ext = ".png";
        else if (ct.includes("jpeg") || ct.includes("jpg")) ext = ".jpg";
        else if (ct.includes("gif")) ext = ".gif";
        else if (ct.includes("webp")) ext = ".webp";
        else if (ct.includes("pdf")) ext = ".pdf";
        else return res.status(400).json({ error: "unsupported file type" });
      }
      if (!req.body || !req.body.length) {
        return res.status(400).json({ error: "empty upload" });
      }
      if (!existsSync(UPLOAD_DIR)) await mkdir(UPLOAD_DIR, { recursive: true });
      const filename = `${Date.now()}-${randomUUID().slice(0, 8)}${ext}`;
      const url = `/uploads/${filename}`;
      await writeFile(join(UPLOAD_DIR, filename), req.body);
      // Register in the media library (refCount starts at 0 until a theme saves it)
      const entry = await registerUpload({
        url, filename, size: req.body.length, buffer: req.body
      });
      res.status(201).json(entry);
    } catch (err) {
      res.status(500).json({ error: "upload failed", detail: String(err.message) });
    }
  }
);

// ---------- Media library (admin-only) ----------
api.get("/media", requireAuth, async (req, res) => {
  const list = await readMedia();
  // newest first
  res.json(list.slice().sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || "")));
});

// Delete a specific asset. Blocked if still referenced (refCount > 0).
api.delete("/media", requireAuth, async (req, res) => {
  const url = String(req.query.url || "");
  if (!url) return res.status(400).json({ error: "url query required" });
  // refresh counts before deciding
  await syncAllReferences([url]);
  const list = await readMedia();
  const entry = list.find((m) => m.url === url);
  if (!entry) return res.status(404).json({ error: "not found" });
  if (entry.refCount > 0) {
    return res.status(409).json({ error: "asset in use", refCount: entry.refCount });
  }
  await deleteMedia(url);
  res.json({ ok: true, deleted: url });
});

// Sweep orphans on demand (utility)
api.post("/media/cleanup", requireAuth, async (req, res) => {
  const removed = await syncAllReferences();
  res.json({ ok: true, removed });
});

app.use("/api", api);

// ---------- Static files ----------
app.use(express.static(PUBLIC_DIR));

// Friendly routes
app.get("/admin", (req, res) => res.sendFile(join(PUBLIC_DIR, "admin.html")));
app.get("/", (req, res) => res.sendFile(join(PUBLIC_DIR, "index.html")));

app.listen(PORT, async () => {
  // Reconcile any untracked files in /uploads, then refresh reference counts.
  try {
    const { added } = await reconcileUploads();
    await syncAllReferences();
    if (added.length) console.log(`   Media  : reconciled ${added.length} untracked upload(s)`);
  } catch (err) {
    console.warn("   Media  : reconcile skipped —", err.message);
  }
  console.log(`\n  MY RUNNER PROFILE running:`);
  console.log(`   Public : http://localhost:${PORT}/`);
  console.log(`   Admin  : http://localhost:${PORT}/admin`);
  console.log(`   API    : http://localhost:${PORT}/api/races`);
  console.log(`   Themes : http://localhost:${PORT}/api/themes\n`);
});
