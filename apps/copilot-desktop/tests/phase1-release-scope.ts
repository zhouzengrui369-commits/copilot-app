export const PHASE1_RELEASE_EXCLUSIONS = Object.freeze([
  'tests/KnowledgeWorkspace.wiki-truth-r1.test.tsx',
  'tests/backup/**',
  'tests/demo-first-prototype-r1.test.tsx',
  'tests/integration/reversible-trash-desktop-ui-r1.integration.test.ts',
  'tests/integration/reversible-trash-source-r1.integration.test.ts',
  'tests/local-asr-package-contract.test.ts',
  'tests/post-package-evidence.test.ts',
  'tests/r22-startup-lazy-red.test.tsx',
  'tests/r22-v3-run-identity-evidence-adversarial.test.ts',
  'tests/r31-v1-candidate-bound-performance-adversarial.test.ts',
  'tests/remote/**',
]);

export const PHASE1_RELEASE_EXCLUSION_RATIONALE = Object.freeze({
  'tests/KnowledgeWorkspace.wiki-truth-r1.test.tsx': 'Superseded renderer fixture; digest-bound WIKI is gated by current packaged Electron journeys and LocalKnowledgeService contracts.',
  'tests/backup/**': 'Encrypted Backup is owner-deferred and outside the Phase 1 local-first candidate.',
  'tests/demo-first-prototype-r1.test.tsx': 'Browser prototype assertions are not packaged-runtime release evidence.',
  'tests/integration/reversible-trash-desktop-ui-r1.integration.test.ts': 'Reversible Trash recovery remains source debt and is not promoted by the Phase 1 candidate.',
  'tests/integration/reversible-trash-source-r1.integration.test.ts': 'Reversible Trash recovery remains source debt and is not promoted by the Phase 1 candidate.',
  'tests/local-asr-package-contract.test.ts': 'Historical immutable SHA snapshot; current ASR source/build/package closure is checked by the canonical builder and packaged Electron.',
  'tests/post-package-evidence.test.ts': 'Distribution-only signed evidence schema; unsigned diagnostic candidate uses the R30 canonical manifest and remains release-blocked.',
  'tests/r22-startup-lazy-red.test.tsx': 'Superseded r22 source-shape contract; current startup is validated by candidate-bound r31 performance.',
  'tests/r22-v3-run-identity-evidence-adversarial.test.ts': 'Superseded r22 performance evidence contract.',
  'tests/r31-v1-candidate-bound-performance-adversarial.test.ts': 'Depends on a private historical task snapshot; executable r31-v1 runtime is re-bound by scripts/candidate-r30/performance.mjs.',
  'tests/remote/**': 'Remote pairing/control is owner-deferred and outside the Phase 1 local-first candidate.',
});
