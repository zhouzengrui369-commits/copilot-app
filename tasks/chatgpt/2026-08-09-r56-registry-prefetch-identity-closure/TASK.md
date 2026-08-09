# TASK

1. Verify the exact R55 closure blocker against GitHub source truth.
2. Repair only registry-prefetch identity closure.
3. Add regression coverage for the exact `typescript@6.0.3` gap and unrelated nested-package exclusion.
4. Run the complete source gate on the implementation head.
5. Record evidence, then run the complete source gate again on the final evidence-containing head.
6. Merge only into Draft PR #20, never main.
7. Run the complete source gate on the resulting exact PR #20 head before local successor authorization.
