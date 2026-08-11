# EVIDENCE

## Static selector/source review

- retired `note-detail-meta`: absent from the EXP-COP-008 spec
- current bindings:
  - `.breadcrumb`
  - `wiki-organized-preview-current`
  - `knowledge-document-reader`
  - `data-document-path`
  - `markdown-renderer`
  - `全页阅读`
  - `返回 .* MOC`
- Playwright discovery: `1 test / 1 file`

## Frozen runtime identity

- Git HEAD: `2b832c20b93e07ee68b6b325dc3ad758986b7f69`
- Electron: `38.8.6`
- ABI: `139`
- `dist/main/main.js` SHA256:
  `ae2f7dd761d3e864944cd281c6ac2c05d173ff3da02162053b40aff4cc960bff`
- `dist/main/preload.mjs` SHA256:
  `73648ba0b941fb369c8a67b40af59963f69560bb2e5474d6de84d5934d7c21df`
- `dist/renderer/index.html` SHA256:
  `8ecd25af96404b7c13009f55002d67ec41855d03cd55104c15f536040edc01ac`
- ABI-139 binding SHA256:
  `77907e9952f0d2a4d2d6a751f8828cab96ab132dd52d6610cb0e9a7192f28696`

## Electron first/only result

- exit: `1`
- wall duration: `21.1s`
- source reader assertions: passed
- failure after full quit/relaunch:
  - unscheduled Todo ID:
    `9d0b46e8-eb72-49e2-9d33-5ab275a61495`
  - explicit Todo ID: `NOT_CAPTURED`; pre-close non-empty assertion passed,
    but selected-day readback was not reached.
  - expected source field: `a, b`
  - received source field: `b\na`
  - both exact source paths persisted; order followed retrieval rank.

Artifacts:

- `test-failed-1.png`
  SHA256 `c090cb55d113b11b6fc60fa34571b8fe29dcd7f4cb93bf98853f24281d089852`
- `test-failed-2.png`
  SHA256 `1da304d29eeac3c08cae352a9d8c9595c86e8baffd9907ce42c51f31ea55b119`
- `trace.zip`
  SHA256 `62e427aecc6838e155c76da08b0fa208e68b45de0e8029e026e88eaa50c163a7`
- `error-context.md`
  SHA256 `e977362d44079ca7ce7ea4c9e23e4e9d3d610a31c89167937a94066b6959ef4d`

Artifact root:
`apps/copilot-desktop/test-results/electron-e2e-artifacts/exp-cop-008-todo-closure-E-c68f5--open-and-relaunch-readback/`

Current spec SHA256:
`f3d3030330d178ec64bf0f682f0802d65d5b92159f795b942f26f3cb1b798218`
