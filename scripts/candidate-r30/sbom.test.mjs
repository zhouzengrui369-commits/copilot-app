import test from 'node:test';
import assert from 'node:assert/strict';
import { parseAndValidateCycloneDxSbom, validateCycloneDxSbom } from './sbom.mjs';

function validSbom(rootName = 'openclaw-workbench') {
  return {
    bomFormat: 'CycloneDX',
    specVersion: '1.6',
    serialNumber: 'urn:uuid:00000000-0000-4000-8000-000000000001',
    version: 1,
    metadata: {
      component: {
        type: 'application',
        name: rootName,
        version: '0.1.0',
        'bom-ref': `${rootName}@0.1.0`,
        purl: `pkg:npm/${rootName}@0.1.0`,
      },
    },
    components: [
      {
        type: 'library',
        name: 'react',
        version: '19.0.0',
        purl: 'pkg:npm/react@19.0.0',
        'bom-ref': 'react@19.0.0',
      },
    ],
    dependencies: [
      { ref: `${rootName}@0.1.0`, dependsOn: ['react@19.0.0'] },
    ],
  };
}

test('accepts package and npm 11 checkout-root identities with exact version', () => {
  const canonicalSbom = validSbom();
  const canonical = validateCycloneDxSbom(canonicalSbom);
  const repeated = parseAndValidateCycloneDxSbom(JSON.stringify(canonicalSbom)).identity;
  const checkoutNamed = validateCycloneDxSbom(validSbom('copilot-app'));

  assert.deepEqual(canonical.root, {
    type: 'application',
    name: 'openclaw-workbench',
    version: '0.1.0',
  });
  assert.deepEqual(checkoutNamed.root, {
    type: 'application',
    name: 'copilot-app',
    version: '0.1.0',
  });
  assert.equal(canonical.componentCount, 1);
  assert.equal(canonical.dependencyRelationCount, 1);
  assert.match(canonical.contentSha256, /^[0-9a-f]{64}$/u);
  assert.equal(canonical.contentSha256, repeated.contentSha256);
});

test('supports an explicitly narrowed expected root contract', () => {
  assert.equal(
    validateCycloneDxSbom(validSbom('copilot-app'), {
      expectedName: 'copilot-app',
      expectedVersion: '0.1.0',
    }).root.name,
    'copilot-app',
  );
  assert.throws(
    () => validateCycloneDxSbom(validSbom('openclaw-workbench'), {
      expectedNames: ['copilot-app'],
      expectedVersion: '0.1.0',
    }),
    /BLOCKED_GATE_05_SBOM_ROOT_COMPONENT/u,
  );
});

test('rejects malformed format, root, duplicate refs, bad purl, private paths, and secrets', () => {
  const cases = [
    { mutate: (value) => { value.bomFormat = 'SPDX'; }, code: /BLOCKED_GATE_05_SBOM_FORMAT/u },
    { mutate: (value) => { value.metadata.component.type = 'library'; }, code: /BLOCKED_GATE_05_SBOM_ROOT_COMPONENT/u },
    { mutate: (value) => { value.metadata.component.name = 'unexpected-root'; }, code: /BLOCKED_GATE_05_SBOM_ROOT_COMPONENT/u },
    { mutate: (value) => { value.metadata.component.version = '0.2.0'; }, code: /BLOCKED_GATE_05_SBOM_ROOT_COMPONENT/u },
    { mutate: (value) => { value.metadata.component['bom-ref'] = ''; }, code: /BLOCKED_GATE_05_SBOM_ROOT_COMPONENT/u },
    { mutate: (value) => { value.metadata.component.purl = 'https://example.invalid/root'; }, code: /BLOCKED_GATE_05_SBOM_ROOT_COMPONENT/u },
    { mutate: (value) => { value.components.push({ ...value.components[0] }); }, code: /BLOCKED_GATE_05_SBOM_COMPONENT_DUPLICATE/u },
    { mutate: (value) => { value.components[0].purl = 'https://example.invalid/react'; }, code: /BLOCKED_GATE_05_SBOM_PURL_INVALID/u },
    { mutate: (value) => { value.components[0].description = '/Users/njx/private'; }, code: /BLOCKED_GATE_05_SBOM_PRIVATE_PATH_OR_SECRET/u },
    { mutate: (value) => { value.components[0].description = 'sk-' + 'a'.repeat(24); }, code: /BLOCKED_GATE_05_SBOM_PRIVATE_PATH_OR_SECRET/u },
  ];
  for (const item of cases) {
    const value = validSbom(); item.mutate(value);
    assert.throws(() => validateCycloneDxSbom(value), item.code);
  }
  assert.throws(
    () => validateCycloneDxSbom(validSbom(), { expectedNames: [] }),
    /BLOCKED_GATE_05_SBOM_EXPECTED_ROOT_INVALID/u,
  );
  assert.throws(() => parseAndValidateCycloneDxSbom('{'), /BLOCKED_GATE_05_SBOM_JSON/u);
});
