import { realpath } from 'node:fs/promises';

export interface CanonicalElectronUserDataPaths {
  expected: string;
  actual: string;
}

export async function canonicalizeElectronUserDataPaths(
  expectedPath: string,
  actualPath: string,
): Promise<CanonicalElectronUserDataPaths> {
  try {
    const [expected, actual] = await Promise.all([
      realpath(expectedPath),
      realpath(actualPath),
    ]);
    return { expected, actual };
  } catch (error) {
    const cause = error instanceof Error ? error.message : String(error);
    throw new Error(
      `BLOCKED_ELECTRON_USER_DATA_REALPATH_FAILED: ${JSON.stringify({ expectedPath, actualPath, cause })}`,
    );
  }
}
