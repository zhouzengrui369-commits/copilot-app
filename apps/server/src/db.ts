import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { DATA_DIR, nowIso, SESSION_DAYS } from "./config.js";

export type Db = DatabaseSync;

export function openDb() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const db = new DatabaseSync(path.join(DATA_DIR, "workbench.sqlite"));
  db.exec("PRAGMA busy_timeout = 5000;");
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA foreign_keys = ON;");
  migrate(db);
  return db;
}

function migrate(db: Db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      password_hash TEXT NOT NULL,
      salt TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY(user_id) REFERENCES users(id)
    );
    CREATE TABLE IF NOT EXISTS mobile_pairing_challenges (
      id TEXT PRIMARY KEY,
      code_hash TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL,
      device_hint TEXT NOT NULL DEFAULT '',
      created_by TEXT NOT NULL DEFAULT 'owner',
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      claimed_at TEXT
    );
    CREATE TABLE IF NOT EXISTS mobile_devices (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      platform TEXT NOT NULL,
      app_version TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL,
      pairing_id TEXT,
      user_agent TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      last_seen_at TEXT,
      revoked_at TEXT,
      FOREIGN KEY(pairing_id) REFERENCES mobile_pairing_challenges(id)
    );
    CREATE TABLE IF NOT EXISTS mobile_device_tokens (
      id TEXT PRIMARY KEY,
      device_id TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      kind TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      last_used_at TEXT,
      revoked_at TEXT,
      FOREIGN KEY(device_id) REFERENCES mobile_devices(id)
    );
    CREATE TABLE IF NOT EXISTS mobile_voice_notes (
      id TEXT PRIMARY KEY,
      device_id TEXT,
      date_key TEXT NOT NULL,
      title TEXT NOT NULL,
      transcript_text TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'manual_transcript',
      language TEXT NOT NULL DEFAULT 'zh-CN',
      duration_seconds INTEGER,
      audio_path TEXT,
      audio_mime TEXT,
      audio_bytes INTEGER,
      audio_hash TEXT,
      transcription_provider TEXT,
      knowledge_entry_id TEXT,
      calendar_note_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      organized_at TEXT,
      error TEXT NOT NULL DEFAULT '',
      FOREIGN KEY(device_id) REFERENCES mobile_devices(id),
      FOREIGN KEY(knowledge_entry_id) REFERENCES knowledge_entries(id),
      FOREIGN KEY(calendar_note_id) REFERENCES calendar_notes(id)
    );
    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts TEXT NOT NULL,
      actor TEXT NOT NULL,
      action TEXT NOT NULL,
      target_type TEXT NOT NULL,
      target_id TEXT,
      risk_level TEXT NOT NULL,
      details TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      status TEXT NOT NULL,
      risk_level TEXT NOT NULL,
      session_key TEXT,
      run_id TEXT,
      approval_status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS task_dependencies (
      task_id TEXT NOT NULL,
      depends_on_task_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY(task_id, depends_on_task_id),
      FOREIGN KEY(task_id) REFERENCES tasks(id),
      FOREIGN KEY(depends_on_task_id) REFERENCES tasks(id)
    );
    CREATE TABLE IF NOT EXISTS task_events (
      id TEXT PRIMARY KEY,
      task_id TEXT,
      event_type TEXT NOT NULL,
      actor TEXT NOT NULL,
      message TEXT NOT NULL,
      payload TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY(task_id) REFERENCES tasks(id)
    );
    CREATE TABLE IF NOT EXISTS workbench_events (
      id TEXT PRIMARY KEY,
      work_item_id TEXT,
      source_type TEXT NOT NULL,
      source_id TEXT,
      agent_id TEXT,
      event_type TEXT NOT NULL,
      severity TEXT NOT NULL,
      message TEXT NOT NULL,
      payload TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS workbench_links (
      work_item_id TEXT NOT NULL,
      link_type TEXT NOT NULL,
      target TEXT NOT NULL,
      metadata TEXT NOT NULL DEFAULT '{}',
      updated_at TEXT NOT NULL,
      PRIMARY KEY(work_item_id, link_type, target)
    );
    CREATE TABLE IF NOT EXISTS approvals (
      id TEXT PRIMARY KEY,
      task_id TEXT,
      action TEXT NOT NULL,
      status TEXT NOT NULL,
      requested_at TEXT NOT NULL,
      resolved_at TEXT,
      details TEXT NOT NULL,
      FOREIGN KEY(task_id) REFERENCES tasks(id)
    );
    CREATE TABLE IF NOT EXISTS knowledge_entries (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      source TEXT NOT NULL,
      source_path TEXT,
      summary TEXT NOT NULL,
      tags TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS knowledge_links (
      id TEXT PRIMARY KEY,
      source_entry_id TEXT NOT NULL,
      target TEXT NOT NULL,
      relation TEXT NOT NULL,
      confidence REAL NOT NULL DEFAULT 1,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY(source_entry_id) REFERENCES knowledge_entries(id)
    );
    CREATE TABLE IF NOT EXISTS research_jobs (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      question TEXT NOT NULL,
      sources TEXT NOT NULL,
      formats TEXT NOT NULL,
      status TEXT NOT NULL,
      output_dir TEXT,
      report_path TEXT,
      mindmap_path TEXT,
      ppt_path TEXT,
      notes TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      status TEXT NOT NULL,
      description TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS project_milestones (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      name TEXT NOT NULL,
      due_date TEXT,
      status TEXT NOT NULL,
      deliverables TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(project_id) REFERENCES projects(id)
    );
    CREATE TABLE IF NOT EXISTS project_deliverables (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      title TEXT NOT NULL,
      uri TEXT,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(project_id) REFERENCES projects(id)
    );
    CREATE TABLE IF NOT EXISTS development_project_profiles (
      project_id TEXT PRIMARY KEY,
      objective TEXT NOT NULL DEFAULT '',
      repo_path TEXT NOT NULL DEFAULT '',
      task_dir TEXT NOT NULL DEFAULT '',
      preview_url TEXT NOT NULL DEFAULT '',
      quality_gates TEXT NOT NULL DEFAULT '[]',
      default_model_id TEXT NOT NULL DEFAULT 'minimax-m3',
      default_agent_policy TEXT NOT NULL DEFAULT 'auto',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(project_id) REFERENCES projects(id)
    );
    CREATE TABLE IF NOT EXISTS development_documents (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      doc_key TEXT NOT NULL,
      label TEXT NOT NULL,
      title TEXT NOT NULL,
      kind TEXT NOT NULL,
      path TEXT NOT NULL DEFAULT '',
      url TEXT NOT NULL DEFAULT '',
      summary TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'missing',
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(project_id, doc_key),
      FOREIGN KEY(project_id) REFERENCES projects(id)
    );
    CREATE TABLE IF NOT EXISTS development_stages (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      stage_key TEXT NOT NULL,
      label TEXT NOT NULL,
      status TEXT NOT NULL,
      owner_agent_id TEXT NOT NULL DEFAULT 'main',
      summary TEXT NOT NULL DEFAULT '',
      sort_order INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL,
      UNIQUE(project_id, stage_key),
      FOREIGN KEY(project_id) REFERENCES projects(id)
    );
    CREATE TABLE IF NOT EXISTS development_runs (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      mode TEXT NOT NULL,
      trigger_type TEXT NOT NULL,
      status TEXT NOT NULL,
      active_agent_id TEXT NOT NULL DEFAULT 'main',
      started_at TEXT NOT NULL,
      completed_at TEXT,
      duration_ms INTEGER NOT NULL DEFAULT 0,
      summary TEXT NOT NULL DEFAULT '',
      delivery_report_path TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      FOREIGN KEY(project_id) REFERENCES projects(id)
    );
    CREATE TABLE IF NOT EXISTS development_run_events (
      id TEXT PRIMARY KEY,
      run_id TEXT,
      project_id TEXT NOT NULL,
      task_id TEXT,
      event_type TEXT NOT NULL,
      actor TEXT NOT NULL,
      severity TEXT NOT NULL DEFAULT 'info',
      message TEXT NOT NULL,
      artifact_id TEXT,
      payload TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      FOREIGN KEY(run_id) REFERENCES development_runs(id),
      FOREIGN KEY(project_id) REFERENCES projects(id),
      FOREIGN KEY(task_id) REFERENCES tasks(id)
    );
    CREATE TABLE IF NOT EXISTS development_artifacts (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      run_id TEXT,
      task_id TEXT,
      artifact_type TEXT NOT NULL,
      title TEXT NOT NULL,
      path TEXT NOT NULL DEFAULT '',
      url TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'available',
      evidence_level TEXT NOT NULL DEFAULT 'reference',
      metadata TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      FOREIGN KEY(project_id) REFERENCES projects(id),
      FOREIGN KEY(run_id) REFERENCES development_runs(id),
      FOREIGN KEY(task_id) REFERENCES tasks(id)
    );
    CREATE TABLE IF NOT EXISTS development_gates (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      run_id TEXT,
      gate_key TEXT NOT NULL,
      label TEXT NOT NULL,
      status TEXT NOT NULL,
      severity TEXT NOT NULL DEFAULT 'normal',
      evidence TEXT NOT NULL DEFAULT '',
      required INTEGER NOT NULL DEFAULT 1,
      updated_at TEXT NOT NULL,
      UNIQUE(project_id, run_id, gate_key),
      FOREIGN KEY(project_id) REFERENCES projects(id),
      FOREIGN KEY(run_id) REFERENCES development_runs(id)
    );
    CREATE TABLE IF NOT EXISTS development_work_packets (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      title TEXT NOT NULL,
      objective TEXT NOT NULL DEFAULT '',
      scope TEXT NOT NULL DEFAULT '',
      stage_key TEXT NOT NULL DEFAULT 'intake',
      owner_agent_id TEXT NOT NULL DEFAULT 'main',
      status TEXT NOT NULL DEFAULT 'planned',
      acceptance_criteria TEXT NOT NULL DEFAULT '[]',
      blockers TEXT NOT NULL DEFAULT '[]',
      next_action TEXT NOT NULL DEFAULT '',
      active_task_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(project_id) REFERENCES projects(id),
      FOREIGN KEY(active_task_id) REFERENCES tasks(id)
    );
    CREATE TABLE IF NOT EXISTS development_tool_registry (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      tool_key TEXT NOT NULL,
      label TEXT NOT NULL,
      category TEXT NOT NULL,
      risk_level TEXT NOT NULL DEFAULT 'low',
      approval_policy TEXT NOT NULL DEFAULT 'auto_allow',
      hook_points TEXT NOT NULL DEFAULT '[]',
      enabled INTEGER NOT NULL DEFAULT 1,
      last_status TEXT NOT NULL DEFAULT 'unknown',
      last_run_at TEXT,
      metadata TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(project_id, tool_key),
      FOREIGN KEY(project_id) REFERENCES projects(id)
    );
    CREATE TABLE IF NOT EXISTS development_context_manifests (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      run_id TEXT,
      work_packet_id TEXT,
      status TEXT NOT NULL DEFAULT 'available',
      summary TEXT NOT NULL DEFAULT '',
      manifest_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      FOREIGN KEY(project_id) REFERENCES projects(id),
      FOREIGN KEY(run_id) REFERENCES development_runs(id),
      FOREIGN KEY(work_packet_id) REFERENCES development_work_packets(id)
    );
    CREATE TABLE IF NOT EXISTS development_gate_definitions (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      gate_key TEXT NOT NULL,
      label TEXT NOT NULL,
      category TEXT NOT NULL,
      required INTEGER NOT NULL DEFAULT 1,
      command TEXT NOT NULL DEFAULT '',
      source_path TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'active',
      metadata TEXT NOT NULL DEFAULT '{}',
      updated_at TEXT NOT NULL,
      UNIQUE(project_id, gate_key),
      FOREIGN KEY(project_id) REFERENCES projects(id)
    );
    CREATE TABLE IF NOT EXISTS development_review_records (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      run_id TEXT,
      work_packet_id TEXT,
      reviewer_key TEXT NOT NULL,
      label TEXT NOT NULL,
      status TEXT NOT NULL,
      score INTEGER NOT NULL DEFAULT 0,
      severity TEXT NOT NULL DEFAULT 'normal',
      summary TEXT NOT NULL DEFAULT '',
      evidence TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      FOREIGN KEY(project_id) REFERENCES projects(id),
      FOREIGN KEY(run_id) REFERENCES development_runs(id),
      FOREIGN KEY(work_packet_id) REFERENCES development_work_packets(id)
    );
    CREATE TABLE IF NOT EXISTS development_plugin_registry (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      plugin_key TEXT NOT NULL,
      label TEXT NOT NULL,
      kind TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      permission_scope TEXT NOT NULL DEFAULT 'read',
      risk_level TEXT NOT NULL DEFAULT 'low',
      last_status TEXT NOT NULL DEFAULT 'unknown',
      last_run_at TEXT,
      failure_reason TEXT NOT NULL DEFAULT '',
      metadata TEXT NOT NULL DEFAULT '{}',
      updated_at TEXT NOT NULL,
      UNIQUE(project_id, plugin_key),
      FOREIGN KEY(project_id) REFERENCES projects(id)
    );
    CREATE TABLE IF NOT EXISTS development_project_workspaces (
      project_id TEXT PRIMARY KEY,
      workspace_path TEXT NOT NULL,
      goal_path TEXT NOT NULL DEFAULT '',
      prd_path TEXT NOT NULL DEFAULT '',
      baseline_path TEXT NOT NULL DEFAULT '',
      evidence_dir TEXT NOT NULL DEFAULT '',
      artifacts_dir TEXT NOT NULL DEFAULT '',
      reviews_dir TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'ready',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(project_id) REFERENCES projects(id)
    );
    CREATE TABLE IF NOT EXISTS development_product_roles (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      role_key TEXT NOT NULL,
      title TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      principles TEXT NOT NULL DEFAULT '[]',
      value_metrics TEXT NOT NULL DEFAULT '[]',
      taste_threshold INTEGER NOT NULL DEFAULT 85,
      critical_threshold INTEGER NOT NULL DEFAULT 75,
      non_goals TEXT NOT NULL DEFAULT '[]',
      acceptance_policy TEXT NOT NULL DEFAULT 'gates_plus_human_for_high_risk',
      updated_at TEXT NOT NULL,
      UNIQUE(project_id, role_key),
      FOREIGN KEY(project_id) REFERENCES projects(id)
    );
    CREATE TABLE IF NOT EXISTS development_baselines (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'draft',
      source_goal_path TEXT NOT NULL DEFAULT '',
      source_prd_path TEXT NOT NULL DEFAULT '',
      summary TEXT NOT NULL DEFAULT '',
      total_subtasks INTEGER NOT NULL DEFAULT 0,
      passed_subtasks INTEGER NOT NULL DEFAULT 0,
      active_subtask_id TEXT NOT NULL DEFAULT '',
      locked_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(project_id, version),
      FOREIGN KEY(project_id) REFERENCES projects(id)
    );
    CREATE TABLE IF NOT EXISTS development_subtasks (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      baseline_id TEXT NOT NULL,
      work_packet_id TEXT,
      task_id TEXT,
      sequence INTEGER NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'queued',
      owner_agent_id TEXT NOT NULL DEFAULT 'worker',
      acceptance_criteria TEXT NOT NULL DEFAULT '[]',
      required_gates TEXT NOT NULL DEFAULT '[]',
      blockers TEXT NOT NULL DEFAULT '[]',
      plan_path TEXT NOT NULL DEFAULT '',
      result_path TEXT NOT NULL DEFAULT '',
      evidence_dir TEXT NOT NULL DEFAULT '',
      artifacts_dir TEXT NOT NULL DEFAULT '',
      reviews_dir TEXT NOT NULL DEFAULT '',
      started_at TEXT,
      completed_at TEXT,
      updated_at TEXT NOT NULL,
      UNIQUE(baseline_id, sequence),
      FOREIGN KEY(project_id) REFERENCES projects(id),
      FOREIGN KEY(baseline_id) REFERENCES development_baselines(id),
      FOREIGN KEY(work_packet_id) REFERENCES development_work_packets(id),
      FOREIGN KEY(task_id) REFERENCES tasks(id)
    );
    CREATE TABLE IF NOT EXISTS development_goals (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      title TEXT NOT NULL,
      objective TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'active',
      autonomy_level TEXT NOT NULL DEFAULT 'supervised',
      active_work_packet_id TEXT,
      active_subtask_id TEXT,
      token_budget INTEGER,
      tokens_used INTEGER NOT NULL DEFAULT 0,
      turn_count INTEGER NOT NULL DEFAULT 0,
      heartbeat_count INTEGER NOT NULL DEFAULT 0,
      last_heartbeat_at TEXT,
      next_heartbeat_at TEXT,
      next_action TEXT NOT NULL DEFAULT '',
      auto_run_enabled INTEGER NOT NULL DEFAULT 0,
      heartbeat_interval_minutes INTEGER NOT NULL DEFAULT 30,
      max_auto_turns INTEGER NOT NULL DEFAULT 3,
      auto_turns_used INTEGER NOT NULL DEFAULT 0,
      risk_policy TEXT NOT NULL DEFAULT 'low_risk_only',
      stop_conditions TEXT NOT NULL DEFAULT '[]',
      last_auto_run_at TEXT,
      blockers TEXT NOT NULL DEFAULT '[]',
      success_criteria TEXT NOT NULL DEFAULT '[]',
      evidence TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      completed_at TEXT,
      FOREIGN KEY(project_id) REFERENCES projects(id),
      FOREIGN KEY(active_work_packet_id) REFERENCES development_work_packets(id),
      FOREIGN KEY(active_subtask_id) REFERENCES development_subtasks(id)
    );
    CREATE TABLE IF NOT EXISTS development_goal_runs (
      id TEXT PRIMARY KEY,
      goal_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      subtask_id TEXT NOT NULL DEFAULT '',
      development_run_id TEXT NOT NULL DEFAULT '',
      action TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'intake',
      active_agent_id TEXT NOT NULL DEFAULT '',
      preflight_json TEXT NOT NULL DEFAULT '{}',
      resume_manifest_json TEXT NOT NULL DEFAULT '{}',
      evidence_pack_json TEXT NOT NULL DEFAULT '{}',
      dispatch_error TEXT NOT NULL DEFAULT '',
      token_budget INTEGER,
      tokens_used INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      completed_at TEXT,
      FOREIGN KEY(goal_id) REFERENCES development_goals(id),
      FOREIGN KEY(project_id) REFERENCES projects(id)
    );
    CREATE INDEX IF NOT EXISTS idx_development_goal_runs_goal ON development_goal_runs(goal_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_development_goal_runs_project ON development_goal_runs(project_id, created_at DESC);
    CREATE TABLE IF NOT EXISTS development_subtask_acceptance (
      id TEXT PRIMARY KEY,
      subtask_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      run_id TEXT,
      status TEXT NOT NULL,
      reviewer TEXT NOT NULL DEFAULT 'top_ai_pm',
      score INTEGER NOT NULL DEFAULT 0,
      summary TEXT NOT NULL DEFAULT '',
      evidence TEXT NOT NULL DEFAULT '',
      blockers TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL,
      FOREIGN KEY(subtask_id) REFERENCES development_subtasks(id),
      FOREIGN KEY(project_id) REFERENCES projects(id),
      FOREIGN KEY(run_id) REFERENCES development_runs(id)
    );
    CREATE TABLE IF NOT EXISTS todos (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      status TEXT NOT NULL,
      priority TEXT NOT NULL,
      due_at TEXT,
      project_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(project_id) REFERENCES projects(id)
    );
    CREATE TABLE IF NOT EXISTS plan_items (
      id TEXT PRIMARY KEY,
      plan_type TEXT NOT NULL,
      import_key TEXT UNIQUE,
      import_hash TEXT NOT NULL DEFAULT '',
      source_file TEXT NOT NULL DEFAULT '',
      source_sheet TEXT NOT NULL DEFAULT '',
      source_row INTEGER NOT NULL DEFAULT 0,
      title TEXT NOT NULL,
      status TEXT NOT NULL,
      priority TEXT NOT NULL,
      due_at TEXT,
      agent_id TEXT,
      list_name TEXT NOT NULL DEFAULT '',
      tags TEXT NOT NULL DEFAULT '[]',
      raw_fields TEXT NOT NULL DEFAULT '{}',
      field_order TEXT NOT NULL DEFAULT '[]',
      todo_id TEXT,
      followed INTEGER NOT NULL DEFAULT 0,
      sync_status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(todo_id) REFERENCES todos(id)
    );
    CREATE TABLE IF NOT EXISTS events (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      start_at TEXT NOT NULL,
      end_at TEXT,
      project_id TEXT,
      notes TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(project_id) REFERENCES projects(id)
    );
    CREATE TABLE IF NOT EXISTS calendar_notes (
      id TEXT PRIMARY KEY,
      date_key TEXT NOT NULL,
      title TEXT NOT NULL,
      summary TEXT NOT NULL DEFAULT '',
      content TEXT NOT NULL DEFAULT '',
      tags TEXT NOT NULL DEFAULT '[]',
      knowledge_entry_id TEXT,
      knowledge_path TEXT,
      knowledge_html_path TEXT,
      related_type TEXT,
      related_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(knowledge_entry_id) REFERENCES knowledge_entries(id)
    );
    CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY,
      level TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      source TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS system_checks (
      id TEXT PRIMARY KEY,
      category TEXT NOT NULL,
      name TEXT NOT NULL,
      status TEXT NOT NULL,
      summary TEXT NOT NULL,
      details TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS agent_snapshots (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      status TEXT NOT NULL,
      model TEXT,
      current_task_id TEXT,
      payload TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS model_configs (
      id TEXT PRIMARY KEY,
      label TEXT NOT NULL,
      provider TEXT NOT NULL,
      model TEXT NOT NULL,
      context_window INTEGER,
      status TEXT NOT NULL,
      metadata TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS chat_sessions (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      knowledge_sources TEXT NOT NULL,
      skill_ids TEXT NOT NULL,
      plan_enabled INTEGER NOT NULL DEFAULT 0,
      favorite INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      export_path TEXT
    );
    CREATE TABLE IF NOT EXISTS chat_messages (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      role TEXT NOT NULL,
      agent_id TEXT,
      content TEXT NOT NULL,
      message_type TEXT NOT NULL,
      status TEXT NOT NULL,
      metadata TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY(session_id) REFERENCES chat_sessions(id)
    );
    CREATE TABLE IF NOT EXISTS chat_attachments (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      message_id TEXT,
      type TEXT NOT NULL,
      name TEXT NOT NULL,
      source_url TEXT,
      content_path TEXT,
      text_excerpt TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY(session_id) REFERENCES chat_sessions(id),
      FOREIGN KEY(message_id) REFERENCES chat_messages(id)
    );
    CREATE TABLE IF NOT EXISTS skill_catalog (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      source TEXT NOT NULL,
      path TEXT,
      description TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS agent_config_versions (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      file_key TEXT NOT NULL,
      file_path TEXT NOT NULL,
      content TEXT NOT NULL,
      version INTEGER NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS cron_jobs (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      name TEXT NOT NULL,
      expression TEXT NOT NULL,
      prompt TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS inbox_items (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      item_type TEXT NOT NULL,
      status TEXT NOT NULL,
      source TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS todo_sync_links (
      id TEXT PRIMARY KEY,
      todo_id TEXT NOT NULL,
      provider TEXT NOT NULL,
      external_id TEXT,
      external_list TEXT NOT NULL DEFAULT '',
      sync_hash TEXT NOT NULL DEFAULT '',
      last_synced_at TEXT,
      last_seen_at TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      error TEXT NOT NULL DEFAULT '',
      retry_count INTEGER NOT NULL DEFAULT 0,
      last_error_at TEXT,
      last_error_kind TEXT NOT NULL DEFAULT '',
      blocked INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(todo_id, provider),
      FOREIGN KEY(todo_id) REFERENCES todos(id)
    );
    CREATE TABLE IF NOT EXISTS todo_sync_conflicts (
      id TEXT PRIMARY KEY,
      todo_id TEXT,
      provider TEXT NOT NULL,
      external_id TEXT,
      field TEXT NOT NULL,
      local_value TEXT NOT NULL DEFAULT '',
      remote_value TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'pending',
      recommendation TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      resolved_at TEXT,
      FOREIGN KEY(todo_id) REFERENCES todos(id)
    );
    CREATE TABLE IF NOT EXISTS event_sync_links (
      id TEXT PRIMARY KEY,
      event_id TEXT NOT NULL,
      provider TEXT NOT NULL,
      external_id TEXT,
      external_calendar TEXT NOT NULL DEFAULT '',
      sync_hash TEXT NOT NULL DEFAULT '',
      last_synced_at TEXT,
      last_seen_at TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      error TEXT NOT NULL DEFAULT '',
      retry_count INTEGER NOT NULL DEFAULT 0,
      last_error_at TEXT,
      last_error_kind TEXT NOT NULL DEFAULT '',
      blocked INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(event_id, provider),
      FOREIGN KEY(event_id) REFERENCES events(id)
    );
    CREATE TABLE IF NOT EXISTS event_sync_conflicts (
      id TEXT PRIMARY KEY,
      event_id TEXT,
      provider TEXT NOT NULL,
      external_id TEXT,
      field TEXT NOT NULL,
      local_value TEXT NOT NULL DEFAULT '',
      remote_value TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'pending',
      recommendation TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      resolved_at TEXT,
      FOREIGN KEY(event_id) REFERENCES events(id)
    );
    CREATE TABLE IF NOT EXISTS knowledge_file_index (
      id TEXT PRIMARY KEY,
      source TEXT NOT NULL,
      title TEXT NOT NULL,
      path TEXT NOT NULL,
      file_type TEXT NOT NULL,
      size_bytes INTEGER,
      mtime TEXT,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS knowledge_preview_chats (
      id TEXT PRIMARY KEY,
      source_path TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      question TEXT NOT NULL,
      answer TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS knowledge_output_jobs (
      id TEXT PRIMARY KEY,
      source_path TEXT,
      output_type TEXT NOT NULL,
      title TEXT NOT NULL,
      status TEXT NOT NULL,
      output_path TEXT,
      notes TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS knowledge_wiki_pages (
      id TEXT PRIMARY KEY,
      page_type TEXT NOT NULL,
      title TEXT NOT NULL,
      slug TEXT NOT NULL,
      path TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL,
      review_status TEXT NOT NULL,
      confidence REAL NOT NULL DEFAULT 0,
      source_count INTEGER NOT NULL DEFAULT 0,
      source_paths TEXT NOT NULL DEFAULT '[]',
      source_hashes TEXT NOT NULL DEFAULT '[]',
      summary TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS knowledge_wiki_sources (
      id TEXT PRIMARY KEY,
      source_path TEXT NOT NULL UNIQUE,
      source_hash TEXT NOT NULL,
      source_type TEXT NOT NULL,
      wiki_page_id TEXT,
      status TEXT NOT NULL,
      last_compiled_at TEXT NOT NULL,
      metadata TEXT NOT NULL DEFAULT '{}'
    );
    CREATE TABLE IF NOT EXISTS knowledge_wiki_runs (
      id TEXT PRIMARY KEY,
      mode TEXT NOT NULL,
      status TEXT NOT NULL,
      processed_count INTEGER NOT NULL DEFAULT 0,
      generated_count INTEGER NOT NULL DEFAULT 0,
      skipped_count INTEGER NOT NULL DEFAULT 0,
      conflict_count INTEGER NOT NULL DEFAULT 0,
      error_count INTEGER NOT NULL DEFAULT 0,
      notes TEXT NOT NULL DEFAULT '',
      started_at TEXT NOT NULL,
      completed_at TEXT
    );
    CREATE TABLE IF NOT EXISTS report_templates (
      id TEXT PRIMARY KEY,
      report_type TEXT NOT NULL,
      name TEXT NOT NULL,
      style TEXT NOT NULL,
      content TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS reports (
      id TEXT PRIMARY KEY,
      report_type TEXT NOT NULL,
      title TEXT NOT NULL,
      range_start TEXT,
      range_end TEXT,
      sources TEXT NOT NULL,
      template_id TEXT,
      content TEXT NOT NULL,
      markdown_path TEXT,
      html_path TEXT,
      status TEXT NOT NULL,
      project_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS report_schedules (
      report_type TEXT PRIMARY KEY,
      enabled INTEGER NOT NULL DEFAULT 0,
      time_of_day TEXT NOT NULL DEFAULT '18:00',
      template_id TEXT,
      sources TEXT NOT NULL DEFAULT '["todos","events","plan_items","notes"]',
      last_generated_key TEXT,
      last_run_at TEXT,
      status TEXT NOT NULL DEFAULT 'idle',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS document_renders (
      id TEXT PRIMARY KEY,
      source_path TEXT NOT NULL,
      html_path TEXT NOT NULL,
      source_hash TEXT NOT NULL,
      render_status TEXT NOT NULL,
      document_type TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS opc_profiles (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      status TEXT NOT NULL,
      phase TEXT NOT NULL,
      autopilot_state TEXT NOT NULL,
      mode TEXT NOT NULL,
      plan_path TEXT,
      base_currency TEXT NOT NULL,
      notes TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(project_id) REFERENCES projects(id)
    );
    CREATE TABLE IF NOT EXISTS opc_automation_policies (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL UNIQUE,
      mode TEXT NOT NULL,
      budget_usd REAL NOT NULL,
      budget_cny REAL NOT NULL,
      fx_rate REAL NOT NULL,
      actions_json TEXT NOT NULL,
      pause_rules_json TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(project_id) REFERENCES projects(id)
    );
    CREATE TABLE IF NOT EXISTS opc_kpis (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      metric_key TEXT NOT NULL,
      name TEXT NOT NULL,
      target_value REAL NOT NULL DEFAULT 0,
      current_value REAL NOT NULL DEFAULT 0,
      unit TEXT NOT NULL DEFAULT '',
      amount_usd REAL NOT NULL DEFAULT 0,
      amount_cny REAL NOT NULL DEFAULT 0,
      fx_rate REAL NOT NULL DEFAULT 7.2,
      fx_date TEXT,
      period TEXT NOT NULL DEFAULT 'current',
      status TEXT NOT NULL DEFAULT 'tracking',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(project_id) REFERENCES projects(id)
    );
    CREATE TABLE IF NOT EXISTS opc_skus (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      sku TEXT NOT NULL,
      name TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'testing',
      supplier_id TEXT,
      price_usd REAL NOT NULL DEFAULT 0,
      price_cny REAL NOT NULL DEFAULT 0,
      cost_usd REAL NOT NULL DEFAULT 0,
      cost_cny REAL NOT NULL DEFAULT 0,
      fx_rate REAL NOT NULL DEFAULT 7.2,
      compliance_status TEXT NOT NULL DEFAULT 'pending_review',
      notes TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(project_id) REFERENCES projects(id)
    );
    CREATE TABLE IF NOT EXISTS opc_suppliers (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      name TEXT NOT NULL,
      platform TEXT NOT NULL DEFAULT '1688',
      status TEXT NOT NULL DEFAULT 'candidate',
      contact TEXT NOT NULL DEFAULT '',
      rating REAL NOT NULL DEFAULT 0,
      notes TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(project_id) REFERENCES projects(id)
    );
    CREATE TABLE IF NOT EXISTS opc_customers (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      name TEXT NOT NULL,
      email TEXT NOT NULL DEFAULT '',
      phone TEXT NOT NULL DEFAULT '',
      platform TEXT NOT NULL DEFAULT '',
      region TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'lead',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(project_id) REFERENCES projects(id)
    );
    CREATE TABLE IF NOT EXISTS opc_orders (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      customer_id TEXT,
      external_id TEXT NOT NULL DEFAULT '',
      platform TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'draft',
      order_date TEXT,
      amount_usd REAL NOT NULL DEFAULT 0,
      amount_cny REAL NOT NULL DEFAULT 0,
      cost_usd REAL NOT NULL DEFAULT 0,
      cost_cny REAL NOT NULL DEFAULT 0,
      net_value_usd REAL NOT NULL DEFAULT 0,
      net_value_cny REAL NOT NULL DEFAULT 0,
      fx_rate REAL NOT NULL DEFAULT 7.2,
      fx_date TEXT,
      notes TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(project_id) REFERENCES projects(id)
    );
    CREATE TABLE IF NOT EXISTS opc_order_items (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      order_id TEXT NOT NULL,
      sku_id TEXT,
      title TEXT NOT NULL,
      quantity INTEGER NOT NULL DEFAULT 1,
      amount_usd REAL NOT NULL DEFAULT 0,
      amount_cny REAL NOT NULL DEFAULT 0,
      cost_usd REAL NOT NULL DEFAULT 0,
      cost_cny REAL NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(project_id) REFERENCES projects(id)
    );
    CREATE TABLE IF NOT EXISTS opc_purchase_orders (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      supplier_id TEXT,
      status TEXT NOT NULL DEFAULT 'draft',
      order_date TEXT,
      amount_usd REAL NOT NULL DEFAULT 0,
      amount_cny REAL NOT NULL DEFAULT 0,
      fx_rate REAL NOT NULL DEFAULT 7.2,
      fx_date TEXT,
      notes TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(project_id) REFERENCES projects(id)
    );
    CREATE TABLE IF NOT EXISTS opc_shipments (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      order_id TEXT,
      provider TEXT NOT NULL DEFAULT '',
      tracking_number TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'pending',
      shipped_at TEXT,
      delivered_at TEXT,
      cost_usd REAL NOT NULL DEFAULT 0,
      cost_cny REAL NOT NULL DEFAULT 0,
      fx_rate REAL NOT NULL DEFAULT 7.2,
      notes TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(project_id) REFERENCES projects(id)
    );
    CREATE TABLE IF NOT EXISTS opc_campaigns (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      provider TEXT NOT NULL DEFAULT 'meta_ads',
      name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'draft',
      spend_usd REAL NOT NULL DEFAULT 0,
      spend_cny REAL NOT NULL DEFAULT 0,
      revenue_usd REAL NOT NULL DEFAULT 0,
      revenue_cny REAL NOT NULL DEFAULT 0,
      roas REAL NOT NULL DEFAULT 0,
      cpa REAL NOT NULL DEFAULT 0,
      ctr REAL NOT NULL DEFAULT 0,
      notes TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(project_id) REFERENCES projects(id)
    );
    CREATE TABLE IF NOT EXISTS opc_cashflows (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      flow_type TEXT NOT NULL DEFAULT 'expense',
      category TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL DEFAULT '',
      amount_usd REAL NOT NULL DEFAULT 0,
      amount_cny REAL NOT NULL DEFAULT 0,
      fx_rate REAL NOT NULL DEFAULT 7.2,
      fx_date TEXT,
      occurred_at TEXT,
      status TEXT NOT NULL DEFAULT 'recorded',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(project_id) REFERENCES projects(id)
    );
    CREATE TABLE IF NOT EXISTS opc_risks (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      title TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT '',
      severity TEXT NOT NULL DEFAULT 'P2',
      status TEXT NOT NULL DEFAULT 'open',
      trigger_condition TEXT NOT NULL DEFAULT '',
      mitigation TEXT NOT NULL DEFAULT '',
      owner TEXT NOT NULL DEFAULT 'OpenClaw',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(project_id) REFERENCES projects(id)
    );
    CREATE TABLE IF NOT EXISTS opc_integration_accounts (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      provider TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'not_configured',
      mode TEXT NOT NULL DEFAULT 'dry_run',
      key_ref TEXT NOT NULL DEFAULT '',
      credential_configured INTEGER NOT NULL DEFAULT 0,
      credential_hint TEXT NOT NULL DEFAULT '',
      scopes TEXT NOT NULL DEFAULT '[]',
      last_sync_at TEXT,
      last_error TEXT NOT NULL DEFAULT '',
      capabilities TEXT NOT NULL DEFAULT '{}',
      notes TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(project_id) REFERENCES projects(id)
    );
    CREATE TABLE IF NOT EXISTS opc_sync_runs (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      provider TEXT NOT NULL,
      status TEXT NOT NULL,
      mode TEXT NOT NULL,
      records_read INTEGER NOT NULL DEFAULT 0,
      records_written INTEGER NOT NULL DEFAULT 0,
      message TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      FOREIGN KEY(project_id) REFERENCES projects(id)
    );
    CREATE TABLE IF NOT EXISTS opc_automation_runs (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      action TEXT NOT NULL,
      status TEXT NOT NULL,
      mode TEXT NOT NULL,
      risk_level TEXT NOT NULL DEFAULT 'normal',
      summary TEXT NOT NULL DEFAULT '',
      payload TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(project_id) REFERENCES projects(id)
    );
    CREATE TABLE IF NOT EXISTS development_scheduler_state (
      id TEXT PRIMARY KEY,
      running INTEGER NOT NULL DEFAULT 0,
      last_started_at TEXT,
      last_finished_at TEXT,
      last_error TEXT NOT NULL DEFAULT '',
      target_goal_id TEXT NOT NULL DEFAULT '',
      scanned_goals INTEGER NOT NULL DEFAULT 0,
      executed_goals INTEGER NOT NULL DEFAULT 0,
      skipped_goals INTEGER NOT NULL DEFAULT 0,
      recovered_runs INTEGER NOT NULL DEFAULT 0,
      next_due_goal_id TEXT NOT NULL DEFAULT '',
 next_due_at TEXT,
 last_decision TEXT NOT NULL DEFAULT 'scheduler_not_started',
 last_auto_tick_at TEXT,
 process_id TEXT NOT NULL DEFAULT '',
 process_started_at TEXT NOT NULL DEFAULT '',
 updated_at TEXT NOT NULL
 );
    -- 2026-07-02 — R5B-1: mobile recorder storage. Sessions own segments + ingestion jobs.
    -- Idempotency keys live on (session_id, chunk_index, chunk_hash) so re-uploads dedupe.
    CREATE TABLE IF NOT EXISTS mobile_recording_sessions (
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
      metadata TEXT NOT NULL DEFAULT '{}',
      FOREIGN KEY(device_id) REFERENCES mobile_devices(id),
      FOREIGN KEY(knowledge_entry_id) REFERENCES knowledge_entries(id)
    );
    CREATE TABLE IF NOT EXISTS mobile_transcript_segments (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      device_id TEXT NOT NULL DEFAULT '',
      segment_index INTEGER NOT NULL DEFAULT 0,
      chunk_index INTEGER NOT NULL DEFAULT 0,
      chunk_hash TEXT NOT NULL DEFAULT '',
      text TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'partial',
      start_ms INTEGER NOT NULL DEFAULT 0,
      end_ms INTEGER NOT NULL DEFAULT 0,
      language TEXT NOT NULL DEFAULT 'zh-CN',
      source TEXT NOT NULL DEFAULT 'stt',
      provider TEXT NOT NULL DEFAULT '',
      confidence REAL NOT NULL DEFAULT 0,
      audio_path TEXT NOT NULL DEFAULT '',
      audio_mime TEXT NOT NULL DEFAULT '',
      audio_bytes INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      error TEXT NOT NULL DEFAULT '',
      metadata TEXT NOT NULL DEFAULT '{}',
      FOREIGN KEY(session_id) REFERENCES mobile_recording_sessions(id)
    );
    CREATE TABLE IF NOT EXISTS mobile_ingestion_jobs (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      device_id TEXT NOT NULL DEFAULT '',
      target TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      knowledge_entry_id TEXT,
      calendar_note_id TEXT,
      markdown_path TEXT NOT NULL DEFAULT '',
      html_path TEXT NOT NULL DEFAULT '',
      attempts INTEGER NOT NULL DEFAULT 0,
      max_attempts INTEGER NOT NULL DEFAULT 3,
      last_error TEXT NOT NULL DEFAULT '',
      scheduled_at TEXT,
      started_at TEXT,
      completed_at TEXT,
      payload TEXT NOT NULL DEFAULT '{}',
      result TEXT NOT NULL DEFAULT '{}',
      rollback_ref TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(session_id) REFERENCES mobile_recording_sessions(id),
      FOREIGN KEY(knowledge_entry_id) REFERENCES knowledge_entries(id),
      FOREIGN KEY(calendar_note_id) REFERENCES calendar_notes(id)
    );
    CREATE INDEX IF NOT EXISTS idx_mobile_recording_sessions_device_updated
      ON mobile_recording_sessions(device_id, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_mobile_transcript_segments_session_index
      ON mobile_transcript_segments(session_id, segment_index);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_mobile_transcript_segments_idempotency
      ON mobile_transcript_segments(session_id, chunk_index, chunk_hash)
      WHERE chunk_hash <> '';
    CREATE INDEX IF NOT EXISTS idx_mobile_ingestion_jobs_session_target
      ON mobile_ingestion_jobs(session_id, target);
  `);

  ensureColumn(db, "tasks", "priority", "TEXT NOT NULL DEFAULT 'P2'");
  ensureColumn(db, "tasks", "parent_task_id", "TEXT");
  ensureColumn(db, "tasks", "project_id", "TEXT");
  ensureColumn(db, "tasks", "tags", "TEXT NOT NULL DEFAULT '[]'");
  ensureColumn(db, "tasks", "input", "TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, "tasks", "output", "TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, "tasks", "started_at", "TEXT");
  ensureColumn(db, "tasks", "completed_at", "TEXT");
  ensureColumn(db, "tasks", "development_subtask_id", "TEXT");
  ensureColumn(db, "development_run_events", "subtask_id", "TEXT");
  ensureColumn(db, "development_artifacts", "subtask_id", "TEXT");
  ensureColumn(db, "development_gates", "subtask_id", "TEXT");
  ensureColumn(db, "development_review_records", "subtask_id", "TEXT");
  ensureColumn(db, "development_goals", "auto_run_enabled", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(db, "development_goals", "heartbeat_interval_minutes", "INTEGER NOT NULL DEFAULT 30");
  ensureColumn(db, "development_goals", "max_auto_turns", "INTEGER NOT NULL DEFAULT 3");
  ensureColumn(db, "development_goals", "auto_turns_used", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(db, "development_goals", "risk_policy", "TEXT NOT NULL DEFAULT 'low_risk_only'");
  ensureColumn(db, "development_goals", "stop_conditions", "TEXT NOT NULL DEFAULT '[]'");
  ensureColumn(db, "development_goals", "last_auto_run_at", "TEXT");
  // Sprint2.1 Gap 1: subtask dispatch retry 状态
  ensureColumn(db, "development_subtasks", "retry_count", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(db, "development_subtasks", "retry_at", "TEXT");
  ensureColumn(db, "development_subtasks", "last_dispatch_error", "TEXT");
  // Sprint2.1 Gap 2: completion chain — goal 完成后自动起下一轮
  ensureColumn(db, "development_goals", "continue_goal", "INTEGER NOT NULL DEFAULT 0");
  // Sprint2.1 Gap 3: UI 实时提示
  ensureColumn(db, "development_goals", "last_subtask_passed_at", "TEXT");
  ensureColumn(db, "knowledge_entries", "metadata", "TEXT NOT NULL DEFAULT '{}'");
  ensureColumn(db, "knowledge_entries", "content_path", "TEXT");
  ensureColumn(db, "projects", "objective", "TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, "projects", "key_results", "TEXT NOT NULL DEFAULT '[]'");
  ensureColumn(db, "projects", "deadline", "TEXT");
  ensureColumn(db, "todos", "tags", "TEXT NOT NULL DEFAULT '[]'");
  ensureColumn(db, "todos", "list_name", "TEXT NOT NULL DEFAULT 'work'");
  ensureColumn(db, "todos", "agent_id", "TEXT");
  ensureColumn(db, "todos", "notes", "TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, "todos", "reminder_sent_at", "TEXT");
  ensureColumn(db, "todos", "reminder_inbox_id", "TEXT");
  ensureColumn(db, "todos", "reminder_push_status", "TEXT");
  ensureColumn(db, "todos", "reminder_push_error", "TEXT");
  ensureColumn(db, "todo_sync_links", "retry_count", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(db, "todo_sync_links", "last_error_at", "TEXT");
  ensureColumn(db, "todo_sync_links", "last_error_kind", "TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, "todo_sync_links", "blocked", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(db, "event_sync_links", "retry_count", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(db, "event_sync_links", "last_error_at", "TEXT");
  ensureColumn(db, "event_sync_links", "last_error_kind", "TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, "event_sync_links", "blocked", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(db, "events", "event_type", "TEXT NOT NULL DEFAULT 'schedule'");
  ensureColumn(db, "events", "status", "TEXT NOT NULL DEFAULT 'confirmed'");
  ensureColumn(db, "plan_items", "import_hash", "TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, "plan_items", "raw_fields", "TEXT NOT NULL DEFAULT '{}'");
  ensureColumn(db, "plan_items", "field_order", "TEXT NOT NULL DEFAULT '[]'");
  ensureColumn(db, "plan_items", "followed", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(db, "plan_items", "sync_status", "TEXT NOT NULL DEFAULT 'pending'");
  ensureColumn(db, "calendar_notes", "knowledge_html_path", "TEXT");
  ensureColumn(db, "calendar_notes", "related_type", "TEXT");
  ensureColumn(db, "calendar_notes", "related_id", "TEXT");
  // 2026-06-19 — Mate60 Sprint 2: mobile calendar CRUD needs start/end time + status + kind.
  // Use IF NOT EXISTS semantics (handled by ensureColumn helper) so older DBs migrate in place.
  ensureColumn(db, "calendar_notes", "start_time", "TEXT");
  ensureColumn(db, "calendar_notes", "end_time", "TEXT");
  ensureColumn(db, "calendar_notes", "status", "TEXT NOT NULL DEFAULT 'active'");
  ensureColumn(db, "calendar_notes", "kind", "TEXT NOT NULL DEFAULT 'event'");
  ensureColumn(db, "report_schedules", "last_generated_key", "TEXT");
  ensureColumn(db, "report_schedules", "last_run_at", "TEXT");
  ensureColumn(db, "todos", "repeat_rule", "TEXT");
  ensureColumn(db, "projects", "progress", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(db, "chat_messages", "favorite", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(db, "chat_messages", "deleted_at", "TEXT");
  ensureColumn(db, "chat_sessions", "model_id", "TEXT");
  ensureColumn(db, "mobile_voice_notes", "audio_path", "TEXT");
  ensureColumn(db, "mobile_voice_notes", "audio_mime", "TEXT");
  ensureColumn(db, "mobile_voice_notes", "audio_bytes", "INTEGER");
  ensureColumn(db, "mobile_voice_notes", "audio_hash", "TEXT");
  ensureColumn(db, "mobile_voice_notes", "transcription_provider", "TEXT");
  // 2026-06-24 — P0-B: source_hash dedupes mobile notes by (device + body + source).
  ensureColumn(db, "mobile_voice_notes", "source_hash", "TEXT");
  ensureIndex(db, "mobile_voice_notes", "idx_mobile_voice_notes_source_hash", "(device_id, source_hash)");
  // 2026-07-02 — R5B recorder sessions: in-place safety for DBs created during early R5 testing.
  ensureColumn(db, "mobile_recording_sessions", "scene", "TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, "mobile_recording_sessions", "network", "TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, "mobile_recording_sessions", "battery_level", "INTEGER");
  ensureColumn(db, "mobile_recording_sessions", "retention_hours", "INTEGER NOT NULL DEFAULT 24");
  ensureColumn(db, "mobile_recording_sessions", "audio_dir", "TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, "mobile_recording_sessions", "ended_at", "TEXT");
  ensureColumn(db, "mobile_transcript_segments", "device_id", "TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, "mobile_transcript_segments", "status", "TEXT NOT NULL DEFAULT 'partial'");
  ensureColumn(db, "mobile_transcript_segments", "updated_at", "TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, "mobile_transcript_segments", "error", "TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, "mobile_ingestion_jobs", "device_id", "TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, "mobile_ingestion_jobs", "knowledge_entry_id", "TEXT");
  ensureColumn(db, "mobile_ingestion_jobs", "calendar_note_id", "TEXT");
  ensureColumn(db, "mobile_ingestion_jobs", "markdown_path", "TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, "mobile_ingestion_jobs", "html_path", "TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, "mobile_ingestion_jobs", "rollback_ref", "TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, "research_jobs", "report_html_path", "TEXT");
  ensureColumn(db, "research_jobs", "mindmap_html_path", "TEXT");
  ensureColumn(db, "research_jobs", "sidecar_html_path", "TEXT");
  ensureColumn(db, "model_configs", "base_url", "TEXT");
  ensureColumn(db, "model_configs", "api_key_ref", "TEXT");
  ensureColumn(db, "model_configs", "api_key_configured", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(db, "model_configs", "is_default", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(db, "opc_integration_accounts", "credential_configured", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(db, "opc_integration_accounts", "credential_hint", "TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, "opc_integration_accounts", "last_error", "TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, "opc_integration_accounts", "capabilities", "TEXT NOT NULL DEFAULT '{}'");
  ensureColumn(db, "development_scheduler_state", "last_auto_tick_at", "TEXT");
  ensureColumn(db, "development_goals", "metadata", "TEXT NOT NULL DEFAULT '{}'");
  backfillPlanItemsFromImportedTodos(db);
}

function ensureColumn(db: Db, table: string, column: string, definition: string) {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (rows.some((row) => row.name === column)) return;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

function ensureIndex(db: Db, table: string, indexName: string, columns: string) {
  const existing = db.prepare(`PRAGMA index_list(${table})`).all() as Array<{ name: string }>;
  if (existing.some((row) => row.name === indexName)) return;
  db.exec(`CREATE INDEX IF NOT EXISTS ${indexName} ON ${table} ${columns}`);
}

function backfillPlanItemsFromImportedTodos(db: Db) {
  const rows = db.prepare(`
    SELECT *
    FROM todos
    WHERE (
      tags LIKE '%五年规划%'
      OR tags LIKE '%年度工作计划%'
      OR notes LIKE '%五年规划（2026-2030）%'
      OR notes LIKE '%2026年工作计划%'
      OR notes LIKE '%年度工作计划20260522.xlsx%'
    )
    AND notes LIKE '%openclaw:import:%'
  `).all() as Array<Record<string, unknown>>;
  if (!rows.length) return;
  const insert = db.prepare(`
    INSERT OR IGNORE INTO plan_items (
      id, plan_type, import_key, import_hash, source_file, source_sheet, source_row,
      title, status, priority, due_at, agent_id, list_name, tags, raw_fields, field_order,
      todo_id, followed, sync_status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const row of rows) {
    const notes = String(row.notes || "");
    const tagsText = String(row.tags || "[]");
    const planType = tagsText.includes("年度工作计划") || notes.includes("年度工作计划20260522.xlsx") || notes.includes("2026年工作计划") ? "work" : "life";
    const importKey = extractPlanImportKey(notes, row.id);
    const rawFields = parsePlanRawFields(notes);
    const fieldOrder = Object.keys(rawFields);
    const source = parsePlanSource(notes);
    const importHash = String(notes.match(/openclaw:import_hash:([a-f0-9]+)/)?.[1] || hashText(JSON.stringify({ importKey, rawFields, title: row.title })));
    insert.run(
      randomUUID(),
      planType,
      importKey,
      importHash,
      source.file,
      source.sheet,
      source.row,
      String(row.title || "未命名计划"),
      String(row.status || "open"),
      String(row.priority || "P2"),
      row.due_at ? String(row.due_at) : null,
      row.agent_id ? String(row.agent_id) : "main",
      row.list_name ? String(row.list_name) : (planType === "work" ? "年度工作计划" : "五年规划"),
      tagsText || "[]",
      JSON.stringify(rawFields),
      JSON.stringify(fieldOrder),
      String(row.id || ""),
      0,
      "mirrored",
      String(row.created_at || nowIso()),
      String(row.updated_at || nowIso())
    );
  }
}

function extractPlanImportKey(notes: string, fallback: unknown) {
  const marker = notes.match(/openclaw:import:([^\n\r]+)/)?.[1]?.trim();
  return marker || `legacy-todo:${String(fallback || randomUUID())}`;
}

function parsePlanSource(notes: string) {
  const match = notes.match(/来源：(.+?)\s*\/\s*(.+?)\s*\/\s*第\s*(\d+)\s*行/);
  return {
    file: match?.[1]?.trim() || "",
    sheet: match?.[2]?.trim() || "",
    row: match?.[3] ? Number(match[3]) : null
  };
}

function parsePlanRawFields(notes: string) {
  const raw: Record<string, string> = {};
  const lines = notes.split(/\r?\n/);
  let currentKey = "";
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith("openclaw:")) break;
    if (trimmed.startsWith("来源：")) {
      raw["来源"] = trimmed.replace(/^来源：/, "").trim();
      continue;
    }
    const match = trimmed.match(/^([^：:]{2,24})[：:]\s*(.*)$/);
    if (match) {
      currentKey = match[1].trim();
      raw[currentKey] = [raw[currentKey], match[2].trim()].filter(Boolean).join("\n");
      continue;
    }
    if (currentKey) raw[currentKey] = [raw[currentKey], trimmed].filter(Boolean).join("\n");
  }
  return raw;
}

function hashText(input: string) {
  return createHash("sha256").update(input).digest("hex");
}

export function audit(db: Db, action: string, targetType: string, targetId: string | null, riskLevel: string, details: unknown) {
  db.prepare(
    "INSERT INTO audit_logs (ts, actor, action, target_type, target_id, risk_level, details) VALUES (?, ?, ?, ?, ?, ?, ?)"
  ).run(nowIso(), "owner", action, targetType, targetId, riskLevel, JSON.stringify(details ?? {}));
}

export function hasUser(db: Db) {
  return Boolean(db.prepare("SELECT id FROM users WHERE id = 1").get());
}

export function sessionExpiresAt() {
  const d = new Date();
  d.setDate(d.getDate() + SESSION_DAYS);
  return d.toISOString();
}
