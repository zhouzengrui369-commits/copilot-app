# TASK

- Base: Draft PR #20 source branch at `d29da3e6dcc9c89d680f56c23e66262e9ee967c1`.
- Trigger: prior R58 consumed that source and stopped at `BLOCKED_NATIVE_CACHE_NETWORK_TRANSPORT_RESET` during bounded registry-prefetch batch 21/35 after roughly 71 minutes; Candidate not created.
- Correct adjudication: `R55_BLOCKER_REGRESSION=UNVERIFIED` because registry-cache closure was not reached.
- Change only registry-prefetch throughput: explicit bounded `npm pack --maxsockets=12`; batch size stays 24.
- Preserve no retry/resume, official host allowlist, one hydrator, Candidate deny-network, package/lockfile/product/workflow bytes.
- Add source contract proving the throughput cap and absence of retry flags.
- Before next local online hydration, require an exact-source runtime manifest evidence file proving canonical `typescript@6.0.3` identity exists.
- Complete stacked PR source gate, freeze evidence, merge only to Draft PR #20, then complete final PR #20 source gate.
