# Plan

1. Verify clean frozen source and inspect only the two failing tests plus the smallest date-picker helpers they invoke.
2. Reproduce the focused failures.
3. Apply the smallest deterministic date fix.
4. Run focused tests and desktop test TSC; run the release test command if dependencies permit.
5. Persist exact evidence and stop without Git writes.
