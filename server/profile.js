// ============================================================
// Runner Profile data layer for RUN QUEST 2026
// - Single profile in data/profile.json (name, tagline, bio, PBs, links)
// ============================================================
import { readFile, writeFile, rename, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, "..", "data");
const PROFILE_FILE = join(DATA_DIR, "profile.json");

const DEFAULTS = {
  name: "RUNNER",
  tagline: "",
  bio: "",
  pbs: { "5k": "", "10k": "", "hm": "", "fm": "" },
  strava: "",
  instagram: "",
  website: ""
};

let writeChain = Promise.resolve();

async function ensureStore() {
  if (!existsSync(DATA_DIR)) await mkdir(DATA_DIR, { recursive: true });
  if (!existsSync(PROFILE_FILE)) {
    await writeFile(PROFILE_FILE, JSON.stringify(DEFAULTS, null, 2), "utf8");
  }
}

const str = (v) => String(v ?? "").trim();
// Accept only http(s) links; empty otherwise (prevents javascript: etc.)
function safeUrl(v) {
  v = str(v);
  if (!v) return "";
  return /^https?:\/\//i.test(v) ? v : "";
}
// PB time like "1:58:42", "53:14", or free text up to 20 chars
function pbVal(v) { return str(v).slice(0, 20); }

export function normalizeProfile(input, existing = DEFAULTS) {
  const p = { ...existing, ...input };
  const pbsIn = p.pbs || {};
  return {
    name: str(p.name).slice(0, 60) || DEFAULTS.name,
    tagline: str(p.tagline).slice(0, 120),
    bio: str(p.bio).slice(0, 500),
    pbs: {
      "5k": pbVal(pbsIn["5k"]),
      "10k": pbVal(pbsIn["10k"]),
      "hm": pbVal(pbsIn["hm"]),
      "fm": pbVal(pbsIn["fm"])
    },
    strava: safeUrl(p.strava),
    instagram: safeUrl(p.instagram),
    website: safeUrl(p.website)
  };
}

export async function getProfile() {
  await ensureStore();
  try {
    const raw = await readFile(PROFILE_FILE, "utf8");
    return normalizeProfile(JSON.parse(raw || "{}"));
  } catch {
    return { ...DEFAULTS };
  }
}

export async function saveProfile(input) {
  await ensureStore();
  const current = await getProfile();
  const next = normalizeProfile(input, current);
  writeChain = writeChain.then(async () => {
    const tmp = `${PROFILE_FILE}.${randomUUID()}.tmp`;
    await writeFile(tmp, JSON.stringify(next, null, 2), "utf8");
    await rename(tmp, PROFILE_FILE);
  });
  await writeChain;
  return next;
}
