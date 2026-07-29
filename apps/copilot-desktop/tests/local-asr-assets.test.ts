import { randomUUID } from 'node:crypto';
import {
  appendFile,
  copyFile,
  cp,
  link,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { LocalAsrError } from '../src/shared/local-asr';
import {
  LOCAL_ASR_BUNDLE_MANIFEST,
  LOCAL_ASR_BUNDLE_MANIFEST_SHA256,
  parseLocalAsrManifest,
  verifyLocalAsrAssets,
} from '../src/main/local-asr-assets';

const stagedRoot = path.resolve(process.cwd(), 'resources/local-asr');
const temporaryParents = new Set<string>();

afterEach(async () => {
  await Promise.all(
    [...temporaryParents].map((entry) => rm(entry, { recursive: true, force: true })),
  );
  temporaryParents.clear();
});

describe('local ASR pinned asset verifier', () => {
  it('accepts the current staged 14-file single-link bundle', async () => {
    const verified = await verifyLocalAsrAssets(stagedRoot);
    expect(verified).toMatchObject({
      root: path.resolve(stagedRoot),
      fileCount: 14,
      coveredBytes: 46_632_117,
    });
    expect(verified.manifestPath).toBe(path.join(stagedRoot, LOCAL_ASR_BUNDLE_MANIFEST));
    expect(verified.noEgressPreloadPath).toBe(
      path.join(stagedRoot, 'runtime/local-asr-no-egress-preload.cjs'),
    );
    const manifestBytes = await readFile(verified.manifestPath);
    const { createHash } = await import('node:crypto');
    expect(createHash('sha256').update(manifestBytes).digest('hex')).toBe(
      LOCAL_ASR_BUNDLE_MANIFEST_SHA256,
    );
  });

  it('fails closed for missing roots and a modified pinned manifest', async () => {
    await expect(
      verifyLocalAsrAssets(path.join(tmpdir(), `missing-${randomUUID()}`)),
    ).rejects.toMatchObject({ code: 'ASSETS_UNAVAILABLE' });

    const root = await copyStagedBundle();
    await appendFile(path.join(root, LOCAL_ASR_BUNDLE_MANIFEST), '\n');
    await expect(verifyLocalAsrAssets(root)).rejects.toMatchObject({
      code: 'ASSETS_TAMPERED',
    });
  });

  it('rejects target tamper and any extra file or empty directory', async () => {
    const tampered = await copyStagedBundle();
    await appendFile(path.join(tampered, 'THIRD-PARTY-NOTICES.md'), 'tamper');
    await expect(verifyLocalAsrAssets(tampered)).rejects.toMatchObject({
      code: 'ASSETS_TAMPERED',
    });

    const withExtra = await copyStagedBundle();
    await writeFile(path.join(withExtra, 'unexpected.bin'), Buffer.from([1]));
    await expect(verifyLocalAsrAssets(withExtra)).rejects.toMatchObject({
      code: 'ASSETS_TAMPERED',
    });

    const withExtraDirectory = await copyStagedBundle();
    await mkdir(path.join(withExtraDirectory, 'unexpected-empty'));
    await expect(verifyLocalAsrAssets(withExtraDirectory)).rejects.toMatchObject({
      code: 'ASSETS_TAMPERED',
    });
  });

  it('rejects symlink and hardlink substitutions without following them', async () => {
    const symlinked = await copyStagedBundle();
    const symlinkPath = path.join(symlinked, 'THIRD-PARTY-NOTICES.md');
    const symlinkTarget = path.join(path.dirname(symlinked), 'outside-notice.md');
    await copyFile(symlinkPath, symlinkTarget);
    await unlink(symlinkPath);
    await symlink(symlinkTarget, symlinkPath);
    await expect(verifyLocalAsrAssets(symlinked)).rejects.toMatchObject({
      code: 'ASSETS_TAMPERED',
    });

    const hardlinked = await copyStagedBundle();
    const hardlinkPath = path.join(hardlinked, 'THIRD-PARTY-NOTICES.md');
    const hardlinkSource = path.join(path.dirname(hardlinked), 'outside-hardlink.md');
    await copyFile(hardlinkPath, hardlinkSource);
    await unlink(hardlinkPath);
    await link(hardlinkSource, hardlinkPath);
    expect((await lstat(hardlinkPath)).nlink).toBe(2);
    await expect(verifyLocalAsrAssets(hardlinked)).rejects.toMatchObject({
      code: 'ASSETS_TAMPERED',
    });
  });

  it.each([
    ['/absolute.bin', 'absolute'],
    ['../escape.bin', 'traversal'],
    ['model/../escape.bin', 'normalized traversal'],
    ['model\\escape.bin', 'backslash'],
    [LOCAL_ASR_BUNDLE_MANIFEST, 'self listing'],
  ])('rejects unsafe manifest path class %s (%s)', (unsafePath) => {
    const manifest = validManifestObject();
    manifest.files[0] = { ...manifest.files[0], path: unsafePath };
    expectTampered(() => parseLocalAsrManifest(JSON.stringify(manifest)));
  });

  it('rejects duplicate, malformed, non-canonical hash, and non-integer entries', () => {
    const duplicate = validManifestObject();
    duplicate.files.push({ ...duplicate.files[0] });
    expectTampered(() => parseLocalAsrManifest(JSON.stringify(duplicate)));

    expectTampered(() => parseLocalAsrManifest('{'));

    const badHash = validManifestObject();
    badHash.files[0] = { ...badHash.files[0], sha256: 'A'.repeat(64) };
    expectTampered(() => parseLocalAsrManifest(JSON.stringify(badHash)));

    const badBytes = validManifestObject();
    badBytes.files[0] = { ...badBytes.files[0], bytes: 1.5 };
    expectTampered(() => parseLocalAsrManifest(JSON.stringify(badBytes)));
  });
});

async function copyStagedBundle(): Promise<string> {
  const parent = await mkdtemp(path.join(tmpdir(), 'copilot-local-asr-assets-'));
  temporaryParents.add(parent);
  const target = path.join(parent, 'bundle');
  await cp(stagedRoot, target, { recursive: true });
  return target;
}

function validManifestObject(): {
  files: Array<{ path: string; bytes: number; sha256: string }>;
} {
  return {
    files: [{
      path: 'runtime/example.js',
      bytes: 1,
      sha256: '0'.repeat(64),
    }],
  };
}

function expectTampered(action: () => unknown): void {
  try {
    action();
    throw new Error('expected manifest parser to reject');
  } catch (error) {
    expect(error).toBeInstanceOf(LocalAsrError);
    expect(error).toMatchObject({ code: 'ASSETS_TAMPERED' });
  }
}
