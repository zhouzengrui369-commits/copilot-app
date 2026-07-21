import crypto from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { Db } from "./db.js";
import { hasUser, sessionExpiresAt } from "./db.js";
import { FORWARDER_AUTH_TOKEN, nowIso } from "./config.js";

export function hashPassword(password: string, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = crypto.pbkdf2Sync(password, salt, 210_000, 32, "sha256").toString("hex");
  return { hash, salt };
}

export function verifyPassword(password: string, salt: string, expected: string) {
  const actual = hashPassword(password, salt).hash;
  return crypto.timingSafeEqual(Buffer.from(actual, "hex"), Buffer.from(expected, "hex"));
}

export function tokenHash(token: string) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export function parseCookies(req: FastifyRequest) {
  const header = req.headers.cookie || "";
  const out: Record<string, string> = {};
  for (const part of header.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (!k) continue;
    out[k] = decodeURIComponent(rest.join("="));
  }
  return out;
}

export function createSession(db: Db, reply: FastifyReply) {
  const token = crypto.randomBytes(32).toString("hex");
  db.prepare("INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)")
    .run(tokenHash(token), 1, sessionExpiresAt(), nowIso());
  reply.header("Set-Cookie", `owb_session=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${14 * 24 * 60 * 60}`);
  return token;
}

export function clearSession(reply: FastifyReply) {
  reply.header("Set-Cookie", "owb_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0");
}

export function requireAuth(db: Db, req: FastifyRequest, reply: FastifyReply) {
  const cookies = parseCookies(req);
  const testToken = process.env.OPENCLAW_WORKBENCH_TEST_TOKEN;
  if (testToken && testToken.length >= 20 && cookies.owb_test_session === testToken) return true;
  if (FORWARDER_AUTH_TOKEN && forwardedByOpenClaw(req)) return true;
  const bearer = bearerToken(req);
  if (bearer && requireMobileBearerAuth(db, bearer)) return true;
  if (!hasUser(db)) {
    reply.code(401).send({ ok: false, error: "setup_required" });
    return false;
  }
  const token = cookies.owb_session;
  if (!token) {
    reply.code(401).send({ ok: false, error: "login_required" });
    return false;
  }
  const row = db.prepare("SELECT expires_at FROM sessions WHERE token_hash = ?").get(tokenHash(token)) as { expires_at: string } | undefined;
  if (!row || Date.parse(row.expires_at) < Date.now()) {
    reply.code(401).send({ ok: false, error: "login_required" });
    return false;
  }
  return true;
}

function forwardedByOpenClaw(req: FastifyRequest) {
  const token = headerValue(req.headers["x-openclaw-forwarder-token"]);
  if (!token || token !== FORWARDER_AUTH_TOKEN) return false;
  const marker = headerValue(req.headers["x-forwarded-by"]);
  return marker === "cloudbase-forwarder";
}

function bearerToken(req: FastifyRequest) {
  const header = req.headers.authorization || "";
  const value = headerValue(header);
  const match = String(value || "").match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || "";
}

function headerValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] || "" : String(value || "");
}

function requireMobileBearerAuth(db: Db, token: string) {
  try {
    const row = db.prepare(`
      SELECT t.id, t.device_id, t.expires_at, d.status AS device_status
      FROM mobile_device_tokens t
      JOIN mobile_devices d ON d.id = t.device_id
      WHERE t.token_hash = ?
        AND t.kind = 'access'
        AND t.revoked_at IS NULL
        AND d.status = 'active'
      LIMIT 1
    `).get(tokenHash(token)) as { id: string; device_id: string; expires_at: string; device_status: string } | undefined;
    if (!row || Date.parse(row.expires_at) < Date.now()) return false;
    db.prepare("UPDATE mobile_device_tokens SET last_used_at = ? WHERE id = ?").run(nowIso(), row.id);
    db.prepare("UPDATE mobile_devices SET last_seen_at = ? WHERE id = ?").run(nowIso(), row.device_id);
    return true;
  } catch {
    return false;
  }
}
