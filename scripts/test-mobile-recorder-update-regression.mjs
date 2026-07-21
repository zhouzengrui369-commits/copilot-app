// 2026-07-03 — R7 regression: ensure updateMobileRecordingSession never leaks
// `device_id` (or any other column that node:sqlite will treat as a named
// parameter). This is the original Mate60 1.0.8 chunk-upload failure:
//
//   POST /api/mobile/recorder/sessions/:id/chunks → HTTP 500
//   Unknown named parameter 'device_id'
//
// The cause was that the function spread `...existing` (the full DB row) into
// the bind object, so when the UPDATE statement references only `title`,
// `status`, `scene`, …, `updated_at`, `WHERE id = @id`, the leftover keys
// (`device_id`, `source`, `started_at`) made node:sqlite throw
// `Unknown named parameter '<col>'`. The fix is to project the bind object
// down to ONLY the columns named in the UPDATE statement.
//
// This script runs in-process against the freshly-built `dist/mobileRecorder.js`
// so it can exercise both the fresh-schema and "extra-column-on-the-row"
// scenarios without touching the user's live workbench DB.

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { pathToFileURL, fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const modulePath = path.join(rootDir, "apps", "server", "dist", "mobileRecorder.js");

if (!fs.existsSync(modulePath)) {
  console.error("FAIL: dist/mobileRecorder.js missing — run `npm run build --workspace @openclaw-workbench/server` first");
  process.exit(2);
}

function makeDb() {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE mobile_recording_sessions (
      id TEXT PRIMARY KEY,
      device_id TEXT NOT NULL,
      title TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'recording',
      scene TEXT NOT NULL DEFAULT '',
      language TEXT NOT NULL DEFAULT 'zh-CN',
      network TEXT NOT NULL DEFAULT '',
      battery_level INTEGER,
      retention_hours INTEGER NOT NULL DEFAULT 24,
      audio_dir TEXT NOT NULL DEFAULT '',
      source TEXT NOT NULL DEFAULT 'mobile_app',
      sample_rate INTEGER NOT NULL DEFAULT 0,
      channel_count INTEGER NOT NULL DEFAULT 1,
      duration_ms INTEGER NOT NULL DEFAULT 0,
      total_chunks INTEGER NOT NULL DEFAULT 0,
      total_bytes INTEGER NOT NULL DEFAULT 0,
      last_segment_at TEXT,
      started_at TEXT NOT NULL,
      ended_at TEXT,
      updated_at TEXT NOT NULL,
      completed_at TEXT,
      error TEXT NOT NULL DEFAULT '',
      knowledge_entry_id TEXT,
      metadata TEXT NOT NULL DEFAULT '{}'
    )
  `);
  return db;
}

function assert(cond, message, details) {
  if (!cond) {
    const suffix = details ? `\n${JSON.stringify(details, null, 2)}` : "";
    throw new Error(`${message}${suffix}`);
  }
}

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-mobile-recorder-regression-"));

async function main() {
  const mobileRecorder = await import(`${pathToFileURL(modulePath).href}?t=${Date.now()}`);
  if (typeof mobileRecorder.updateMobileRecordingSession !== "function") {
    throw new Error("updateMobileRecordingSession export missing from dist/mobileRecorder.js");
  }

  // Scenario 1: bare bones UPDATE through the chunk code path.
  {
    const db = makeDb();
    db.exec(`INSERT INTO mobile_recording_sessions (id, device_id, started_at, updated_at) VALUES ('regr1', 'dev-r60', '2026-07-03T00:00:00Z', '2026-07-03T00:00:00Z')`);
    const updated = mobileRecorder.updateMobileRecordingSession(db, {
      id: "regr1",
      status: "uploading",
      totalChunks: 1,
      totalBytes: 256,
      durationMs: 1500,
      lastSegmentAt: "2026-07-03T00:00:01Z",
    });
    assert(updated && updated.status === "uploading", "scenario1_status_must_be_uploading", updated);
    assert(updated.totalChunks === 1, "scenario1_total_chunks_must_advance", updated);
    assert(updated.totalBytes === 256, "scenario1_total_bytes_must_advance", updated);
    assert(updated.deviceId === "dev-r60", "scenario1_device_id_must_be_preserved", updated);
  }

  // Scenario 2: must NOT leak `device_id` (or any other row column) into the
  // named-param binder. Simulate future schema drift by adding a column that
  // exists on the row but not on the UPDATE statement, then verify the bind
  // object has exactly the 21 expected keys (no `device_id`, `source`,
  // `started_at`).
  {
    const db = makeDb();
    db.exec(`ALTER TABLE mobile_recording_sessions ADD COLUMN future_extra TEXT NOT NULL DEFAULT ''`);
    db.exec(`INSERT INTO mobile_recording_sessions (id, device_id, started_at, updated_at, future_extra) VALUES ('regr2', 'dev-future', '2026-07-03T00:00:00Z', '2026-07-03T00:00:00Z', 'extra-value')`);

    // Intercept the prepare/run pipeline to capture the actual bind object
    // passed to the UPDATE statement.
    const origPrepare = db.prepare.bind(db);
    let captured = null;
    db.prepare = (sql) => {
      const stmt = origPrepare(sql);
      const origRun = stmt.run.bind(stmt);
      stmt.run = (arg) => {
        if (sql.includes("UPDATE mobile_recording_sessions")) {
          captured = JSON.parse(JSON.stringify(arg));
        }
        return origRun(arg);
      };
      return stmt;
    };

    const updated = mobileRecorder.updateMobileRecordingSession(db, {
      id: "regr2",
      status: "ready",
      totalChunks: 2,
      totalBytes: 999,
    });
    assert(updated && updated.status === "ready", "scenario2_status_must_be_ready", updated);
    assert(captured, "scenario2_bind_object_not_captured");
    const bindKeys = Object.keys(captured).sort();
    const expected = [
      "audio_dir",
      "battery_level",
      "channel_count",
      "completed_at",
      "duration_ms",
      "ended_at",
      "error",
      "id",
      "knowledge_entry_id",
      "language",
      "last_segment_at",
      "metadata",
      "network",
      "retention_hours",
      "sample_rate",
      "scene",
      "status",
      "title",
      "total_bytes",
      "total_chunks",
      "updated_at",
    ];
    assert(
      JSON.stringify(bindKeys) === JSON.stringify(expected),
      "scenario2_bind_keys_must_be_exact",
      { actual: bindKeys, expected },
    );
    assert(
      !("device_id" in captured) && !("source" in captured) && !("started_at" in captured) && !("future_extra" in captured),
      "scenario2_leaked_extra_columns_into_bind",
      { captured },
    );
    db.prepare = origPrepare;
  }

  // Scenario 3: PATCH path — same function, different field set, must still
  // not throw.
  {
    const db = makeDb();
    db.exec(`INSERT INTO mobile_recording_sessions (id, device_id, started_at, updated_at) VALUES ('regr3', 'dev-patch', '2026-07-03T00:00:00Z', '2026-07-03T00:00:00Z')`);
    mobileRecorder.updateMobileRecordingSession(db, {
      id: "regr3",
      title: "patched-title",
      language: "en-US",
      endedAt: "2026-07-03T00:10:00Z",
      completedAt: "2026-07-03T00:10:00Z",
    });
    const row = db.prepare("SELECT title, language, ended_at FROM mobile_recording_sessions WHERE id = ?").get("regr3");
    assert(row.title === "patched-title", "scenario3_title_persist", row);
    assert(row.language === "en-US", "scenario3_language_persist", row);
    assert(row.ended_at === "2026-07-03T00:10:00Z", "scenario3_ended_at_persist", row);
  }

  console.log(JSON.stringify({ ok: true, scenarios: ["basic_chunk_update", "future_column_drift", "patch_endpoint"] }));
}

main().catch((err) => {
  console.error("MOBILE_RECORDER_UPDATE_REGRESSION_FAIL:", err.message);
  console.error(err.stack);
  process.exit(1);
});
