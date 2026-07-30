import { createHash, createPublicKey } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const SIGNING_MODES = new Set(['unsigned', 'distribution', 'macos-distribution']);

const SIGNING_INPUT_KEYS = [
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
  'COPILOT_WINDOWS_OSSLSIGNCODE',
  'COPILOT_WINDOWS_TRUST_PUBLIC_KEY_PATH',
  'COPILOT_WINDOWS_TRUST_RUNNER_ID',
];

export function parseSigningModeArgs(args = []) {
  let mode = 'unsigned';
  let found = false;
  for (let index = 0; index < args.length; index += 1) {
    if (args[index].startsWith('--signing-mode=')) {
      throw blocked(
        'BLOCKED_SIGNING_MODE_INVALID',
        'Use --signing-mode followed by unsigned, distribution, or macos-distribution',
      );
    }
    if (args[index] !== '--signing-mode') continue;
    if (found) {
      throw blocked('BLOCKED_SIGNING_MODE_INVALID', 'Signing mode may be provided only once');
    }
    found = true;
    const value = args[index + 1];
    if (!value || value.startsWith('--')) {
      throw blocked('BLOCKED_SIGNING_MODE_INVALID', 'A signing mode value is required');
    }
    mode = value;
    index += 1;
  }
  return validatedMode(mode);
}

export function resolveSigningProfile({ mode = 'unsigned', env = {} } = {}) {
  const validated = validatedMode(mode);
  if (validated === 'unsigned') return { mode: 'unsigned' };

  const identity = nonempty(env.COPILOT_MAC_SIGN_IDENTITY);
  if (!identity?.startsWith('Developer ID Application: ')) {
    throw blocked(
      'BLOCKED_MAC_DEVELOPER_ID_MISSING',
      'A Developer ID Application identity is required',
    );
  }

  const teamId = nonempty(env.COPILOT_MAC_TEAM_ID);
  if (!/^[A-Z0-9]{10}$/.test(teamId ?? '')) {
    throw blocked(
      'BLOCKED_MAC_UNTRUSTED_IDENTITY',
      'A 10-character Apple Team ID is required',
    );
  }

  const notaryProfile = nonempty(env.COPILOT_NOTARY_KEYCHAIN_PROFILE);
  if (!notaryProfile) {
    throw blocked(
      'BLOCKED_MAC_NOTARY_CREDENTIALS_MISSING',
      'A notarytool Keychain profile is required',
    );
  }

  if (validated === 'macos-distribution') {
    return {
      mode: 'macos-distribution',
      mac: { identity, teamId, notaryProfile },
    };
  }

  const cscLink = nonempty(env.WIN_CSC_LINK);
  const cscPassword = nonempty(env.WIN_CSC_KEY_PASSWORD);
  if (!cscLink || !cscPassword) {
    throw blocked(
      'BLOCKED_WINDOWS_SIGNING_CREDENTIALS_MISSING',
      'Windows PFX credentials are required',
    );
  }

  const timestampUrl = nonempty(env.COPILOT_WINDOWS_TIMESTAMP_URL);
  if (!isHttpsUrl(timestampUrl)) {
    throw blocked(
      'BLOCKED_WINDOWS_SIGNING_CREDENTIALS_MISSING',
      'An HTTPS timestamp URL is required',
    );
  }

  const trustPublicKeyPath = nonempty(env.COPILOT_WINDOWS_TRUST_PUBLIC_KEY_PATH);
  const runnerId = nonempty(env.COPILOT_WINDOWS_TRUST_RUNNER_ID);
  if (!trustPublicKeyPath || !runnerId) {
    throw blocked(
      'BLOCKED_WINDOWS_TRUST_ANCHOR_MISSING',
      'An absolute Ed25519 trust public key path and runner ID are required',
    );
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(runnerId)) {
    throw blocked('BLOCKED_WINDOWS_TRUST_ANCHOR_INVALID', 'Windows trust runner ID is invalid');
  }
  const trust = loadWindowsTrustAnchor(trustPublicKeyPath, runnerId);

  return {
    mode: 'distribution',
    mac: { identity, teamId, notaryProfile },
    windows: { cscLink, cscPassword, timestampUrl, trust },
  };
}

/**
 * Task 1 intentionally gives every electron-builder child a zero-signing
 * environment. Distribution credentials remain only in the private profile;
 * the later platform-signing task owns any narrowly scoped credential use.
 */
export function createSigningEnvironment(_profile, env = {}) {
  const clean = { ...env };
  for (const key of SIGNING_INPUT_KEYS) delete clean[key];
  return {
    ...clean,
    CSC_IDENTITY_AUTO_DISCOVERY: 'false',
  };
}

/** Restore the PFX inputs only for electron-builder Windows signing calls. */
export function createWindowsSigningEnvironment(profile, env = {}, { osslSigncode } = {}) {
  const clean = createSigningEnvironment(profile, env);
  if (profile?.mode !== 'distribution') return clean;
  return {
    ...clean,
    WIN_CSC_LINK: profile.windows.cscLink,
    WIN_CSC_KEY_PASSWORD: profile.windows.cscPassword,
    COPILOT_WINDOWS_TIMESTAMP_URL: profile.windows.timestampUrl,
    COPILOT_WINDOWS_OSSLSIGNCODE: osslSigncode,
  };
}

/** Select the environment at the single canonical subprocess boundary. */
export function resolveReleaseChildEnvironment({
  scope = 'default',
  cleanEnvironment = {},
  windowsBuilderEnvironment = {},
  overrides = {},
} = {}) {
  if (scope !== 'default' && scope !== 'windows-electron-builder') {
    throw blocked(
      'BLOCKED_SIGNING_CHILD_ENVIRONMENT_INVALID',
      'Canonical child environment scope is invalid',
    );
  }
  const clean = createSigningEnvironment(undefined, { ...cleanEnvironment, ...overrides });
  if (scope === 'default') return clean;
  const windows = { ...clean };
  for (const key of [
    'WIN_CSC_LINK',
    'WIN_CSC_KEY_PASSWORD',
    'COPILOT_WINDOWS_TIMESTAMP_URL',
    'COPILOT_WINDOWS_OSSLSIGNCODE',
  ]) {
    if (typeof windowsBuilderEnvironment[key] === 'string' && windowsBuilderEnvironment[key]) {
      windows[key] = windowsBuilderEnvironment[key];
    }
  }
  return windows;
}

export function publicSigningProfile(profile) {
  if (profile.mode === 'unsigned') return { mode: 'unsigned' };
  if (profile.mode === 'macos-distribution') {
    return {
      mode: 'macos-distribution',
      platforms: ['darwin'],
      mac: {
        teamId: profile.mac.teamId,
        identityType: 'Developer ID Application',
        notaryProfileConfigured: true,
      },
      windows: {
        status: 'OWNER_DEFERRED',
        phase: '1.1',
      },
    };
  }
  return {
    mode: 'distribution',
    mac: {
      teamId: profile.mac.teamId,
      identityType: 'Developer ID Application',
      notaryProfileConfigured: true,
    },
    windows: {
      certificateConfigured: true,
      timestampConfigured: true,
      trustAnchorConfigured: true,
      runnerId: profile.windows.trust.runnerId,
      publicKeySha256: profile.windows.trust.publicKeySha256,
    },
  };
}

function loadWindowsTrustAnchor(keyPath, runnerId) {
  if (!path.isAbsolute(keyPath)) {
    throw blocked('BLOCKED_WINDOWS_TRUST_ANCHOR_INVALID', 'Windows trust key path must be absolute');
  }
  try {
    if (!statSync(keyPath).isFile()) throw new Error('not a regular file');
    const key = createPublicKey(readFileSync(keyPath));
    if (key.asymmetricKeyType !== 'ed25519') throw new Error('not Ed25519');
    const publicKeyPem = key.export({ type: 'spki', format: 'pem' }).toString();
    const publicKeySha256 = createHash('sha256')
      .update(key.export({ type: 'spki', format: 'der' }))
      .digest('hex');
    return { publicKeyPem, publicKeySha256, runnerId };
  } catch {
    throw blocked(
      'BLOCKED_WINDOWS_TRUST_ANCHOR_INVALID',
      'Windows trust key must be an existing Ed25519 SPKI PEM file',
    );
  }
}

function validatedMode(mode) {
  if (!SIGNING_MODES.has(mode)) {
    throw blocked('BLOCKED_SIGNING_MODE_INVALID', `Unsupported signing mode: ${String(mode)}`);
  }
  return mode;
}

function nonempty(value) {
  if (typeof value !== 'string') return undefined;
  return value.trim() ? value : undefined;
}

function isHttpsUrl(value) {
  if (!value) return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:'
      && Boolean(parsed.hostname)
      && !parsed.username
      && !parsed.password
      && !parsed.search
      && !parsed.hash;
  } catch {
    return false;
  }
}

function blocked(code, message) {
  return Object.assign(new Error(`${code}: ${message}`), { code });
}
