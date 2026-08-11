# DISPATCH STATUS — R50

```text
CHATGPT_PARENT_PM = SOURCE_REPAIR_COMPLETE_PENDING_FINAL_HEAD_GATE
MINIMAX = STOPPED
CODEX = WAITING_FOR_CANDIDATE_IDENTITY
```

R50 is remote source repair only. MiniMax must not execute this stacked branch or reuse R49 paths/cache/evidence. A new local successor is authorized only after:

1. the final evidence-containing PR #25 head passes the complete source gate;
2. PR #25 merges only into Draft PR #20;
3. project truth is synchronized on PR #20;
4. the resulting exact PR #20 head passes the complete source gate;
5. one handoff supplies `SOURCE_COMMIT`, `PR=20`, `SOURCE_GATE=PASS`, and a new unique `RUN_STAMP`.
