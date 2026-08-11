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

/**
 * Global V8 coverage measures the Phase 1 end-user product boundary, not
 * owner-deferred subsystems or process/bootstrap files whose executable truth
 * is established by packaged Electron, canonical release and performance gates.
 */
export const PHASE1_RELEASE_SOURCE_EXCLUSIONS = Object.freeze([
  'src/main/backup-integration/**',
  'src/main/backup/**',
  'src/main/direct-performance-probe.ts',
  'src/main/local-asr/local-asr-worker.ts',
  'src/main/local-telemetry.ts',
  'src/main/main.ts',
  'src/main/remote/**',
  'src/renderer/components/RemoteManagement/**',
  'src/renderer/components/Settings/Backup*.tsx',
  'src/renderer/main.tsx',
  'src/renderer/prototype/**',
  'src/shared/backup-management.ts',
  'src/shared/remote-management.ts',
]);

export const PHASE1_RELEASE_SOURCE_EXCLUSION_RATIONALE = Object.freeze({
  'src/main/backup-integration/**': 'Encrypted Backup integration is owner-deferred; no Backup implementation is promoted or claimed by the Phase 1 local-first candidate.',
  'src/main/backup/**': 'Encrypted Backup engine and container code are owner-deferred and remain outside the Phase 1 local-first candidate boundary.',
  'src/main/direct-performance-probe.ts': 'Candidate-only performance instrumentation is executed and bound by the three-run r31-v1 performance gate rather than jsdom source coverage.',
  'src/main/local-asr/local-asr-worker.ts': 'The isolated ASR worker entrypoint is validated through manager/worker contracts and packaged execution; importing it into the unit process would change worker lifecycle semantics.',
  'src/main/local-telemetry.ts': 'Telemetry is non-functional observability infrastructure and must not inflate or depress end-user product coverage; failure containment remains covered separately.',
  'src/main/main.ts': 'Electron main-process bootstrap and composition execute only in the packaged runtime and are verified by build, exact packaged Electron and candidate performance gates.',
  'src/main/remote/**': 'Remote pairing and control are owner-deferred and no Remote implementation is promoted or claimed by the Phase 1 local-first candidate.',
  'src/renderer/components/RemoteManagement/**': 'Remote management UI is owner-deferred together with the Remote runtime and is not part of the Phase 1 local-first candidate.',
  'src/renderer/components/Settings/Backup*.tsx': 'Backup consent and settings UI are owner-deferred together with the Backup runtime and are not part of the Phase 1 local-first candidate.',
  'src/renderer/main.tsx': 'Renderer bootstrap is verified by packaged Electron application-root visibility and must not be imported as a second side-effectful jsdom entrypoint.',
  'src/renderer/prototype/**': 'The browser-only prototype adapter is demonstration infrastructure and is not shipped as the authoritative packaged Electron data path.',
  'src/shared/backup-management.ts': 'Backup renderer contracts are owner-deferred with the Backup subsystem and are not exposed by the Phase 1 candidate.',
  'src/shared/remote-management.ts': 'Remote renderer contracts are owner-deferred with the Remote subsystem and are not exposed by the Phase 1 candidate.',
});
