# RESULT — COPILOT-SKE-V03-C4-R3

## Verdict

```text
C4_R3_SOURCE_GATE=PASS
C4_AGENT_CONTRACT_SOURCE_PASS=PASS
C4_SOURCE_GATED_SHA=f10226c58f8e4a0ee18339fe8238b47347619d32
C4_SOURCE_GATE_RUN=31486885217
C4_SOURCE_GATE_JOB=93764214771
```

## Exact verification

Environment:

```text
RUNNER=macos-14-arm64
NODE=v24.18.0
NPM=11.16.0
PYTHON=3.9.6
NPM_CI_PACKAGES=1454
```

Tests:

```text
C1_FOCUSED_TESTS=28/28_PASS
COMPLETE_KB_TEST_FILES=22/22_PASS
COMPLETE_KB_TESTS=255/255_PASS
SHARED_ENGINE_STRICT_TEST_FILES=9/9_PASS
SHARED_ENGINE_STRICT_TESTS=121/121_PASS
```

Strict Shared Engine coverage:

```text
STATEMENTS=99.77%
BRANCHES=97.29%
FUNCTIONS=100%
LINES=99.77%
PER_FILE_THRESHOLD=90%_ALL_FOUR_DIMENSIONS
```

C4-specific strict coverage:

```text
agent-api.ts=99.12_STMTS/94.44_BRANCH/100_FUNCS/99.12_LINES
agent-conformance.ts=100/100/100/100
capability.ts=100_STMTS/96.87_BRANCH/100_FUNCS/100_LINES
```

The R1 coverage blocker (`capability.ts branches=89.83%`) is closed by R3 structural fail-closed coverage without lowering the threshold.

## Contract behavior proven

```text
C4_VERSION_NEGOTIATION=PASS
C4_CAPABILITY_MANIFEST=PASS
C4_CAPABILITY_STRUCTURAL_FAIL_CLOSED=PASS
C4_EXPIRED_CAPABILITY=DENIED
C4_POLICY_FILTERED_OBJECT_READ=PASS
C4_POLICY_FILTERED_RETRIEVAL=PASS
C4_READ_ONLY_WRITE=DENIED
C4_WRITE_TARGET_POLICY=PASS
C4_WRITE_PROPOSAL_ONLY=PASS
C4_TERMINAL_WRITE_AUTHORITY=ABSENT
C4_CONTENT_SAFE_AUDIT=PASS
C4_CONFORMANCE_FIXTURE=PASS
C4_STORAGE_NEUTRAL=PASS
C4_SOURCE_CLEAN=PASS
```

## Guardrails verified

```text
PACKAGE_JSON_CHANGE=NONE
PACKAGE_LOCK_CHANGE=NONE
DEPENDENCY_CHANGE=NONE
LEGACY_CRITICAL_INPUTS_UNCHANGED=PASS
LEGACY_CRITICAL_COVERAGE_DEBT=TRACKED_IN_ISSUE_44
PHYSICAL_SCHEMA_EXPOSED_AS_CONTRACT=NO
PR20_SOURCE_CHANGE=NO
MAIN_CHANGE=NO
ELECTRON_RUNTIME_CHANGE=NO
D3_ENABLEMENT=NO
```

## Lineage adjudication

- C4 R1 PR #47 is closed unmerged as superseded.
- R1 functional behavior passed but strict per-file coverage failed on the exact R1 SHA; it was not rerun.
- The pre-existing R2 branch contributed stronger capability/session structural validation but was incomplete as the complete C4 implementation.
- R3 is the sole accepted C4 source successor: complete R1 behavior + R2 structural hardening + dedicated structural fail-closed tests.

## Dependency / claim ceiling

C3 PR #46 remains source-accepted but Draft/unmerged at the moment this result is written. Therefore C4 may be source-accepted but cannot merge ahead of C3.

```text
C3_DEPENDENCY=UNRESOLVED_AT_RESULT_WRITE
MCP_API_SDK_TRANSPORT=NOT_IMPLEMENTED
REFERENCE_IMPLEMENTATION=NOT_YET
PRODUCT_RUNTIME=NOT_CHANGED
LOCAL_RUNTIME_PROOF=NOT_YET
MERGE_TO_MAIN=FORBIDDEN
```
