# Evidence

## Outcome

- MiniMax worker stopped after forbidden package-install attempts; no worker
  PASS accepted.
- Codex restored `PROJECT_STATE.yaml` to `HEAD` bytes, verified no remaining
  diff, then applied minimal governance patches.
- `git diff --check`: PASS.
- `PROJECT_STATE.yaml`: parsed successfully with the already-present root
  `js-yaml`; `status.verdict=BLOCKED`,
  `status.github_source=SOURCE_HEAD_UNDER_REPAIR`, and
  `r32.role=PR14_DATE_STABILITY_AND_TAKEOVER`.
- Final repository diff before staging: nine files, 241 insertions and 33
  deletions; two are the separately accepted test repair and seven are
  governance/handoff files.
- Candidate/artifact/runtime remain not established.

## PR #15 clean-CI compatibility follow-up

- GitHub run `30689136694` reached candidate source contracts and passed
  `59/60`; the only failure was the exact governance assertion requiring
  `status.github_source: SOURCE_COMPLETE`.
- The aggregate verdict, `r31.status`, candidate, artifact, runtime, release,
  experience, and MVP fields remain fail-closed. Restoring this source-capability
  token does not claim a candidate or runtime result.

## Current governance SHA256

- `AGENTS.md`: `37034de0cf1888a12929d6d164f7aa4ed388c7baf85753a88df7305b313e9f17`
- `PROJECT_STATE.yaml`: `7c024a82d4f9cdcddca8aaf9e5b92e2073ccb89280ca5a12071c00e6e3d32d62`
- `PROJECT_STATUS.md`: `7182dd9dc11d290d5f313c0984c5128923db9930c898b382c3597c5d3af0654c`
- `TODO.md`: `69947022301045020e4688c065500902b2d004690964589ab9337e9361d15af4`
- `CHANGELOG.md`: `c797b91f027eacb10015ee619b12c87e2a12f7c842b7d6ac641e65157f96e6c9`
- `DECISIONS.md`: `7bd126310bef15fe791727addfe22bf0c2d53061d771bee82c09e954e78d77ca`
- `docs/ARCHITECTURE.md`: `5ba1cb27de91be0738821c8ed11f15102ba2a07d739d6e2f9bf89a789e8a47c3`
