import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
// @ts-expect-error Production release helpers are intentionally plain Node ESM.
import {
  createSigningEnvironment,
  isDistributionSigningMode,
  isMacOnlySigningMode,
  parseSigningModeArgs,
  publicSigningProfile,
  resolveSigningProfile,
} from '../scripts/release-signing-profile.mjs';

function resolveAppRoot(cwd = process.cwd()): string {
  const workspaceAppRoot = path.join(cwd, 'apps/copilot-desktop');
  return existsSync(workspaceAppRoot) ? workspaceAppRoot : cwd;
}

const appRoot = resolveAppRoot();
const pollutedEnv = {
  COPILOT_MAC_SIGN_IDENTITY: 'Developer ID Application: Fixture (A1B2C3D4E5)',
  COPILOT_MAC_TEAM_ID: 'A1B2C3D4E5',
  COPILOT_NOTARY_KEYCHAIN_PROFILE: 'fixture-notary-secret',
  WIN_CSC_LINK: 'fixture-windows-link',
  WIN_CSC_KEY_PASSWORD: 'fixture-windows-password',
  SAFE_VALUE: 'preserved',
};

describe('macOS-only unsigned canonical profile', () => {
  it('parses and classifies macos-unsigned without treating it as distribution', () => {
    expect(parseSigningModeArgs(['--signing-mode', 'macos-unsigned'])).toBe('macos-unsigned');
    expect(isMacOnlySigningMode('macos-unsigned')).toBe(true);
    expect(isMacOnlySigningMode('macos-distribution')).toBe(true);
    expect(isMacOnlySigningMode('unsigned')).toBe(false);
    expect(isDistributionSigningMode('macos-unsigned')).toBe(false);
    expect(isDistributionSigningMode('macos-distribution')).toBe(true);
    expect(isDistributionSigningMode('distribution')).toBe(true);
  });

  it('requires no signing credential and serializes only non-secret owner-deferred truth', () => {
    const profile = resolveSigningProfile({ mode: 'macos-unsigned', env: pollutedEnv });
    expect(profile).toEqual({ mode: 'macos-unsigned' });
    expect(publicSigningProfile(profile)).toEqual({
      mode: 'macos-unsigned',
      platforms: ['darwin'],
      mac: { signing: 'unsigned' },
      windows: { status: 'OWNER_DEFERRED', phase: '1.1' },
    });

    const child = createSigningEnvironment(profile, pollutedEnv);
    expect(child.SAFE_VALUE).toBe('preserved');
    expect(child.CSC_IDENTITY_AUTO_DISCOVERY).toBe('false');
    expect(child).not.toHaveProperty('COPILOT_MAC_SIGN_IDENTITY');
    expect(child).not.toHaveProperty('COPILOT_NOTARY_KEYCHAIN_PROFILE');
    expect(child).not.toHaveProperty('WIN_CSC_LINK');
    expect(child).not.toHaveProperty('WIN_CSC_KEY_PASSWORD');
  });

  it('keeps the canonical builder mac-only branch explicit and Windows-free', async () => {
    const source = await readFile(path.join(appRoot, 'scripts/build-canonical-release.mjs'), 'utf8');
    expect(source).toContain('isMacOnlySigningMode');
    expect(source).toContain('isDistributionSigningMode');
    expect(source).toContain('const macOnly = isMacOnlySigningMode(signingProfile.mode)');
    expect(source).toContain('const distributionGrade = isDistributionSigningMode(signingProfile.mode)');
    expect(source).toContain('if (!macOnly)');
    expect(source).toContain('requiredArtifacts: macOnly ? 4 : 8');
  });
});
