# Next-best work audit r2

**Audit mode:** read-only selection; this file is the only deliverable.  
**Decision:** `SELECT_BACKUP_RESTORE_IMPORT_AS_COPY_SOURCE_R6`  
**Release meaning:** source work only. It cannot close live COS, Electron execution, coverage, E2E, dual-platform real-device, signing, final-candidate, or Phase 1 MVP gates.

## 1. Fact baseline

- `delivery.md` post SHA256: `ec83872ac18d8355cf6c83d4e123f46944ff76ff00bc9dfb415b7bf679ee00ba`.
- `tasks/codex/2026-07-14T17-11-phase1-mvp-codex-takeover/RESULT.md` SHA256: `73a28cbb282d6c2a546e475b8a879eca52ab181128de82a39055d81a50f704d3`.
- `tasks/codex/2026-07-14T17-11-phase1-mvp-codex-takeover/EVIDENCE.md` SHA256: `6952620cff5c29789f718e6cc3fd6828e6c7d1baf205bd99a22d26b9050532f1`.
- Project truth remains `IN_PROGRESS / PARTIAL_BLOCKED / MVP_NOT_COMPLETE / RELEASE_NOT_READY`.
- Closed/excluded from this audit: baseline amendment, r31 static contract, T-1.4.6 docs static, owner-authorization lanes for macOS release/Tencent configuration/Remote readiness/Git publish, resource-unsafe test/Electron/build execution, and external Apple/Tencent/ASR model inputs.

## 2. Candidate result

| Candidate | Current fact | Audit result |
|---|---|---|
| Strict-local ASR production path | WebSpeech is fail-closed; sherpa-onnx still needs a licensed model download, native Electron decode, real microphone and packaging/signing proof | Exclude: no honest source-only continuation before the external model/native spike gate |
| Coverage routing | Static routing is already accepted; the remaining evidence is the controlled execution of the 13 coverage commands | Exclude: resource/execution gate, not a source defect |
| Electron integration/E2E evidence routing | Routing has no identified source defect; Backup/Pairing/Trash and full Electron operation evidence remain not executed/not reachable | Exclude: Electron execution gate |
| Final-candidate document placeholders | Static docs are closed; placeholders truthfully say `PENDING_REAL_FINAL_CANDIDATE_EVIDENCE` | Exclude: replacing them without artifacts would fabricate evidence |
| Backup restore | Download, verify and in-memory preview exist, but apply is absent; UI explicitly says import apply and replace-current are unavailable | **Select:** highest-value user-data recovery gap that can advance without cloud, signing, model download or release authorization |

The selected gap is not a cosmetic UI addition. The current manager downloads, verifies, decrypts and produces an import-as-copy plan, then discards the temporary plaintext. There is no operation that restores verified user content into local truth. A backup that cannot be applied does not complete the recovery user journey.

## 3. Bounded implementation contract

**Task ID:** `T-BACKUP-A-R6-RESTORE-APPLY-SOURCE`  
**Goal:** add a separate, explicit **Import verified copy** operation for supported local user data after restore preview. It must never overwrite current data and must not make `replace-current` available.

### Required behavior

1. Keep preview and apply as two separate commands. Apply requires a fresh, command-bound approval containing the exact snapshot ID, ciphertext SHA256, selected scopes, preview digest, generation and expiry.
2. On apply, re-download and re-run the existing container inspection/decrypt/digest/schema checks. Do not trust cached preview bytes and do not retain plaintext beyond the operation.
3. R6 supports only the complete set `note-markdown + note-metadata`, with optional `todos`. Any `preferences`, KB index, KG, partial note pair, malformed record or unknown scope rejects the entire operation **before first mutation**. No silent partial restore.
4. Import notes under a deterministic, non-colliding namespace derived from `snapshotId`; preserve original logical path in metadata. Generate new Todo IDs and remap Todo links only to imported note paths. Never overwrite an existing note or Todo.
5. Preflight every record and conflict before mutation. Persist a mode-`0600` restore intent before first write. On any failure or restart recovery, delete only objects created under that exact import namespace and leave no visible notes, Todos or trash residue. Success is returned only after the intent is durably cleared.
6. Return an auditable result containing snapshot ID, preview digest, imported note/Todo counts, deterministic import namespace, conflict count, rollback status and `replaceCurrentAvailable:false`.
7. Surface the result in Backup settings. The CTA and copy must say **Import verified copy**; do not use wording that implies replacement, merge, cloud recovery completion or release readiness.

### Allowed existing files and immutable preimages

| File | SHA256 preimage |
|---|---|
| `apps/copilot-desktop/src/shared/backup-management.ts` | `4bf4d632f020ef8cb114a48c3204797ba09b92b1ce320d2c22f0e3e4b541ff15` |
| `apps/copilot-desktop/src/shared/ipc-channels.ts` | `f29e9c17dee7b5cd37e1d531866d85fc5bff5c12bb5d8ea77859bfb33e60b8bd` |
| `apps/copilot-desktop/src/main/backup-integration/approval.ts` | `b5bdaad6bc4910dc66bf3d4242af52ea90f3e1674fc1d0e02593d8a79aad72f9` |
| `apps/copilot-desktop/src/main/backup-integration/repository.ts` | `aa02558273ea79366ead4e579a08e9d3f249927c4e42b0bbc7f44a95281544bb` |
| `apps/copilot-desktop/src/main/backup-integration/source.ts` | `717b497ae3163f0ea906e832dad69e17088d9980f3c63f84eefc8b1e80dfeece` |
| `apps/copilot-desktop/src/main/backup-integration/manager.ts` | `f798c3d1044ef9e134902db58c207c383a7afb034b6bcd0454714b2b30c1758d` |
| `apps/copilot-desktop/src/main/backup-integration/ipc.ts` | `9fd7ad80dfaa4d12c7a156480b6ffa424568a56b265c2ed85978bafbac20ab49` |
| `apps/copilot-desktop/src/main/backup-integration/production-runtime.ts` | `0092d05756c8f9d64e0d7177f37ee12e3629a3c6b7237fd0edd02d1e7b97ed9f` |
| `apps/copilot-desktop/src/main/local-knowledge-service.ts` | `2b3fb8b5bee51f960d343ebbdd1f073918210561a192dda80b232e1e77878be7` |
| `apps/copilot-desktop/src/main/preload.ts` | `06eae4c5f99f2734bc6014d46c2f240d8e817308432208c26a6b8bf5d8a801a9` |
| `apps/copilot-desktop/src/renderer/components/Settings/BackupManagementSettings.tsx` | `a4276a2e31ba4334cd2ae632f73bb3b2d3cf572a6a8180a5645c8c0d040f1a3d` |
| `apps/copilot-desktop/tests/e2e/current-security-surfaces.spec.ts` | `06863b7193cddfb2d93cea3937510b5071a01d74ad7dab05daf26a881893389a` |

Allowed new focused tests (must be absent at dispatch preflight):

- `apps/copilot-desktop/tests/backup/backup-integration-r6-restore-apply.test.ts`
- `apps/copilot-desktop/tests/backup/backup-ui-ipc-r2-restore-apply.test.tsx`
- `apps/copilot-desktop/tests/integration/backup-restore-import-as-copy-r1.integration.test.ts`

No other file is in scope. If any listed preimage differs at dispatch, stop as `BLOCKED_PREIMAGE_DRIFT`; do not merge around concurrent edits.

### Forbidden

- No change to `backup/engine.ts`, container format, cryptography, KDF, cloud adapter, Tencent configuration, package/build/signing configuration, model/ASR code, final-candidate docs, or delivery status.
- No replace-current, overwrite, destructive merge, plaintext export, long-lived decrypted temp file, implicit approval, mock-success path, or weakening of fail-closed behavior.
- No Electron launch, package/build, full coverage run, external network call, credential use, Git commit/push, or release claim in this source lane.
- Do not mark Backup, Remote, macOS/Windows signing, final candidate, or MVP complete from this task.

### Focused acceptance

Source acceptance requires real diff plus focused hermetic evidence for:

- approval replay/mismatch/expiry/generation rejection;
- corrupt container or unsupported/mixed scopes causing zero mutation;
- deterministic namespace and no-overwrite behavior;
- note body/metadata integrity and Todo ID/link remapping;
- injected failure after partial writes producing exact rollback with no trash residue;
- restart recovery from a persisted unfinished restore intent;
- preload exact-key allowlist, IPC payload validation, and truthful UI copy;
- the current `restorePreview` behavior and `replaceCurrentAvailable:false` remaining intact.

Expected task result is at most `SOURCE_PASS / ELECTRON_AND_RELEASE_EVIDENCE_BLOCKED`. Real Electron Backup upload/download/preview/apply/delete, live COS, signing, screenshots and final-candidate evidence remain separate mandatory gates.

## 4. Final judgment

Proceed next with the bounded R6 restore-apply source contract. It completes the missing local recovery action for the most important supported data while preserving local-first, no-overwrite and fail-closed boundaries. Do not substitute this source closure for the Phase 1 final goal.
