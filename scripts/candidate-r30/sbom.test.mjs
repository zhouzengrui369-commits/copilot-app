import test from 'node:test';
import assert from 'node:assert/strict';
import { parseAndValidateCycloneDxSbom, validateCycloneDxSbom } from './sbom.mjs';

function validSbom() {
  return {
    bomFormat: 'CycloneDX',
    specVersion: '1.6',
    serialNumber: 'urn:uuid:00000000-0000-4000-8000-000000000001',
    version: 1,
    metadata: {
      component: {
        type: 'application',
        name: 'openclaw-workbench',
        version: '0.1.0',
        'bom-ref': 'openclaw-workbench@0.1.0',
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
      { ref: 'openclaw-workbench@0.1.0', dependsOn: ['react@19.0.0'] },
    ],
  };
}

test('accepts a CycloneDX application SBOM and returns stable public identity', () => {
  const sbom = validSbom();
  const first = validateCycloneDxSbom(sbom);
  const repeated = parseAndValidateCycloneDxSbom(JSON.stringify(sbom)).identity;
  assert.deepEqual(first.root, { type: 'application', name: 'openclaw-workbench', version: '0.1.0' });
  assert.equal(first.componentCount, 1);
  assert.equal(first.dependencyRelationCount, 1);
  assert.match(first.contentSha256, /^[0-9a-f]{64}$/u);
  assert.equal(first.contentSha256, repeated.contentSha256);
});

test('rejects malformed format, root, duplicate refs, bad purl, private paths, and secrets', () => {
  const cases = [
    { mutate: (value) => { value.bomFormat = 'SPDX'; }, code: /BLOCKED_GATE_05_SBOM_FORMAT/u },
    { mutate: (value) => { value.metadata.component.type = 'library'; }, code: /BLOCKED_GATE_05_SBOM_ROOT_COMPONENT/u },
    { mutate: (value) => { value.components.push({ ...value.components[0] }); }, code: /BLOCKED_GATE_05_SBOM_COMPONENT_DUPLICATE/u },
    { mutate: (value) => { value.components[0].purl = 'https://example.invalid/react'; }, code: /BLOCKED_GATE_05_SBOM_PURL_INVALID/u },
    { mutate: (value) => { value.components[0].description = '/Users/njx/private'; }, code: /BLOCKED_GATE_05_SBOM_PRIVATE_PATH_OR_SECRET/u },
    { mutate: (value) => { value.components[0].description = 'sk-' + 'a'.repeat(24); }, code: /BLOCKED_GATE_05_SBOM_PRIVATE_PATH_OR_SECRET/u },
  ];
  for (const item of cases) {
    const value = validSbom(); item.mutate(value);
    assert.throws(() => validateCycloneDxSbom(value), item.code);
  }
  assert.throws(() => parseAndValidateCycloneDxSbom('{'), /BLOCKED_GATE_05_SBOM_JSON/u);
});
