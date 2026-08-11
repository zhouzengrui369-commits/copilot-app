# EVIDENCE

## Static review

- exact count: `persistedSourcePaths.length === 2`
- no duplicate: `Set.size === 2`
- exact unordered set: sorted set equals sorted expected A+B
- no retired selector or remaining delimiter/order assumption after the
  changed assertion
- Playwright discovery: `1 test / 1 file`

## Electron first/only result

- Electron `38.8.6`, ABI `139`, isolated userData
- exit: `1`
- duration: `19.5s`
- source set after full relaunch: `PASS`
- failure line: `330`
- action: click `选择日期 <explicitDateKey>`
- expected: `所选日期[aria-pressed=true]`
- actual: `所选日期[aria-pressed=false]` for 8 seconds
- classification: `CALENDAR_DATE_SCOPE_NOT_SYNCHRONIZED`

Artifacts:

- screenshot 1 SHA256:
  `8bdf85a031a9a3ed35b18330b6c996f225a6581164833ed2e3677727ac375e4b`
- screenshot 2 SHA256:
  `a904676e9bba018b61b4c41bfcb6f02b41aea6091bb276322c8724307c95dc7c`
- trace SHA256:
  `c31ebf60ce1bb9f5d8c8630e12eb0ee0f0071fd58b3b5d47d7705dbfdea9f775`
- error context SHA256:
  `8c260be97c8dda876210b1d72671644dbf02c28887caeb9767272fecee00f158`
- artifact root:
  `apps/copilot-desktop/test-results/electron-e2e-artifacts/exp-cop-008-todo-closure-E-c68f5--open-and-relaunch-readback/`

Current spec SHA256:
`417e9c254130f9debeaf8a502eb784e9fd9493af42c70bfe7378cd6da3f45a0a`
