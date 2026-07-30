import { createHash } from 'node:crypto';
import { block } from './contract.mjs';
import { canonical } from './io.mjs';

const CYCLONEDX = 'CycloneDX';
const SPEC_VERSION = /^1\.(?:[5-9]|[1-9][0-9]+)$/u;
const PURL = /^pkg:/u;
const DEFAULT_ROOT_NAMES = Object.freeze(['openclaw-workbench', 'copilot-app']);
const DEFAULT_ROOT_VERSION = '0.1.0';

export function validateCycloneDxSbom(value, options = {}) {
  const expectedNames = options.expectedNames
    ?? (options.expectedName ? [options.expectedName] : DEFAULT_ROOT_NAMES);
  const expectedVersion = options.expectedVersion ?? DEFAULT_ROOT_VERSION;
  if (
    !Array.isArray(expectedNames)
    || expectedNames.length === 0
    || expectedNames.some((name) => typeof name !== 'string' || name.length === 0)
    || new Set(expectedNames).size !== expectedNames.length
    || typeof expectedVersion !== 'string'
    || expectedVersion.length === 0
  ) {
    block('BLOCKED_GATE_05_SBOM_EXPECTED_ROOT_INVALID', 5);
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    block('BLOCKED_GATE_05_SBOM_SCHEMA', 5, 'object required');
  }
  if (value.bomFormat !== CYCLONEDX || typeof value.specVersion !== 'string'
    || !SPEC_VERSION.test(value.specVersion)) {
    block('BLOCKED_GATE_05_SBOM_FORMAT', 5, `${String(value.bomFormat)}/${String(value.specVersion)}`);
  }
  const root = value.metadata?.component;
  if (root?.type !== 'application'
    || !expectedNames.includes(root?.name)
    || root?.version !== expectedVersion
    || typeof root?.['bom-ref'] !== 'string'
    || root['bom-ref'].length === 0
    || (root.purl !== undefined && (typeof root.purl !== 'string' || !PURL.test(root.purl)))) {
    block('BLOCKED_GATE_05_SBOM_ROOT_COMPONENT', 5);
  }
  if (!Array.isArray(value.components) || value.components.length === 0) {
    block('BLOCKED_GATE_05_SBOM_COMPONENTS_EMPTY', 5);
  }
  const refs = new Set();
  for (const component of value.components) {
    if (!component || typeof component !== 'object' || Array.isArray(component)
      || typeof component.name !== 'string' || component.name.length === 0
      || typeof component.version !== 'string' || component.version.length === 0
      || typeof component['bom-ref'] !== 'string' || component['bom-ref'].length === 0) {
      block('BLOCKED_GATE_05_SBOM_COMPONENT_INVALID', 5);
    }
    if (refs.has(component['bom-ref'])) block('BLOCKED_GATE_05_SBOM_COMPONENT_DUPLICATE', 5, component['bom-ref']);
    refs.add(component['bom-ref']);
    if (component.purl !== undefined && (typeof component.purl !== 'string' || !PURL.test(component.purl))) {
      block('BLOCKED_GATE_05_SBOM_PURL_INVALID', 5, component.name);
    }
  }
  if (!Array.isArray(value.dependencies)) block('BLOCKED_GATE_05_SBOM_DEPENDENCIES_INVALID', 5);
  const serialized = canonical(value);
  if (/\/(?:Users|home|private\/var\/folders)\//u.test(serialized)
    || /(?:BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY|sk-[A-Za-z0-9_-]{20,})/u.test(serialized)) {
    block('BLOCKED_GATE_05_SBOM_PRIVATE_PATH_OR_SECRET', 5);
  }
  return {
    format: CYCLONEDX,
    specVersion: value.specVersion,
    root: {
      type: root.type,
      name: root.name,
      version: root.version,
    },
    componentCount: value.components.length,
    dependencyRelationCount: value.dependencies.length,
    contentSha256: createHash('sha256').update(serialized).digest('hex'),
  };
}

export function parseAndValidateCycloneDxSbom(text, options) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    block('BLOCKED_GATE_05_SBOM_JSON', 5, error instanceof Error ? error.message : String(error));
  }
  return { parsed, identity: validateCycloneDxSbom(parsed, options) };
}
