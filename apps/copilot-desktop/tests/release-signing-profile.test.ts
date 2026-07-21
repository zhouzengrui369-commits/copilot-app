import { generateKeyPairSync } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
// @ts-expect-error The production release helper is intentionally shipped as plain Node ESM.
import { createSigningEnvironment, createWindowsSigningEnvironment, parseSigningModeArgs, publicSigningProfile, resolveReleaseChildEnvironment, resolveSigningProfile } from '../scripts/release-signing-profile.mjs';

function resolveAppRoot(cwd = process.cwd()): string {
  const workspaceAppRoot = path.join(cwd, 'apps/copilot-desktop');
  return existsSync(workspaceAppRoot) ? workspaceAppRoot : cwd;
}

const appRoot = resolveAppRoot();
const createdPaths: string[] = [];

const trustRoot = path.join(appRoot, 'release', `signing-profile-trust-${process.pid}`);
const trustKeyPath = path.join(trustRoot, 'windows-runner-public.pem');
const trustKey = generateKeyPairSync('ed25519').publicKey;
const validDistributionEnv = {
  COPILOT_MAC_SIGN_IDENTITY: 'Developer ID Application: Example Corp (A1B2C3D4E5)',
  COPILOT_MAC_TEAM_ID: 'A1B2C3D4E5',
  COPILOT_NOTARY_KEYCHAIN_PROFILE: 'fixture-notary-profile-secret',
  WIN_CSC_LINK: 'fixture-pfx-link-secret',
  WIN_CSC_KEY_PASSWORD: ' fixture-pfx-password-secret ',
  COPILOT_WINDOWS_TIMESTAMP_URL: 'https://timestamp.example.test/rfc3161',
  COPILOT_WINDOWS_TRUST_PUBLIC_KEY_PATH: trustKeyPath,
  COPILOT_WINDOWS_TRUST_RUNNER_ID: 'windows-release-runner-01',
};
const validMacosDistributionEnv = {
  COPILOT_MAC_SIGN_IDENTITY: validDistributionEnv.COPILOT_MAC_SIGN_IDENTITY,
  COPILOT_MAC_TEAM_ID: validDistributionEnv.COPILOT_MAC_TEAM_ID,
  COPILOT_NOTARY_KEYCHAIN_PROFILE: validDistributionEnv.COPILOT_NOTARY_KEYCHAIN_PROFILE,
};

const fixtureSecretValues = [
  validDistributionEnv.COPILOT_MAC_SIGN_IDENTITY,
  validDistributionEnv.COPILOT_NOTARY_KEYCHAIN_PROFILE,
  validDistributionEnv.WIN_CSC_LINK,
  validDistributionEnv.WIN_CSC_KEY_PASSWORD,
  validDistributionEnv.COPILOT_WINDOWS_TIMESTAMP_URL,
];

const signingInputKeys = [
  'CSC_LINK',
  'CSC_KEY_PASSWORD',
  'CSC_NAME',
  'CSC_IDENTITY_AUTO_DISCOVERY',
  'WIN_CSC_LINK',
  'WIN_CSC_KEY_PASSWORD',
  'APPLE_ID',
  'APPLE_APP_SPECIFIC_PASSWORD',
  'APPLE_TEAM_ID',
  'COPILOT_MAC_SIGN_IDENTITY',
  'COPILOT_MAC_TEAM_ID',
  'COPILOT_NOTARY_KEYCHAIN_PROFILE',
  'COPILOT_WINDOWS_TIMESTAMP_URL',
  'COPILOT_WINDOWS_TRUST_PUBLIC_KEY_PATH',
  'COPILOT_WINDOWS_TRUST_RUNNER_ID',
] as const;

beforeAll(async () => {
  await mkdir(trustRoot, { recursive: true });
  await writeFile(trustKeyPath, trustKey.export({ type: 'spki', format: 'pem' }));
});

afterAll(async () => {
  await rm(trustRoot, { recursive: true, force: true });
});

afterEach(async () => {
  await Promise.all(createdPaths.splice(0).map((target) => rm(target, { recursive: true, force: true })));
});

describe('release signing profile', () => {
  it('defaults the CLI signing mode to unsigned and accepts explicit distribution mode', () => {
    expect(parseSigningModeArgs([])).toBe('unsigned');
    expect(parseSigningModeArgs(['--output', 'candidate'])).toBe('unsigned');
    expect(parseSigningModeArgs(['--signing-mode', 'unsigned'])).toBe('unsigned');
    expect(parseSigningModeArgs(['--signing-mode', 'distribution'])).toBe('distribution');
    expect(parseSigningModeArgs(['--signing-mode', 'macos-distribution'])).toBe('macos-distribution');
  });

  it('rejects an invalid CLI signing mode with the stable blocker code', () => {
    expect(() => parseSigningModeArgs(['--signing-mode', 'development'])).toThrow(
      expect.objectContaining({ code: 'BLOCKED_SIGNING_MODE_INVALID' }),
    );
  });

  it.each([
    [['--signing-mode'], 'missing value'],
    [['--signing-mode', 'unsigned', '--signing-mode', 'distribution'], 'duplicate flag'],
    [['--signing-mode=distribution'], 'equals syntax'],
  ])('rejects ambiguous CLI signing input: %s (%s)', (args) => {
    expect(() => parseSigningModeArgs(args)).toThrow(
      expect.objectContaining({ code: 'BLOCKED_SIGNING_MODE_INVALID' }),
    );
  });

  it('finds the signing mode independently of output and evidence argument ordering', () => {
    expect(parseSigningModeArgs([
      '--output', 'candidate',
      '--signing-mode', 'distribution',
      '--external-evidence', 'evidence.json',
    ])).toBe('distribution');
    expect(parseSigningModeArgs([
      '--external-evidence', 'evidence.json',
      '--signing-mode', 'unsigned',
      '--output', 'candidate',
    ])).toBe('unsigned');
  });

  it('removes every signing input from a polluted unsigned child environment', () => {
    const pollutedEnv = Object.fromEntries(signingInputKeys.map((key) => [key, `polluted-${key}`]));
    const profile = resolveSigningProfile({ mode: 'unsigned', env: pollutedEnv });
    const childEnv = createSigningEnvironment(profile, { ...pollutedEnv, SAFE_VALUE: 'preserved' });

    expect(profile).toEqual({ mode: 'unsigned' });
    expect(childEnv.SAFE_VALUE).toBe('preserved');
    expect(childEnv.CSC_IDENTITY_AUTO_DISCOVERY).toBe('false');
    for (const key of signingInputKeys) {
      if (key !== 'CSC_IDENTITY_AUTO_DISCOVERY') expect(childEnv).not.toHaveProperty(key);
    }
  });

  it('rejects unsupported profile modes', () => {
    expect(() => resolveSigningProfile({ mode: 'development', env: {} })).toThrow(
      expect.objectContaining({ code: 'BLOCKED_SIGNING_MODE_INVALID' }),
    );
  });

  it.each(['mac-distribution', 'macos_distribution', 'macos-distribute', 'MACOS-DISTRIBUTION'])(
    'rejects near-match macOS-only mode %s',
    (mode) => {
      expect(() => parseSigningModeArgs(['--signing-mode', mode])).toThrow(
        expect.objectContaining({ code: 'BLOCKED_SIGNING_MODE_INVALID' }),
      );
    },
  );

  it('resolves macos-distribution with only the three macOS inputs and never evaluates Windows inputs', () => {
    const profile = resolveSigningProfile({ mode: 'macos-distribution', env: validMacosDistributionEnv });
    expect(profile).toEqual({
      mode: 'macos-distribution',
      mac: {
        identity: validMacosDistributionEnv.COPILOT_MAC_SIGN_IDENTITY,
        teamId: validMacosDistributionEnv.COPILOT_MAC_TEAM_ID,
        notaryProfile: validMacosDistributionEnv.COPILOT_NOTARY_KEYCHAIN_PROFILE,
      },
    });
    const clean = createSigningEnvironment(profile, { ...validDistributionEnv, SAFE_VALUE: 'preserved' });
    expect(createWindowsSigningEnvironment(profile, clean, { osslSigncode: '/forbidden/osslsigncode' }))
      .toEqual(clean);
    for (const key of signingInputKeys) {
      if (key !== 'CSC_IDENTITY_AUTO_DISCOVERY') expect(clean).not.toHaveProperty(key);
    }
  });

  it.each([
    ['COPILOT_MAC_SIGN_IDENTITY', undefined, 'BLOCKED_MAC_DEVELOPER_ID_MISSING'],
    ['COPILOT_MAC_SIGN_IDENTITY', 'Apple Development: Example', 'BLOCKED_MAC_DEVELOPER_ID_MISSING'],
    ['COPILOT_MAC_TEAM_ID', undefined, 'BLOCKED_MAC_UNTRUSTED_IDENTITY'],
    ['COPILOT_MAC_TEAM_ID', 'short', 'BLOCKED_MAC_UNTRUSTED_IDENTITY'],
    ['COPILOT_NOTARY_KEYCHAIN_PROFILE', undefined, 'BLOCKED_MAC_NOTARY_CREDENTIALS_MISSING'],
  ])('rejects macos-distribution when %s is invalid', (key, replacement, expectedCode) => {
    const env: Record<string, string | undefined> = { ...validMacosDistributionEnv };
    env[key] = replacement;
    expect(() => resolveSigningProfile({ mode: 'macos-distribution', env })).toThrow(
      expect.objectContaining({ code: expectedCode }),
    );
  });

  it('serializes the exact non-secret macOS-only public profile', () => {
    const profile = resolveSigningProfile({ mode: 'macos-distribution', env: validMacosDistributionEnv });
    const publicProfile = publicSigningProfile(profile);
    expect(publicProfile).toEqual({
      mode: 'macos-distribution',
      platforms: ['darwin'],
      mac: {
        teamId: 'A1B2C3D4E5',
        identityType: 'Developer ID Application',
        notaryProfileConfigured: true,
      },
      windows: { status: 'OWNER_DEFERRED', phase: '1.1' },
    });
    expect(JSON.stringify(publicProfile)).not.toContain(validMacosDistributionEnv.COPILOT_NOTARY_KEYCHAIN_PROFILE);
    expect(JSON.stringify(publicProfile)).not.toContain(validMacosDistributionEnv.COPILOT_MAC_SIGN_IDENTITY);
  });

  it.each([
    ['missing Developer ID identity', 'COPILOT_MAC_SIGN_IDENTITY', undefined, 'BLOCKED_MAC_DEVELOPER_ID_MISSING'],
    ['invalid Developer ID identity', 'COPILOT_MAC_SIGN_IDENTITY', 'Apple Development: Example', 'BLOCKED_MAC_DEVELOPER_ID_MISSING'],
    ['missing Team ID', 'COPILOT_MAC_TEAM_ID', undefined, 'BLOCKED_MAC_UNTRUSTED_IDENTITY'],
    ['invalid Team ID', 'COPILOT_MAC_TEAM_ID', 'short', 'BLOCKED_MAC_UNTRUSTED_IDENTITY'],
    ['missing notary profile', 'COPILOT_NOTARY_KEYCHAIN_PROFILE', undefined, 'BLOCKED_MAC_NOTARY_CREDENTIALS_MISSING'],
    ['missing Windows certificate', 'WIN_CSC_LINK', undefined, 'BLOCKED_WINDOWS_SIGNING_CREDENTIALS_MISSING'],
    ['missing Windows password', 'WIN_CSC_KEY_PASSWORD', undefined, 'BLOCKED_WINDOWS_SIGNING_CREDENTIALS_MISSING'],
    ['missing timestamp URL', 'COPILOT_WINDOWS_TIMESTAMP_URL', undefined, 'BLOCKED_WINDOWS_SIGNING_CREDENTIALS_MISSING'],
    ['non-HTTPS timestamp URL', 'COPILOT_WINDOWS_TIMESTAMP_URL', 'http://timestamp.example.test', 'BLOCKED_WINDOWS_SIGNING_CREDENTIALS_MISSING'],
    ['credential-bearing timestamp URL', 'COPILOT_WINDOWS_TIMESTAMP_URL', 'https://fixture-user:fixture-password@timestamp.example.test/rfc3161', 'BLOCKED_WINDOWS_SIGNING_CREDENTIALS_MISSING'],
    ['timestamp URL with query', 'COPILOT_WINDOWS_TIMESTAMP_URL', 'https://timestamp.example.test/rfc3161?secret=fixture', 'BLOCKED_WINDOWS_SIGNING_CREDENTIALS_MISSING'],
    ['timestamp URL with fragment', 'COPILOT_WINDOWS_TIMESTAMP_URL', 'https://timestamp.example.test/rfc3161#fixture', 'BLOCKED_WINDOWS_SIGNING_CREDENTIALS_MISSING'],
    ['missing trust public key', 'COPILOT_WINDOWS_TRUST_PUBLIC_KEY_PATH', undefined, 'BLOCKED_WINDOWS_TRUST_ANCHOR_MISSING'],
    ['missing trust runner id', 'COPILOT_WINDOWS_TRUST_RUNNER_ID', undefined, 'BLOCKED_WINDOWS_TRUST_ANCHOR_MISSING'],
    ['unsafe trust runner id', 'COPILOT_WINDOWS_TRUST_RUNNER_ID', '../runner', 'BLOCKED_WINDOWS_TRUST_ANCHOR_INVALID'],
  ])('rejects distribution mode with %s', (_label, key, replacement, expectedCode) => {
    const env: Record<string, string | undefined> = { ...validDistributionEnv };
    env[key] = replacement;
    expect(() => resolveSigningProfile({ mode: 'distribution', env })).toThrow(
      expect.objectContaining({ code: expectedCode }),
    );
  });

  it('keeps distribution credentials only in the private profile and gives builders a zero-signing environment', () => {
    const profile = resolveSigningProfile({ mode: 'distribution', env: validDistributionEnv });
    const childEnv = createSigningEnvironment(profile, {
      ...validDistributionEnv,
      CSC_LINK: 'polluted-generic-link',
      CSC_KEY_PASSWORD: 'polluted-generic-password',
      APPLE_ID: 'polluted@example.test',
      SAFE_VALUE: 'preserved',
    });

    expect(profile.mode).toBe('distribution');
    expect(profile.windows.cscPassword).toBe(validDistributionEnv.WIN_CSC_KEY_PASSWORD);
    expect(profile.windows.timestampUrl).toBe(validDistributionEnv.COPILOT_WINDOWS_TIMESTAMP_URL);
    expect(childEnv).toMatchObject({
      SAFE_VALUE: 'preserved',
      CSC_IDENTITY_AUTO_DISCOVERY: 'false',
    });
    for (const key of signingInputKeys) {
      if (key !== 'CSC_IDENTITY_AUTO_DISCOVERY') expect(childEnv).not.toHaveProperty(key);
    }
    for (const secret of fixtureSecretValues) {
      expect(JSON.stringify(childEnv)).not.toContain(secret);
    }
  });

  it('restores only raw Windows signing credentials for the Windows builder branch', () => {
    const profile = resolveSigningProfile({ mode: 'distribution', env: validDistributionEnv });
    const generic = createSigningEnvironment(profile, {
      ...validDistributionEnv,
      CSC_LINK: 'polluted-link',
      CSC_KEY_PASSWORD: 'polluted-password',
      SAFE_VALUE: 'preserved',
    });
    const windows = createWindowsSigningEnvironment(profile, generic);

    expect(windows).toMatchObject({
      SAFE_VALUE: 'preserved',
      CSC_IDENTITY_AUTO_DISCOVERY: 'false',
      WIN_CSC_LINK: validDistributionEnv.WIN_CSC_LINK,
      WIN_CSC_KEY_PASSWORD: validDistributionEnv.WIN_CSC_KEY_PASSWORD,
    });
    expect(windows).not.toHaveProperty('CSC_LINK');
    expect(windows).not.toHaveProperty('CSC_KEY_PASSWORD');
    expect(windows).not.toHaveProperty('COPILOT_WINDOWS_TRUST_PUBLIC_KEY_PATH');
    expect(windows).not.toHaveProperty('COPILOT_WINDOWS_TRUST_RUNNER_ID');
  });

  it('keeps unsigned Windows builders credential-free', () => {
    const profile = resolveSigningProfile({ mode: 'unsigned', env: validDistributionEnv });
    const generic = createSigningEnvironment(profile, validDistributionEnv);
    expect(createWindowsSigningEnvironment(profile, generic)).toEqual(generic);
  });

  it('routes all canonical children through a clean environment and scopes raw credentials to Windows builders', () => {
    const resolveChildEnvironment = resolveReleaseChildEnvironment;
    expect(resolveChildEnvironment).toBeTypeOf('function');

    const cleanEnvironment = {
      SAFE_VALUE: 'preserved',
      CSC_IDENTITY_AUTO_DISCOVERY: 'false',
      WIN_CSC_LINK: 'must-not-leak-from-clean-input',
      WIN_CSC_KEY_PASSWORD: 'must-not-leak-from-clean-input',
    };
    const windowsEnvironment = {
      SAFE_VALUE: 'preserved',
      CSC_IDENTITY_AUTO_DISCOVERY: 'false',
      WIN_CSC_LINK: '/private/fixture-signing.pfx',
      WIN_CSC_KEY_PASSWORD: 'fixture-password',
    };
    expect(resolveChildEnvironment({
      scope: 'default', cleanEnvironment, windowsBuilderEnvironment: windowsEnvironment,
      overrides: { ELECTRON_RUN_AS_NODE: '1' },
    })).toEqual({
      SAFE_VALUE: 'preserved', CSC_IDENTITY_AUTO_DISCOVERY: 'false', ELECTRON_RUN_AS_NODE: '1',
    });
    expect(resolveChildEnvironment({
      scope: 'windows-electron-builder', cleanEnvironment, windowsBuilderEnvironment: windowsEnvironment,
    })).toEqual(windowsEnvironment);
    expect(() => resolveChildEnvironment({
      scope: 'untrusted-scope', cleanEnvironment, windowsBuilderEnvironment: windowsEnvironment,
    })).toThrow(expect.objectContaining({ code: 'BLOCKED_SIGNING_CHILD_ENVIRONMENT_INVALID' }));
  });

  it('uses the clean environment selector at the only spawn boundary and opts in exactly two Windows builder calls', async () => {
    const canonicalSource = await readFile(path.join(appRoot, 'scripts/build-canonical-release.mjs'), 'utf8');
    expect(canonicalSource.match(/spawnSync\(/g)).toHaveLength(1);
    expect(canonicalSource).toContain('resolveReleaseChildEnvironment({');
    expect(canonicalSource).not.toContain('env: opts.env ?? process.env');
    expect(canonicalSource).not.toContain('env: { ...process.env');
    expect(canonicalSource.match(/childEnvironment: signingProfile\.mode === 'distribution'/g)).toHaveLength(2);
  });

  it('anchors the PM Ed25519 runner in the canonical manifest and blocks distribution before gates when absent', async () => {
    const canonicalSource = await readFile(path.join(appRoot, 'scripts/build-canonical-release.mjs'), 'utf8');
    expect(canonicalSource).toContain('COPILOT_PM_RUNNER_ID');
    expect(canonicalSource).toContain('COPILOT_PM_PUBLIC_KEY_SPKI_BASE64');
    expect(canonicalSource).toContain('COPILOT_PM_PUBLIC_KEY_FINGERPRINT_SHA256');
    expect(canonicalSource).toContain('if (distributionGrade && !pmRunnerConfiguration.anchor)');
    expect(canonicalSource).toContain("code: 'BLOCKED_PM_REPLAY_TRUST_ANCHOR'");
    expect(canonicalSource.indexOf("code: 'BLOCKED_PM_REPLAY_TRUST_ANCHOR'"))
      .toBeLessThan(canonicalSource.indexOf('await runGates();'));
    expect(canonicalSource).toContain('pmRunner: pmRunnerConfiguration.anchor');
  });

  it('keeps macos-distribution on the existing hardened mac branch and outside every Windows build/sign branch', async () => {
    const canonicalSource = await readFile(path.join(appRoot, 'scripts/build-canonical-release.mjs'), 'utf8');
    expect(canonicalSource).toContain("signingProfile.mode === 'macos-distribution' ? 4 : 8");
    expect(canonicalSource).toContain("if (signingProfile.mode !== 'macos-distribution') {\n      for (const arch of ['x64', 'arm64'])");
    expect(canonicalSource).toContain("const distributionVerification = distributionGrade");
    expect(canonicalSource).toContain("mode: 'distribution'");
    expect(canonicalSource).toContain('releaseMode: signingProfile.mode');
    expect(canonicalSource).toContain('releaseMode: manifest.releaseMode');
    expect(canonicalSource).toContain('Windows is OWNER_DEFERRED to Phase 1.1');
    expect(canonicalSource).toContain("const osslSigncode = signingProfile.mode === 'distribution'");
    expect(canonicalSource).toContain("const windowsBuilderEnvironment = signingProfile.mode === 'distribution'");
    expect(canonicalSource.match(/childEnvironment: signingProfile\.mode === 'distribution'/g)).toHaveLength(2);
  });

  it('serializes only a redacted public distribution profile', () => {
    const profile = resolveSigningProfile({ mode: 'distribution', env: validDistributionEnv });
    const publicProfile = publicSigningProfile(profile);
    const serialized = JSON.stringify(publicProfile);

    expect(publicProfile).toEqual({
      mode: 'distribution',
      mac: {
        teamId: 'A1B2C3D4E5',
        identityType: 'Developer ID Application',
        notaryProfileConfigured: true,
      },
      windows: {
        certificateConfigured: true,
        timestampConfigured: true,
        trustAnchorConfigured: true,
        runnerId: 'windows-release-runner-01',
        publicKeySha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      },
    });
    for (const secret of fixtureSecretValues) {
      expect(serialized).not.toContain(secret);
    }
  });

  it('never echoes a credential-bearing timestamp URL in its validation error', () => {
    const credentialUrl = 'https://fixture-user:fixture-password@timestamp.example.test/rfc3161';
    let caught: unknown;
    try {
      resolveSigningProfile({
        mode: 'distribution',
        env: { ...validDistributionEnv, COPILOT_WINDOWS_TIMESTAMP_URL: credentialUrl },
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toEqual(expect.objectContaining({ code: 'BLOCKED_WINDOWS_SIGNING_CREDENTIALS_MISSING' }));
    expect(JSON.stringify(caught, Object.getOwnPropertyNames(caught as object))).not.toContain(credentialUrl);
    expect(String(caught)).not.toContain('fixture-user');
    expect(String(caught)).not.toContain('fixture-password');
  });

  it('fails a distribution build before creating the requested candidate directory', () => {
    const candidate = path.join(
      appRoot,
      'release',
      `signing-profile-early-failure-${process.pid}-${Date.now()}`,
    );
    createdPaths.push(candidate);
    const cleanEnv: NodeJS.ProcessEnv = { ...process.env, ...validDistributionEnv };
    for (const key of signingInputKeys) delete cleanEnv[key];
    Object.assign(cleanEnv, validDistributionEnv);
    delete cleanEnv.COPILOT_MAC_SIGN_IDENTITY;

    const result = spawnSync(
      process.execPath,
      [
        path.join(appRoot, 'scripts/build-canonical-release.mjs'),
        '--signing-mode',
        'distribution',
        '--output',
        candidate,
      ],
      { cwd: appRoot, env: cleanEnv, encoding: 'utf8' },
    );

    expect(result.status).not.toBe(0);
    const processOutput = `${result.stdout}\n${result.stderr}`;
    expect(processOutput).toContain('BLOCKED_MAC_DEVELOPER_ID_MISSING');
    for (const secret of fixtureSecretValues.slice(1)) {
      expect(processOutput).not.toContain(secret);
    }
    expect(existsSync(candidate)).toBe(false);
  });
});
