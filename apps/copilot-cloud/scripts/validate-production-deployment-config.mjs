#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const NEW_ENV_NAMES = [
  'TRUST_PROXY_CIDRS',
  'BACKUP_ENABLED',
  'BACKUP_AUTH_BINDINGS',
  'COPILOT_BACKUP_COS_REGION',
  'COPILOT_BACKUP_COS_BUCKET',
  'COPILOT_BACKUP_COS_SECRET_ID',
  'COPILOT_BACKUP_COS_SECRET_KEY',
  'COPILOT_BACKUP_COS_SECURITY_TOKEN',
  'REMOTE_RELAY_ENABLED',
  'REMOTE_PAIRING_ISSUER_KEY_PATH',
  'REMOTE_PAIRING_MAX_SESSIONS',
  'REMOTE_PAIRING_MAX_USED_REQUESTS',
  'REMOTE_PAIRING_SESSION_TTL_MS',
];

const BASE_ENV_PARAMS = {
  NODE_ENV: 'production',
  PORT: '8788',
  HOST: '0.0.0.0',
  LOG_LEVEL: 'info',
  LLM_BASE_URL: '${env.LLM_BASE_URL}',
  LLM_API_KEY: '${env.LLM_API_KEY}',
  LLM_CHAT_PATH: '${env.LLM_CHAT_PATH}',
  LLM_EMBEDDINGS_PATH: '${env.LLM_EMBEDDINGS_PATH}',
  CORS_ORIGINS: '${env.CORS_ORIGINS}',
  COPILOT_CLOUD_TOKENS: '${env.COPILOT_CLOUD_TOKENS}',
  RATE_LIMIT_MAX: '${env.RATE_LIMIT_MAX}',
  RATE_LIMIT_WINDOW_MS: '${env.RATE_LIMIT_WINDOW_MS}',
  CLOUDBASE_RELAY_ENABLED: '${env.CLOUDBASE_RELAY_ENABLED}',
};

const ROOT_KEYS = [
  'schemaVersion',
  'profile',
  'serverRoles',
  'envBindings',
  'trustProxy',
  'features',
  'issuerMount',
  'backupBoundary',
  'activationGates',
];

const SERVER_ROLES = [
  'stateless-llm-proxy',
  'optional-encrypted-backup-presign',
  'optional-remote-relay',
];

export class ProductionDeploymentConfigError extends Error {
  constructor(code, field) {
    super(`PRODUCTION_DEPLOYMENT_CONFIG_INVALID code=${code} field=${field}`);
    this.name = 'ProductionDeploymentConfigError';
    this.code = code;
    this.field = field;
  }
}

function fail(code, field) {
  throw new ProductionDeploymentConfigError(code, field);
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function requireRecord(value, field) {
  if (!isRecord(value)) fail('SHAPE_INVALID', field);
  return value;
}

function requireExactKeys(value, keys, field) {
  const actual = Object.keys(requireRecord(value, field)).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    fail('SHAPE_INVALID', field);
  }
}

function requireEqual(actual, expected, code, field) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) fail(code, field);
}

function isEnvReference(value, name) {
  return value === `\${env.${name}}`;
}

function scanForbidden(value, field = 'contract') {
  if (Array.isArray(value)) {
    value.forEach((item, index) => scanForbidden(item, `${field}[${index}]`));
    return;
  }
  if (isRecord(value)) {
    for (const [key, item] of Object.entries(value)) {
      if (/windows|win32|signtool|authenticode/i.test(key)) fail('WINDOWS_FIELD_FORBIDDEN', `${field}.${key}`);
      scanForbidden(item, `${field}.${key}`);
    }
    return;
  }
  if (typeof value !== 'string' || /^\$\{env\.[A-Z0-9_]+\}$/.test(value)) return;
  if (/windows|win32|signtool|authenticode/i.test(value)) fail('WINDOWS_FIELD_FORBIDDEN', field);
  if (/-----BEGIN [A-Z ]*(?:PRIVATE KEY|CERTIFICATE)-----/.test(value)) fail('PRIVATE_MATERIAL_FORBIDDEN', field);
  if (/(?:https?|wss?):\/\//i.test(value)) fail('ENDPOINT_LITERAL_FORBIDDEN', field);
  if (/(?:secret|token|password|private[-_]?key)[=:][^\s]{4,}/i.test(value)) fail('SECRET_LITERAL_FORBIDDEN', field);
  if (/\bAKID[A-Z0-9]{8,}\b|\bsk-[A-Za-z0-9_-]{8,}\b/.test(value)) fail('SECRET_LITERAL_FORBIDDEN', field);
}

function validateSchema(schema) {
  const root = requireRecord(schema, 'schema');
  requireEqual(root.$schema, 'https://json-schema.org/draft/2020-12/schema', 'SCHEMA_INVALID', 'schema.$schema');
  requireEqual(root.$id, 'urn:copilot:production-deployment-contract:v1', 'SCHEMA_INVALID', 'schema.$id');
  requireEqual(root.type, 'object', 'SCHEMA_INVALID', 'schema.type');
  requireEqual(root.additionalProperties, false, 'SCHEMA_INVALID', 'schema.additionalProperties');
  requireEqual(root.required, ROOT_KEYS, 'SCHEMA_INVALID', 'schema.required');
  const properties = requireRecord(root.properties, 'schema.properties');
  requireExactKeys(properties, ROOT_KEYS, 'schema.properties');
  requireEqual(properties.schemaVersion?.const, 1, 'SCHEMA_INVALID', 'schema.schemaVersion');
  requireEqual(properties.profile?.const, 'production', 'SCHEMA_INVALID', 'schema.profile');
  requireEqual(properties.serverRoles?.const, SERVER_ROLES, 'SCHEMA_INVALID', 'schema.serverRoles');
  for (const name of NEW_ENV_NAMES) {
    requireEqual(properties.envBindings?.properties?.[name]?.const, `\${env.${name}}`, 'SCHEMA_INVALID', `schema.envBindings.${name}`);
  }
  requireEqual(properties.trustProxy?.properties?.strategy?.const, 'cidrs', 'SCHEMA_INVALID', 'schema.trustProxy.strategy');
  requireEqual(properties.features?.properties?.backup?.properties?.defaultEnabled?.const, false, 'SCHEMA_INVALID', 'schema.features.backup.defaultEnabled');
  requireEqual(properties.features?.properties?.remote?.properties?.defaultEnabled?.const, false, 'SCHEMA_INVALID', 'schema.features.remote.defaultEnabled');
  requireEqual(properties.features?.properties?.remote?.properties?.activationAllowed?.const, false, 'SCHEMA_INVALID', 'schema.features.remote.activationAllowed');
  requireEqual(properties.issuerMount?.properties?.filePolicy?.properties?.mode?.const, '0600', 'SCHEMA_INVALID', 'schema.issuerMount.mode');
  requireEqual(properties.issuerMount?.properties?.filePolicy?.properties?.ownership?.const, 'runtime-uid', 'SCHEMA_INVALID', 'schema.issuerMount.ownership');
  requireEqual(properties.backupBoundary?.properties?.ciphertextOnly?.const, true, 'SCHEMA_INVALID', 'schema.backupBoundary.ciphertextOnly');
  requireEqual(properties.backupBoundary?.properties?.localAuthoritative?.const, true, 'SCHEMA_INVALID', 'schema.backupBoundary.localAuthoritative');
}

function validateCloudbase(cloudbase) {
  requireEqual(cloudbase?.deploy?.envId, '${env.CLOUDBASE_ENV_ID}', 'ACCOUNT_IDENTIFIER_LITERAL_FORBIDDEN', 'cloudbaserc.deploy.envId');
  const envParams = requireRecord(cloudbase?.deploy?.envParams, 'cloudbaserc.deploy.envParams');
  const hasCidrs = Object.hasOwn(envParams, 'TRUST_PROXY_CIDRS');
  const hasHops = Object.hasOwn(envParams, 'TRUST_PROXY_HOPS');
  if (!hasCidrs || hasHops) fail('TRUST_PROXY_STRATEGY_INVALID', 'cloudbaserc.deploy.envParams');

  for (const name of NEW_ENV_NAMES) {
    if (!Object.hasOwn(envParams, name)) fail('ENV_BINDING_MISSING', `cloudbaserc.deploy.envParams.${name}`);
  }
  const allowed = [...Object.keys(BASE_ENV_PARAMS), ...NEW_ENV_NAMES].sort();
  const actual = Object.keys(envParams).sort();
  if (actual.length !== allowed.length || actual.some((name, index) => name !== allowed[index])) {
    fail('UNKNOWN_ENV_REFERENCE', 'cloudbaserc.deploy.envParams');
  }
  for (const [name, expected] of Object.entries(BASE_ENV_PARAMS)) {
    requireEqual(envParams[name], expected, 'BASE_BINDING_DRIFT', `cloudbaserc.deploy.envParams.${name}`);
  }
  for (const name of NEW_ENV_NAMES) {
    if (!isEnvReference(envParams[name], name)) fail('ENV_BINDING_MISSING', `cloudbaserc.deploy.envParams.${name}`);
  }
}

function validateContract(contract) {
  requireExactKeys(contract, ROOT_KEYS, 'contract');
  requireEqual(contract.schemaVersion, 1, 'SCHEMA_VERSION_INVALID', 'contract.schemaVersion');
  requireEqual(contract.profile, 'production', 'PROFILE_INVALID', 'contract.profile');
  requireEqual(contract.serverRoles, SERVER_ROLES, 'SERVER_ROLE_INVALID', 'contract.serverRoles');

  requireRecord(contract.envBindings, 'contract.envBindings');
  for (const name of NEW_ENV_NAMES) {
    if (!Object.hasOwn(contract.envBindings, name)) fail('ENV_BINDING_MISSING', `contract.envBindings.${name}`);
  }
  requireExactKeys(contract.envBindings, NEW_ENV_NAMES, 'contract.envBindings');
  for (const name of NEW_ENV_NAMES) {
    if (!isEnvReference(contract.envBindings[name], name)) fail('ENV_BINDING_MISSING', `contract.envBindings.${name}`);
  }

  requireExactKeys(contract.trustProxy, ['strategy', 'cidrsEnv', 'hopsEnv'], 'contract.trustProxy');
  if (contract.trustProxy.strategy !== 'cidrs' || contract.trustProxy.cidrsEnv !== 'TRUST_PROXY_CIDRS' || contract.trustProxy.hopsEnv !== null) {
    fail('TRUST_PROXY_STRATEGY_INVALID', 'contract.trustProxy');
  }

  requireExactKeys(contract.features, ['backup', 'remote'], 'contract.features');
  requireExactKeys(contract.features.backup, ['defaultEnabled', 'enableEnv', 'exactOptInValue'], 'contract.features.backup');
  if (contract.features.backup.defaultEnabled !== false) fail('FEATURE_DEFAULT_ON', 'contract.features.backup.defaultEnabled');
  requireEqual(contract.features.backup.enableEnv, 'BACKUP_ENABLED', 'FEATURE_BINDING_INVALID', 'contract.features.backup.enableEnv');
  requireEqual(contract.features.backup.exactOptInValue, '1', 'FEATURE_OPT_IN_INVALID', 'contract.features.backup.exactOptInValue');

  requireExactKeys(contract.features.remote, [
    'defaultEnabled',
    'enableEnv',
    'exactOptInValue',
    'activationAllowed',
    'readinessGate',
    'relayPath',
    'transport',
    'defaultPort',
    'queryAllowed',
  ], 'contract.features.remote');
  if (contract.features.remote.defaultEnabled !== false) fail('FEATURE_DEFAULT_ON', 'contract.features.remote.defaultEnabled');
  requireEqual(contract.features.remote.enableEnv, 'REMOTE_RELAY_ENABLED', 'FEATURE_BINDING_INVALID', 'contract.features.remote.enableEnv');
  requireEqual(contract.features.remote.exactOptInValue, '1', 'FEATURE_OPT_IN_INVALID', 'contract.features.remote.exactOptInValue');
  if (contract.features.remote.activationAllowed !== false || contract.features.remote.readinessGate !== 'blocked-pending-remote-runtime-readiness') {
    fail('REMOTE_ACTIVATION_BLOCKED', 'contract.features.remote');
  }
  requireEqual(contract.features.remote.relayPath, '/v1/remote/ws', 'REMOTE_ROUTE_INVALID', 'contract.features.remote.relayPath');
  requireEqual(contract.features.remote.transport, 'wss', 'REMOTE_TRANSPORT_INVALID', 'contract.features.remote.transport');
  requireEqual(contract.features.remote.defaultPort, 443, 'REMOTE_TRANSPORT_INVALID', 'contract.features.remote.defaultPort');
  requireEqual(contract.features.remote.queryAllowed, false, 'REMOTE_TRANSPORT_INVALID', 'contract.features.remote.queryAllowed');

  requireExactKeys(contract.issuerMount, [
    'provider',
    'targetPath',
    'pathBinding',
    'repoEmbedded',
    'imageEmbedded',
    'loggable',
    'filePolicy',
  ], 'contract.issuerMount');
  requireEqual(contract.issuerMount.provider, 'external', 'ISSUER_PROVIDER_INVALID', 'contract.issuerMount.provider');
  const targetPath = contract.issuerMount.targetPath;
  if (typeof targetPath !== 'string' || !path.posix.isAbsolute(targetPath) || targetPath.includes('..') || /^\/(?:app|workspace|repo|Users|home)(?:\/|$)/.test(targetPath)) {
    fail('ISSUER_MOUNT_PATH_INVALID', 'contract.issuerMount.targetPath');
  }
  requireExactKeys(contract.issuerMount.pathBinding, ['envName', 'envReference', 'expectedValue'], 'contract.issuerMount.pathBinding');
  requireEqual(contract.issuerMount.pathBinding.envName, 'REMOTE_PAIRING_ISSUER_KEY_PATH', 'ISSUER_PATH_BINDING_INVALID', 'contract.issuerMount.pathBinding.envName');
  requireEqual(contract.issuerMount.pathBinding.envReference, '${env.REMOTE_PAIRING_ISSUER_KEY_PATH}', 'ISSUER_PATH_BINDING_INVALID', 'contract.issuerMount.pathBinding.envReference');
  if (contract.issuerMount.pathBinding.expectedValue !== targetPath) fail('ISSUER_PATH_MISMATCH', 'contract.issuerMount.pathBinding.expectedValue');
  if (contract.issuerMount.repoEmbedded !== false || contract.issuerMount.imageEmbedded !== false || contract.issuerMount.loggable !== false) {
    fail('ISSUER_EMBEDDING_FORBIDDEN', 'contract.issuerMount');
  }

  const policy = contract.issuerMount.filePolicy;
  requireExactKeys(policy, ['format', 'mode', 'ownership', 'regularFile', 'nlink', 'allowSymlink', 'followSymlink', 'maxBytes'], 'contract.issuerMount.filePolicy');
  if (policy.format !== 'ed25519-pkcs8-pem' || policy.mode !== '0600' || policy.ownership !== 'runtime-uid' || policy.regularFile !== true || policy.nlink !== 1 || policy.allowSymlink !== false || policy.followSymlink !== false || policy.maxBytes !== 65536) {
    fail('ISSUER_FILE_POLICY_INVALID', 'contract.issuerMount.filePolicy');
  }

  requireExactKeys(contract.backupBoundary, ['ciphertextOnly', 'localAuthoritative', 'cloudSourceOfTruth', 'objectPrefix', 'allowedObjectVerbs'], 'contract.backupBoundary');
  if (contract.backupBoundary.ciphertextOnly !== true || contract.backupBoundary.localAuthoritative !== true || contract.backupBoundary.cloudSourceOfTruth !== false) {
    fail('BACKUP_BOUNDARY_INVALID', 'contract.backupBoundary');
  }
  requireEqual(contract.backupBoundary.objectPrefix, 'backup/v1/', 'BACKUP_BOUNDARY_INVALID', 'contract.backupBoundary.objectPrefix');
  requireEqual(contract.backupBoundary.allowedObjectVerbs, ['PUT', 'GET', 'HEAD', 'DELETE'], 'BACKUP_BOUNDARY_INVALID', 'contract.backupBoundary.allowedObjectVerbs');

  requireExactKeys(contract.activationGates, ['backupCiphertextEndToEndRequired', 'remoteRuntimeReadinessRequired', 'remoteLiveMountTlsEvidenceRequired'], 'contract.activationGates');
  if (contract.activationGates.backupCiphertextEndToEndRequired !== true || contract.activationGates.remoteRuntimeReadinessRequired !== true || contract.activationGates.remoteLiveMountTlsEvidenceRequired !== true) {
    fail('ACTIVATION_GATE_INVALID', 'contract.activationGates');
  }
}

export function validateProductionDeploymentContract({ cloudbase, schema, contract }) {
  scanForbidden(cloudbase, 'cloudbaserc');
  scanForbidden(contract, 'contract');
  validateSchema(schema);
  validateCloudbase(cloudbase);
  validateContract(contract);
  return {
    schemaVersion: 1,
    profile: 'production',
    envBindings: NEW_ENV_NAMES.length,
    backupDefaultEnabled: false,
    remoteDefaultEnabled: false,
    remoteActivationAllowed: false,
  };
}

async function readJson(filePath, field) {
  try {
    return JSON.parse(await readFile(filePath, 'utf8'));
  } catch {
    fail('JSON_READ_INVALID', field);
  }
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!['--cloudbaserc', '--schema', '--contract'].includes(key) || !value) fail('CLI_ARGUMENT_INVALID', 'argv');
    options[key.slice(2)] = path.resolve(value);
  }
  return options;
}

async function main() {
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const appRoot = path.resolve(scriptDir, '..');
  const options = parseArgs(process.argv.slice(2));
  const paths = {
    cloudbaserc: options.cloudbaserc ?? path.join(appRoot, 'cloudbaserc.json'),
    schema: options.schema ?? path.join(appRoot, 'deployment', 'production-deployment-contract.schema.json'),
    contract: options.contract ?? path.join(appRoot, 'deployment', 'production-deployment-contract.example.json'),
  };
  const result = validateProductionDeploymentContract({
    cloudbase: await readJson(paths.cloudbaserc, 'cloudbaserc.json'),
    schema: await readJson(paths.schema, 'production-deployment-contract.schema.json'),
    contract: await readJson(paths.contract, 'production-deployment-contract.example.json'),
  });
  process.stdout.write(`PRODUCTION_DEPLOYMENT_CONFIG_VALID schemaVersion=${result.schemaVersion} envBindings=${result.envBindings} backupDefault=OFF remoteDefault=OFF remoteActivation=BLOCKED\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    if (error instanceof ProductionDeploymentConfigError) {
      process.stderr.write(`${error.message}\n`);
    } else {
      process.stderr.write('PRODUCTION_DEPLOYMENT_CONFIG_INVALID code=INTERNAL field=validator\n');
    }
    process.exitCode = 1;
  });
}
