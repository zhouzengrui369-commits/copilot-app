export interface PrivateReplayPublished<T = unknown> {
  path: string;
  sha256: string;
  bytes: number;
  document?: T;
}

export interface PmReplayAttestationInput {
  bundleManifestPath: string;
  outputPath: string;
  replayedAt: string;
  sourcePaths: Record<'telemetry' | 'kb' | 'kg' | 'rag' | 'questionSet' | 'ownerAcceptance', string>;
  embeddingBaseUrl?: string;
  embeddingModel?: string;
  fetchImpl?: (input: string, init?: Record<string, any>) => Promise<any>;
  timeoutMs?: number;
  runnerId?: string;
  privateKeyPath?: string;
  candidateRoot?: string;
}

export function canonicalizePrivateSourceId(value: string): string;
export function hashPrivateId(salt: Buffer, domain: string, value: string): string;
export function createPrivateReplayBundle(input: Record<string, any>): Promise<PrivateReplayPublished>;
export function createPmReplayAttestation(input: PmReplayAttestationInput): Promise<PrivateReplayPublished<any>>;
export function validatePrivateReplayEvidenceSet(input: Record<string, any>): {
  errors: string[];
  documents?: Record<string, any>;
  results?: Record<string, any> | null;
};
export function validatePmReplayAttestation(document: unknown, binding?: Record<string, any>): string[];
export function pmAttestationCanonicalPayload(document: Record<string, any>): Buffer;
export function validatePmRunnerAnchor(value: unknown): {
  runnerId: string;
  publicKeySpki: string;
  publicKeyFingerprintSha256: string;
};
export function readPmTrustAnchorFile(
  filePath: string,
  candidateRoot: string,
  hooks?: { afterFirstRead?: () => void | Promise<void> },
): Promise<{
  runnerId: string;
  publicKeySpki: string;
  publicKeyFingerprintSha256: string;
}>;
export function resolvePmTrustAnchorForFinalization(input: {
  trustAnchorPath?: string;
  candidateRoot: string;
  manifestAnchor: unknown;
  distribution: boolean;
}): Promise<{
  runnerId: string;
  publicKeySpki: string;
  publicKeyFingerprintSha256: string;
} | null>;
export function assertPrivateReplayAbsent(candidateRoot: string): Promise<void>;
