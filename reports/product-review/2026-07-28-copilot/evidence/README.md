# 2026-07-28 Copilot Focused Retest Evidence

## Candidate binding

- Review mode: `FOCUSED_RETEST`
- Runtime surface: real source-run Electron, not Browser or HTML prototype
- Worktree: `/private/tmp/copilot-exp-cop-p0`
- Electron app: `/private/tmp/copilot-exp-cop-p0/apps/copilot-desktop/node_modules/electron/dist/Electron.app`
- Source candidate: `e43459db1774203162a25399615aaae9ee65fe6b72c594f3123825d2149d013e`
- Runtime candidate: `53a340858f03cfea780fa8915948d55d20685b637c33e7dc42242061374dd393`
- Electron: `38.8.6`
- Git HEAD recorded by the candidate: `320a4c8d214b928b8963f054d5ebd27cd6afb8bb`
- Candidate caveat: product source remains dirty/untracked and is not a frozen, commit-reproducible artifact.

## Current-run screenshots

All screenshots below were captured from the real R13 Electron window at
`1229×768`, copied from the Computer Use capture, reopened, and visually
inspected before acceptance.

| Step | File | SHA256 | Observation |
|---|---|---|---|
| 1 | `01-source-full-reader.jpeg` | `7411ae3dae642610067d2cf0b0f90f3b334def35014323175afa6100778084b9` | Full local MSTAR source is readable and contains both synthetic facts. |
| 2 | `02-grounded-answer-action-receipt.jpeg` | `b22694ffa2b4e098074d6f02c46b267300d42680c05df4773a8a5dee089a5989` | Correct answer, `LOCAL_PRESENT` source, exact excerpt, egress disclosure, and a success receipt for a newly created linked local Todo are visible. |
| 3 | `03-settings-egress-boundary.jpeg` | `bd63c420d0857360e8de7f836753fd852f61a7509d258f0572beac423b1dd908` | Settings disclose loopback first hop, unknown upstream/retention, and a secure credential field; Remote/Backup remains off. |
| 4 | `04-today-action-not-discoverable.jpeg` | `6f88689128bb1edb493e6fc9aee66c2cb835006c55569a8ed7af8ae60cfcee27` | After the success receipt, Today still reports only the pre-existing one Todo; the newly created no-due Todo has no visible continuation entry. |

## Exact current-run journey

1. Opened `MSTAR-417 acceptance source` in Knowledge and used **全页阅读**.
2. Asked: `仅依据本地资料回答：MSTAR-417 的 rendezvous date 和 verification phrase 分别是什么？`
3. Verified the answer `2031-04-17 / amber satellite 62`, the exact excerpt,
   and the local source path `inbox/exp-cop-001/mstar-417`.
4. Opened the source. The app navigated to Knowledge; a second **全页阅读**
   action was needed to reach the full original note.
5. Returned to Conversations. The question, answer, and source state had been
   discarded, so the question had to be asked again.
6. Selected **转为待办**, changed the title to
   `复核 MSTAR-417 rendezvous · 2026-07-28 体验评审`, left the optional due
   time empty, retained the verified linked source, and confirmed.
7. The app displayed a success receipt with Todo ID
   `b288471f-fdfd-40af-afe1-59908eff7f6b`.
8. Returned to Today. Today still showed one outstanding item, the pre-existing
   `Follow up MSTAR-417 rendezvous`; the newly created item was not visible or
   reachable.
9. Inspected Settings. No credential value was read or output, and no real
   provider or real credential was used.

## Bounded inherited evidence

- R12 independently bound two canonical Electron launches, a full quit, a
  second launch, source/WIKI/Todo/settings readback, and process/port cleanup
  to the same source/runtime candidate.
- R10/R12 bind the before-confirm-revoke egress behavior to the same product
  source. This review directly rechecked the visible confirmed-state
  disclosure, but did not revoke the R13 owner candidate or close it.
- These inherited receipts support focused regression decisions. They do not
  turn this dirty source-run candidate into a release artifact.

## Evidence limits

- The R13 owner session was intentionally left running for the owner; this
  review did not close or relaunch it.
- Corrupt-file import, slow Knowledge loading, injected runtime failure,
  cross-midnight/sleep-wake date behavior, offline mode, packaged app,
  signing/notarization, real credentials, and full keyboard/screen-reader
  operation were not rerun.
- Screenshot evidence can identify visible contrast, density, overlap, and
  labeling risks; it cannot establish WCAG compliance.
