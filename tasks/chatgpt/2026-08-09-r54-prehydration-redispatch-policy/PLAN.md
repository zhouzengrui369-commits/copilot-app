# PLAN

- Base exact source: `0e097811650e2ca79a79a1ab095fdbad1f933ce3`.
- Branch: `chatgpt/r54-prehydration-redispatch-policy`.
- Scope: governance/handoff only.
- Preserve required document-authority anchors: R31, `1107/1107`, exact Git object, `EXACT_FINAL_HEAD`, Candidate Gate 2/3/9/11/12 and deployment authority.
- Source acceptance: complete `copilot-source-gate` on final R54 evidence-containing head.
- Integration: squash only into `chatgpt/mvp-source-finalization` / Draft PR #20.
- Final freeze: complete `copilot-source-gate` on resulting exact PR #20 head; no later tracked changes.
- Local handoff: fresh run stamp/all-new paths; persistent single hydrator process; one hydration max; one Candidate max; fail closed.
