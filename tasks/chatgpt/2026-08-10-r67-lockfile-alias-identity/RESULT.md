# RESULT — R67 implementation checkpoint

## Root cause

R66 did not prove that the root lockfile needed wholesale regeneration. The failing entries are npm alias/install-path entries. For example:

```text
node_modules/string-width-cjs
  name=string-width
  version=4.2.3

node_modules/strip-ansi-cjs
  name=strip-ansi
  version=6.0.1

node_modules/wrap-ansi-cjs
  name=wrap-ansi
  version=7.0.0
```

R65's exact-version-only fallback used the `node_modules/...` path as package name and therefore emitted fake registry identities such as `string-width-cjs@4.2.3`.

## Repair

R67 introduces lock-entry-aware alias identity:
- the entry must first be a real `node_modules/...` install path;
- when that entry contains a valid `name`, registry-prefetch uses the lock entry name;
- otherwise it falls back to the install-path-derived package name;
- root/workspace entries outside `node_modules` remain excluded.

No package/lockfile bytes, dependency versions, mirrors, allowlists, retry policy, Candidate network authority or product runtime bytes changed.

## Tests

New regression coverage proves both synthetic alias behavior and the current exact repository manifest. The first code Head after the final guard is `20003b07b8137a369263e0fadb3b4f4171d7d392`.

Source gate:

```text
run=31354821614
job=93352458882
result=17/17 SUCCESS
```

The final evidence-containing Head still requires its own complete source gate before merge.

## Status

`SOURCE_GREEN_IMPLEMENTATION / NOT_RUNTIME_PROOF / MVP_NOT_COMPLETE / NOT_RELEASE_READY / NOT_EXPERIENCE_READY`.
