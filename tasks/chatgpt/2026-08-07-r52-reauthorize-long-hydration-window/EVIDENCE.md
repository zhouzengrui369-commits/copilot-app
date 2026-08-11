# EVIDENCE — R52 reauthorize long hydration window

## GitHub source

```text
Base PR #20 exact head at branch creation:
2835e36ee37a417bd88e5a8dc1187421eb61e966

R52 branch:
chatgpt/r52-reauthorize-long-hydration-window

R52 Draft PR:
#26

First governance source-green head:
b5461ea987d2f1e6bc1bf5460d6341e09cc51a5f

Source gate:
run=31165670393
job=92825767451
result=17/17_SUCCESS
```

## R51 evidence accepted

- source `2835e36ee37a417bd88e5a8dc1187421eb61e966` was attempted locally;
- first R51 dispatch entered one hydration invocation and was terminated by an outer 120-second driver limit before PASS receipt/Candidate;
- second R51 dispatch stopped at `BLOCKED_NEW_PATH_ALREADY_EXISTS` before hydration;
- no Candidate, artifact SHA-256 or runtime ID exists;
- source changes by MiniMax: none;
- all R51 paths/evidence remain immutable and non-reusable.

## Source diff scope

R52 changes governance/handoff and Parent PM task records only. R50 implementation, product/UI, package/lockfile, tests, network allowlist and Candidate runner behavior are unchanged.

## Required successor envelope

```text
SOURCE_COMMIT=<new exact PR #20 head>
PR=20
SOURCE_GATE=PASS
RUN_STAMP=<new unique value>
OUTER_DRIVER_TIMEOUT_SECONDS>=3600
OWNER_AUTHORITY=OWNER_APPROVAL_FOR_BOUNDED_NATIVE_TOOLCHAIN_CACHE_HYDRATION
```

`OUTER_DRIVER_TIMEOUT_SECONDS` is caller wall-clock allowance only. It does not authorize retry/resume/partial-cache reuse/second hydration/network expansion.

Final evidence-containing PR #26 head must pass complete source gate before merge into PR #20.