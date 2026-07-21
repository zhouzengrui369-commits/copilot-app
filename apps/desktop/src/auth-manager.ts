/**
 * Desktop session / password manager.
 *
 * Why this exists:
 *   - Chromium stores `owb_session` cookies in the desktop app's userData
 *     Cookies sqlite. The workbench server stores session rows keyed by
 *     `sha256(token)`. If those two diverge (e.g. another client logged in
 *     and overwrote the server session row without the desktop webview
 *     picking up the new Set-Cookie), every `/api/*` request that needs
 *     auth fails with `login_required` even though the user is still
 *     "logged in" from the webview's perspective.
 *   - Long-term fix: store the workbench password encrypted in the OS
 *     keychain via `electron.safeStorage`, and on each desktop launch,
 *     proactively re-login if the cookie doesn't match any server
 *     session. This keeps the cookie and the session row in sync.
 *
 * Design constraints:
 *   - `safeStorage.encryptString` is only available after `app.whenReady`
 *     resolves on macOS/Linux. We call it lazily.
 *   - We never log the password or write it to disk in plaintext. The
 *     encrypted blob lives in electron-store under
 *     `auth.workbenchPassword`.
 *   - `electron-store` is already in `apps/desktop/package.json`. We
 *     import the v8 default export (CommonJS) and wrap it in a small
 *     typed surface so the rest of main.ts doesn't need to know the
 *     storage layout.
 *   - Auto-login runs after the server reports `ready`. If login fails
 *     (e.g. password changed elsewhere), we surface the failure to the
 *     splash so the user knows to re-enter via the AuthScreen.
 */
// eslint-disable-next-line @typescript-eslint/no-var-requires
import Store from "electron-store";
import { app, safeStorage, type BrowserWindow } from "electron";
import http from "node:http";

interface AuthStoreSchema {
  /** Encrypted (safeStorage) base64 of the workbench password. */
  workbenchPassword?: string;
  /** Last known good session token (raw, not hashed). Stored separately
   *  so we can detect drift without re-encrypting the password on every
   *  launch. */
  lastSessionToken?: string;
}

const store = new Store<AuthStoreSchema>({
  name: "auth",
  encryptionKey: "openclaw-workbench-desktop-v1",
  defaults: { workbenchPassword: undefined, lastSessionToken: undefined },
});

const COOKIE_NAME = "owb_session";
const PASSWORD_KEY = "workbenchPassword";

export type AuthEvent =
  | { kind: "login_succeeded"; token: string }
  | { kind: "login_failed"; reason: string }
  | { kind: "no_password_stored" }
  | { kind: "skipped"; reason: string };

export interface AutoLoginResult {
  attempted: boolean;
  event?: AuthEvent;
}

/**
 * Persist a plaintext workbench password encrypted at rest via
 * `safeStorage`. No-op if `safeStorage.isEncryptionAvailable()` returns
 * false (e.g. on Linux without a keyring) — in that case we skip
 * persistence rather than store plaintext.
 */
export function rememberPassword(plaintext: string): boolean {
  if (!plaintext) return false;
  if (!safeStorage.isEncryptionAvailable()) {
    console.warn("[auth] safeStorage unavailable; password not persisted");
    return false;
  }
  try {
    const cipher = safeStorage.encryptString(plaintext).toString("base64");
    store.set(PASSWORD_KEY, cipher);
    return true;
  } catch (err) {
    console.error("[auth] failed to persist password:", err);
    return false;
  }
}

export function clearPassword(): void {
  store.delete(PASSWORD_KEY);
}

export function hasStoredPassword(): boolean {
  if (!safeStorage.isEncryptionAvailable()) return false;
  const cipher = store.get(PASSWORD_KEY);
  return typeof cipher === "string" && cipher.length > 0;
}

/** Decode the stored password. Returns undefined if missing or decrypt fails. */
export function readPassword(): string | undefined {
  if (!hasStoredPassword()) return undefined;
  try {
    const cipher = store.get(PASSWORD_KEY);
    if (!cipher) return undefined;
    return safeStorage.decryptString(Buffer.from(cipher, "base64"));
  } catch (err) {
    console.error("[auth] failed to decrypt password:", err);
    return undefined;
  }
}

/**
 * Cookie/session drift check: hit `/api/auth/me` once. If it returns 200
 * we trust the cookie is still good. If it returns 401, we know the
 * cookie is stale and the caller should attempt auto-login.
 */
export function checkAuthHealth(
  baseUrl: string,
  cookieToken?: string,
): Promise<{ ok: boolean; status: number; reason?: string }> {
  return new Promise((resolve) => {
    try {
      const url = new URL("/api/auth/me", baseUrl);
      const headers: Record<string, string> = {};
      if (cookieToken) {
        headers["Cookie"] = `${COOKIE_NAME}=${encodeURIComponent(cookieToken)}`;
      }
      const req = http.request(
        {
          hostname: url.hostname,
          port: url.port || 80,
          path: url.pathname,
          method: "GET",
          headers,
          timeout: 4000,
        },
        (res) => {
          // Drain & discard body
          res.resume();
          if (res.statusCode === 200) {
            resolve({ ok: true, status: 200 });
          } else if (res.statusCode === 401) {
            resolve({ ok: false, status: 401, reason: "login_required" });
          } else {
            resolve({ ok: false, status: res.statusCode || 0, reason: "unexpected" });
          }
        },
      );
      req.on("error", (err) => resolve({ ok: false, status: 0, reason: err.message }));
      req.on("timeout", () => {
        req.destroy(new Error("timeout"));
      });
      req.end();
    } catch (err) {
      resolve({ ok: false, status: 0, reason: err instanceof Error ? err.message : String(err) });
    }
  });
}

/**
 * POST `/api/auth/login` with a plaintext password and return the
 * `owb_session` cookie value parsed from `Set-Cookie`. Returns undefined
 * if login fails (network error, 401, no cookie set).
 */
export function loginWithPassword(
  baseUrl: string,
  password: string,
): Promise<{ ok: boolean; token?: string; reason?: string }> {
  return new Promise((resolve) => {
    try {
      const url = new URL("/api/auth/login", baseUrl);
      const body = JSON.stringify({ password });
      const req = http.request(
        {
          hostname: url.hostname,
          port: url.port || 80,
          path: url.pathname,
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Content-Length": Buffer.byteLength(body),
          },
          timeout: 6000,
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on("data", (chunk) => chunks.push(chunk));
          res.on("end", () => {
            const raw = Buffer.concat(chunks).toString("utf8");
            if (res.statusCode !== 200) {
              resolve({ ok: false, reason: raw || `status_${res.statusCode}` });
              return;
            }
            // The Set-Cookie header is on `res.headers["set-cookie"]` (array form).
            const setCookies = res.headers["set-cookie"];
            if (!Array.isArray(setCookies)) {
              resolve({ ok: false, reason: "no_set_cookie" });
              return;
            }
            const target = setCookies.find((c) => c.startsWith(`${COOKIE_NAME}=`));
            if (!target) {
              resolve({ ok: false, reason: "owb_session_not_set" });
              return;
            }
            const token = decodeURIComponent(target.split(";")[0].split("=").slice(1).join("="));
            if (!token) {
              resolve({ ok: false, reason: "empty_token" });
              return;
            }
            resolve({ ok: true, token });
          });
        },
      );
      req.on("error", (err) => resolve({ ok: false, reason: err.message }));
      req.on("timeout", () => {
        req.destroy(new Error("timeout"));
      });
      req.write(body);
      req.end();
    } catch (err) {
      resolve({ ok: false, reason: err instanceof Error ? err.message : String(err) });
    }
  });
}

/**
 * Inject `owb_session=<token>` into a BrowserWindow's cookie jar so the
 * next `fetch` call sees a valid session. Uses `webContents.session.cookies.set`
 * with the matching origin so Chromium stores it under the same host key
 * the server sets on login.
 */
export async function injectSessionCookie(
  window: BrowserWindow,
  baseUrl: string,
  token: string,
): Promise<boolean> {
  try {
    const url = new URL(baseUrl);
    await window.webContents.session.cookies.set({
      url: url.origin,
      name: COOKIE_NAME,
      value: token,
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      expirationDate: Math.floor(Date.now() / 1000) + 14 * 24 * 60 * 60,
    });
    return true;
  } catch (err) {
    console.error("[auth] failed to inject session cookie:", err);
    return false;
  }
}

export async function clearSessionCookie(window: BrowserWindow, baseUrl: string): Promise<void> {
  try {
    const url = new URL(baseUrl);
    await window.webContents.session.cookies.remove(url.origin, COOKIE_NAME);
  } catch (err) {
    console.warn("[auth] failed to clear session cookie:", err);
  }
}

/**
 * Read the current `owb_session` cookie from the BrowserWindow's cookie
 * jar. Returns undefined if absent.
 */
export async function readSessionCookie(
  window: BrowserWindow,
  baseUrl: string,
): Promise<string | undefined> {
  try {
    const url = new URL(baseUrl);
    const cookies = await window.webContents.session.cookies.get({ url: url.origin, name: COOKIE_NAME });
    const hit = cookies.find((c) => c.name === COOKIE_NAME);
    return hit?.value;
  } catch (err) {
    console.warn("[auth] failed to read session cookie:", err);
    return undefined;
  }
}

/**
 * Top-level orchestrator. Called once after the server is ready and the
 * main window has loaded. Performs the drift check + auto-login and
 * optionally reloads the window so the renderer picks up the new
 * session.
 */
export async function reconcileSession(
  window: BrowserWindow,
  baseUrl: string,
): Promise<AutoLoginResult> {
  if (!app.isReady()) {
    return { attempted: false, event: { kind: "skipped", reason: "app_not_ready" } };
  }

  // 1. Pull the current cookie from the webview (if any).
  const existingCookie = await readSessionCookie(window, baseUrl);

  // 2. Probe /api/auth/me to see if the cookie still works server-side.
  const health = await checkAuthHealth(baseUrl, existingCookie);

  if (health.ok) {
    if (existingCookie) store.set("lastSessionToken", existingCookie);
    return { attempted: false, event: { kind: "skipped", reason: "session_valid" } };
  }

  // 3. Cookie is stale (or missing). Try auto-login if we have a stored password.
  if (!hasStoredPassword()) {
    return { attempted: false, event: { kind: "no_password_stored" } };
  }

  const password = readPassword();
  if (!password) {
    return { attempted: false, event: { kind: "no_password_stored" } };
  }

  const login = await loginWithPassword(baseUrl, password);
  if (!login.ok || !login.token) {
    // Stored password no longer matches. Clear it so we don't loop forever.
    clearPassword();
    return {
      attempted: true,
      event: { kind: "login_failed", reason: login.reason || "unknown" },
    };
  }

  // 4. Wipe stale cookie + inject fresh one.
  await clearSessionCookie(window, baseUrl);
  const injected = await injectSessionCookie(window, baseUrl, login.token);
  if (!injected) {
    return {
      attempted: true,
      event: { kind: "login_failed", reason: "cookie_inject_failed" },
    };
  }
  store.set("lastSessionToken", login.token);
  return { attempted: true, event: { kind: "login_succeeded", token: login.token } };
}
