import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

import type {
  MobilePendingNote,
  MobilePendingNoteStatus,
  MobileSession,
  MobileToday,
} from "@/lib/types";

const sessionKey = "openclaw.mobile.session.v1";
const todayCacheKey = "openclaw.mobile.today.cache.v1";
const deviceIdKey = "openclaw.mobile.device_id.v1";
const pendingNotesKey = "openclaw.mobile.notes.pending.v1";
const lastSyncKey = "openclaw.mobile.last_sync.v1";

async function secureStoreAvailable() {
  if (Platform.OS === "web") return false;
  try {
    return await SecureStore.isAvailableAsync();
  } catch {
    return false;
  }
}

async function writeSecret(key: string, value: string) {
  if (await secureStoreAvailable()) {
    await SecureStore.setItemAsync(key, value, {
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    });
    return;
  }
  await AsyncStorage.setItem(key, value);
}

async function readSecret(key: string) {
  if (await secureStoreAvailable()) return SecureStore.getItemAsync(key);
  return AsyncStorage.getItem(key);
}

async function deleteSecret(key: string) {
  if (await secureStoreAvailable()) {
    await SecureStore.deleteItemAsync(key);
    return;
  }
  await AsyncStorage.removeItem(key);
}

export async function saveMobileSession(session: MobileSession) {
  await writeSecret(sessionKey, JSON.stringify(session));
}

export async function loadMobileSession(): Promise<MobileSession | null> {
  const raw = await readSecret(sessionKey);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as MobileSession;
  } catch {
    return null;
  }
}

export async function clearMobileSession() {
  await deleteSecret(sessionKey);
}

export async function loadOrCreateMobileDeviceId() {
  const existing = await AsyncStorage.getItem(deviceIdKey);
  if (existing && /^ocm_[a-z0-9_-]{12,}$/i.test(existing)) return existing;
  const randomPart = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
  const next = `ocm_${Date.now().toString(36)}_${randomPart}`.slice(0, 64);
  await AsyncStorage.setItem(deviceIdKey, next);
  return next;
}

export async function saveTodayCache(today: MobileToday) {
  await AsyncStorage.setItem(todayCacheKey, JSON.stringify({ cachedAt: new Date().toISOString(), today }));
}

export async function loadTodayCache(): Promise<{ cachedAt: string; today: MobileToday } | null> {
  const raw = await AsyncStorage.getItem(todayCacheKey);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as { cachedAt: string; today: MobileToday };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// 2026-06-22 — Pending notes (offline write queue)
// 关键约束:写入本地永远成功,只有在 Mac 服务端确认后才允许把 status 改为 synced。
// 之前 saveTodayCache 写入即代表 success,这里 pending 队列明确区分 "本地暂存" 与 "已同步"。
// ---------------------------------------------------------------------------

export async function loadPendingNotes(): Promise<MobilePendingNote[]> {
  const raw = await AsyncStorage.getItem(pendingNotesKey);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as MobilePendingNote[];
    if (!Array.isArray(parsed)) return [];
    return parsed;
  } catch {
    return [];
  }
}

async function writePendingNotes(notes: MobilePendingNote[]) {
  await AsyncStorage.setItem(pendingNotesKey, JSON.stringify(notes));
}

export async function savePendingNote(note: MobilePendingNote) {
  const rows = await loadPendingNotes();
  const index = rows.findIndex((row) => row.id === note.id);
  if (index >= 0) {
    rows[index] = note;
  } else {
    rows.unshift(note);
  }
  await writePendingNotes(rows);
}

export async function updatePendingNoteStatus(
  id: string,
  status: MobilePendingNoteStatus,
  patch?: { lastError?: string; retryCount?: number; title?: string; body?: string; transcript?: string },
) {
  const rows = await loadPendingNotes();
  const next = rows.map((row) =>
    row.id === id
      ? {
          ...row,
          status,
          lastError: patch?.lastError !== undefined ? patch.lastError : row.lastError,
          retryCount: patch?.retryCount !== undefined ? patch.retryCount : row.retryCount,
          title: patch?.title !== undefined ? patch.title : row.title,
          body: patch?.body !== undefined ? patch.body : row.body,
          transcript: patch?.transcript !== undefined ? patch.transcript : row.transcript,
          updatedAt: new Date().toISOString(),
        }
      : row,
  );
  await writePendingNotes(next);
}

export async function removePendingNote(id: string) {
  const rows = await loadPendingNotes();
  const next = rows.filter((row) => row.id !== id);
  await writePendingNotes(next);
}

export async function clearPendingNotes() {
  await AsyncStorage.removeItem(pendingNotesKey);
}

export async function loadLastSyncTimestamp(): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(lastSyncKey);
  } catch {
    return null;
  }
}

export async function saveLastSyncTimestamp(timestamp: string = new Date().toISOString()) {
  try {
    await AsyncStorage.setItem(lastSyncKey, timestamp);
  } catch {
    // ignore — local cache only
  }
}

// ---------------------------------------------------------------------------
// 2026-07-02 — R5C: 本地 recorder 草稿 / 会话状态持久化。
// 仅当设备因低内存 / 后台被回收时,把未提交的草稿写回 AsyncStorage,
// 下次启动时再由 RecorderProvider hydrate (见 App.tsx 的 useEffect)。
// 不存敏感凭据,只存标题 / 转写 / 录音时长等可重新生成的数据。
// ---------------------------------------------------------------------------

const recorderDraftKey = "openclaw.mobile.recorder.draft.v1";
const recorderSessionKey = "openclaw.mobile.recorder.session.v1";

export type PersistedRecorderDraft = {
  title: string;
  transcript: string;
  audioUri: string;
  audioMime: string | null;
  durationSeconds: number | null;
  previewMarkdown: string;
  previewHtml: string;
  startedAt: string | null;
  updatedAt: string;
};

export type PersistedRecorderSession = {
  recorderSessionId: string;
  transcriptionProvider: string | null;
  recorderSessionError: string | null;
  uploadedChunks: number;
  totalChunks: number;
  segmentsCount: number;
  updatedAt: string;
};

export async function saveRecorderDraft(draft: Omit<PersistedRecorderDraft, "updatedAt">) {
  try {
    await AsyncStorage.setItem(recorderDraftKey, JSON.stringify({ ...draft, updatedAt: new Date().toISOString() }));
  } catch {
    // ignore — local cache only
  }
}

export async function loadRecorderDraft(): Promise<PersistedRecorderDraft | null> {
  try {
    const raw = await AsyncStorage.getItem(recorderDraftKey);
    if (!raw) return null;
    return JSON.parse(raw) as PersistedRecorderDraft;
  } catch {
    return null;
  }
}

export async function clearRecorderDraft() {
  try {
    await AsyncStorage.removeItem(recorderDraftKey);
  } catch {
    // ignore
  }
}

export async function saveRecorderSession(session: PersistedRecorderSession) {
  try {
    await AsyncStorage.setItem(recorderSessionKey, JSON.stringify({ ...session, updatedAt: new Date().toISOString() }));
  } catch {
    // ignore
  }
}

export async function loadRecorderSession(): Promise<PersistedRecorderSession | null> {
  try {
    const raw = await AsyncStorage.getItem(recorderSessionKey);
    if (!raw) return null;
    return JSON.parse(raw) as PersistedRecorderSession;
  } catch {
    return null;
  }
}

export async function clearRecorderSession() {
  try {
    await AsyncStorage.removeItem(recorderSessionKey);
  } catch {
    // ignore
  }
}

// ---------------------------------------------------------------------------
// 2026-07-03 — R7: stale recorder recovery marker.
// Mobile writes a small JSON blob whenever the voice workbench leaves the
// "closed" state and clears it on dismissal. On cold start, if the marker is
// present but the in-memory state was reset to closed (because the JS engine
// restarted), the UI uses this to render a recovery banner with three
// actions: continue / discard / retry. Nothing else touches this key — it is
// not a duplicate of mobile_recording_sessions (server-owned) but a
// per-device pointer so the user can clear stale local UI state without
// touching server data.
// ---------------------------------------------------------------------------

export type RecorderRecoveryMarker = {
  mode: "recording" | "paused" | "transcribing" | "preview" | "saving" | "saved";
  voiceNoteId: string | null;
  recorderSessionId: string | null;
  hasTranscript: boolean;
  recordedAudio: boolean;
  writtenAt: string;
};

const recorderRecoveryKey = "openclaw.mobile.recorder.recovery.v1";

export async function saveRecorderRecoveryMarker(marker: Omit<RecorderRecoveryMarker, "writtenAt">) {
  try {
    await AsyncStorage.setItem(
      recorderRecoveryKey,
      JSON.stringify({ ...marker, writtenAt: new Date().toISOString() }),
    );
  } catch {
    // ignore — local cache only
  }
}

export async function loadRecorderRecoveryMarker(): Promise<RecorderRecoveryMarker | null> {
  try {
    const raw = await AsyncStorage.getItem(recorderRecoveryKey);
    if (!raw) return null;
    return JSON.parse(raw) as RecorderRecoveryMarker;
  } catch {
    return null;
  }
}

export async function clearRecorderRecoveryMarker() {
  try {
    await AsyncStorage.removeItem(recorderRecoveryKey);
  } catch {
    // ignore
  }
}

// One-shot helper used by "discard stale" actions. Clears every per-device
// recorder artifact so a fresh session starts with no leftover state.
export async function clearAllRecorderLocalState() {
  await Promise.all([
    clearRecorderDraft(),
    clearRecorderSession(),
    clearRecorderRecoveryMarker(),
  ]);
}
