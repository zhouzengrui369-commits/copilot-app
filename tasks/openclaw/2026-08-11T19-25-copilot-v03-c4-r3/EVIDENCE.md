# EVIDENCE — COPILOT-SKE-V03-C4-R3

## Authority

```text
REPOSITORY=zhouzengrui369-commits/copilot-app
PR=48
BRANCH=chatgpt/v03-c4-agent-capability-api-r3
SOURCE_GATED_SHA=f10226c58f8e4a0ee18339fe8238b47347619d32
SOURCE_GATE_RUN=31486885217
SOURCE_GATE_JOB=93764214771
C3_ACCEPTED_HEAD=7236d102013d2b909f4c0bd62f14516cf0e99939
ECOSYSTEM_SHA=e46c4be501c465884486a4417adca2e158a58ccc
SHARED_ENGINE_CONTRACT=0.3.0-draft
```

## Gate evidence

All workflow steps completed with `success`:

1. exact PR head checkout;
2. Node 24/toolchain identity;
3. unchanged package/lock authority;
4. legacy KB critical inputs byte-identical;
5. exact `npm ci` (`1454` packages);
6. `@copilot/kb` build;
7. `@copilot/kb` type check;
8. C1 focused conformance (`28/28`);
9. complete KB suite (`255/255`, `22/22` files);
10. global coverage;
11. strict Shared Engine per-file coverage (`121/121`, `9/9` files);
12. storage-neutral source scan;
13. tracked/untracked source-clean proof.

## Strict coverage table

```text
adapters.ts          100.00 / 95.74 / 100.00 / 100.00
agent-api.ts          99.12 / 94.44 / 100.00 /  99.12
agent-conformance.ts 100.00 /100.00 / 100.00 / 100.00
capability.ts        100.00 / 96.87 / 100.00 / 100.00
compiler.ts          100.00 / 98.41 / 100.00 / 100.00
conflict.ts          100.00 / 97.67 / 100.00 / 100.00
contract.ts          100.00 /100.00 / 100.00 / 100.00
identity.ts          100.00 /100.00 / 100.00 / 100.00
ingestion.ts         100.00 / 98.27 / 100.00 / 100.00
policy.ts            100.00 /100.00 / 100.00 / 100.00
projection.ts        100.00 /100.00 / 100.00 / 100.00
retrieval.ts          98.60 / 90.90 / 100.00 /  98.60
review.ts            100.00 / 96.66 / 100.00 / 100.00
write-proposal.ts    100.00 /100.00 / 100.00 / 100.00
```

Column order: statements / branches / functions / lines.

Strict aggregate:

```text
99.77 / 97.29 / 100.00 / 99.77
```

## C4 security/conformance evidence

Tests prove:

- deterministic normalized capability identities;
- exact version negotiation and session identity;
- unsupported versions, D2/D3 ceilings, unknown modes and expiry fail closed;
- malformed manifest/session structures fail closed before nested authority use;
- capability expiry is revalidated at operation time;
- read-by-ID returns only policy-authorized objects;
- C3 retrieval cannot be bypassed for stale or denied projections;
- denied reads/retrieval do not copy content, scores or projection payloads into Agent API receipts;
- read-only capabilities cannot write;
- proposal-capable agents may only create `WRITE_PROPOSAL` records and the proposal target must pass namespace/purpose/consumer/privacy/object-type policy;
- free-form proposal reasons are rejected in favor of bounded machine codes;
- no terminal review/commit/delete operation is exported through the Agent API surface;
- conformance fixtures are D0/D1 only and deterministic.

## Non-change evidence

```text
package.json=UNCHANGED
package-lock.json=UNCHANGED
packages/kb/package.json=UNCHANGED
legacy_store_sources=UNCHANGED
legacy_critical_tests=UNCHANGED
physical_KB_KG_RAG_schema=UNCHANGED
Electron_Runtime=UNCHANGED
PR20=UNCHANGED
main=UNCHANGED
D3=DISABLED
```

## Claim limit

This is **source/conformance evidence**, not a real MCP/API/SDK transport deployment and not Runtime/reference-implementation proof. C3 dependency order remains binding.
