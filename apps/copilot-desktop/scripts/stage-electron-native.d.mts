export interface StagePathOptions {
  appPath?: string;
}

export interface StagePaths {
  appPath: string;
  executable: string;
  asarArchive: string;
  asarPackage: string;
  packagedBinary: string;
  sourcePackage: string;
  rootBinary: string;
}

export function resolveStagePaths(options?: StagePathOptions): StagePaths;

export function sha256(filePath: string): Promise<string>;

export function atomicStageBinary(source: string, destination: string): Promise<void>;

export function rebuildArgs(electronVersion: string, arch: string): string[];

export function validateSourceOutputPath(outputPath: string): string;

export function assertRootShaUnchanged(
  rootBinary: string,
  expectedSha: string,
): Promise<string>;

export function spawnFailureEvidence(result: {
  status: number | null;
  signal?: string | null;
  error?: Error & {
    code?: string;
    errno?: string | number;
    syscall?: string;
  };
}): {
  exitCode: number | null;
  signal: string | null;
  timedOut: boolean;
  error: {
    name: string;
    code: string | null;
    message: string;
    errno: string | number | null;
    syscall: string | null;
  } | null;
};
