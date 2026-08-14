# Native proxy graceful-control R1 test receipt

## Verdict

`SOURCE_CONTRACT_PASS / LOCAL_CANDIDATE_NOT_RUN / NOT_RUNTIME_PROOF`

## R5 evidence basis

- Source SHA: `6d609d9c989a16e143d38e7a33b2d69d01f1d442`
- Source tree: `1b2ffaf673617393f42234f7a54bc1ded801687d`
- Evidence root: `/Users/njx/copilot-evidence/6d609d9c989a16e143d38e7a33b2d69d01f1d442-20260814T020338Z`
- R5 source contract: `112/112 PASS`, executions `1`
- Hydration: executions `1`, exit `2`, `automaticRetry=false`, `npmFetchRetries=0`
- Proxy total: requests `5`, allowed `5`, denied `0`, transport errors `1`, upstream-to-client bytes `121555082`
- Terminal request: `github.com:443`, upstream `ETIMEDOUT`, upstream-to-client bytes `3088`
- Downstream error: Electron `install.js` `RequestError: socket hang up`
- Dry-run, Candidate, package, App, E2E and performance executions: `0`

R5 is immutable and none of its cache, worktree, receipt or evidence paths may be reused.

## Repair contract

Graceful EOF is eligible only when all are true:

```text
host=github.com
error=ETIMEDOUT
bytesUpstreamToClient >= 1
bytesUpstreamToClient <= 65536
downstreamValidationRequired=true
```

Every release-assets error, zero-byte response, oversized response, non-timeout error and other host remains `fail-closed-destroy`. The repair adds no retry, resume, mirror, host, port, cache reuse or Candidate network permission.

## Verification

Focused transport, receipt audit and hydrator suites passed before the full contract.

The complete command was run in the non-nested macOS environment:

```text
node --test scripts/candidate-r30/*.test.mjs
```

Result:

```text
tests=117
pass=117
fail=0
skipped=0
cancelled=0
```

The same command inside the nested Codex sandbox produced `116/117 PASS`; its only failure was the existing real `/usr/bin/sandbox-exec` grammar smoke with `sandbox_apply: Operation not permitted`. The non-nested run passed that exact smoke test.

## Remaining gates

- Commit/push exact PR #54 head: pending.
- GitHub source gate on new exact head: pending.
- R6 hydration/Candidate/package/App/E2E/performance: not run.
- Parent PM packaged acceptance: pending.
- Signing, notarization, release and Human Owner milestone: not run.
