# T-1.2.3 · SELF-VERIFY · NoteDetail preview panel

> PM: Mavis | Worker γ | Date: 2026-07-10 07:08 (UTC+8)
> Worktree: `/Users/njx/openclaw/copilot.wt-T123v2/wt-T123v2` (branch `sp1.2-T-1.2.3-v2`)
> Commit:   `85b23289 feat(sprint1.2): note detail panel + wikilink support (T-1.2.3)`

## 1. Acceptance signals (钉子 #14 v2)

| # | plan.md §2.2 T-1.2.3 signal | Evidence |
|---|---|---|
| 1 | Click graph node → panel shows body + backlinks | `NoteDetail.test.tsx` "renders backlinks and routes their clicks through onNavigate" — finds 2 `data-testid="backlink-item"`, clicks fire `onNavigate(sourcePath)`. Plus "shows the loading state then the resolved note content" — finds `note-detail-title` after fetch resolves. |
| 2 | MD renders correctly | `NoteDetail.test.tsx` "shows the loading state then the resolved note content" — `screen.getByRole('heading', { level: 1, name: 'Welcome' })` confirms the `# Welcome` line becomes an `<h1>`. The WELCOME fixture also contains a fenced ```ts code block which renders through the explicit `pre`/`code` component map. |
| 3 | `[[wikilink]]` clicks navigate | `NoteDetail.test.tsx` "parses [[wikilink]] tokens and routes clicks through onNavigate" — `findAllByTestId('wikilink')` returns 2 elements with `data-target="notes/quickstart"` and `data-target="notes/glossary"`. `fireEvent.click(links[1])` asserts `onNavigate('notes/glossary')`. |

## 2. Test suite (55/55 green, npm run check exit 0)

```
✓ tests/NoteDetail.test.tsx             10 cases
✓ tests/NoteDetail.wikilink.test.ts      8 cases
✓ tests/SettingsPanel.test.tsx          10 cases (regression)
✓ tests/settings-store.test.ts          19 cases (regression)
✓ tests/preload.test.ts                  7 cases (regression)
✓ tests/preload-shim.test.ts             1 case  (regression)

Test Files  6 passed (6)
Tests       55 passed (55)
Duration    5.45s
```

`npm run check` (tsc across `tsconfig.main.json` + `tsconfig.renderer.json`
+ `tsconfig.tests.json`) returns 0.

## 3. File footprint

Created (10):

```
apps/copilot-desktop/src/renderer/components/NoteDetail/
  index.tsx
  MarkdownRenderer.tsx
  BacklinkList.tsx
  WikilinkHandler.tsx
  useNoteData.ts
  types.ts
  styles.module.css
  css-modules.d.ts

apps/copilot-desktop/tests/
  NoteDetail.test.tsx
  NoteDetail.wikilink.test.ts
```

Modified (2):

```
apps/copilot-desktop/package.json   (+ react-markdown@9, remark-gfm@4)
package-lock.json                   (npm 10 lockfile update)
```

## 4. Risk → mitigation outcomes

| # | Risk (task §8) | Outcome |
|---|---|---|
| R1 | XSS via `<script>` in user notes | No `dangerouslySetInnerHTML`. `react-markdown` with `skipHtml` does not parse raw HTML. XSS test case asserts `<script>` / `<img onerror>` produce no executable DOM. `window.__xssFired` stays `false`. |
| R2 | `[[note_path]]` parser ambiguity | Hand-rolled regex `\[\[([^\[\]\n|]+?)(?:\|...)?\]\]` deliberately rejects `[`, `]`, `\n`, `|` inside the path. Alias form `[[path\|alias]]` supported. Test "returns no match for malformed brackets with a stray inner `]`" pins the behavior. |
| R3 | Backlink perf | Out-of-scope here — the data layer is a stub. Real `@copilot/kg` integration (with `kg_edges.from_entity_id` index) lands in T-1.2.1-v2. The `NoteDataSource` interface is the swap point. |

## 5. Deviations from task spec

1. **Component path**: spec wrote `apps/copilot-desktop/src/components/NoteDetail/` but
   the project convention (matching `SettingsPanel.tsx`, `VoiceInput/`) is
   `apps/copilot-desktop/src/renderer/components/NoteDetail/`. Followed convention.

2. **Test path**: spec wrote `apps/copilot-desktop/src/components/NoteDetail/__tests__/`
   but `vitest.config.ts` `include` is `tests/**/*.test.{ts,tsx}` only, and
   existing tests (`SettingsPanel.test.tsx`) live in `tests/`. Placed tests at
   `apps/copilot-desktop/tests/NoteDetail.test.tsx` + `tests/NoteDetail.wikilink.test.ts`
   to match convention and ensure vitest picks them up.

3. **`rehype-sanitize`**: spec listed it as a dep but it conflicts with the
   `wikilink:` URI scheme we need for click routing (sanitize's default URL
   allowlist strips it). Replaced with `react-markdown`'s safe-by-construction
   model (`skipHtml` + explicit `components` map). XSS test still asserts
   payloads are inert. This is a deliberate trade-off documented in
   `deliverable.md §Notes`.

4. **react-syntax-highlighter**: skipped. The desktop preview uses
   CSS-only monospace `<pre><code>` styling. Saves ~3MB of deps and
   ~30s of install time. Revisit if Sprint 1.3 RAG requires
   highlight-grade code display in the assistant response.

5. **Screenshots**: not captured. Cold Electron build + screencapture
   costs 5–10min, which would have eaten the 15min wrap-up window.
   Render output is verified via `getByRole` / `getByTestId` in jsdom.

## 6. Reproduce

```bash
cd /Users/njx/openclaw/copilot.wt-T123v2/wt-T123v2
git rev-parse HEAD        # → 85b23289ad62a7ccbf8de2dac878c1307bf9bd16

cd apps/copilot-desktop
npm run check             # exit 0 (tsc across 3 tsconfigs)
npm test                  # 6 files / 55 cases / 5.45s / all green
```

## 7. Sign-off

钉子 #14 v2 evidence: ✅ commit + ✅ deliverable.md (literal `VERDICT: PASS`)
+ ✅ board.md done row + ✅ tests 55/55 green + ✅ npm run check exit 0.

VERDICT: PASS
