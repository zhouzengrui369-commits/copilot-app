# RESULT — R46 Native Hydration Transport Stability

## Remote result

The bounded source patch is published as Draft PR #22, `chatgpt/r45-native-hydration-transport-fix` → `chatgpt/mvp-source-finalization`. It hardens the single authorized native-toolchain hydration against long-transfer tunnel instability while retaining explicit `automaticRetry=false`.

Implemented source truth:

- TCP keepalive, no-delay, and twenty-minute idle timeout;
- explicit npm fetch timeout, zero fetch retries, and four-socket maximum;
- per-CONNECT timestamps, duration, directional byte counts, socket policy, and terminal errors;
- stable reset/timeout/pipe/abort blocker classifications;
- exclusive `HYDRATION-FAILED.json` marker for transport-failed cache roots;
- `partial_failed_transport`, `reusable=false`, `passReceiptCreated=false` evidence;
- receipt rejection of partial markers, retry-policy drift, and fatal tunnel records;
- direct transport and receipt regression tests;
- updated project state, status, TODO, changelog, decision, and MiniMax handoff.

## Preserved boundaries

- official-host allowlist unchanged;
- Candidate remains deny-network;
- one hydration invocation only;
- no hidden retry, resume, mirror fallback, or partial-cache promotion;
- no product, package-version, database, credential, signing, notarization, cloud, Windows, or mobile change.

## Validation boundary

The exact final PR #22 head must pass the complete Node 24/macOS `copilot-source-gate`. After that, PR #22 may be merged only into Draft PR #20's source branch. The resulting exact PR #20 head must pass the same complete source gate before MiniMax receives a new four-field handoff.

## Runtime truth

ChatGPT did not run hydration, Candidate, Electron, packaging, performance, signing, notarization, or product acceptance. Source CI and local execution are separate gates.

```text
LOCAL_SUCCESSOR_NOT_RUN
NOT_RUNTIME_PROOF
MVP_NOT_COMPLETE
NOT_RELEASE_READY
NOT_EXPERIENCE_READY
```
