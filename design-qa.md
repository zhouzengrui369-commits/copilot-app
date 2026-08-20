# Copilot Demo UI web-first design QA

**Final result:** `passed`

## Comparison target

- Source visual truth: `design/authority/copilot-phase1-mvp-demo-v3-calendar-moc.html`
- Source identity: `52046` bytes; SHA256 `231cbef9985cedb697ba52be31d9c04df44ede49bdd9298c3081c8ec19ca4205`
- Implementation URL: `http://127.0.0.1:41744/?prototype=ready#today`
- State: Today / local browser fixture / quick capture expanded / contextual AI collapsed
- CSS viewport and density: `1440 x 900`, DPR `1`, desktop
- Source capture: browser CSS viewport `1440 x 900`; raw visible capture `1425 x 891` after scrollbar/chrome exclusion; normalized to `1440 x 900`
- Implementation capture: `1440 x 900`

## Evidence

- Source: `reports/web-first-ui-r1/screenshots/source-today-final-1440x900-normalized.png`
- Implementation: `reports/web-first-ui-r1/screenshots/implementation-today-final-1440x900.png`
- Same-input comparison: `reports/web-first-ui-r1/screenshots/side-by-side-final.png`
- Focused source workbench: `reports/web-first-ui-r1/screenshots/source-workbench-focus.png`
- Focused implementation workbench: `reports/web-first-ui-r1/screenshots/implementation-workbench-focus.png`
- Browser console errors/warnings: none

## Findings

No actionable P0, P1, or P2 mismatch remains.

- Information architecture: passed. Both surfaces use exactly four primary destinations: `今天 / 知识 / 对话 / 设置`. Wiki Studio is a secondary action inside Knowledge, not a fifth primary destination.
- Spacing and layout rhythm: passed. Top shell, status strip, 260px calendar rail, Today workbench, two-column capture area, local notes/timeline, and collapsed contextual assistant preserve the source composition and hierarchy without viewport overflow.
- Fonts and typography: passed. Both use the macOS system/PingFang fallback stack with comparable hierarchy, weights, line-height, wrapping, and compact desktop density.
- Colors and visual tokens: passed. Neutral canvas, white surfaces, blue primary/selected state, muted status tokens, borders, and radii map to the source language with accessible contrast.
- Image quality and asset fidelity: passed. The compared Today state contains no required photographic, logo, or illustration asset. No source asset is replaced with CSS art, handcrafted SVG, emoji, or a placeholder.
- Copy and content: passed with intentional truth constraints. Implementation copy substitutes current fixture dates and explicit `PROTOTYPE / NOT_RUNTIME_PROOF / NOT_PROBED` labels for the Demo's simulated runtime claims.
- Interactions and accessibility: passed for the primary browser journey. Today, Knowledge, Conversations, and Settings navigation work; Knowledge opens Wiki Studio through its secondary button; semantic links/buttons and selected state are exposed; all four primary destinations remain keyboard-addressable.
- Responsiveness: passed for the authoritative desktop viewport. No horizontal overflow or persistent-control clipping exists at `1440 x 900`. Mobile parity is not an acceptance target for this macOS-first screen.

## Intentional deviations

The source Demo's simulated live recording transcript, diarized speakers, PPT/photo attachments, cross-app background recording dock, and 3D presentation are not copied into the web acceptance candidate. They are demo-only or post-MVP behaviors and would create false product claims. Their absence is an expected product-truth constraint, not design drift.

## Focused comparison

The quick-capture/workbench crop confirms the source's dominant split composition is preserved: editable capture/transcript area at left and WIKI enrichment/truth area at right. The implementation presents the same hierarchy using executable local-draft controls and fail-closed WIKI status instead of simulated recording data.

## Comparison history

1. An early CDP screenshot showed duplicated horizontal slices and was provisionally treated as a possible P1 layout issue.
2. DOM geometry showed `1440 x 900`, no horizontal overflow, and one normal page tree. A standard in-app-browser capture rendered the page correctly, proving the slices were capture-tool artifacts rather than product output.
3. The invalid captures were removed. Source and implementation were recaptured in the same in-app browser, viewport, DPR, route, and scroll position, then placed together in `side-by-side-final.png`.
4. The final full-view and focused comparisons contain no actionable P0/P1/P2 issue.

## Residual test gaps

- Owner taste/acceptance is deliberately not inferred from this QA pass: `OWNER_WEB_UI_ACCEPTANCE=PENDING`.
- Electron, native runtime, package, signing, notarization, and deployment were not exercised and remain blocked by the web-first gate.

## Implementation checklist

- [x] Bind the exact Demo HTML and hash.
- [x] Restore four primary destinations.
- [x] Keep Wiki Studio secondary to Knowledge.
- [x] Verify browser interactions and console.
- [x] Compare source and implementation together at the authoritative desktop state.
- [ ] Obtain explicit NJX Owner web acceptance before any Electron or package successor.
