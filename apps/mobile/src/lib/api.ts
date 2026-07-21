import * as Device from "expo-device";
import Constants from "expo-constants";
import { File } from "expo-file-system";
import { Platform } from "react-native";

import { loadOrCreateMobileDeviceId, saveMobileSession } from "@/lib/storage";
import type {
  Approval,
  ChatMessage,
  ChatSession,
  KbCreateRequest,
  KbCreateResponse,
  KbDeleteResponse,
  KbListResponse,
  KbReadResponse,
  KbWriteRequest,
  KbWriteResponse,
  MobileBootstrap,
  MobileCalendarCreateRequest,
  MobileCalendarDeleteResponse,
  MobileCalendarEventResponse,
  MobileCalendarListResponse,
  MobileCalendarRangeResponse,
  MobileCalendarUpdateRequest,
  MobileDevice,
  MobileKnowledgeAtlasResponse,
  MobileSession,
  MobileToday,
  MobileVoiceNote,
  MobileVoiceNoteOrganizeResponse,
  PairingClaimResponse,
} from "@/lib/types";

type RequestOptions = RequestInit & { allowRefresh?: boolean; timeoutMs?: number };

const defaultTimeoutMs = 45_000;
const voiceDirectUploadMaxBytes = 320 * 1024;
const voiceChunkBytes = 256 * 1024;
// 2026-07-04 R9: R5B recorder chunks ride over the CloudBase public relay,
// which caps a single JSON payload well below the legacy /voice-notes chunk
// path (Mate60 1.0.8 accepted 60-90s m4a with 256KB chunks but 413'd on
// EXCEED_MAX_PAYLOAD_SIZE for some longer runs). 96KB binary → ~128KB base64
// → ~130KB JSON keeps us safely under the public relay single-payload limit
// while staying cheap on the mobile side.
const recorderChunkBytes = 96 * 1024;

const mobileErrorMessages: Record<string, string> = {
  empty_message: "请输入要发送的内容",
  invalid_pairing_code: "配对码无效，请在 Mac 工作台重新生成 6 位码",
  not_paired: "当前手机尚未配对",
  offline_read_only: "当前为离线只读，恢复连接后才能操作",
  pairing_claim_failed: "配对失败，请确认工作台地址和 6 位码",
  pairing_code_expired: "配对码已过期，请在 Mac 工作台重新生成",
  refresh_required: "设备登录已过期，请重新配对",
  request_failed: "请求失败，请检查手机与 Mac 是否在同一 Wi-Fi",
  request_timeout: "请求超时，Mac 或网关暂时没有响应，请稍后重试",
  FUNCTION_INVOCATION_FAILED: "CloudBase 公网中继暂不可用，请先用 iOS 模拟器或同 Wi-Fi 地址验证，恢复 CloudBase 后再用外网连接",
  InsufficientBalance: "CloudBase 公网中继余额不足或函数不可用，外网手机暂时无法连接 Mac 工作台",
  microphone_permission_denied: "麦克风权限未开启，无法录音",
  recording_failed: "录音失败，请稍后重试",
  audio_required: "没有找到录音文件，请重新录音",
  audio_too_short: "录音未采集到有效声音，请在手机本机上重新录音；iPhone 镜像不能使用 iPhone 麦克风",
  audio_too_large: "录音太长，当前版本请先控制在 25MB 以内",
  audio_chunk_too_large: "单段录音上传超过公网中继限制，请重试；当前版本会自动改用更小分片。",
  audio_upload_incomplete: "录音分片尚未完整到达 Mac，请保持网络连接后重试转写。",
  EXCEED_MAX_PAYLOAD_SIZE: "公网中继限制了单次录音上传大小，当前版本会自动分片上传；请重试本次转写。",
  transcription_failed: "自动转写失败，请保留录音后手动输入或稍后重试",
  transcription_provider_unavailable: "Mac 端尚未配置语音转写服务，暂时需要手动输入转写文本",
  transcription_timeout: "语音转写超时，请稍后重试",
  server_url_required: "请输入 Mac 工作台地址",
  transcript_required: "请先输入或粘贴语音转写文本",
  token_revoked: "设备已被撤销，请重新配对",
  unauthorized: "设备令牌无效或已被撤销",
  voice_note_not_found: "没有找到这条语音笔记",
  voice_note_organize_failed: "语音笔记保存失败，请稍后重试",
  // 2026-06-19 — Mate60 calendar CRUD
  title_required: "请先填写日程标题",
  invalid_date: "日期格式无效，请使用 YYYY-MM-DD",
  time_pair_incomplete: "开始和结束时间需要同时填写",
  time_pair_invalid: "结束时间必须晚于开始时间",
  event_not_found: "没有找到这条日程",
  range_invalid: "结束日期必须不早于开始日期",
  invalid_start_date: "开始日期格式无效",
  invalid_end_date: "结束日期格式无效",
  missing_id: "日程 id 缺失",
  // 2026-06-19 — Mate60 KB vault
  invalid_path: "路径无效",
  path_traversal: "路径越界，已拒绝访问",
  path_not_found: "没有找到该路径",
  not_a_directory: "当前路径不是目录",
  not_a_file: "当前路径不是文件",
  file_not_found: "没有找到该文件",
  file_exists: "该路径已存在文件",
  file_too_large: "文件超过 2MB 限制",
  content_too_large: "内容超过 2MB 限制",
  content_required: "请输入笔记内容",
  unsupported_type: "当前类型不支持读写",
  invalid_kind: "笔记类型必须为 markdown 或 html",
  parent_not_found: "父目录不存在",
  vault_read_only: "南极熊当前只读；可先用首页“添加笔记”入库，或在 Mac 上恢复 NAS 写权限后再编辑原文件",
  nas_root_read_only: "南极熊当前只读；可浏览和搜索，暂不能原地保存",
  write_failed: "写入失败，请稍后重试",
  delete_failed: "删除失败，请稍后重试",
  read_failed: "读取失败，请稍后重试",
  knowledge_atlas_failed: "知识地图读取失败，请稍后重试",
};

export function humanizeMobileError(value?: string | null, status?: number) {
  const raw = String(value || "").trim();
  const lower = raw.toLowerCase();
  if (raw.includes("错误码:") || raw.includes("阶段:") || raw.includes("建议:")) return raw;
  if (raw && mobileErrorMessages[raw]) return mobileErrorMessages[raw];
  if (lower.includes("exceed max request payload") || lower.includes("exceed_max_payload_size")) return mobileErrorMessages.EXCEED_MAX_PAYLOAD_SIZE;
  if (lower.includes("insufficientbalance") || lower.includes("insufficient balance")) return mobileErrorMessages.InsufficientBalance;
  if (lower.includes("function_invocation_failed") || lower.includes("function is unavailable")) return mobileErrorMessages.FUNCTION_INVOCATION_FAILED;
  if (status === 401) return mobileErrorMessages.unauthorized;
  if (status === 404) return "没有找到移动端接口，请确认工作台地址是否正确";
  if (status && status >= 500) return "Mac 工作台服务暂不可用，请稍后刷新";
  if (!raw) return mobileErrorMessages.request_failed;
  if (raw === "AbortError" || raw === "The operation was aborted.") return mobileErrorMessages.request_timeout;
  if (lower.includes("canceled") || lower.includes("cancelled")) return mobileErrorMessages.request_timeout;
  if (raw === "Failed to fetch" || raw === "Network request failed") return "无法连接 Mac 工作台，请检查同一无线网络和地址";
  if (lower.includes("timeout")) return mobileErrorMessages.request_timeout;
  if (lower.includes("gateway")) return "网关暂不可用，请在 Mac 端确认模型服务或稍后重试";
  if (lower.includes("network")) return "网络不可用，请确认手机和 Mac 在同一 Wi-Fi";
  if (lower.includes("unauthorized")) return mobileErrorMessages.unauthorized;
  if (lower.includes("not found")) return "没有找到对应接口，请确认地址是否为 OpenClaw 工作台";
  return raw.includes("_") ? raw.replace(/_/g, " ") : raw;
}

type MobileApiErrorPayload = {
  ok?: boolean;
  error?: unknown;
  message?: unknown;
  code?: unknown;
  errorCode?: unknown;
  errorStage?: unknown;
  errorAdvice?: unknown;
  failure?: {
    reason?: unknown;
    reasonLabel?: unknown;
    stage?: unknown;
    advice?: unknown;
  } | null;
};

function textValue(value: unknown) {
  if (typeof value === "string") return value.trim();
  if (value == null) return "";
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "";
}

function listValue(value: unknown) {
  if (Array.isArray(value)) return value.map(textValue).filter(Boolean);
  const one = textValue(value);
  return one ? [one] : [];
}

function formatResponseError(data: unknown, fallback: string, status?: number, stageFallback?: string) {
  const row = (data || {}) as MobileApiErrorPayload;
  const failure = row.failure || null;
  const rawMessage =
    textValue(row.error) ||
    textValue(row.message) ||
    textValue(failure?.reasonLabel) ||
    textValue(failure?.reason) ||
    (status === 413 ? "EXCEED_MAX_PAYLOAD_SIZE" : fallback) ||
    "request_failed";
  const code =
    textValue(row.errorCode) ||
    textValue(row.code) ||
    textValue(failure?.reason) ||
    (status ? `HTTP_${status}` : "");
  const stage = textValue(row.errorStage) || textValue(failure?.stage) || stageFallback || "";
  const advice =
    listValue(row.errorAdvice).length > 0
      ? listValue(row.errorAdvice)
      : listValue(failure?.advice).length > 0
        ? listValue(failure?.advice)
        : status && status >= 500
          ? ["检查 Mac 工作台服务和 CloudBase relay 是否在线", "稍后重试,或切换同 Wi-Fi 地址验证"]
          : [];
  const message = humanizeMobileError(rawMessage);
  const lines = [message];
  if (code && !message.includes(code)) lines.push(`错误码:${code}`);
  if (stage) lines.push(`阶段:${stage}`);
  if (status) lines.push(`HTTP:${status}`);
  if (advice.length > 0) lines.push(`建议:${advice.join("；")}`);
  return lines.join("\n");
}

function responseError(data: unknown, fallback: string) {
  return formatResponseError(data, fallback);
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error || "request_failed");
}

export function normalizeServerUrl(input: string) {
  const trimmed = input.trim().replace(/\/+$/, "");
  if (!trimmed) return "";
  if (/^https?:\/\//i.test(trimmed)) {
    try {
      const parsed = new URL(trimmed);
      if (parsed.protocol === "https:" && isLocalWorkbenchHost(parsed.hostname)) {
        return `http://${parsed.host}${parsed.pathname === "/" ? "" : parsed.pathname}`.replace(/\/+$/, "");
      }
    } catch {
      return trimmed;
    }
    return trimmed;
  }
  if (/^localhost(:\d+)?$/i.test(trimmed)) return `http://${trimmed}`;
  if (/^(\d{1,3}\.){3}\d{1,3}(:\d+)?$/.test(trimmed)) return `http://${trimmed}`;
  if (/^[\w.-]+\.local(:\d+)?$/i.test(trimmed)) return `http://${trimmed}`;
  if (/:\d+$/.test(trimmed)) return `http://${trimmed}`;
  return `https://${trimmed}`;
}

function isLocalWorkbenchHost(hostname: string) {
  const host = hostname.toLowerCase();
  if (host === "localhost" || host === "127.0.0.1" || host === "0.0.0.0" || host.endsWith(".local")) return true;
  const parts = host.split(".").map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  if (parts[0] === 10) return true;
  if (parts[0] === 192 && parts[1] === 168) return true;
  if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
  return false;
}

async function readJson<T>(res: Response): Promise<T> {
  return res.json().catch(() => ({})) as Promise<T>;
}

function buildHeaders(session?: MobileSession, init?: RequestInit) {
  const headers: Record<string, string> = {
    ...(init?.headers as Record<string, string> | undefined),
  };
  if (init?.body !== undefined && !headers["Content-Type"]) headers["Content-Type"] = "application/json";
  if (session?.accessToken) headers.Authorization = `Bearer ${session.accessToken}`;
  return headers;
}

async function fetchWithTimeout(url: string, init: RequestOptions = {}) {
  const { allowRefresh: _allowRefresh, timeoutMs, ...requestInit } = init;
  const timeout = timeoutMs ?? defaultTimeoutMs;

  if (typeof AbortController === "undefined") {
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        fetch(url, requestInit),
        new Promise<Response>((_resolve, reject) => {
          timeoutHandle = setTimeout(() => reject(new Error("request_timeout")), timeout);
        }),
      ]);
    } finally {
      if (timeoutHandle) clearTimeout(timeoutHandle);
    }
  }

  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(), timeout);
  try {
    return await fetch(url, { ...requestInit, signal: controller.signal });
  } catch (error) {
    if (error instanceof Error && (error.name === "AbortError" || error.message.includes("aborted"))) {
      throw new Error("request_timeout");
    }
    throw error;
  } finally {
    clearTimeout(timeoutHandle);
  }
}

async function refreshSession(session: MobileSession) {
  let res: Response;
  try {
    res = await fetchWithTimeout(`${session.serverUrl}/api/mobile/auth/refresh`, {
      method: "POST",
      timeoutMs: 60_000,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken: session.refreshToken }),
    });
  } catch (error) {
    throw new Error(humanizeMobileError(errorMessage(error)));
  }
  const data = await readJson<{ accessToken?: string; accessExpiresAt?: string; error?: string }>(res);
  if (!res.ok || !data.accessToken) throw new Error(humanizeMobileError(responseError(data, "refresh_required"), res.status));
  const next = { ...session, accessToken: data.accessToken, accessExpiresAt: data.accessExpiresAt || new Date(Date.now() + 12 * 60 * 60_000).toISOString() };
  await saveMobileSession(next);
  return next;
}

export async function apiRequest<T>(
  session: MobileSession,
  path: string,
  init: RequestOptions = {},
  onSession?: (session: MobileSession) => void,
): Promise<T> {
  let res: Response;
  try {
    res = await fetchWithTimeout(`${session.serverUrl}${path}`, {
      ...init,
      headers: buildHeaders(session, init),
    });
  } catch (error) {
    throw new Error(humanizeMobileError(errorMessage(error)));
  }
  if (res.status === 401 && init.allowRefresh !== false) {
    const next = await refreshSession(session);
    onSession?.(next);
    let retry: Response;
    try {
      retry = await fetchWithTimeout(`${next.serverUrl}${path}`, {
        ...init,
        headers: buildHeaders(next, init),
      });
    } catch (error) {
      throw new Error(humanizeMobileError(errorMessage(error)));
    }
    const retryData = await readJson<T & MobileApiErrorPayload>(retry);
    if (!retry.ok || retryData?.ok === false) {
      throw new Error(formatResponseError(retryData, retry.statusText || "request_failed", retry.status, path));
    }
    return retryData;
  }
  const data = await readJson<T & MobileApiErrorPayload>(res);
  if (!res.ok || data?.ok === false) {
    throw new Error(formatResponseError(data, res.statusText || "request_failed", res.status, path));
  }
  return data;
}

export async function claimPairing(serverUrl: string, code: string): Promise<MobileSession> {
  const base = normalizeServerUrl(serverUrl);
  if (!base) throw new Error(humanizeMobileError("server_url_required"));
  const deviceId = await loadOrCreateMobileDeviceId();
  let res: Response;
  try {
    res = await fetchWithTimeout(`${base}/api/mobile/pairing/claim`, {
      method: "POST",
      timeoutMs: 60_000,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        code: code.replace(/\D/g, ""),
        deviceId: await loadOrCreateMobileDeviceId(),
        deviceName: Device.deviceName || `OpenClaw ${Platform.OS === "ios" ? "iPhone" : Platform.OS === "android" ? "安卓" : "网页"}`,
        platform: Platform.OS,
        appVersion: Constants.expoConfig?.version || "1.0.0",
        buildNumber: Platform.OS === "ios" ? Constants.expoConfig?.ios?.buildNumber || "1" : String(Constants.expoConfig?.android?.versionCode || ""),
      }),
    });
  } catch (error) {
    throw new Error(humanizeMobileError(errorMessage(error)));
  }
  const data = await readJson<PairingClaimResponse & { error?: string }>(res);
  if (!res.ok || !data.accessToken) throw new Error(humanizeMobileError(responseError(data, "pairing_claim_failed"), res.status));
  const now = new Date().toISOString();
  const session = {
    serverUrl: base,
    accessToken: data.accessToken,
    accessExpiresAt: data.accessExpiresAt || new Date(Date.now() + 12 * 60 * 60_000).toISOString(),
    refreshToken: data.refreshToken,
    refreshExpiresAt: data.refreshExpiresAt || new Date(Date.now() + 90 * 24 * 60 * 60_000).toISOString(),
    device: data.device || {
      id: deviceId,
      name: Device.deviceName || "OpenClaw 随身分身",
      platform: Platform.OS,
      appVersion: Constants.expoConfig?.version || "1.0.0",
      status: "active",
      createdAt: now,
      lastSeenAt: now,
      revokedAt: null,
    },
  };
  await saveMobileSession(session);
  return session;
}

export function fetchBootstrap(session: MobileSession, onSession?: (session: MobileSession) => void) {
  return apiRequest<MobileBootstrap>(session, "/api/mobile/bootstrap", { timeoutMs: 60_000 }, onSession);
}

export function fetchToday(session: MobileSession, date: string, onSession?: (session: MobileSession) => void) {
  return apiRequest<MobileToday>(session, `/api/mobile/today?date=${encodeURIComponent(date)}`, { timeoutMs: 60_000 }, onSession);
}

export function fetchKnowledgeAtlas(session: MobileSession, onSession?: (session: MobileSession) => void) {
  return apiRequest<MobileKnowledgeAtlasResponse>(session, "/api/mobile/knowledge/atlas", { timeoutMs: 90_000 }, onSession);
}

export async function createChatSession(session: MobileSession, agentId: string, onSession?: (session: MobileSession) => void) {
  const data = await apiRequest<{ ok: true; session: ChatSession }>(
    session,
    "/api/chat/sessions",
    {
      method: "POST",
      body: JSON.stringify({
        title: "手机端对话",
        agentId,
        modelId: "minimax-m3",
        knowledgeSources: ["all"],
        skillIds: [],
        planEnabled: false,
      }),
    },
    onSession,
  );
  return data.session;
}

export async function sendChatMessage(
  session: MobileSession,
  params: { sessionId: string; agentId: string; message: string },
  onSession?: (session: MobileSession) => void,
) {
  const data = await apiRequest<{ ok: true; assistant?: ChatMessage; sessionId: string; userMessageId: string }>(
    session,
    "/api/chat/send",
    {
      method: "POST",
      body: JSON.stringify({
        sessionId: params.sessionId,
        message: params.message,
        agentId: params.agentId,
        modelId: "minimax-m3",
        knowledgeSources: ["all"],
        skillIds: [],
        planEnabled: false,
      }),
    },
    onSession,
  );
  return data;
}

export function resolveApproval(
  session: MobileSession,
  approvalId: string,
  decision: "approved" | "rejected",
  onSession?: (session: MobileSession) => void,
) {
  return apiRequest<{ ok: true; execution?: unknown }>(
    session,
    `/api/approvals/${encodeURIComponent(approvalId)}/resolve`,
    { method: "POST", body: JSON.stringify({ decision }) },
    onSession,
  );
}

export function listDevices(session: MobileSession, onSession?: (session: MobileSession) => void) {
  return apiRequest<{ ok: true; devices: MobileDevice[] }>(session, "/api/mobile/devices", { timeoutMs: 60_000 }, onSession);
}

export function revokeDevice(session: MobileSession, deviceId: string, onSession?: (session: MobileSession) => void) {
  return apiRequest<{ ok: true; device: MobileDevice }>(
    session,
    `/api/mobile/devices/${encodeURIComponent(deviceId)}/revoke`,
    { method: "POST", timeoutMs: 60_000, body: JSON.stringify({}) },
    onSession,
  );
}

export function listVoiceNotes(session: MobileSession, date: string, onSession?: (session: MobileSession) => void) {
  return apiRequest<{ ok: true; date: string; voiceNotes: MobileVoiceNote[] }>(
    session,
    `/api/mobile/voice-notes?date=${encodeURIComponent(date)}`,
    { timeoutMs: 60_000 },
    onSession,
  );
}

export function createVoiceNote(
  session: MobileSession,
  params: { title?: string; transcriptText?: string; date?: string; source?: string; language?: string; durationSeconds?: number | null },
  onSession?: (session: MobileSession) => void,
) {
  return apiRequest<{ ok: true; voiceNote: MobileVoiceNote }>(
    session,
    "/api/mobile/voice-notes",
    {
      method: "POST",
      timeoutMs: 60_000,
      body: JSON.stringify({
        date: params.date || todayKey(),
        title: params.title || "",
        transcriptText: params.transcriptText || "",
        source: params.source || "manual_transcript",
        language: params.language || "zh-CN",
        durationSeconds: params.durationSeconds ?? null,
      }),
    },
    onSession,
  );
}

// 2026-06-24 — P0-B: single-shot add-note that returns Markdown + HTML paths.
// Server dedupes by (device_id, source_hash) so duplicate clicks of the
// primary action cannot create a second note with the same body.
export type AddKnowledgeNoteResult = {
  ok: true;
  status: "saved" | "duplicate";
  voiceNote: MobileVoiceNote;
  markdownPath?: string;
  htmlPath?: string;
  sourceHash: string;
  knowledgeEntryId?: string;
  calendarNoteId?: string;
};

export function addKnowledgeNote(
  session: MobileSession,
  params: {
    title?: string;
    body?: string;
    transcriptText?: string;
    source?: string;
    language?: string;
    durationSeconds?: number | null;
  },
  onSession?: (session: MobileSession) => void,
) {
  return apiRequest<AddKnowledgeNoteResult>(
    session,
    "/api/mobile/knowledge/notes/add",
    {
      method: "POST",
      timeoutMs: 90_000,
      body: JSON.stringify({
        title: params.title || "",
        body: params.body || "",
        transcriptText: params.transcriptText || params.body || "",
        source: params.source || "manual_transcript",
        language: params.language || "zh-CN",
        durationSeconds: params.durationSeconds ?? null,
      }),
    },
    onSession,
  );
}

function audioMimeFromUri(uri: string) {
  const lower = uri.toLowerCase().split("?")[0];
  if (lower.endsWith(".mp3")) return "audio/mpeg";
  if (lower.endsWith(".wav")) return "audio/wav";
  if (lower.endsWith(".aac")) return "audio/aac";
  if (lower.endsWith(".ogg")) return "audio/ogg";
  if (lower.endsWith(".webm")) return "audio/webm";
  return "audio/m4a";
}

function filenameFromUri(uri: string) {
  const name = decodeURIComponent(uri.split("?")[0].split("/").filter(Boolean).pop() || "");
  return name || `openclaw-voice-${Date.now()}.m4a`;
}

function bytesToBase64(bytes: Uint8Array) {
  const chunkSize = 0x8000;
  let binary = "";
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  if (typeof btoa !== "function") throw new Error("audio_encoding_failed");
  return btoa(binary);
}

function arrayBufferToBase64(buffer: ArrayBuffer) {
  return bytesToBase64(new Uint8Array(buffer));
}

function shouldChunkVoiceAudio(session: MobileSession, byteLength: number) {
  const url = session.serverUrl.toLowerCase();
  return byteLength > voiceDirectUploadMaxBytes || url.includes("tcloudbase.com") || url.includes("/openclaw-relay");
}

async function uploadVoiceNoteAudioChunks(
  session: MobileSession,
  voiceNoteId: string,
  params: { audioBytes: Uint8Array; audioMime: string; filename: string; durationSeconds?: number | null },
  onSession?: (session: MobileSession) => void,
) {
  const totalChunks = Math.max(1, Math.ceil(params.audioBytes.byteLength / voiceChunkBytes));
  let activeSession = session;
  const updateSession = (next: MobileSession) => {
    activeSession = next;
    onSession?.(next);
  };
  for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex += 1) {
    const start = chunkIndex * voiceChunkBytes;
    const end = Math.min(params.audioBytes.byteLength, start + voiceChunkBytes);
    const chunk = params.audioBytes.subarray(start, end);
    await apiRequest<{ ok: true; status: string; uploadedChunks: number; totalChunks: number }>(
      activeSession,
      `/api/mobile/voice-notes/${encodeURIComponent(voiceNoteId)}/audio-chunk`,
      {
        method: "POST",
        timeoutMs: 60_000,
        body: JSON.stringify({
          audioBase64: bytesToBase64(chunk),
          audioMime: params.audioMime,
          filename: params.filename,
          chunkIndex,
          totalChunks,
          totalBytes: params.audioBytes.byteLength,
          durationSeconds: params.durationSeconds ?? null,
          reset: chunkIndex === 0,
        }),
      },
      updateSession,
    );
  }
  return activeSession;
}

export async function transcribeVoiceNote(
  session: MobileSession,
  voiceNoteId: string,
  params: { audioUri: string; durationSeconds?: number | null; language?: string; async?: boolean },
  onSession?: (session: MobileSession) => void,
) {
  if (!params.audioUri) throw new Error(humanizeMobileError("audio_required"));
  const file = new File(params.audioUri);
  const audioBuffer = await file.arrayBuffer();
  const audioBytes = new Uint8Array(audioBuffer);
  const audioMime = audioMimeFromUri(params.audioUri);
  const filename = filenameFromUri(params.audioUri);
  if (shouldChunkVoiceAudio(session, audioBytes.byteLength)) {
    const activeSession = await uploadVoiceNoteAudioChunks(
      session,
      voiceNoteId,
      { audioBytes, audioMime, filename, durationSeconds: params.durationSeconds ?? null },
      onSession,
    );
    return apiRequest<{ ok: true; transcriptText?: string; provider?: string; model?: string; status?: string; voiceNote: MobileVoiceNote }>(
      activeSession,
      `/api/mobile/voice-notes/${encodeURIComponent(voiceNoteId)}/transcribe`,
      {
        method: "POST",
        timeoutMs: 120_000,
        body: JSON.stringify({
          uploadedAudio: true,
          audioMime,
          filename,
          durationSeconds: params.durationSeconds ?? null,
          language: params.language || "zh-CN",
          async: params.async === true,
        }),
      },
      onSession,
    );
  }
  const audioBase64 = arrayBufferToBase64(audioBuffer);
  return apiRequest<{ ok: true; transcriptText?: string; provider?: string; model?: string; status?: string; voiceNote: MobileVoiceNote }>(
    session,
    `/api/mobile/voice-notes/${encodeURIComponent(voiceNoteId)}/transcribe`,
    {
      method: "POST",
      timeoutMs: 120_000,
      body: JSON.stringify({
        audioBase64,
        audioMime,
        filename,
        durationSeconds: params.durationSeconds ?? null,
        language: params.language || "zh-CN",
        async: params.async === true,
      }),
    },
    onSession,
  );
}

export function organizeVoiceNote(session: MobileSession, voiceNoteId: string, onSession?: (session: MobileSession) => void) {
  return apiRequest<MobileVoiceNoteOrganizeResponse>(
    session,
    `/api/mobile/voice-notes/${encodeURIComponent(voiceNoteId)}/organize`,
    { method: "POST", timeoutMs: 120_000, body: JSON.stringify({}) },
    onSession,
  );
}

// 2026-06-26 — 异步知识库笔记整理 (NJX 反馈: mobile 无 Obsidian 整理功能, 参考桌面 app)
export type KnowledgeNoteOrganizeRequest = {
  title: string;
  body: string;
  folder?: string;
  qualityMode?: string;
  source?: string;
  language?: string;
  agentId?: string;
  retryPolicy?: { autoRepair?: boolean; maxAttempts?: number; exposeDiagnostics?: boolean };
};

export type KnowledgeNoteOrganizeJob = {
  id: string;
  status: string;
  phase?: string;
  progress?: number;
  title?: string;
  date?: string;
  folder?: string;
  sourceHash?: string;
  qualityMode?: string;
  message?: string;
  error?: string | null;
  errorCode?: string | null;
  errorStage?: string | null;
  errorAdvice?: string[] | null;
  failure?: { reason?: string; reasonLabel?: string; stage?: string; advice?: string[] } | null;
  diagnostics?: { gatewayConnected?: boolean; attempts?: number; lastError?: string; recoverySteps?: unknown[] } | null;
  markdownPath?: string;
  htmlPath?: string;
  knowledgePath?: string;
  createdAt?: string;
  updatedAt?: string;
  finishedAt?: string | null;
};

export type KnowledgeNoteOrganizeResponse = {
  ok: boolean;
  job: KnowledgeNoteOrganizeJob;
  reused?: boolean;
  knowledgeNotePipelineVersion?: string;
};

export function organizeKnowledgeNoteStart(
  session: MobileSession,
  body: KnowledgeNoteOrganizeRequest,
  onSession?: (s: MobileSession) => void,
): Promise<KnowledgeNoteOrganizeResponse> {
  return apiRequest<KnowledgeNoteOrganizeResponse>(
    session,
    "/api/mobile/knowledge/notes/organize-jobs",
    {
      method: "POST",
      timeoutMs: 30_000,
      body: JSON.stringify({
        title: body.title,
        folder: body.folder || "calendar",
        qualityMode: body.qualityMode || "high",
        content: body.body,
        source: body.source || "mobile_capture",
        language: body.language || "zh-CN",
        agentId: body.agentId || "main",
        retryPolicy: body.retryPolicy || { autoRepair: true, maxAttempts: 3, exposeDiagnostics: true },
      }),
    },
    onSession,
  );
}

export function organizeKnowledgeNoteStatus(
  session: MobileSession,
  jobId: string,
  onSession?: (s: MobileSession) => void,
): Promise<KnowledgeNoteOrganizeResponse> {
  return apiRequest<KnowledgeNoteOrganizeResponse>(
    session,
    `/api/mobile/knowledge/notes/organize-jobs/${encodeURIComponent(jobId)}`,
    { method: "GET", timeoutMs: 15_000 },
    onSession,
  );
}

export function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

export function describeApproval(approval: Approval) {
  const actionLabels: Record<string, string> = {
    approve: "批准",
    reject: "拒绝",
    computer_use: "桌面操作",
    file_write: "写入文件",
    shell_command: "执行命令",
    network_access: "网络访问",
    send_message: "发送消息",
    final_delivery: "最终交付",
  };
  const task = approval.task_id ? `任务 ${approval.task_id}` : "未绑定任务";
  const action = actionLabels[String(approval.action || "").toLowerCase()] || String(approval.action || "操作").replace(/_/g, " ");
  return `${action} / ${task}`;
}

// ---------------------------------------------------------------------------
// 2026-06-19 — Mate60 KB vault API helpers
//   GET /api/mobile/kb/list?path=<rel>     → KbListResponse
//   GET /api/mobile/kb/read?path=<rel>     → KbReadResponse
//   POST   /api/mobile/kb/create?path=<rel>   body KbCreateRequest → KbCreateResponse
//   POST   /api/mobile/kb/write?path=<rel>    body KbWriteRequest  → KbWriteResponse
//   DELETE /api/mobile/kb/delete?path=<rel>                       → KbDeleteResponse
// path 约定:服务端 / 开头表示 vault 根,客户端统一保留 "/" 作为根。
// ---------------------------------------------------------------------------

function kbNormalizePath(path: string): string {
  const trimmed = String(path || "").trim();
  if (!trimmed || trimmed === "/") return "/";
  let normalized = trimmed.replace(/\\/g, "/").replace(/\/+$/g, "");
  if (!normalized.startsWith("/")) normalized = "/" + normalized;
  return normalized;
}

export function listKb(session: MobileSession, kbPath: string, onSession?: (session: MobileSession) => void) {
  const normalized = kbNormalizePath(kbPath);
  return apiRequest<KbListResponse>(
    session,
    `/api/mobile/kb/list?path=${encodeURIComponent(normalized)}`,
    { timeoutMs: 60_000 },
    onSession,
  );
}

export type KnowledgeNoteContent = {
  ok: true;
  path: string;
  content: string;
  size: number;
  kind: "markdown" | "html";
};

export function readKnowledgeNoteContent(
  session: MobileSession,
  notePath: string,
  onSession?: (session: MobileSession) => void,
): Promise<KnowledgeNoteContent> {
  return apiRequest<KnowledgeNoteContent>(
    session,
    `/api/mobile/knowledge/notes/content?path=${encodeURIComponent(notePath)}`,
    { timeoutMs: 30_000 },
    onSession,
  );
}

export function readKb(session: MobileSession, kbPath: string, onSession?: (session: MobileSession) => void) {
  const normalized = kbNormalizePath(kbPath);
  return apiRequest<KbReadResponse>(
    session,
    `/api/mobile/kb/read?path=${encodeURIComponent(normalized)}`,
    { timeoutMs: 60_000 },
    onSession,
  );
}

export function parentKbPath(kbPath: string): string {
  const normalized = kbNormalizePath(kbPath);
  if (normalized === "/") return "/";
  const idx = normalized.lastIndexOf("/");
  if (idx <= 0) return "/";
  return normalized.slice(0, idx);
}

export function createKb(
  session: MobileSession,
  kbPath: string,
  body: KbCreateRequest,
  onSession?: (session: MobileSession) => void,
) {
  const normalized = kbNormalizePath(kbPath);
  return apiRequest<KbCreateResponse>(
    session,
    `/api/mobile/kb/create?path=${encodeURIComponent(normalized)}`,
    { method: "POST", timeoutMs: 60_000, body: JSON.stringify(body) },
    onSession,
  );
}

export function writeKb(
  session: MobileSession,
  kbPath: string,
  body: KbWriteRequest,
  onSession?: (session: MobileSession) => void,
) {
  const normalized = kbNormalizePath(kbPath);
  return apiRequest<KbWriteResponse>(
    session,
    `/api/mobile/kb/write?path=${encodeURIComponent(normalized)}`,
    { method: "POST", timeoutMs: 60_000, body: JSON.stringify(body) },
    onSession,
  );
}

export function deleteKb(
  session: MobileSession,
  kbPath: string,
  onSession?: (session: MobileSession) => void,
) {
  const normalized = kbNormalizePath(kbPath);
  return apiRequest<KbDeleteResponse>(
    session,
    `/api/mobile/kb/delete?path=${encodeURIComponent(normalized)}`,
    { method: "DELETE", timeoutMs: 60_000 },
    onSession,
  );
}

// Helper — 把 vault 相对路径拼成 vault 根下的文件名(用于新建时拼接 title → filename)
export function kbBasenameFromPath(kbPath: string): string {
  const normalized = kbNormalizePath(kbPath);
  const idx = normalized.lastIndexOf("/");
  return idx < 0 ? normalized : normalized.slice(idx + 1);
}

// Helper — 拼接父子路径(与 KnowledgeScreen.joinPath 等价,但 export 出来给 editor 复用)
export function joinKbPath(parent: string, child: string): string {
  const trimmedParent = String(parent || "").trim();
  if (!trimmedParent || trimmedParent === "/") return "/" + String(child || "").replace(/^\/+/, "");
  const cleanParent = trimmedParent.replace(/\/+$/g, "");
  return cleanParent + "/" + String(child || "").replace(/^\/+/, "");
}

// Helper — 从 fileName 推断 kind(用于 create 时决定 .md / .html 后缀)
export function inferKbKind(fileName: string): "markdown" | "html" | "unknown" {
  const lower = String(fileName || "").toLowerCase();
  if (lower.endsWith(".md") || lower.endsWith(".markdown")) return "markdown";
  if (lower.endsWith(".html") || lower.endsWith(".htm")) return "html";
  return "unknown";
}

// Helper — 用户输入文件名(可能不含后缀)→ 强制加 .md / .html 后缀
export function ensureKbExtension(fileName: string, kind: "markdown" | "html"): string {
  const trimmed = String(fileName || "").trim();
  if (!trimmed) return kind === "markdown" ? "untitled.md" : "untitled.html";
  const existing = inferKbKind(trimmed);
  if (existing !== "unknown") return trimmed;
  const dot = trimmed.lastIndexOf(".");
  const stem = dot > 0 ? trimmed.slice(0, dot) : trimmed;
  const safeStem = stem.replace(/[\\/:*?"<>|]/g, "_").trim() || (kind === "markdown" ? "untitled" : "untitled");
  return `${safeStem}.${kind === "markdown" ? "md" : "html"}`;
}

// ---------------------------------------------------------------------------
// 2026-06-19 — Mate60 CalendarScreen mobile CRUD
//   GET    /api/mobile/calendar/today        → MobileCalendarListResponse
//   GET    /api/mobile/calendar?date=...     → MobileCalendarListResponse
//   GET    /api/mobile/calendar/range?...    → MobileCalendarRangeResponse
//   POST   /api/mobile/calendar/create       → MobileCalendarEventResponse
//   POST   /api/mobile/calendar/:id/update   → MobileCalendarEventResponse
//   POST   /api/mobile/calendar/:id/delete   → MobileCalendarDeleteResponse
// 时间约定:24h "HH:MM"。dateKey 由 todayKey() 产出 (本地)。
// ---------------------------------------------------------------------------

function calendarNormalizeDate(date: string): string {
  const trimmed = String(date || "").trim();
  if (!trimmed) return todayKey();
  return /^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? trimmed : todayKey();
}

function calendarNormalizeTime(time: string | null | undefined): string | null {
  if (time == null || time === "") return null;
  const trimmed = String(time).trim();
  if (!trimmed) return null;
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(trimmed) ? trimmed : null;
}

export function fetchCalendarToday(
  session: MobileSession,
  onSession?: (session: MobileSession) => void,
) {
  return apiRequest<MobileCalendarListResponse>(session, "/api/mobile/calendar/today", { timeoutMs: 60_000 }, onSession);
}

export function fetchCalendarByDate(
  session: MobileSession,
  date: string,
  onSession?: (session: MobileSession) => void,
) {
  const dateKey = calendarNormalizeDate(date);
  return apiRequest<MobileCalendarListResponse>(
    session,
    `/api/mobile/calendar?date=${encodeURIComponent(dateKey)}`,
    { timeoutMs: 60_000 },
    onSession,
  );
}

export function fetchCalendarRange(
  session: MobileSession,
  params: { start: string; end: string },
  onSession?: (session: MobileSession) => void,
) {
  const start = calendarNormalizeDate(params.start);
  const end = calendarNormalizeDate(params.end);
  return apiRequest<MobileCalendarRangeResponse>(
    session,
    `/api/mobile/calendar/range?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`,
    { timeoutMs: 60_000 },
    onSession,
  );
}

export function createCalendarEvent(
  session: MobileSession,
  body: MobileCalendarCreateRequest,
  onSession?: (session: MobileSession) => void,
) {
  const payload = {
    date: calendarNormalizeDate(body.date),
    title: String(body.title || "").trim(),
    description: body.description ? String(body.description).trim() : "",
    startTime: calendarNormalizeTime(body.startTime ?? null),
    endTime: calendarNormalizeTime(body.endTime ?? null),
    kind: body.kind || "event",
    rawContent: body.rawContent ? String(body.rawContent).trim() : undefined,
    autoOrganize: body.autoOrganize === true,
    qualityMode: body.qualityMode,
    requestedQualityMode: body.requestedQualityMode,
    useNkxLanding: body.useNkxLanding,
    nkxLandingRootMode: body.nkxLandingRootMode,
    nkxLandingSubdirOverride: body.nkxLandingSubdirOverride,
    tags: body.tags,
    related: body.related,
  };
  return apiRequest<MobileCalendarEventResponse>(
    session,
    "/api/mobile/calendar/create",
    { method: "POST", timeoutMs: 60_000, body: JSON.stringify(payload) },
    onSession,
  );
}

export function updateCalendarEvent(
  session: MobileSession,
  eventId: string,
  body: MobileCalendarUpdateRequest,
  onSession?: (session: MobileSession) => void,
) {
  const payload: Record<string, unknown> = {};
  if (typeof body.title === "string") payload.title = body.title.trim();
  if (typeof body.description === "string") payload.description = body.description.trim();
  if (Object.prototype.hasOwnProperty.call(body, "startTime")) {
    payload.startTime = calendarNormalizeTime(body.startTime ?? null);
  }
  if (Object.prototype.hasOwnProperty.call(body, "endTime")) {
    payload.endTime = calendarNormalizeTime(body.endTime ?? null);
  }
  if (typeof body.status === "string") payload.status = body.status;
  return apiRequest<MobileCalendarEventResponse>(
    session,
    `/api/mobile/calendar/${encodeURIComponent(eventId)}/update`,
    { method: "POST", timeoutMs: 60_000, body: JSON.stringify(payload) },
    onSession,
  );
}

export function deleteCalendarEvent(
  session: MobileSession,
  eventId: string,
  onSession?: (session: MobileSession) => void,
) {
  return apiRequest<MobileCalendarDeleteResponse>(
    session,
    `/api/mobile/calendar/${encodeURIComponent(eventId)}/delete`,
    { method: "POST", timeoutMs: 60_000, body: JSON.stringify({}) },
    onSession,
  );
}

// ---------------------------------------------------------------------------
// 2026-07-02 — R5C: R5B recorder session/chunk/segment/ingest wrappers.
//
// 旧接口 (MobileVoiceNote) 保留, 新 R5B 工作台使用以下端点:
//
//   POST   /api/mobile/recorder/sessions
//     body : { language, title?, scene?, network?, retentionHours? }
//     →    : { ok: true, session }
//   POST   /api/mobile/recorder/sessions/:id/chunks
//     body : { audioBase64, audioMime, chunkIndex, totalChunks, totalBytes,
//              durationSeconds?, filename?, reset?: boolean }
//     →    : { ok: true, uploadedChunks: number, totalChunks: number }
//   GET    /api/mobile/recorder/sessions/:id/segments
//     →    : { ok: true, session, segments }
//   POST   /api/mobile/recorder/sessions/:id/ingest
//     body : { target, payload }
//     →    : { ok: true, status: "created"|"reused", job }
//
// Mobile 端走 "先 POST sessions → 多 chunks → 多个 segments(draft 文本 / 占位)
// → 停止后用 ingest 一次性落库" 的工作流。所有调用超时 60s,失败由调用方
// humanizeMobileError 翻译。
// ---------------------------------------------------------------------------

export type RecorderSessionRecord = {
  id: string;
  deviceId?: string;
  title?: string;
  status?: string;
  scene?: string;
  language?: string;
  totalChunks?: number;
  totalBytes?: number;
  durationMs?: number;
  startedAt?: string;
  updatedAt?: string;
};

export type RecorderTranscriptSegment = {
  id: string;
  sessionId?: string;
  segmentIndex?: number;
  chunkIndex?: number;
  text?: string;
  status?: string;
  startMs?: number;
  endMs?: number;
  provider?: string;
  audioBytes?: number;
  createdAt?: string;
};

export type RecorderSessionStartResponse = {
  ok: true;
  session: RecorderSessionRecord;
};

export type RecorderChunkResponse = {
  ok: true;
  uploadedChunks: number;
  totalChunks: number;
};

export type RecorderSegmentsResponse = {
  ok: true;
  session: RecorderSessionRecord;
  segments: RecorderTranscriptSegment[];
};

export type RecorderIngestResponse = {
  ok: true;
  status: "created" | "reused";
  job: {
    id: string;
    status?: string;
    target?: string;
    markdownPath?: string;
    htmlPath?: string;
    knowledgeEntryId?: string | null;
    calendarNoteId?: string | null;
  };
  voiceNote?: MobileVoiceNote;
  markdownPath?: string;
  htmlPath?: string;
  knowledgeEntryId?: string | null;
  calendarNoteId?: string | null;
};

export function startRecorderSession(
  session: MobileSession,
  params: { language?: string; title?: string; scene?: string; network?: string; retentionHours?: number; metadata?: Record<string, unknown> } = {},
  onSession?: (s: MobileSession) => void,
): Promise<RecorderSessionStartResponse> {
  return apiRequest<RecorderSessionStartResponse>(
    session,
    "/api/mobile/recorder/sessions",
    {
      method: "POST",
      timeoutMs: 30_000,
      body: JSON.stringify({
        language: params.language || "zh-CN",
        title: params.title || "",
        scene: params.scene || "mobile_recorder",
        network: params.network || "",
        retentionHours: params.retentionHours ?? 24,
        metadata: params.metadata || {},
      }),
    },
    onSession,
  );
}

export function uploadRecorderChunk(
  session: MobileSession,
  recorderSessionId: string,
  chunk: {
    audioBase64: string;
    audioMime: string;
    chunkIndex: number;
    totalChunks: number;
    totalBytes: number;
    durationSeconds?: number | null;
    transcriptText?: string;
    text?: string;
    status?: "partial" | "final" | string;
    language?: string;
    filename?: string;
    reset?: boolean;
  },
  onSession?: (s: MobileSession) => void,
): Promise<RecorderChunkResponse> {
  return apiRequest<RecorderChunkResponse>(
    session,
    `/api/mobile/recorder/sessions/${encodeURIComponent(recorderSessionId)}/chunks`,
    {
      method: "POST",
      timeoutMs: 60_000,
      body: JSON.stringify({
        audioBase64: chunk.audioBase64,
        audioMime: chunk.audioMime,
        chunkIndex: chunk.chunkIndex,
        totalChunks: chunk.totalChunks,
        totalBytes: chunk.totalBytes,
        durationSeconds: chunk.durationSeconds ?? null,
        durationMs: chunk.durationSeconds != null ? Math.round(chunk.durationSeconds * 1000) : null,
        transcriptText: chunk.transcriptText || "",
        text: chunk.text || "",
        status: chunk.status || "partial",
        language: chunk.language || "zh-CN",
        filename: chunk.filename || `recorder-chunk-${Date.now()}.m4a`,
        reset: chunk.reset === true,
      }),
    },
    onSession,
  );
}

export async function uploadRecorderAudio(
  session: MobileSession,
  recorderSessionId: string,
  params: { audioUri: string; durationSeconds?: number | null; language?: string; transcriptText?: string },
  onSession?: (s: MobileSession) => void,
): Promise<RecorderChunkResponse> {
  if (!params.audioUri) throw new Error(humanizeMobileError("audio_required"));
  const file = new File(params.audioUri);
  const audioBuffer = await file.arrayBuffer();
  const audioBytes = new Uint8Array(audioBuffer);
  const audioMime = audioMimeFromUri(params.audioUri);
  const filename = filenameFromUri(params.audioUri);
  // 2026-07-04 R9: use the smaller recorder chunk size so each /chunks POST
  // stays under the CloudBase public-relay EXCEED_MAX_PAYLOAD_SIZE ceiling
  // (96KB binary → ~130KB JSON). Same bytes total, more requests, no 413.
  const totalChunks = Math.max(1, Math.ceil(audioBytes.byteLength / recorderChunkBytes));
  let activeSession = session;
  const updateSession = (next: MobileSession) => {
    activeSession = next;
    onSession?.(next);
  };
  let last: RecorderChunkResponse = { ok: true, uploadedChunks: 0, totalChunks };
  for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex += 1) {
    const start = chunkIndex * recorderChunkBytes;
    const end = Math.min(audioBytes.byteLength, start + recorderChunkBytes);
    const chunk = audioBytes.subarray(start, end);
    last = await uploadRecorderChunk(
      activeSession,
      recorderSessionId,
      {
        audioBase64: bytesToBase64(chunk),
        audioMime,
        chunkIndex,
        totalChunks,
        totalBytes: audioBytes.byteLength,
        durationSeconds: params.durationSeconds ?? null,
        filename,
        reset: chunkIndex === 0,
        transcriptText: chunkIndex === totalChunks - 1 ? params.transcriptText || "" : "",
        status: chunkIndex === totalChunks - 1 ? "final" : "partial",
        language: params.language || "zh-CN",
      },
      updateSession,
    );
  }
  return last;
}

// 2026-07-04 — R10: live transcription segment upload.
//
// During active note recording the app finalizes a rolling audio segment every
// ~12s and uploads it here BEFORE the user stops. Each segment is chunked at
// recorderChunkBytes (the same small CloudBase-safe size uploadRecorderAudio
// uses) and posted to the dedicated /live-segments endpoint, which keeps each
// segment's audio isolated (no shared-dir reset) and transcribes it server
// side. This is what makes the transcript textarea fill incrementally while
// recording, instead of only after stop.
export type RecorderLiveSegmentResponse = {
  ok: true;
  status: "segment_uploading" | "transcribing" | "provider_unavailable";
  transcriptionConfigured?: boolean;
  segmentIndex: number;
  chunksUploaded?: number;
  segment?: RecorderTranscriptSegment;
};

export async function uploadRecorderLiveSegment(
  session: MobileSession,
  recorderSessionId: string,
  params: { segmentIndex: number; audioUri: string; durationSeconds?: number | null; language?: string },
  onSession?: (s: MobileSession) => void,
): Promise<RecorderLiveSegmentResponse> {
  if (!params.audioUri) throw new Error(humanizeMobileError("audio_required"));
  const file = new File(params.audioUri);
  const audioBuffer = await file.arrayBuffer();
  const audioBytes = new Uint8Array(audioBuffer);
  const audioMime = audioMimeFromUri(params.audioUri);
  // Same small recorder chunk size as uploadRecorderAudio so each POST stays
  // under the CloudBase public-relay EXCEED_MAX_PAYLOAD_SIZE ceiling.
  const totalChunks = Math.max(1, Math.ceil(audioBytes.byteLength / recorderChunkBytes));
  const durationMs = params.durationSeconds != null ? Math.round(params.durationSeconds * 1000) : null;
  let activeSession = session;
  const updateSession = (next: MobileSession) => {
    activeSession = next;
    onSession?.(next);
  };
  let last: RecorderLiveSegmentResponse = { ok: true, status: "segment_uploading", segmentIndex: params.segmentIndex };
  for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex += 1) {
    const start = chunkIndex * recorderChunkBytes;
    const end = Math.min(audioBytes.byteLength, start + recorderChunkBytes);
    const chunk = audioBytes.subarray(start, end);
    last = await apiRequest<RecorderLiveSegmentResponse>(
      activeSession,
      `/api/mobile/recorder/sessions/${encodeURIComponent(recorderSessionId)}/live-segments`,
      {
        method: "POST",
        timeoutMs: 60_000,
        body: JSON.stringify({
          audioBase64: bytesToBase64(chunk),
          audioMime,
          segmentIndex: params.segmentIndex,
          chunkIndex,
          totalChunks,
          totalBytes: audioBytes.byteLength,
          durationMs,
          language: params.language || "zh-CN",
          reset: chunkIndex === 0,
        }),
      },
      updateSession,
    );
  }
  return { ...last, chunksUploaded: totalChunks };
}

export function listRecorderSegments(
  session: MobileSession,
  recorderSessionId: string,
  onSession?: (s: MobileSession) => void,
): Promise<RecorderSegmentsResponse> {
  return apiRequest<RecorderSegmentsResponse>(
    session,
    `/api/mobile/recorder/sessions/${encodeURIComponent(recorderSessionId)}/segments`,
    { timeoutMs: 30_000 },
    onSession,
  );
}

export function finalizeRecorderIngest(
  session: MobileSession,
  recorderSessionId: string,
  payload: {
    title?: string;
    transcriptText: string;
    source?: string;
    language?: string;
    durationSeconds?: number | null;
    target?: "timeline" | "calendar" | "knowledge" | "wiki" | "all";
  },
  onSession?: (s: MobileSession) => void,
): Promise<RecorderIngestResponse> {
  return apiRequest<RecorderIngestResponse>(
    session,
    `/api/mobile/recorder/sessions/${encodeURIComponent(recorderSessionId)}/ingest`,
    {
      method: "POST",
      timeoutMs: 90_000,
      body: JSON.stringify({
        target: payload.target || "all",
        payload: {
          title: payload.title || "",
          transcriptText: payload.transcriptText || "",
          source: payload.source || "speech_recognition",
          language: payload.language || "zh-CN",
          durationSeconds: payload.durationSeconds ?? null,
          confirm: true,
        },
      }),
    },
    onSession,
  );
}
