# GOAL — R67 lockfile alias registry identity repair

Close the R66 fail-closed registry-prefetch blocker without regenerating `package-lock.json`, changing dependency versions, expanding network authority, or weakening Candidate gates.

R66 consumed source `beb951b95695233911da0a17543ef342acc6df93` after one real hydrator completed 50/57 registry-prefetch batches and stopped on `npm pack string-width-cjs@4.2.3` with `ETARGET`.

The exact root lock proves this is an npm alias identity issue: install paths such as `node_modules/string-width-cjs` carry `name: string-width`, `version: 4.2.3`. R67 must preserve the locked package name for registry prefetch while retaining the install path only as filesystem placement metadata.

Success means the source manifest contains real registry specs (`string-width@4.2.3`, `strip-ansi@6.0.1`, `wrap-ansi@7.0.0`) and never emits fake `*-cjs@...` registry package specs, with all existing source gates unchanged.
