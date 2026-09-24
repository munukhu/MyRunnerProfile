// ============================================================
// Simple auth for RUN QUEST 2026 (no external dependencies)
// - Loads credentials from .env
// - Stateless sessions via a signed HMAC cookie token
// - Express middleware to protect routes
// ============================================================
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createHmac, timingSafeEqual, randomBytes } from "node:crypto";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ENV_FILE = join(__dirname, "..", ".env");

// ---------- Minimal .env loader (no dotenv dependency) ----------
function loadEnv() {
  if (!existsSync(ENV_FILE)) return;
  const raw = readFileSync(ENV_FILE, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    // strip surrounding quotes
    if ((val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = val;
  }
}
loadEnv();

export const AUTH = {
  username: process.env.ADMIN_USERNAME || "admin",
  password: process.env.ADMIN_PASSWORD || "changeme",
  secret: process.env.SESSION_SECRET || randomBytes(32).toString("hex"),
  sessionHours: Number(process.env.SESSION_HOURS) || 12
};

if (!process.env.SESSION_SECRET) {
  console.warn("   Auth   : SESSION_SECRET not set — using a random secret (sessions reset on restart).");
}
if (process.env.ADMIN_PASSWORD === "changeme" || !process.env.ADMIN_PASSWORD) {
  console.warn("   Auth   : using default/placeholder ADMIN_PASSWORD — set a real one in .env.");
}

const COOKIE_NAME = "rq_session";

// ---------- Constant-time string compare ----------
function safeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

// ---------- Token = base64url(payload).hmac ----------
function b64url(buf) {
  return Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function sign(data) {
  return createHmac("sha256", AUTH.secret).update(data).digest("base64")
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function createToken(username) {
  const payload = JSON.stringify({
    u: username,
    exp: Date.now() + AUTH.sessionHours * 3600 * 1000
  });
  const body = b64url(payload);
  return `${body}.${sign(body)}`;
}

export function verifyToken(token) {
  if (!token || typeof token !== "string" || !token.includes(".")) return null;
  const [body, mac] = token.split(".");
  if (!body || !mac) return null;
  if (!safeEqual(mac, sign(body))) return null;
  try {
    const payload = JSON.parse(Buffer.from(body.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"));
    if (!payload.exp || Date.now() > payload.exp) return null;
    return payload; // { u, exp }
  } catch {
    return null;
  }
}

// ---------- Credential check ----------
export function checkCredentials(username, password) {
  // Compare both to avoid short-circuit timing leaks
  const okUser = safeEqual(username || "", AUTH.username);
  const okPass = safeEqual(password || "", AUTH.password);
  return okUser && okPass;
}

// ---------- Cookie helpers ----------
export function parseCookies(req) {
  const header = req.headers.cookie || "";
  const out = {};
  header.split(";").forEach((part) => {
    const i = part.indexOf("=");
    if (i === -1) return;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  });
  return out;
}

export function setSessionCookie(res, token) {
  const maxAge = AUTH.sessionHours * 3600; // seconds
  res.setHeader("Set-Cookie",
    `${COOKIE_NAME}=${encodeURIComponent(token)}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${maxAge}`);
}

export function clearSessionCookie(res) {
  res.setHeader("Set-Cookie",
    `${COOKIE_NAME}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0`);
}

export function getSession(req) {
  const cookies = parseCookies(req);
  return verifyToken(cookies[COOKIE_NAME]);
}

// ---------- Express middleware: require an authenticated session ----------
export function requireAuth(req, res, next) {
  const session = getSession(req);
  if (!session) return res.status(401).json({ error: "authentication required" });
  req.user = session.u;
  next();
}
