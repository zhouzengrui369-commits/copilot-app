import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

import {
  ProductionDeploymentConfigError,
  validateProductionDeploymentContract,
} from '../scripts/validate-production-deployment-config.mjs';

interface Fixture {
  cloudbase: Record<string, any>;
  schema: Record<string, any>;
  contract: Record<string, any>;
}

async function loadFixture(): Promise<Fixture> {
  const [cloudbase, schema, contract] = await Promise.all([
    readFile(new URL('../cloudbaserc.json', import.meta.url), 'utf8'),
    readFile(new URL('../deployment/production-deployment-contract.schema.json', import.meta.url), 'utf8'),
    readFile(new URL('../deployment/production-deployment-contract.example.json', import.meta.url), 'utf8'),
  ]);
  return {
    cloudbase: JSON.parse(cloudbase),
    schema: JSON.parse(schema),
    contract: JSON.parse(contract),
  };
}

function clone(fixture: Fixture): Fixture {
  return structuredClone(fixture);
}

function expectCode(fixture: Fixture, code: string): ProductionDeploymentConfigError {
  try {
    validateProductionDeploymentContract(fixture);
  } catch (error) {
    expect(error).toBeInstanceOf(ProductionDeploymentConfigError);
    expect((error as ProductionDeploymentConfigError).code).toBe(code);
    return error as ProductionDeploymentConfigError;
  }
  throw new Error(`expected ${code}`);
}

describe('production deployment config contract', () => {
  it('accepts the repo-owned variable-only contract with both optional features OFF', async () => {
    const result = validateProductionDeploymentContract(await loadFixture());
    expect(result).toEqual({
      schemaVersion: 1,
      profile: 'production',
      envBindings: 13,
      backupDefaultEnabled: false,
      remoteDefaultEnabled: false,
      remoteActivationAllowed: false,
    });
  });

  it('rejects a literal endpoint without echoing its canary value', async () => {
    const fixture = clone(await loadFixture());
    const canary = 'https://production.invalid/canary-secret-928441';
    fixture.contract.issuerMount.targetPath = canary;
    const error = expectCode(fixture, 'ENDPOINT_LITERAL_FORBIDDEN');
    expect(String(error)).not.toContain(canary);
    expect(JSON.stringify(error)).not.toContain(canary);
  });

  it('rejects a literal CloudBase environment identifier', async () => {
    const fixture = clone(await loadFixture());
    fixture.cloudbase.deploy.envId = 'env-generated-canary-123456';
    const error = expectCode(fixture, 'ACCOUNT_IDENTIFIER_LITERAL_FORBIDDEN');
    expect(String(error)).not.toContain(fixture.cloudbase.deploy.envId);
  });

  it('rejects a missing deployment env reference', async () => {
    const fixture = clone(await loadFixture());
    delete fixture.cloudbase.deploy.envParams.BACKUP_ENABLED;
    expectCode(fixture, 'ENV_BINDING_MISSING');
  });

  it.each([
    ['both strategies', (fixture: Fixture) => { fixture.cloudbase.deploy.envParams.TRUST_PROXY_HOPS = '${env.TRUST_PROXY_HOPS}'; }],
    ['missing strategy', (fixture: Fixture) => { delete fixture.cloudbase.deploy.envParams.TRUST_PROXY_CIDRS; }],
  ])('rejects %s for trust proxy', async (_name, mutate) => {
    const fixture = clone(await loadFixture());
    mutate(fixture);
    expectCode(fixture, 'TRUST_PROXY_STRATEGY_INVALID');
  });

  it('rejects Backup enabled by default', async () => {
    const fixture = clone(await loadFixture());
    fixture.contract.features.backup.defaultEnabled = true;
    expectCode(fixture, 'FEATURE_DEFAULT_ON');
  });

  it('rejects Backup activation inputs with a required binding removed', async () => {
    const fixture = clone(await loadFixture());
    delete fixture.contract.envBindings.COPILOT_BACKUP_COS_SECRET_KEY;
    expectCode(fixture, 'ENV_BINDING_MISSING');
  });

  it('rejects Remote activation while runtime readiness is unresolved', async () => {
    const fixture = clone(await loadFixture());
    fixture.contract.features.remote.activationAllowed = true;
    expectCode(fixture, 'REMOTE_ACTIVATION_BLOCKED');
  });

  it('rejects an issuer env path that differs from the mount target', async () => {
    const fixture = clone(await loadFixture());
    fixture.contract.issuerMount.pathBinding.expectedValue = '/run/secrets/copilot/different.pkcs8';
    expectCode(fixture, 'ISSUER_PATH_MISMATCH');
  });

  it.each([
    ['relative path', (fixture: Fixture) => { fixture.contract.issuerMount.targetPath = 'secrets/issuer.pkcs8'; fixture.contract.issuerMount.pathBinding.expectedValue = 'secrets/issuer.pkcs8'; }, 'ISSUER_MOUNT_PATH_INVALID'],
    ['repo path', (fixture: Fixture) => { fixture.contract.issuerMount.targetPath = '/workspace/copilot/issuer.pkcs8'; fixture.contract.issuerMount.pathBinding.expectedValue = '/workspace/copilot/issuer.pkcs8'; }, 'ISSUER_MOUNT_PATH_INVALID'],
    ['permissive mode', (fixture: Fixture) => { fixture.contract.issuerMount.filePolicy.mode = '0640'; }, 'ISSUER_FILE_POLICY_INVALID'],
    ['symlink allowed', (fixture: Fixture) => { fixture.contract.issuerMount.filePolicy.allowSymlink = true; }, 'ISSUER_FILE_POLICY_INVALID'],
    ['wrong owner', (fixture: Fixture) => { fixture.contract.issuerMount.filePolicy.ownership = 'root'; }, 'ISSUER_FILE_POLICY_INVALID'],
    ['multiple links', (fixture: Fixture) => { fixture.contract.issuerMount.filePolicy.nlink = 2; }, 'ISSUER_FILE_POLICY_INVALID'],
  ])('rejects issuer policy: %s', async (_name, mutate, code) => {
    const fixture = clone(await loadFixture());
    mutate(fixture);
    expectCode(fixture, code);
  });

  it('rejects private-key-looking content without returning the content', async () => {
    const fixture = clone(await loadFixture());
    const canary = '-----BEGIN PRIVATE KEY-----canary-private-material';
    fixture.contract.issuerMount.pathBinding.expectedValue = canary;
    const error = expectCode(fixture, 'PRIVATE_MATERIAL_FORBIDDEN');
    expect(String(error)).not.toContain(canary);
  });

  it('rejects an unknown deployment env reference', async () => {
    const fixture = clone(await loadFixture());
    fixture.cloudbase.deploy.envParams.UNREVIEWED_ENV = '${env.UNREVIEWED_ENV}';
    expectCode(fixture, 'UNKNOWN_ENV_REFERENCE');
  });

  it('rejects Windows fields or claims', async () => {
    const fixture = clone(await loadFixture());
    fixture.contract.windowsSigning = false;
    expectCode(fixture, 'WINDOWS_FIELD_FORBIDDEN');
  });
});
