/** Capabilities that must stay truthful until a production adapter exists. */
export const CLOUD_BACKUP_CAPABILITY = Object.freeze({
  available: false,
  mode: 'metadata-only' as const,
  reason: 'metadata-only backup adapter is not connected',
});
