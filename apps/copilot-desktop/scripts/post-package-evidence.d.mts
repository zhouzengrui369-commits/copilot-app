export interface PostPackageArtifact {
  relativePath: string;
  sha256: string;
  signing: string;
}

export interface PostPackageEvidenceContext {
  evidencePath?: string;
  candidate: string;
  source: { head: string; snapshot: { sha256: string } };
  artifacts: PostPackageArtifact[];
  northStar?: {
    runnerSha256: string;
    pmRunner?: {
      runnerId: string;
      publicKeySpki: string;
      publicKeyFingerprintSha256: string;
    };
  };
}

export interface PostPackageEvidenceResult {
  status: 'PASS' | 'BLOCKED';
  evidenceFile: { path: string; sha256: string | null } | null;
  binding: Record<string, unknown>;
  gates: Array<Record<string, unknown>>;
  blockers: Array<{ code: string; message: string }>;
}

export function evaluatePostPackageEvidence(
  context: PostPackageEvidenceContext,
): Promise<PostPackageEvidenceResult>;
