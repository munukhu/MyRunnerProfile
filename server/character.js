// ============================================================
// Character (runner sprite) config for RUN QUEST 2026
// - Single config in data/character.json applied to the runner everywhere
// - Colors drive CSS custom properties (skin / hair / jersey / shorts)
// ============================================================
import { readFile, writeFile, rename, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, "..", "data");
const CHAR_FILE = join(DATA_DIR, "character.json");

const DEFAULTS = {
  skinTone: "#ffcf8b",
  hairColor: "#2b2b3a",
  jerseyColor: "#4cc9f0",
  shortsColor: "#2b3a55",
  shoesColor: "#e8e8f0"
};

let writeChain = Promise.resolve();

async function ensureStore() {
  if (!existsSync(DATA_DIR)) await mkdir(DATA_DIR, { recursive: true });
  if (!existsSync(CHAR_FILE)) await writeFile(CHAR_FILE, JSON.stringify(DEFAULTS, null, 2), "utf8");
}

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;
function color(v, fallback) {
  v = String(v || "").trim();
  return HEX.test(v) ? v : fallback;
}

export async function getCharacter() {
  await ensureStore();
  try {
    const raw = await readFile(CHAR_FILE, "utf8");
    const c = JSON.parse(raw || "{}");
    return normalizeCharacter(c);
  } catch {
    return { ...DEFAULTS };
  }
}

export function normalizeCharacter(input, existing = DEFAULTS) {
  const c = { ...existing, ...input };
  return {
    skinTone: color(c.skinTone, DEFAULTS.skinTone),
    hairColor: color(c.hairColor, DEFAULTS.hairColor),
    jerseyColor: color(c.jerseyColor, DEFAULTS.jerseyColor),
    shortsColor: color(c.shortsColor, DEFAULTS.shortsColor),
    shoesColor: color(c.shoesColor, DEFAULTS.shoesColor)
  };
}

export async function saveCharacter(input) {
  await ensureStore();
  const current = await getCharacter();
  const next = normalizeCharacter(input, current);
  writeChain = writeChain.then(async () => {
    const tmp = `${CHAR_FILE}.${randomUUID()}.tmp`;
    await writeFile(tmp, JSON.stringify(next, null, 2), "utf8");
    await rename(tmp, CHAR_FILE);
  });
  await writeChain;
  return next;
}

// No external asset urls anymore (sprite sheet removed). Kept for API compatibility.
export async function characterAssetUrls() {
  return [];
}
