# PLAN

- Freeze R55 as consumed, evidence-only.
- Base R56 exactly on PR #20 head `69a0e651f599403bf2427fd321d9491bd31f13b0`.
- Keep root `package-lock.json` as closure authority.
- Use Git-tracked nested package-lock v3 files only as exact registry identity supplements for unresolved root specs.
- Preserve reviewed origins, integrity conflict rejection, bounded batching, deny-network closure proof, zero retry, and Candidate deny-network.
- Validate with source contracts and the full Node 24/macOS source gate.
- Merge stacked PR only into PR #20 after the final evidence head is source-green.
