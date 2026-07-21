import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';
// @ts-expect-error The production release helper is intentionally shipped as plain Node ESM.
import { assertMacSigningReportBinding, buildMacSigningReport, createMacDmgDistributionPlan, createMacDistributionPlan, executeMacAppDistributionSigning, executeMacDmgDistribution, formatRedactedCommandLog, parseCertificateDetails, parseCodesignDetails, parseEntitlementsEvidence, parseNotarytoolJson, publishSigningReportCrashSafe, validateMacDistributionPlan, verifyCanonicalCompletionIntegrity } from '../scripts/release-macos-signing.mjs';

function resolveAppRoot(cwd = process.cwd()): string {
  const workspaceAppRoot = path.join(cwd, 'apps/copilot-desktop');
  return existsSync(workspaceAppRoot) ? workspaceAppRoot : cwd;
}

const appRoot = resolveAppRoot();
const identity = 'Developer ID Application: NJX Software (A1B2C3D4E5)';
const teamId = 'A1B2C3D4E5';
const secretProfile = 'fixture-notary-profile-secret';
const now = new Date('2026-07-11T12:00:00Z');

const codesignDetails = `Executable=/tmp/NJX.app/Contents/MacOS/NJX
Identifier=ai.njx.copilot.v6
Format=app bundle with Mach-O thin (arm64)
CodeDirectory v=20500 size=672 flags=0x10000(runtime) hashes=11+7 location=embedded
Signature size=9045
Authority=Developer ID Application: NJX Software (A1B2C3D4E5)
Authority=Developer ID Certification Authority
Authority=Apple Root CA
Timestamp=Jul 11, 2026 at 7:59:59 PM
TeamIdentifier=A1B2C3D4E5
Runtime Version=15.5.0
Sealed Resources version=2 rules=13 files=210
Internal requirements count=1 size=180`;

const certificateDetails = `subject=CN=Developer ID Application: NJX Software (A1B2C3D4E5),OU=A1B2C3D4E5,O=NJX Software,C=US
issuer=CN=Developer ID Certification Authority,OU=Apple Certification Authority,O=Apple Inc.,C=US
sha256 Fingerprint=11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00
notAfter=Jul 11 12:00:00 2027 GMT`;

function plan(overrides: Record<string, unknown> = {}) {
  return createMacDistributionPlan({
    mode: 'distribution',
    arch: 'arm64',
    appPath: '/tmp/NJX.app',
    electronVersion: '33.4.11',
    osxSignPath: '/repo/node_modules/@electron/osx-sign/bin/electron-osx-sign.js',
    identity,
    teamId,
    notaryProfile: secretProfile,
    certificatePrefix: '/tmp/developer-id-',
    temporaryNotaryZip: '/tmp/notary.zip',
    finalZipPath: '/candidate/artifacts/mac-arm64.zip',
    ...overrides,
  });
}

describe('macOS canonical distribution signing', () => {
  it('leaves the r12 Windows builder semantics untouched', async () => {
    const current = parseYaml(await readFile(path.join(appRoot, 'electron-builder.yml'), 'utf8')) as Record<string, any>;
    expect(current.win).toMatchObject({
      publisherName: 'njx',
      icon: 'build/icon.ico',
      certificateFile: 'build/dev-cert.pfx',
      certificatePassword: null,
      certificateSubjectName: null,
      signingHashAlgorithms: ['sha256'],
      target: [
        { target: 'nsis', arch: ['x64', 'arm64'] },
        { target: 'portable', arch: ['x64', 'arm64'] },
      ],
      artifactName: '${productName}-${version}-${arch}.${ext}',
    });
  });

  it('keeps unsigned mode a strict no-op', () => {
    expect(createMacDistributionPlan({ mode: 'unsigned' })).toEqual({ mode: 'unsigned', steps: [] });
  });

  it('creates the required strict order and never signs before native staging', () => {
    const result = plan();
    const ids = result.steps.map((step: { id: string }) => step.id);

    expect(ids).toEqual([
      'unsigned-app',
      'native-stage',
      'sign-app',
      'codesign-verify',
      'codesign-details',
      'codesign-entitlements',
      'certificate-extract',
      'certificate-verify',
      'certificate-details',
      'notary-zip-app',
      'notary-submit-app',
      'staple-app',
      'staple-validate-app',
      'final-codesign-verify',
      'final-codesign-details',
      'gatekeeper-app',
      'final-zip',
      'final-extracted-runtime',
      'final-extracted-codesign',
      'final-extracted-stapler',
      'artifact-hash',
      'write-report',
      'bind-report-sha',
    ]);
    expect(validateMacDistributionPlan(result)).toEqual([]);

    const sign = result.steps.find((step: { id: string }) => step.id === 'sign-app');
    expect(sign).toMatchObject({
      command: process.execPath,
      args: expect.arrayContaining([
        '--platform=darwin',
        '--type=distribution',
        '--version=33.4.11',
        `--identity=${identity}`,
      ]),
    });
    // electron-osx-sign's installed CLI overwrites args.app with the first
    // positional argument; `--app=...` would therefore be discarded.
    expect(sign.args[1]).toBe('/tmp/NJX.app');
    expect(sign.args).not.toContain('--app=/tmp/NJX.app');
    expect(sign.args).not.toContain('--deep');
    const deepSteps = result.steps.filter((step: { args?: string[] }) => step.args?.includes('--deep'));
    expect(deepSteps.every((step: { id: string }) => step.id.includes('codesign'))).toBe(true);
    const extract = result.steps.find((step: { id: string }) => step.id === 'certificate-extract');
    expect(extract).toMatchObject({
      command: '/usr/bin/codesign',
      args: ['-d', '--extract-certificates', '/tmp/developer-id-', '/tmp/NJX.app'],
    });
    const verify = result.steps.find((step: { id: string }) => step.id === 'certificate-verify');
    expect(verify.args).toEqual(['verify-cert', '-c', '/tmp/developer-id-0', '-p', 'codeSign']);
    const details = result.steps.find((step: { id: string }) => step.id === 'certificate-details');
    expect(details.args).toEqual([
      'x509', '-inform', 'DER', '-in', '/tmp/developer-id-0', '-noout',
      '-sha256', '-fingerprint', '-subject', '-issuer', '-enddate',
    ]);
  });

  it('rejects reordered signing and final-artifact mutation steps', () => {
    const result = plan();
    const reordered = {
      ...result,
      steps: [...result.steps].sort((a, b) => {
        if (a.id === 'sign-app') return -1;
        if (b.id === 'sign-app') return 1;
        return 0;
      }),
    };
    expect(validateMacDistributionPlan(reordered)).toContain(
      'BLOCKED_MAC_SIGNING_FAILED: macOS distribution step order is invalid',
    );

    const mutatedAfterReport = {
      ...result,
      steps: [...result.steps, { id: 'mutate-final-artifact', kind: 'command', command: 'touch', args: [] }],
    };
    expect(validateMacDistributionPlan(mutatedAfterReport)).toContain(
      'BLOCKED_SIGNED_ARTIFACT_MUTATED: final artifacts may not change after report binding',
    );
  });

  it('redacts the notary keychain profile from display arguments while retaining it for spawn', () => {
    const submit = plan().steps.find((step: { id: string }) => step.id === 'notary-submit-app');
    expect(submit.args).toContain(secretProfile);
    expect(submit.displayArgs).not.toContain(secretProfile);
    expect(submit.displayArgs).toContain('<redacted-keychain-profile>');
    expect(JSON.stringify({ ...plan(), steps: plan().steps.map((step: Record<string, unknown>) => ({
      ...step,
      args: step.displayArgs,
    })) })).not.toContain(secretProfile);
  });

  it('redacts secret echoes from command, execution error, stdout and stderr logs without mutating raw results', () => {
    const submit = plan().steps.find((step: { id: string }) => step.id === 'notary-submit-app');
    const raw = {
      status: 1,
      stdout: `stdout leaked ${secretProfile}`,
      stderr: `stderr leaked ${secretProfile}`,
      error: { name: 'Error', message: `spawn leaked ${secretProfile}` },
    };
    const log = formatRedactedCommandLog({
      command: submit.command,
      args: submit.args,
      displayArgs: submit.displayArgs,
      result: raw,
      execution: { exitCode: 1, error: raw.error },
    });
    expect(log).not.toContain(secretProfile);
    expect(log).toContain('<redacted-keychain-profile>');
    expect(raw.stdout).toContain(secretProfile);
    expect(raw.stderr).toContain(secretProfile);
    expect(raw.error.message).toContain(secretProfile);
  });

  it('parses only Developer ID details with exact team, hardened runtime and timestamp', () => {
    expect(parseCodesignDetails(codesignDetails, { identity, teamId })).toMatchObject({
      identityType: 'Developer ID Application',
      teamId,
      codesignValid: true,
      hardenedRuntime: true,
      trustedTimestamp: true,
      authorityChain: [
        identity,
        'Developer ID Certification Authority',
        'Apple Root CA',
      ],
    });
  });

  it.each([
    ['Apple Development identity', codesignDetails.replace(identity, 'Apple Development: NJX (A1B2C3D4E5)')],
    ['wrong team', codesignDetails.replace('TeamIdentifier=A1B2C3D4E5', 'TeamIdentifier=Z9Y8X7W6V5')],
    ['missing runtime', codesignDetails.replace('flags=0x10000(runtime)', 'flags=0x0(none)')],
    ['missing timestamp', codesignDetails.replace('Timestamp=Jul 11, 2026 at 7:59:59 PM\n', '')],
  ])('rejects %s in codesign details', (_label, output) => {
    expect(() => parseCodesignDetails(output, { identity, teamId })).toThrow(
      expect.objectContaining({ code: 'BLOCKED_MAC_UNTRUSTED_IDENTITY' }),
    );
  });

  it('requires a trusted, unexpired and non-self-signed certificate', () => {
    expect(parseCertificateDetails(certificateDetails, { verifyStatus: 0, now })).toEqual({
      certificateTrusted: true,
      certificateExpired: false,
      selfSigned: false,
      certificateSha256Fingerprint: '112233445566778899aabbccddeeff00112233445566778899aabbccddeeff00',
    });
    expect(() => parseCertificateDetails(certificateDetails, { verifyStatus: 1, now })).toThrow(
      expect.objectContaining({ code: 'BLOCKED_MAC_UNTRUSTED_IDENTITY' }),
    );
    expect(() => parseCertificateDetails(
      certificateDetails.replace('2027 GMT', '2025 GMT'),
      { verifyStatus: 0, now },
    )).toThrow(expect.objectContaining({ code: 'BLOCKED_MAC_UNTRUSTED_IDENTITY' }));
    expect(() => parseCertificateDetails(
      certificateDetails.replace(
        'issuer=CN=Developer ID Certification Authority,OU=Apple Certification Authority,O=Apple Inc.,C=US',
        'issuer=CN=Developer ID Application: NJX Software (A1B2C3D4E5),OU=A1B2C3D4E5,O=NJX Software,C=US',
      ),
      { verifyStatus: 0, now },
    )).toThrow(expect.objectContaining({ code: 'BLOCKED_MAC_UNTRUSTED_IDENTITY' }));
    expect(() => parseCertificateDetails(
      certificateDetails.replace(/^sha256 Fingerprint=.*\n/m, ''),
      { verifyStatus: 0, now },
    )).toThrow(expect.objectContaining({ code: 'BLOCKED_MAC_UNTRUSTED_IDENTITY' }));
  });

  it('hashes exact entitlements evidence and rejects get-task-allow=true', () => {
    const safe = '<?xml version="1.0"?><plist><dict><key>com.apple.security.get-task-allow</key><false/></dict></plist>';
    expect(parseEntitlementsEvidence(safe)).toEqual({
      entitlementsSha256: createHash('sha256').update(safe).digest('hex'),
      getTaskAllow: false,
    });
    const unsafe = '<?xml version="1.0"?><plist><dict><key>com.apple.security.get-task-allow</key><true/></dict></plist>';
    expect(() => parseEntitlementsEvidence(unsafe)).toThrow(
      expect.objectContaining({ code: 'BLOCKED_MAC_SIGNING_FAILED' }),
    );
    expect(() => parseEntitlementsEvidence('not a plist')).toThrow(
      expect.objectContaining({ code: 'BLOCKED_MAC_SIGNING_FAILED' }),
    );
  });

  it('parses Accepted notarytool JSON and blocks rejected or malformed output', () => {
    expect(parseNotarytoolJson('{"status":"Accepted","id":"submission-123"}')).toEqual({
      status: 'Accepted', submissionId: 'submission-123',
    });
    expect(() => parseNotarytoolJson('{"status":"Rejected","id":"submission-123"}')).toThrow(
      expect.objectContaining({ code: 'BLOCKED_MAC_NOTARIZATION_REJECTED' }),
    );
    expect(() => parseNotarytoolJson('not-json')).toThrow(
      expect.objectContaining({ code: 'BLOCKED_MAC_NOTARIZATION_REJECTED' }),
    );
  });

  it('creates and notarizes a DMG only after the app staple assertion', () => {
    const result = createMacDmgDistributionPlan({
      mode: 'distribution',
      arch: 'arm64',
      appPath: '/tmp/NJX.app',
      dmgPath: '/tmp/NJX.dmg',
      volumeName: 'NJX Copilot arm64',
      notaryProfile: secretProfile,
      identity,
      teamId,
      certificatePrefix: '/tmp/dmg-developer-id-',
    });
    expect(result.steps.map((step: { id: string }) => step.id)).toEqual([
      'stapled-app-ready',
      'create-dmg',
      'sign-dmg',
      'codesign-verify-dmg',
      'codesign-details-dmg',
      'certificate-extract-dmg',
      'certificate-verify-dmg',
      'certificate-details-dmg',
      'notary-submit-dmg',
      'staple-dmg',
      'staple-validate-dmg',
      'gatekeeper-dmg',
      'verify-dmg-contents',
      'artifact-hash',
      'write-report',
      'bind-report-sha',
    ]);
    expect(result.steps[0]).toMatchObject({ kind: 'assertion' });
    expect(result.steps[1]).toMatchObject({
      command: '/usr/bin/hdiutil',
      args: expect.arrayContaining(['-srcfolder', '/tmp/NJX.app', '/tmp/NJX.dmg']),
    });
    const signDmg = result.steps.find((step: { id: string }) => step.id === 'sign-dmg');
    expect(signDmg.args).toEqual(['--force', '--timestamp', '--sign', identity, '/tmp/NJX.dmg']);
    expect(signDmg.args).not.toContain('--deep');
    expect(result.steps.find((step: { id: string }) => step.id === 'certificate-extract-dmg').args)
      .toEqual(['-d', '--extract-certificates', '/tmp/dmg-developer-id-', '/tmp/NJX.dmg']);
    expect(result.steps.find((step: { id: string }) => step.id === 'certificate-verify-dmg').args)
      .toEqual(['verify-cert', '-c', '/tmp/dmg-developer-id-0', '-p', 'codeSign']);
    const submit = result.steps.find((step: { id: string }) => step.id === 'notary-submit-dmg');
    expect(submit.args).toContain(secretProfile);
    expect(submit.displayArgs).not.toContain(secretProfile);
  });

  it('executes DMG create/notary/staple/Gatekeeper through an injected runner', async () => {
    const dmgPlan = createMacDmgDistributionPlan({
      mode: 'distribution',
      arch: 'arm64',
      appPath: '/tmp/NJX.app',
      dmgPath: '/tmp/NJX.dmg',
      volumeName: 'NJX Copilot arm64',
      notaryProfile: secretProfile,
      identity,
      teamId,
      certificatePrefix: '/tmp/dmg-developer-id-',
    });
    const calls: string[] = [];
    const output = await executeMacDmgDistribution({
      plan: dmgPlan,
      stapledAppVerified: true,
    }, {
      runStep: async (step: { id: string }) => {
        calls.push(step.id);
        if (step.id === 'notary-submit-dmg') {
          return { status: 0, stdout: '{"status":"Accepted","id":"dmg-submission-123"}', stderr: '' };
        }
        if (step.id === 'codesign-details-dmg') {
          return { status: 0, stdout: '', stderr: codesignDetails };
        }
        if (step.id === 'certificate-details-dmg') {
          return { status: 0, stdout: certificateDetails, stderr: '' };
        }
        if (step.id === 'staple-validate-dmg') {
          return { status: 0, stdout: 'The validate action worked!', stderr: '' };
        }
        if (step.id === 'gatekeeper-dmg') {
          return { status: 0, stdout: '', stderr: '/tmp/NJX.dmg: accepted\nsource=Notarized Developer ID' };
        }
        return { status: 0, stdout: '', stderr: '' };
      },
    });
    expect(calls).toEqual([
      'create-dmg', 'sign-dmg', 'codesign-verify-dmg', 'codesign-details-dmg',
      'certificate-extract-dmg', 'certificate-verify-dmg', 'certificate-details-dmg',
      'notary-submit-dmg', 'staple-dmg', 'staple-validate-dmg', 'gatekeeper-dmg',
    ]);
    expect(output).toEqual(expect.objectContaining({
      notarization: { status: 'Accepted', submissionId: 'dmg-submission-123' },
      staplerValid: true,
      gatekeeperAccepted: true,
      containerCodesignValid: true,
      identityType: 'Developer ID Application',
      teamId,
      trustedTimestamp: true,
      containerCertificateSha256Fingerprint: '112233445566778899aabbccddeeff00112233445566778899aabbccddeeff00',
    }));
  });

  it('blocks a DMG notary rejection and a DMG staple failure with exact codes', async () => {
    const dmgPlan = createMacDmgDistributionPlan({
      mode: 'distribution', arch: 'arm64', appPath: '/tmp/NJX.app', dmgPath: '/tmp/NJX.dmg',
      volumeName: 'NJX Copilot arm64', notaryProfile: secretProfile, identity, teamId,
      certificatePrefix: '/tmp/dmg-developer-id-',
    });
    await expect(executeMacDmgDistribution({ plan: dmgPlan, stapledAppVerified: true }, {
      runStep: async (step: { id: string }) => step.id === 'notary-submit-dmg'
        ? { status: 0, stdout: '{"status":"Rejected","id":"dmg-submission-123"}', stderr: '' }
        : step.id === 'codesign-details-dmg'
          ? { status: 0, stdout: '', stderr: codesignDetails }
          : step.id === 'certificate-details-dmg'
            ? { status: 0, stdout: certificateDetails, stderr: '' }
          : { status: 0, stdout: '', stderr: '' },
    })).rejects.toMatchObject({ code: 'BLOCKED_MAC_NOTARIZATION_REJECTED' });
    await expect(executeMacDmgDistribution({ plan: dmgPlan, stapledAppVerified: true }, {
      runStep: async (step: { id: string }) => step.id === 'staple-dmg'
        ? { status: 1, stdout: '', stderr: 'fixture staple failure' }
        : step.id === 'notary-submit-dmg'
          ? { status: 0, stdout: '{"status":"Accepted","id":"dmg-submission-123"}', stderr: '' }
          : step.id === 'codesign-details-dmg'
            ? { status: 0, stdout: '', stderr: codesignDetails }
            : step.id === 'certificate-details-dmg'
              ? { status: 0, stdout: certificateDetails, stderr: '' }
            : { status: 0, stdout: '', stderr: '' },
    })).rejects.toMatchObject({ code: 'BLOCKED_MAC_STAPLE_FAILED' });
  });

  it('executes the app signing plan with injected commands and never invokes platform tools itself', async () => {
    const calls: Array<{ id: string; args: string[]; displayArgs: string[] }> = [];
    const results: Record<string, { status: number; stdout?: string; stderr?: string }> = {
      'sign-app': { status: 0 },
      'codesign-verify': { status: 0 },
      'codesign-details': { status: 0, stderr: codesignDetails },
      'codesign-entitlements': { status: 0, stdout: '<?xml version="1.0"?><plist></plist>' },
      'certificate-extract': { status: 0 },
      'certificate-verify': { status: 0 },
      'certificate-details': { status: 0, stdout: certificateDetails },
      'notary-zip-app': { status: 0 },
      'notary-submit-app': { status: 0, stdout: '{"status":"Accepted","id":"submission-123"}' },
      'staple-app': { status: 0 },
      'staple-validate-app': { status: 0, stdout: 'The validate action worked!' },
      'final-codesign-verify': { status: 0 },
      'final-codesign-details': { status: 0, stderr: codesignDetails },
      'gatekeeper-app': { status: 0, stderr: '/tmp/NJX.app: accepted\nsource=Notarized Developer ID' },
    };
    const output = await executeMacAppDistributionSigning({
      plan: plan(), nativeStageVerified: true,
    }, {
      runStep: async (step: { id: string; args: string[]; displayArgs: string[] }) => {
        calls.push(step);
        return { stdout: '', stderr: '', ...results[step.id] };
      },
      now,
    });

    expect(calls.map((call) => call.id)).toEqual([
      'sign-app', 'codesign-verify', 'codesign-details', 'codesign-entitlements',
      'certificate-extract', 'certificate-verify', 'certificate-details', 'notary-zip-app',
      'notary-submit-app', 'staple-app', 'staple-validate-app', 'final-codesign-verify',
      'final-codesign-details', 'gatekeeper-app',
    ]);
    expect(calls.find((call) => call.id === 'notary-submit-app')?.displayArgs).not.toContain(secretProfile);
    expect(output).toMatchObject({
      identityType: 'Developer ID Application',
      teamId,
      certificateTrusted: true,
      certificateExpired: false,
      selfSigned: false,
      certificateSha256Fingerprint: '112233445566778899aabbccddeeff00112233445566778899aabbccddeeff00',
      entitlementsSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      codesignValid: true,
      hardenedRuntime: true,
      nestedSignaturesValid: true,
      trustedTimestamp: true,
      notarization: { status: 'Accepted', submissionId: 'submission-123' },
      staplerValid: true,
      gatekeeperAccepted: true,
    });
  });

  it('never staples an app or DMG after notarytool returns Rejected', async () => {
    const appCalls: string[] = [];
    const common: Record<string, { stdout?: string; stderr?: string }> = {
      'codesign-details': { stderr: codesignDetails },
      'final-codesign-details': { stderr: codesignDetails },
      'codesign-entitlements': { stdout: '<plist><dict></dict></plist>' },
      'certificate-extract': {},
      'certificate-details': { stdout: certificateDetails },
      'notary-submit-app': { stdout: '{"status":"Rejected","id":"submission-123"}' },
    };
    await expect(executeMacAppDistributionSigning({ plan: plan(), nativeStageVerified: true }, {
      runStep: async (step: { id: string }) => {
        appCalls.push(step.id);
        return { status: 0, stdout: '', stderr: '', ...common[step.id] };
      },
      now,
    })).rejects.toMatchObject({ code: 'BLOCKED_MAC_NOTARIZATION_REJECTED' });
    expect(appCalls).not.toContain('staple-app');

    const dmgPlan = createMacDmgDistributionPlan({
      mode: 'distribution', arch: 'arm64', appPath: '/tmp/NJX.app', dmgPath: '/tmp/NJX.dmg',
      volumeName: 'NJX Copilot arm64', notaryProfile: secretProfile, identity, teamId,
      certificatePrefix: '/tmp/dmg-developer-id-',
    });
    const dmgCalls: string[] = [];
    await expect(executeMacDmgDistribution({ plan: dmgPlan, stapledAppVerified: true }, {
      runStep: async (step: { id: string }) => {
        dmgCalls.push(step.id);
        return step.id === 'notary-submit-dmg'
          ? { status: 0, stdout: '{"status":"Rejected","id":"dmg-submission-123"}', stderr: '' }
          : step.id === 'codesign-details-dmg'
            ? { status: 0, stdout: '', stderr: codesignDetails }
            : step.id === 'certificate-details-dmg'
              ? { status: 0, stdout: certificateDetails, stderr: '' }
            : { status: 0, stdout: '', stderr: '' };
      },
    })).rejects.toMatchObject({ code: 'BLOCKED_MAC_NOTARIZATION_REJECTED' });
    expect(dmgCalls).not.toContain('staple-dmg');
  });

  it.each(['stdout', 'stderr', 'throw'])('redacts a notary profile echoed through a failing %s path', async (channel) => {
    let caught: unknown;
    try {
      await executeMacAppDistributionSigning({ plan: plan(), nativeStageVerified: true }, {
        runStep: async (step: { id: string }) => {
          if (step.id === 'notary-submit-app') {
            if (channel === 'throw') throw new Error(`runner leaked ${secretProfile}`);
            return {
              status: 1,
              stdout: channel === 'stdout' ? `leaked ${secretProfile}` : '',
              stderr: channel === 'stderr' ? `leaked ${secretProfile}` : '',
            };
          }
          const fixture: Record<string, { stdout?: string; stderr?: string }> = {
            'codesign-details': { stderr: codesignDetails },
            'codesign-entitlements': { stdout: '<plist><dict></dict></plist>' },
            'certificate-extract': {},
            'certificate-details': { stdout: certificateDetails },
          };
          return { status: 0, stdout: '', stderr: '', ...fixture[step.id] };
        },
        now,
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toEqual(expect.objectContaining({ code: 'BLOCKED_MAC_NOTARIZATION_REJECTED' }));
    expect(String(caught)).not.toContain(secretProfile);
    expect(String(caught)).toContain('<redacted-keychain-profile>');
  });

  it.each([
    ['sign failure', 'sign-app', { status: 1, stderr: 'fixture failure' }, 'BLOCKED_MAC_SIGNING_FAILED'],
    ['staple failure', 'staple-app', { status: 1, stderr: 'fixture failure' }, 'BLOCKED_MAC_STAPLE_FAILED'],
  ])('maps an injected %s to the exact blocker', async (_label, failedStep, failure, code) => {
    const defaultResult = { status: 0, stdout: '', stderr: '' };
    const outputs: Record<string, Partial<typeof defaultResult>> = {
      'codesign-details': { stderr: codesignDetails },
      'final-codesign-details': { stderr: codesignDetails },
      'codesign-entitlements': { stdout: '<plist><dict></dict></plist>' },
      'certificate-extract': {},
      'certificate-details': { stdout: certificateDetails },
      'notary-submit-app': { stdout: '{"status":"Accepted","id":"submission-123"}' },
      'staple-validate-app': { stdout: 'The validate action worked!' },
      'gatekeeper-app': { stderr: 'accepted\nsource=Notarized Developer ID' },
      [failedStep]: failure,
    };
    await expect(executeMacAppDistributionSigning({ plan: plan(), nativeStageVerified: true }, {
      runStep: async (step: { id: string }) => ({ ...defaultResult, ...outputs[step.id] }),
      now,
    })).rejects.toMatchObject({ code });
  });

  it('builds an allowlisted report and binds its SHA to the exact final artifact', () => {
    const artifact = {
      relativePath: 'artifacts/mac-arm64.zip',
      platform: 'darwin',
      arch: 'arm64',
      bytes: 1234,
      sha256: 'b'.repeat(64),
      signing: 'verified',
    };
    const verification = {
      identityType: 'Developer ID Application', teamId,
      certificateTrusted: true, certificateExpired: false, selfSigned: false,
      certificateSha256Fingerprint: '112233445566778899aabbccddeeff00112233445566778899aabbccddeeff00',
      codesignValid: true, hardenedRuntime: true, nestedSignaturesValid: true,
      trustedTimestamp: true,
      entitlementsSha256: 'f'.repeat(64),
      notarization: { status: 'Accepted', submissionId: 'submission-123' },
      staplerValid: true,
    };
    const built = buildMacSigningReport({
      candidate: 'v6.2-r13', sourceHead: 'abc123', snapshotSha256: 'a'.repeat(64),
      artifact, verification,
    });

    expect(built.report).toEqual(expect.objectContaining({
      schemaVersion: 1,
      reportType: 'macos-signing',
      provenance: 'canonical-macos-verifier',
      artifactPath: artifact.relativePath,
      artifactSha256: artifact.sha256,
      artifactBytes: artifact.bytes,
      verificationPlatform: 'darwin',
      teamId,
      certificateSha256Fingerprint: verification.certificateSha256Fingerprint,
      certificateThumbprint: verification.certificateSha256Fingerprint,
      entitlementsSha256: verification.entitlementsSha256,
    }));
    expect(built.signature).toEqual(expect.objectContaining({
      provenance: 'canonical-macos-verifier',
      teamId,
      certificateTrusted: true,
      certificateExpired: false,
      selfSigned: false,
      certificateSha256Fingerprint: verification.certificateSha256Fingerprint,
      certificateThumbprint: verification.certificateSha256Fingerprint,
      entitlementsSha256: verification.entitlementsSha256,
      signingReportSha256: createHash('sha256').update(built.reportText).digest('hex'),
    }));
    expect(built.reportText).not.toContain(secretProfile);
    expect(() => assertMacSigningReportBinding({ artifact, ...built })).not.toThrow();
    expect(() => assertMacSigningReportBinding({
      artifact: { ...artifact, sha256: 'c'.repeat(64) }, ...built,
    })).toThrow(expect.objectContaining({ code: 'BLOCKED_SIGNED_ARTIFACT_MUTATED' }));
    expect(() => assertMacSigningReportBinding({
      artifact, ...built, reportText: `${built.reportText} `,
    })).toThrow(expect.objectContaining({ code: 'BLOCKED_SIGNING_EVIDENCE_BINDING' }));
  });

  it('publishes a signing report with 0600, fsync/close and atomic no-overwrite semantics', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'copilot-signing-report-'));
    const target = path.join(root, 'mac.signing.json');
    try {
      await publishSigningReportCrashSafe({ target, contents: '{"first":true}\n' });
      expect(await readFile(target, 'utf8')).toBe('{"first":true}\n');
      expect((await stat(target)).mode & 0o777).toBe(0o600);
      await expect(publishSigningReportCrashSafe({
        target,
        contents: '{"overwritten":true}\n',
      })).rejects.toMatchObject({ code: 'BLOCKED_SIGNING_EVIDENCE_BINDING' });
      expect(await readFile(target, 'utf8')).toBe('{"first":true}\n');
      expect((await readdir(root)).filter((entry) => entry.includes('.tmp-'))).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('scopes DMG container codesign separately from payload hardened/nested evidence', () => {
    const artifact = {
      relativePath: 'artifacts/mac-arm64.dmg', kind: 'macOS DMG', platform: 'darwin', arch: 'arm64',
      bytes: 2345, sha256: 'd'.repeat(64), signing: 'verified',
    };
    const verification = {
      identityType: 'Developer ID Application', teamId,
      certificateTrusted: true, certificateExpired: false, selfSigned: false,
      certificateSha256Fingerprint: '112233445566778899aabbccddeeff00112233445566778899aabbccddeeff00',
      codesignValid: true, hardenedRuntime: true, nestedSignaturesValid: true, trustedTimestamp: true,
      entitlementsSha256: 'e'.repeat(64),
      notarization: { status: 'Accepted', submissionId: 'dmg-submission-123' },
      staplerValid: true,
      containerCodesignValid: true,
      containerTrustedTimestamp: true,
      containerCertificateSha256Fingerprint: '2'.repeat(64),
      payloadCertificateSha256Fingerprint: '1'.repeat(64),
    };
    const built = buildMacSigningReport({
      candidate: 'v6.2-r13', sourceHead: 'abc123', snapshotSha256: 'a'.repeat(64),
      artifact, verification,
    });
    expect(built.report).toMatchObject({
      containerCodesignValid: true,
      containerTrustedTimestamp: true,
      certificateSha256Fingerprint: '2'.repeat(64),
      certificateThumbprint: '2'.repeat(64),
      payloadVerification: {
        codesignValid: true,
        hardenedRuntime: true,
        nestedSignaturesValid: true,
        trustedTimestamp: true,
        entitlementsSha256: 'e'.repeat(64),
        payloadCertificateSha256Fingerprint: '1'.repeat(64),
      },
      verificationScope: {
        hardenedRuntime: 'payload-app',
        nestedSignaturesValid: 'payload-app',
        entitlementsSha256: 'payload-app',
        containerCodesignValid: 'dmg-container',
      },
    });
    expect(built.signature).toMatchObject({
      containerCodesignValid: true,
      certificateSha256Fingerprint: '2'.repeat(64),
      certificateThumbprint: '2'.repeat(64),
      payloadCertificateSha256Fingerprint: '1'.repeat(64),
      payloadEntitlementsSha256: 'e'.repeat(64),
      entitlementsSha256: verification.entitlementsSha256,
    });
  });

  it('rechecks every artifact and signing report at canonical completion', async () => {
    const reportText = '{"report":"fixture"}\n';
    const reportSha = createHash('sha256').update(reportText).digest('hex');
    const artifacts = [
      {
        relativePath: 'artifacts/mac.zip', bytes: 10, sha256: 'a'.repeat(64), signing: 'verified',
        signature: {
          provenance: 'canonical-macos-verifier',
          signingReportSha256: reportSha,
          signingReport: { relativePath: 'evidence/signing/mac.json', sha256: reportSha },
        },
      },
      { relativePath: 'artifacts/win.exe', bytes: 20, sha256: 'b'.repeat(64), signing: 'unsigned' },
    ];
    const evidence = new Map([
      ['artifacts/mac.zip', { bytes: 10, sha256: 'a'.repeat(64) }],
      ['evidence/signing/mac.json', { bytes: Buffer.byteLength(reportText), sha256: reportSha }],
      ['artifacts/win.exe', { bytes: 20, sha256: 'b'.repeat(64) }],
    ]);
    const inspectPath = async (relativePath: string) => evidence.get(relativePath);

    await expect(verifyCanonicalCompletionIntegrity({ artifacts, inspectPath })).resolves.toEqual({
      artifactCount: 2,
      signingReportCount: 1,
    });
    evidence.set('artifacts/mac.zip', { bytes: 11, sha256: 'c'.repeat(64) });
    await expect(verifyCanonicalCompletionIntegrity({ artifacts, inspectPath })).rejects.toMatchObject({
      code: 'BLOCKED_SIGNED_ARTIFACT_MUTATED',
    });
    evidence.set('artifacts/mac.zip', { bytes: 10, sha256: 'a'.repeat(64) });
    evidence.set('artifacts/win.exe', { bytes: 21, sha256: 'd'.repeat(64) });
    await expect(verifyCanonicalCompletionIntegrity({ artifacts, inspectPath })).rejects.toMatchObject({
      code: 'BLOCKED_ARTIFACT_MUTATED',
    });
    evidence.set('artifacts/win.exe', { bytes: 20, sha256: 'b'.repeat(64) });
    evidence.set('evidence/signing/mac.json', { bytes: 99, sha256: 'e'.repeat(64) });
    await expect(verifyCanonicalCompletionIntegrity({ artifacts, inspectPath })).rejects.toMatchObject({
      code: 'BLOCKED_SIGNING_EVIDENCE_BINDING',
    });
  });

  it('rejects a disagreement between nested and top-level signing report SHA', async () => {
    const artifact = {
      relativePath: 'artifacts/mac.zip', bytes: 10, sha256: 'a'.repeat(64), signing: 'verified',
      signature: {
        provenance: 'canonical-macos-verifier',
        signingReportSha256: 'c'.repeat(64),
        signingReport: { relativePath: 'evidence/signing/mac.json', sha256: 'd'.repeat(64) },
      },
    };
    await expect(verifyCanonicalCompletionIntegrity({
      artifacts: [artifact],
      inspectPath: async (relativePath: string) => relativePath === artifact.relativePath
        ? { bytes: artifact.bytes, sha256: artifact.sha256 }
        : { bytes: 10, sha256: 'd'.repeat(64) },
    })).rejects.toMatchObject({ code: 'BLOCKED_SIGNING_EVIDENCE_BINDING' });
  });

  it.each([
    ['missing signature', undefined],
    ['missing report object', { provenance: 'canonical-macos-verifier', signingReportSha256: 'c'.repeat(64) }],
    ['duplicate report array', {
      provenance: 'canonical-macos-verifier', signingReportSha256: 'c'.repeat(64), signingReport: [],
    }],
    ['missing provenance', {
      signingReportSha256: 'c'.repeat(64),
      signingReport: { relativePath: 'evidence/signing/mac.json', sha256: 'c'.repeat(64) },
    }],
  ])('blocks a verified artifact with %s', async (_label, signature) => {
    const artifact = {
      relativePath: 'artifacts/mac.zip', bytes: 10, sha256: 'a'.repeat(64), signing: 'verified', signature,
    };
    await expect(verifyCanonicalCompletionIntegrity({
      artifacts: [artifact],
      inspectPath: async () => ({ bytes: 10, sha256: 'a'.repeat(64) }),
    })).rejects.toMatchObject({ code: 'BLOCKED_SIGNING_EVIDENCE_BINDING' });
  });

  it('integrates native staging before signing and signing before final ZIP in the canonical source', async () => {
    const source = await readFile(path.join(appRoot, 'scripts/build-canonical-release.mjs'), 'utf8');
    const nativeStage = source.indexOf('mac-${arch}-native-stage');
    const distributionSigning = source.indexOf('? await signMacAppForDistribution', nativeStage);
    const finalZip = source.indexOf('mac-${arch}-zip`');
    expect(nativeStage).toBeGreaterThan(-1);
    expect(distributionSigning).toBeGreaterThan(nativeStage);
    expect(finalZip).toBeGreaterThan(distributionSigning);
  });

  it('records final extracted codesign, staple and Gatekeeper verification in canonical logs', async () => {
    const source = await readFile(path.join(appRoot, 'scripts/build-canonical-release.mjs'), 'utf8');
    expect(source).toContain('`${label}-codesign-verify`');
    expect(source).toContain('`${label}-codesign-details`');
    expect(source).toContain('`${label}-stapler-validate`');
    expect(source).toContain('`${label}-gatekeeper`');
  });

  it('rechecks final artifacts and reports before writing the completion marker', async () => {
    const source = await readFile(path.join(appRoot, 'scripts/build-canonical-release.mjs'), 'utf8');
    const postPackage = source.indexOf('await runPostPackageGates();');
    const integrity = source.lastIndexOf('await verifyCanonicalCompletionIntegrity(');
    const installGuide = source.lastIndexOf('await writeInstallGuide();');
    const manifestWrite = source.lastIndexOf("await atomicJson(path.join(outputRoot, 'CANONICAL-MANIFEST.json'), manifest);");
    const completeMarker = source.lastIndexOf("'.canonical-release.complete'");
    expect(integrity).toBeGreaterThan(postPackage);
    expect(installGuide).toBeGreaterThan(integrity);
    expect(manifestWrite).toBeGreaterThan(integrity);
    expect(completeMarker).toBeGreaterThan(manifestWrite);
    expect(source).toContain("'.canonical-release.failed'");
  });

  it('publishes a failed marker for pipeline FAIL even when completion integrity passes', async () => {
    const source = await readFile(path.join(appRoot, 'scripts/build-canonical-release.mjs'), 'utf8');
    expect(source).toContain("const releaseCompleted = completionIntegrityPassed && manifest.status !== 'FAIL';");
    expect(source).toContain("releaseCompleted ? '.canonical-release.complete' : '.canonical-release.failed'");
    expect(source).not.toContain("completionIntegrityPassed ? '.canonical-release.complete' : '.canonical-release.failed'");
  });

  it('integrates leaf extraction cleanup, codeSign policy and crash-safe report publication', async () => {
    const signingSource = await readFile(path.join(appRoot, 'scripts/release-macos-signing.mjs'), 'utf8');
    const canonicalSource = await readFile(path.join(appRoot, 'scripts/build-canonical-release.mjs'), 'utf8');
    expect(signingSource).toContain("'--extract-certificates'");
    expect(signingSource).toContain("'-p', 'codeSign'");
    expect(signingSource).not.toContain("'-p', 'codesigning'");
    expect(canonicalSource).toContain("mkdtemp(path.join(os.tmpdir(), `copilot-mac-cert-${arch}-`))");
    expect(canonicalSource).toContain("mkdtemp(path.join(os.tmpdir(), `copilot-mac-dmg-cert-${arch}-`))");
    expect(canonicalSource).toContain('await removeExtractedCertificateChain(certificatePrefix);');
    expect(canonicalSource).toContain('await rm(certificateRoot, { recursive: true, force: true });');
    expect(canonicalSource).toContain('await rm(dmgCertificateRoot, { recursive: true, force: true });');
    expect(canonicalSource).toContain('await publishSigningReportCrashSafe({');
    const dmgVerify = canonicalSource.indexOf('`${label}-container-codesign-verify`');
    const dmgAttach = canonicalSource.indexOf('`mac-${arch}-dmg-attach`');
    expect(dmgVerify).toBeGreaterThan(-1);
    expect(dmgAttach).toBeGreaterThan(dmgVerify);
  });
});
