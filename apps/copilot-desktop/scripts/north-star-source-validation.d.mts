export interface SharedReleaseIdentity {
  schemaVersion: 1;
  candidate: string;
  sourceHead: string;
  sourceSnapshotSha256: string;
}
export interface SevenDayWindow { start: string; end: string }
export function validateAndCollectTelemetrySource(input: {
  bytes: Buffer | Uint8Array;
  identity: SharedReleaseIdentity;
  window: SevenDayWindow;
}): { events: Record<string, any>[]; uniqueStartupSessions: number; operationEvents: number };
export function queryKbKgSources(input: {
  kbBytes: Buffer | Uint8Array; kgBytes: Buffer | Uint8Array; window: SevenDayWindow;
}): Promise<{ ns2Rows: Record<string, any>[]; kgNodes: Record<string, any>[] }>;
export function queryRagSource(input: {
  ragBytes: Buffer | Uint8Array; embeddingModel: string;
}): Promise<{ model: string; dimensions: number; chunks: Array<{ notePath: string; embedding: Float32Array; model: string }> }>;
