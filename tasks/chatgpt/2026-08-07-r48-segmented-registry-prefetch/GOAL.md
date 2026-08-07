# GOAL — R48 Segmented Registry Prefetch

Close the repeated `registry.npmjs.org` hydration transport blocker without retry, partial-cache reuse, allowlist expansion, Candidate network access, package changes, or product-scope changes.

Success means the exact-source hydrator deterministically prefetches lockfile registry tarballs in bounded script-disabled batches, performs the lifecycle install with npm registry access forced offline, preserves lifecycle-only official asset access through the existing bounded proxy, retains all deny-network Candidate gates, and passes the complete GitHub source gate.

Runtime/Candidate success is explicitly out of scope for ChatGPT remote execution and remains `MVP_NOT_COMPLETE / NOT_RUNTIME_PROOF` until MiniMax and Codex complete their gates.