// 2026-07-06 — R17: QR 扫码配对 helper。
//
// 桌面端工作台已经显示了 QR 码(openclaw://pair?server=<url>&code=<6-digit>);
// 手机端的 QR 扫码入口需要:
//   1. 解析扫描到的 payload —— extractPairingPayloadFromText
//   2. 验证 payload 是不是 OpenClaw 配对 QR —— isQRScanPayload
//   3. 检测 + 请求相机权限 —— requestQRScannerPermission (lazy import expo-camera)
//
// 设计要点:
//   - QR 解析必须是"宽松"的:既认 openclaw://pair?... 自定义 scheme,
//     也认 http(s)://<host>/pair?server=...&code=... 的深链,还认
//     `server=<url>\ncode=<123456>` 这种把两个参数写在多行/单行文本里
//     的退化格式(老桌面端 / 第三方工具可能这么打印)。
//   - 解析失败必须可读,UI 拿到的 reason 字符串会直接显示给用户。
//   - 不引入 React / 不引用任何 native 模块,这样 helper 可以被
//     R17 contract test 直接 require()。

export type QRScanPayload = {
  /** Mac 工作台 URL,标准化后(http(s)://host:port 形式) */
  server: string;
  /** 6 位数字配对码 */
  code: string;
  /** 原始 payload 字符串,留作诊断 */
  raw: string;
  /** 解析来源(用于诊断) */
  source: "openclaw-scheme" | "https-url" | "query-string" | "loose-text";
};

export type QRScanPermissionState = "unknown" | "granted" | "denied" | "unavailable";

/**
 * 把任意扫描 / 剪贴板文本翻译成 OpenClaw 配对 payload;失败时返回 null。
 *
 * 支持的格式:
 *   (a) openclaw://pair?server=http%3A%2F%2F192.168.0.107%3A38888&code=123456
 *   (b) https://192.168.0.107:38888/pair?server=...&code=123456
 *   (c) http://<host>:<port>/pair?server=<url>&code=<6-digit>  (deep link via web redirect)
 *   (d) server=http://192.168.0.107:38888\ncode=123456  (loose text)
 *   (e) "server=http://192.168.0.107:38888 code=123456"   (loose, single line)
 */
export function extractPairingPayloadFromText(text: string): QRScanPayload | null {
  if (!text) return null;
  const raw = text.trim();
  if (!raw) return null;

  // (a) openclaw://pair?... or openclaw:pair?...
  // Once we've decided the input is an openclaw:// URL, we MUST treat it as
  // such. Don't fall through to the loose-text parser below — that would let
  // malformed QR codes like `openclaw://pair?server=&code=123456` slip into
  // the loose path with a junk "server=&code=123456" value.
  if (/^openclaw:/i.test(raw)) {
    const parsed = parseQuery(raw);
    if (parsed) {
      return finalize("openclaw-scheme", parsed, raw);
    }
    return null;
  }

  // (b/c) http(s)://... — 找 query 里的 server= 和 code=
  if (/^https?:\/\//i.test(raw)) {
    const parsed = parseQuery(raw);
    if (parsed) {
      return finalize("https-url", parsed, raw);
    }
    return null;
  }

  // (d/e) loose text — server=<url> + code=<6-digit>
  const looseServer = matchLoose(raw, "server");
  const looseCode = matchLoose(raw, "code");
  if (looseServer && looseCode) {
    return finalize("loose-text", { server: looseServer, code: looseCode }, raw);
  }

  // (e2) 整行就是 server URL + 第二行 code(桌面端日志型输出)
  const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length >= 2) {
    const urlLine = lines.find((l) => /^https?:\/\//i.test(l));
    const codeLine = lines.find((l) => /^\d{6}$/.test(l));
    if (urlLine && codeLine) {
      return finalize("loose-text", { server: urlLine, code: codeLine }, raw);
    }
  }

  return null;
}

/**
 * 验证文本看起来像 OpenClaw 配对 payload(粗校验,不要求一定解析成功)。
 * UI 在打开扫描器前可用它做软提示,例如扫描到 "hello world" 时显示
 * "这不是 OpenClaw 配对 QR"。
 */
export function isQRScanPayload(text: string): boolean {
  if (!text) return false;
  const lower = text.toLowerCase();
  // 任何含 pair/=code/server 三种特征之一
  if (/(?:^|[\/?&])pair(?:[?&\s=]|$)/i.test(lower)) return true;
  if (/\bcode\s*=\s*\d{6}\b/i.test(lower)) return true;
  if (/\bserver\s*=\s*https?:\/\//i.test(lower)) return true;
  if (/^openclaw:/i.test(lower)) return true;
  return false;
}

/**
 * 动态 import expo-camera 并请求权限。
 * - native 模块未编译完成时:返回 "unavailable",UI 走"手动粘贴 / 剪贴板"。
 * - 用户拒绝权限:返回 "denied",UI 提示"在系统设置里允许相机后重试"。
 * - 用户同意:返回 "granted",UI 进入实时扫码界面。
 */
export async function requestQRScannerPermission(): Promise<QRScanPermissionState> {
  try {
    // dynamic import — native module not linked → import resolves null
    // @ts-ignore — expo-camera is an optional dep, not in current package.json;
    // the dynamic import will resolve to `null` at runtime when the module is missing.
    const mod = await import(/* @vite-ignore */ "expo-camera").catch(() => null);
    if (!mod) return "unavailable";
    const requestFn = (mod as { requestCameraPermissionsAsync?: () => Promise<{ status?: string }> }).requestCameraPermissionsAsync;
    if (typeof requestFn !== "function") return "unavailable";
    const result = await requestFn();
    const status = String(result?.status || "").toLowerCase();
    if (status === "granted") return "granted";
    if (status === "denied") return "denied";
    return "denied";
  } catch {
    return "unavailable";
  }
}

// ---------------------------------------------------------------------------
// 内部 helpers
// ---------------------------------------------------------------------------

type LooseQuery = { server: string | null; code: string | null };

function parseQuery(url: string): LooseQuery | null {
  try {
    const parsed = new URL(url);
    const sp = parsed.searchParams;
    const server = sp.get("server") || "";
    const code = (sp.get("code") || "").replace(/\D/g, "").slice(0, 6);
    if (!server || !code) return null;
    return { server, code };
  } catch {
    return null;
  }
}

function matchLoose(text: string, key: string): string | null {
  // 匹配 key=<value>,value 直到空白 / 换行 / 引号结束
  const re = new RegExp(`\\b${key}\\s*=\\s*([^\\s"'<>]+)`, "i");
  const m = re.exec(text);
  if (!m) return null;
  let v = m[1].trim();
  if (key === "code") v = v.replace(/\D/g, "").slice(0, 6);
  if (key === "server") v = v.replace(/[,\s]+$/, "");
  return v || null;
}

function finalize(source: QRScanPayload["source"], query: LooseQuery, raw: string): QRScanPayload | null {
  if (!query.server || !query.code) return null;
  return {
    server: query.server,
    code: query.code,
    raw,
    source,
  };
}
