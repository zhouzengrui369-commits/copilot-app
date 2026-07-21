#!/usr/bin/env node
// Mock pairing/recorder backend for R19 emulator testing.
// Returns MobileBootstrap + MobileToday shapes that match the production schema
// so the recorder tab can render without "Cannot read property 'tone' of undefined".

import http from "node:http";
import { URL } from "node:url";

const PORT = Number(process.env.MOCK_PORT || 18080);

const json = (res, body, status = 200) => {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
  });
  res.end(JSON.stringify(body));
};

const nowIso = () => new Date().toISOString();
const FAR_FUTURE = () => new Date(Date.now() + 30 * 86400 * 1000).toISOString();

// ---------------------------------------------------------------------------
// R19 in-memory segment store: simulate the workbench's transcribeServer so
// uploadRecorderLiveSegment() returns a segment back via listRecorderSegments()
// within ~3s. This lets the app's recorder card textArea fill in real time.
// ---------------------------------------------------------------------------
const segmentStore = new Map(); // recorderSessionId -> RecorderTranscriptSegment[]

function pushSegment(recorderSessionId, segmentIndex, text) {
  const arr = segmentStore.get(recorderSessionId) || [];
  const seg = {
    id: `mock_seg_${recorderSessionId}_${segmentIndex}`,
    sessionId: recorderSessionId,
    segmentIndex,
    chunkIndex: 0,
    text,
    status: "final",
    startMs: segmentIndex * 12000,
    endMs: (segmentIndex + 1) * 12000,
    provider: "mock-segment-fallback",
    audioBytes: 32000,
    createdAt: nowIso(),
  };
  arr.push(seg);
  segmentStore.set(recorderSessionId, arr);
  return seg;
}

// Pre-canned transcript text for each segment index. These are real Chinese
// phrases that look like ASR output and exercise the textarea render path.
const mockTranscriptLines = [
  "今天我们来测试一下本地 ASR 引擎的转写效果",
  "录制的音频会通过 sherpa-onnx 离线转写成文字",
  "然后显示在右边的语音工作台卡片里",
  "测试一下实时分段上传和远端兜底之间的协同",
  "如果一切顺利 用户就能在录音停止之前看到文字",
  "接下来开始暂停和继续的切换测试",
];

// ---------------------------------------------------------------------------
// MobileBootstrap (matches apps/mobile/src/lib/types.ts MobileBootstrap)
// ---------------------------------------------------------------------------
const commonBootstrap = {
  ok: true,
  user: { id: "user_mock_r19", role: "owner" },
  service: {
    name: "MockMac",
    workspace: "MockMac",
    updatedAt: nowIso(),
  },
  mobile: {
    apiVersion: "v1",
    platform: "android",
    packageName: "com.openclaw.mobile",
    iosBundleIdentifier: "com.openclaw.mobile",
    distribution: "internal",
    updateChannel: "stable",
    syncModel: "polling",
    minSupportedAppVersion: "1.0.8",
    latestAppVersion: "1.0.8",
    latestAndroidVersionCode: 9,
    latestIosAppVersion: "1.0.8",
    latestIosBuildNumber: "9",
    testFlightTrack: "internal",
    buildSha: "r19-mock",
    nativeUpdateRequired: false,
    nativeCapabilities: {
      audioRecording: true,
      microphonePermission: true,
      automaticTranscription: true,
      backgroundRecording: false,
    },
  },
  featureFlags: {
    todayExecution: true,
    chat: true,
    approvals: true,
    knowledgePreview: true,
    voiceNotes: true,
    voiceRecording: true,
    voiceAutoTranscription: true,
    voiceTranscriptionProvider: "sherpa-onnx",
    offlineReadCache: true,
    highRiskApprovalGate: false,
  },
  vault: {
    vaultRoot: "/Users/mock/vault",
    vaultLabel: "Mock Vault",
    vaultAvailable: true,
    vaultFallbackReason: null,
    root: "/Users/mock/vault",
    status: "connected",
    reason: null,
    writable: true,
    writeReason: null,
    graphPath: null,
    displayName: "Mock Vault",
    preferredEntries: [],
    kbVaultDir: "/Users/mock/vault/kb",
  },
  gateway: {
    ok: true,
    status: "ok",
    model: "minimax-m3",
    provider: "minimax",
    error: "",
    updatedAt: nowIso(),
  },
  sources: {
    calendar: {
      ok: true,
      status: "ok",
      source: "sqlite",
      updatedAt: nowIso(),
      error: "",
    },
    agentOps: {
      ok: true,
      status: "ok",
      source: "agent_workbench_snapshot",
      updatedAt: nowIso(),
      error: "",
    },
    nas: {
      ok: true,
      status: "connected",
      source: "nas",
      updatedAt: nowIso(),
      error: "",
    },
  },
  agentOps: [
    {
      id: "main",
      name: "主智能体",
      role: "main",
      visualStatus: "ok",
      liveStatus: "ok",
      gateway: "ok",
      activeCount: 0,
      unreadInbox: 0,
      progressPercent: 0,
      lastActivityAt: nowIso(),
      currentWork: null,
    },
    {
      id: "boss",
      name: "老板视角",
      role: "boss",
      visualStatus: "ok",
      liveStatus: "ok",
      gateway: "ok",
      activeCount: 0,
      unreadInbox: 0,
      progressPercent: 0,
      lastActivityAt: nowIso(),
      currentWork: null,
    },
  ],
  inbox: { unread: 0 },
  stats: { todayNotes: 0, todayApprovals: 0, todayTasks: 0 },
};

// ---------------------------------------------------------------------------
// MobileToday (matches apps/mobile/src/lib/types.ts MobileToday)
// ---------------------------------------------------------------------------
const commonToday = {
  ok: true,
  date: new Date().toISOString().slice(0, 10),
  updatedAt: nowIso(),
  status: {
    tone: "ok",
    gateway: "ok",
    summary: "Mock 后端在线 · R19 录音转写验证中",
  },
  source: {
    calendar: { source: "sqlite", updatedAt: nowIso(), staleSeconds: 0 },
    agentOps: { source: "agent_workbench_snapshot", updatedAt: nowIso(), staleSeconds: 0 },
    gateway: { source: "agent_workbench_gateway_cache", updatedAt: nowIso(), staleSeconds: 0 },
  },
  gateway: {
    ok: true,
    status: "ok",
    model: "minimax-m3",
    provider: "minimax",
    error: "",
    updatedAt: nowIso(),
  },
  sources: {
    calendar: {
      ok: true,
      status: "ok",
      source: "sqlite",
      updatedAt: nowIso(),
      error: "",
    },
    agentOps: {
      ok: true,
      status: "ok",
      source: "agent_workbench_snapshot",
      updatedAt: nowIso(),
      error: "",
    },
    nas: {
      ok: true,
      status: "connected",
      source: "nas",
      updatedAt: nowIso(),
      error: "",
    },
  },
  agentOps: commonBootstrap.agentOps,
  nextActions: [],
  timeline: [],
  todos: [],
  events: [],
  planItems: [],
  notes: [],
  reports: [],
  holidays: [],
  approvals: [],
  blocked: [],
  tasks: [],
  inbox: commonBootstrap.inbox,
  stats: commonBootstrap.stats,
};

// ---------------------------------------------------------------------------
// MobileKnowledgeAtlasResponse (minimal)
// ---------------------------------------------------------------------------
const commonAtlas = {
  ok: true,
  updatedAt: nowIso(),
  items: [],
};

// ---------------------------------------------------------------------------
// MobileVoiceNoteListResponse (matches MobileVoiceNote shape)
// ---------------------------------------------------------------------------
const commonVoiceNotes = {
  ok: true,
  items: [],
  updatedAt: nowIso(),
};

// ---------------------------------------------------------------------------
// HTTP handler
// ---------------------------------------------------------------------------
const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://localhost");
  const path = url.pathname;
  console.log(`[mock] ${req.method} ${path}`);

  // Always refresh updatedAt on bootstrap/today so cache freshness shows
  const refreshToday = () => ({ ...commonToday, updatedAt: nowIso() });

  if (path === "/api/mobile/bootstrap" && req.method === "GET") {
    return json(res, commonBootstrap);
  }

  if (path.startsWith("/api/mobile/today") && req.method === "GET") {
    return json(res, refreshToday());
  }

  if (path === "/api/mobile/knowledge/atlas" && req.method === "GET") {
    return json(res, commonAtlas);
  }

  if (path.startsWith("/api/mobile/voice-notes") && req.method === "GET") {
    return json(res, commonVoiceNotes);
  }

  if (path === "/api/mobile/pairing/claim" && req.method === "POST") {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      console.log(`[mock] pairing/claim body: ${body}`);
      return json(res, {
        ok: true,
        accessToken: "mock_access_token_r19",
        accessExpiresAt: FAR_FUTURE(),
        refreshToken: "mock_refresh_token_r19",
        refreshExpiresAt: FAR_FUTURE(),
        device: {
          id: "ocm_mock_r19",
          name: "R19 Emulator Device",
          platform: "android",
          appVersion: "1.0.8",
          status: "active",
          createdAt: nowIso(),
          lastSeenAt: nowIso(),
          revokedAt: null,
        },
      });
    });
    return;
  }

  // POST /api/mobile/recorder/sessions → start a recorder session
  if (path === "/api/mobile/recorder/sessions" && req.method === "POST") {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const id = `r19_mock_session_${Date.now()}`;
      segmentStore.set(id, []);
      console.log(`[mock] recorder/sessions → created ${id} body=${body}`);
      return json(res, {
        ok: true,
        session: {
          id,
          deviceId: "ocm_mock_r19",
          title: "",
          status: "recording",
          scene: "mobile_recorder",
          language: "zh-CN",
          totalChunks: 0,
          totalBytes: 0,
          durationMs: 0,
          startedAt: nowIso(),
          updatedAt: nowIso(),
        },
      });
    });
    return;
  }

  // GET /api/mobile/recorder/sessions/:id/segments → list segments
  const segmentsMatch = path.match(/^\/api\/mobile\/recorder\/sessions\/([^/]+)\/segments$/);
  if (segmentsMatch && req.method === "GET") {
    const id = segmentsMatch[1];
    const arr = segmentStore.get(id) || [];
    return json(res, {
      ok: true,
      session: {
        id,
        status: "recording",
        updatedAt: nowIso(),
      },
      segments: arr,
    });
  }

  // POST /api/mobile/recorder/sessions/:id/chunks → upload a chunk
  const chunksMatch = path.match(/^\/api\/mobile\/recorder\/sessions\/([^/]+)\/chunks$/);
  if (chunksMatch && req.method === "POST") {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const id = chunksMatch[1];
      const payload = body ? JSON.parse(body) : {};
      // Final chunk in uploadRecorderAudio: synthesize a single segment.
      if (payload.status === "final") {
        pushSegment(id, 0, mockTranscriptLines[0]);
      }
      return json(res, {
        ok: true,
        uploadedChunks: (payload.chunkIndex ?? 0) + 1,
        totalChunks: payload.totalChunks ?? 1,
      });
    });
    return;
  }

  // POST /api/mobile/recorder/sessions/:id/live-segments → upload a rolling 12s segment
  const liveMatch = path.match(/^\/api\/mobile\/recorder\/sessions\/([^/]+)\/live-segments$/);
  if (liveMatch && req.method === "POST") {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const id = liveMatch[1];
      const payload = body ? JSON.parse(body) : {};
      const segIdx = payload.segmentIndex ?? 0;
      const text = mockTranscriptLines[segIdx % mockTranscriptLines.length] || `mock_segment_${segIdx}`;
      pushSegment(id, segIdx, text);
      return json(res, {
        ok: true,
        status: "transcribing",
        transcriptionConfigured: true,
        segmentIndex: segIdx,
        chunksUploaded: 1,
        segment: {
          id: `mock_seg_${id}_${segIdx}`,
          sessionId: id,
          segmentIndex: segIdx,
          chunkIndex: 0,
          text,
          status: "final",
          startMs: segIdx * 12000,
          endMs: (segIdx + 1) * 12000,
          provider: "mock-segment-fallback",
          audioBytes: 32000,
          createdAt: nowIso(),
        },
      });
    });
    return;
  }

  // POST /api/mobile/recorder/sessions/:id/ingest → finalize
  const ingestMatch = path.match(/^\/api\/mobile\/recorder\/sessions\/([^/]+)\/ingest$/);
  if (ingestMatch && req.method === "POST") {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const id = ingestMatch[1];
      console.log(`[mock] recorder/sessions/${id}/ingest body=${body.slice(0, 200)}`);
      return json(res, {
        ok: true,
        status: "created",
        job: {
          id: `mock_job_${id}`,
          status: "done",
          target: "note",
          markdownPath: "/mock/note.md",
          htmlPath: "/mock/note.html",
          knowledgeEntryId: null,
          calendarNoteId: null,
        },
      });
    });
    return;
  }

  json(res, { ok: false, error: `mock_path_not_found:${path}` }, 404);
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`[mock] R19 backend listening on http://0.0.0.0:${PORT}`);
});