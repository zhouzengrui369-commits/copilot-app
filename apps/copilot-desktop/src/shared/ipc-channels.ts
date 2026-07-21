/**
 * ipc-channels.ts — single source of truth for IPC channel names shared
 * by the main process (src/main/main.ts) and the preload bridge
 * (src/main/preload.ts). Renderer code never imports this; it gets the
 * names transitively through preload.
 *
 * Adding a new channel? Add it here, expose it through preload, and
 * register the handler in main.ts. Sprint 1.1 ships the settings
 * surface; Sprint 1.2 T-1.2.6 appends SETTINGS_SET_MODEL_API for the
 * multi-provider LLM config.
 */
export const IPC_CHANNELS = {
  SETTINGS_GET: 'copilot:settings:get',
  SETTINGS_SET_CLOUD_BACKUP: 'copilot:settings:set-cloud-backup',
  SETTINGS_SET_THEME: 'copilot:settings:set-theme',
  SETTINGS_SET_WINDOW_BOUNDS: 'copilot:settings:set-window-bounds',
  SETTINGS_SET_SHORTCUTS: 'copilot:settings:set-shortcuts',
  SETTINGS_SET_MODEL_API: 'copilot:settings:set-model-api',
  SETTINGS_RESET: 'copilot:settings:reset',
  BACKUP_GET_STATE: 'copilot:backup:get-state',
  BACKUP_PREPARE_ENABLE: 'copilot:backup:prepare-enable',
  BACKUP_ENABLE: 'copilot:backup:enable',
  BACKUP_DISABLE: 'copilot:backup:disable',
  BACKUP_CREATE: 'copilot:backup:create',
  BACKUP_UPLOAD: 'copilot:backup:upload',
  BACKUP_DOWNLOAD_VERIFY: 'copilot:backup:download-verify',
  BACKUP_RESTORE_PREVIEW: 'copilot:backup:restore-preview',
  BACKUP_RESTORE_APPLY: 'copilot:backup:restore-apply',
  BACKUP_DELETE: 'copilot:backup:delete',
  BACKUP_APPROVAL_REQUEST: 'copilot:backup:approval-request',
  BACKUP_APPROVAL_LIFECYCLE: 'copilot:backup:approval-lifecycle',
  BACKUP_APPROVAL_RESPOND: 'copilot:backup:approval-respond',
  REMOTE_GET_STATE: 'copilot:remote:get-state',
  REMOTE_ENABLE: 'copilot:remote:enable',
  REMOTE_DISABLE: 'copilot:remote:disable',
  REMOTE_IMPORT_PAIRING: 'copilot:remote:import-pairing',
  REMOTE_CREATE_PAIRING_REQUEST: 'copilot:remote:create-pairing-request',
  REMOTE_REVOKE_PAIRING: 'copilot:remote:revoke-pairing',
  REMOTE_APPROVAL_REQUEST: 'copilot:remote:approval-request',
  REMOTE_APPROVAL_LIFECYCLE: 'copilot:remote:approval-lifecycle',
  REMOTE_APPROVAL_RESPOND: 'copilot:remote:approval-respond',
  WINDOW_MINIMIZE: 'copilot:window:minimize',
  WINDOW_TOGGLE_MAXIMIZE: 'copilot:window:toggle-maximize',
  WINDOW_CLOSE: 'copilot:window:close',
  STARTUP_GET_MILESTONES: 'copilot:startup:get-milestones',
  STARTUP_APP_ROOT_VISIBLE: 'copilot:startup:app-root-visible',
  STARTUP_COMPLETE: 'copilot:startup:complete',
  NOTES_LIST: 'copilot:notes:list',
  NOTES_GET: 'copilot:notes:get',
  NOTES_CREATE: 'copilot:notes:create',
  NOTES_UPDATE: 'copilot:notes:update',
  NOTES_REMOVE: 'copilot:notes:remove',
  NOTES_GET_BACKLINKS: 'copilot:notes:get-backlinks',
  KG_GET_SUBGRAPH: 'copilot:kg:get-subgraph',
  KG_REINDEX_NOTE: 'copilot:kg:reindex-note',
  RAG_ASK: 'copilot:rag:ask',
  RAG_STREAM_START: 'copilot:rag:stream-start',
  RAG_STREAM_CANCEL: 'copilot:rag:stream-cancel',
  RAG_STREAM_EVENT: 'copilot:rag:stream-event',
  TODOS_LIST: 'copilot:todos:list',
  TODOS_CREATE: 'copilot:todos:create',
  TODOS_UPDATE: 'copilot:todos:update',
  TODOS_REMOVE: 'copilot:todos:remove',
  TODOS_LIST_DUE: 'copilot:todos:list-due',
  TODOS_MARK_REMINDER_FIRED: 'copilot:todos:mark-reminder-fired',
  TRASH_MOVE_NOTE: 'copilot:trash:move-note',
  TRASH_MOVE_TODO: 'copilot:trash:move-todo',
  TRASH_LIST: 'copilot:trash:list',
  TRASH_RESTORE: 'copilot:trash:restore',
  TRASH_PURGE: 'copilot:trash:purge',
} as const;

export type IpcChannel = (typeof IPC_CHANNELS)[keyof typeof IPC_CHANNELS];
