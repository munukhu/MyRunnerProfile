// ============================================================
// Media library + reference counting for RUN QUEST 2026
// - Tracks every uploaded asset in data/media.json
// - Reference counting: a file is physically deleted only when no
//   theme/race references it anymore (refCount hits 0)
// - Captures image dimensions by parsing file headers (no deps)
// ============================================================
import { readFile, writeFile, rename, mkdir, unlink, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, basename } from "node:path";
import { randomUUID } from "node:crypto";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, "..", "data");
const MEDIA_FILE = join(DATA_DIR, "media.json");
const PUBLIC_DIR = join(__dirname, "..", "public");
const UPLOAD_DIR = join(PUBLIC_DIR, "uploads");

let writeChain = Promise.resolve();

async function ensureStore() {
  if (!existsSync(DATA_DIR)) await mkdir(DATA_DIR, { recursive: true });
  if (!existsSync(MEDIA_FILE)) await writeFile(MEDIA_FILE, "[]", "utf8");
}

export async function readMedia() {
  await ensureStore();
  const raw = await readFile(MEDIA_FILE, "utf8");
  let list;
  try { list = JSON.parse(raw || "[]"); } catch { list = []; }
  if (!Array.isArray(list)) list = [];
  return list;
}

function persist(list) {
  writeChain = writeChain.then(async () => {
    await ensureStore();
    const tmp = `${MEDIA_FILE}.${randomUUID()}.tmp`;
    await writeFile(tmp, JSON.stringify(list, null, 2), "utf8");
    await rename(tmp, MEDIA_FILE);
  });
  return writeChain;
}

// Only manage same-origin uploaded files; external URLs are never tracked/deleted.
function isManaged(url) {
  return typeof url === "string" && url.startsWith("/uploads/");
}
function fileForUrl(url) {
  return join(UPLOAD_DIR, basename(url)); // basename guards against traversal
}

// ---------- Image dimension parsing (headers only) ----------
export function imageSize(buf) {
  try {
    // PNG
    if (buf.length >= 24 && buf[0] === 0x89 && buf[1] === 0x50) {
      return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
    }
    // GIF
    if (buf.length >= 10 && buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) {
      return { width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) };
    }
    // JPEG — scan for SOF marker
    if (buf.length >= 4 && buf[0] === 0xff && buf[1] === 0xd8) {
      let off = 2;
      while (off + 9 < buf.length) {
        if (buf[off] !== 0xff) { off++; continue; }
        const marker = buf[off + 1];
        // SOF0..SOF15 except DHT(0xc4)/DNL(0xc8)/DAC(0xcc)
        if (marker >= 0xc0 && marker <= 0xcf &&
            marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
          return { height: buf.readUInt16BE(off + 5), width: buf.readUInt16BE(off + 7) };
        }
        off += 2 + buf.readUInt16BE(off + 2);
      }
    }
    // WEBP (VP8X / VP8 / VP8L)
    if (buf.length >= 30 && buf.toString("ascii", 0, 4) === "RIFF" &&
        buf.toString("ascii", 8, 12) === "WEBP") {
      const fmt = buf.toString("ascii", 12, 16);
      if (fmt === "VP8X") {
        const w = 1 + (buf[24] | (buf[25] << 8) | (buf[26] << 16));
        const h = 1 + (buf[27] | (buf[28] << 8) | (buf[29] << 16));
        return { width: w, height: h };
      }
      if (fmt === "VP8 ") {
        return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
      }
    }
  } catch { /* fall through */ }
  return { width: 0, height: 0 };
}

// ---------- Register a freshly written upload ----------
export async function registerUpload({ url, filename, size, buffer }) {
  const list = await readMedia();
  const dims = buffer ? imageSize(buffer) : { width: 0, height: 0 };
  const entry = {
    id: randomUUID().slice(0, 12),
    url,
    filename,
    size: size || (buffer ? buffer.length : 0),
    width: dims.width,
    height: dims.height,
    refCount: 0,               // becomes >0 once a theme/race references it
    createdAt: new Date().toISOString()
  };
  list.push(entry);
  await persist(list);
  return entry;
}

// ---------- Physical + record delete ----------
async function removeFileAndRecord(list, url) {
  if (!isManaged(url)) return;
  const idx = list.findIndex((m) => m.url === url);
  if (idx !== -1) list.splice(idx, 1);
  const fp = fileForUrl(url);
  try { if (existsSync(fp)) await unlink(fp); } catch { /* ignore */ }
}

// ---------- Reference maintenance ----------
// Compute how many times each managed url is referenced across all consumers.
// consumers = array of arrays of urls, e.g. themes' [bg, landmark], races' [...]
export async function syncReferences(allReferencedUrls) {
  const list = await readMedia();
  const counts = new Map();
  for (const url of allReferencedUrls) {
    if (!isManaged(url)) continue;
    counts.set(url, (counts.get(url) || 0) + 1);
  }
  const survivors = [];
  for (const m of list) {
    const c = counts.get(m.url) || 0;
    m.refCount = c;
    survivors.push(m);
  }
  await persist(survivors);
  return survivors;
}

// Delete orphaned files: managed entries with refCount 0 AND not in keepUrls.
// keepUrls lets us preserve freshly-uploaded-but-not-yet-saved assets briefly.
export async function cleanupOrphans(keepUrls = []) {
  const keep = new Set(keepUrls);
  const list = await readMedia();
  const survivors = [];
  const removed = [];
  for (const m of list) {
    if (m.refCount <= 0 && !keep.has(m.url)) {
      removed.push(m.url);
      const fp = fileForUrl(m.url);
      try { if (existsSync(fp)) await unlink(fp); } catch { /* ignore */ }
    } else {
      survivors.push(m);
    }
  }
  if (removed.length) await persist(survivors);
  return removed;
}

// Explicitly delete a specific managed asset (used by media DELETE endpoint).
export async function deleteMedia(url) {
  const list = await readMedia();
  await removeFileAndRecord(list, url);
  await persist(list);
}

// Convenience: gather referenced urls from themes + races
export function collectUrls({ themes = [], races = [] }) {
  const urls = [];
  for (const t of themes) {
    if (t.backgroundImage) urls.push(t.backgroundImage);
    if (t.landmarkImage) urls.push(t.landmarkImage);
  }
  // races currently reference images only via their theme, but we future-proof:
  for (const r of races) {
    if (r.image) urls.push(r.image);
  }
  return urls;
}

// ---------- Startup reconciliation ----------
// Register any file physically present in /uploads that isn't yet tracked in
// media.json (e.g. files uploaded before the media system existed). This makes
// orphans visible + deletable in the Media Library instead of lingering forever.
export async function reconcileUploads() {
  if (!existsSync(UPLOAD_DIR)) return { added: [] };
  let files;
  try { files = await readdir(UPLOAD_DIR); } catch { return { added: [] }; }

  const list = await readMedia();
  const known = new Set(list.map((m) => m.url));
  const added = [];

  for (const name of files) {
    if (name === ".gitkeep") continue;
    const url = `/uploads/${name}`;
    if (known.has(url)) continue;
    const fp = join(UPLOAD_DIR, name);
    let buffer = null, size = 0;
    try {
      buffer = await readFile(fp);
      size = buffer.length;
    } catch { continue; }
    const dims = imageSize(buffer);
    list.push({
      id: randomUUID().slice(0, 12),
      url,
      filename: name,
      size,
      width: dims.width,
      height: dims.height,
      refCount: 0,
      createdAt: new Date().toISOString(),
      reconciled: true
    });
    added.push(url);
  }
  if (added.length) await persist(list);
  return { added };
}
