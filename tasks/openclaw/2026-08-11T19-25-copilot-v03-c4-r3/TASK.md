# TASK — COPILOT-SKE-V03-C4-R3

## Required proof

1. Preserve the C4 R1 Agent API behavior already proven by the complete KB suite.
2. Adopt R2 capability hardening:
   - malformed expiry becomes a stable capability error;
   - non-object/array sessions fail closed before nested access.
3. Exercise structural manifest fallbacks for namespaces, purposes, object types, expiry and manifest identity.
4. Keep write target enforcement bound to namespace/purpose/consumer/privacy/object-type policy and `WRITE_PROPOSAL` only.
5. Run the unchanged v0.3 source gate from a fresh exact R3 Head.
6. Require all Shared Engine files to meet per-file >=90% statements/lines/branches/functions.
7. Require storage-neutral scan and tracked-source-clean proof after strict coverage.

## Acceptance

```text
C4_COMPLETE_KB_REGRESSION=PASS
C4_CAPABILITY_STRUCTURAL_FAIL_CLOSED=PASS
C4_POLICY_FILTERED_READ=PASS
C4_POLICY_FILTERED_RETRIEVAL=PASS
C4_WRITE_TARGET_POLICY=PASS
C4_WRITE_PROPOSAL_ONLY=PASS
C4_TERMINAL_WRITE_AUTHORITY=ABSENT
C4_CONTENT_SAFE_AUDIT=PASS
C4_STRICT_PER_FILE_COVERAGE=PASS
C4_STORAGE_NEUTRAL=PASS
C4_SOURCE_CLEAN=PASS
```

## Forbidden

No threshold reduction, test skip, rerun of failed R1 SHA, PR #20/main mutation, C3 bypass merge, physical schema/dependency/lock/Runtime change, D3, signing, notarization or release.
