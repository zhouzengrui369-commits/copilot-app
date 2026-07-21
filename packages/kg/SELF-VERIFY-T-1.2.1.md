# T-1.2.1 SELF-VERIFY · single-wave accept (NJX 07:04 popup Hybrid 🅰)

> Branch: sp1.2-T-1.2.1-v2  · HEAD: db508d44
> Worktree: /Users/njx/openclaw/copilot.wt-T121v2/wt-T121v2
> Worker: coder (session mvs_ed8e486f31ee44959c8177ae9afd5f83)
> Date: 2026-07-10

## Scope of THIS verification (single-wave)
NJX 07:04 popup 拍板 Hybrid 🅰 — T-1.2.1 = wave 1 only. Wave 2 (relation +
tagger + summarizer) + wave 3 (incremental + query + perf baseline) +
Electron integration (apps/copilot-desktop/src/kg/integration.ts) are
**deferred to Sprint 1.3** per the NJX popup decision. This document
covers only wave 1.

## Acceptance signals (plan.md v6.2 §2.2 T-1.2.1 — wave 1 portion)
- ✅ `@copilot/kg` package scaffold landed (workspace package, strict TS 5.8)
- ✅ kg_nodes table + schema_meta + WAL mode
- ✅ note_entities bridge table
- ✅ KgStore class with merge-on-update semantics (alias + source_notes
  dedup, max-confidence picking on update)
- ✅ kg_edges + kg_tags table skeletons (full CRUD; wave 2 will add the
  relation-extractor / tagger that actually populates them)
- ✅ EntityExtractor with LLM JSON-strict system prompt + parseEntityResponse
  (handles fences, trailing commas, prose wrappers, non-allowed type coercion,
  dedup by lowercase canonical name)
- ✅ 16/16 vitest PASS (8 sqlite-store + 8 entity-extractor)
- ✅ 1 screenshot: screenshots/T-1.2.1/kg-nodes-db.png (1920x1511, 12
  seeded entities across 5 types — dark UI table view)

## 已跑命令 + 输出 (key commands)
```
$ git log --oneline -4
db508d44 feat(kg): wave 1 done · kg-nodes-db screenshot + KgStore exports
fe329439 feat(kg): wave 1 tests + kg_edges schema fix · 16/16 PASS
7eb31335 feat(kg): wave 1 · entity extractor + kg store + KG schema migration (partial)
ae88c600 feat(kg): Sprint 1.2 T-1.2.1 scaffold · @copilot/kg v0 package

$ npx tsc -p packages/kg/tsconfig.json --noEmit
(0 errors)

$ npm run test --workspace @copilot/kg
Test Files  2 passed (2)
     Tests  16 passed (16)
  Duration  ~280ms

$ node packages/kg/scripts/gen-screenshots.mjs
[gen-shots] wrote /…/screenshots/T-1.2.1/kg-nodes-db.html
[gen-shots] wrote /…/screenshots/T-1.2.1/kg-nodes-db.png
```

## 截图清单
- `screenshots/T-1.2.1/kg-nodes-db.png` (1920x1511, 249 KB after compression,
  12 entities seeded — 4 person / 3 org / 2 concept / 2 event / 1 place)
- `screenshots/T-1.2.1/kg-nodes-db.html` (source HTML with full dark
  theme + table view + schema block + counts panel)

## Known limitations / deviations
- **kg_edges schema deviation from contract §5**: SQLite forbids both
  `id INTEGER PRIMARY KEY AUTOINCREMENT` AND composite `PRIMARY KEY
  (from, to, rel)`. Implementation uses surrogate `id` + `UNIQUE
  (from, to, rel)` — identical dedup guarantee. Will be documented in
  the Sprint 1.3 SCHEMA-FROZEN-1.2.md when the relation-extractor actually
  populates it.
- **CJK entity names fall to `:unnamed` placeholder** under current
  ASCII-only slugifier. Tested explicitly in entity-extractor.test.ts.
  Sprint 1.4 follow-up (add Unicode-aware slug, e.g. github-slugger
  with pinyin).
- **Wave 2 + wave 3 not landed (NJX 07:04 popup decision)**. The 6
  wave-2 untracked files (relation-extractor / tagger / summarizer +
  matching tests) are preserved in working tree as Sprint 1.3 carry-over.
  Test failures were soft (2 of 24 cases have aspirational-expected-string
  fixes; non-blockers) and will be repaired as part of Sprint 1.3
  wave-2 dispatch.

## Package surface (post-wave-1)
```ts
// @copilot/kg (named exports — packages/kg/src/index.ts)
KgStore, KG_SCHEMA_SQL, KG_SCHEMA_VERSION, KgStoreOptions
runKgMigrations, KG_MIGRATIONS, KgMigrationStep
EntityExtractor, EntityExtractInput, EntityExtractorLike
type EntityType, Entity, EntityInput, RelationType, Relation,
     RelationInput, Tag, TagInput, NoteEntityLink,
     KgBuildOptions, KgBuildResult, KgBuildError,
     IncrementalStats, QueryRequest, QueryResult, Subgraph
```

## Sprint 1.3 carry-over (for next sprint's T-1.2.1 dispatch)
- Resume from HEAD db508d44 on branch `sp1.2-T-1.2.1-v2`.
- 6 untracked wave-2 files at:
  - `packages/kg/src/builder/{relation-extractor, tagger, summarizer}.ts`
  - `packages/kg/tests/{relation-extractor, tagger, summarizer}.test.ts`
- 2 soft test failures to repair:
  - tagger.test.ts: one aspirational-expected-string for CJK-strip test
  - summarizer.test.ts: cooldown test 'returns empty Map' assertion recheck
- Wave 2 finish: SCHEMA-FROZEN-1.2.md freeze (currently NOT written —
  will land at end of Sprint 1.3 wave-2 since the relation/tags/summary
  surface needs to be fully landed).
- Wave 3 + Electron integration: separate Sprint 1.3 sub-task per
  new contract T-1.2.1-wave3-v3.md (will be drafted by PM after this
  cycle closes).
