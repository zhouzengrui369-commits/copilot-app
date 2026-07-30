import { readFile } from 'node:fs/promises';
import path from 'node:path';

const coverageFile = process.argv[2];
if (!coverageFile) {
  throw new Error('usage: report-critical-coverage-gaps.mjs <coverage-final.json>');
}

const parsed = JSON.parse(await readFile(coverageFile, 'utf8'));

function uniqueSorted(values) {
  return [...new Set(values)].sort((left, right) => left - right);
}

function formatLines(values) {
  const lines = uniqueSorted(values);
  return lines.length ? lines.join(',') : '-';
}

for (const [absoluteFile, record] of Object.entries(parsed).sort(([left], [right]) => left.localeCompare(right))) {
  const statements = [];
  for (const [id, count] of Object.entries(record.s ?? {})) {
    if (count === 0) statements.push(record.statementMap?.[id]?.start?.line ?? 0);
  }

  const functions = [];
  for (const [id, count] of Object.entries(record.f ?? {})) {
    if (count === 0) {
      const entry = record.fnMap?.[id];
      functions.push(entry?.decl?.start?.line ?? entry?.loc?.start?.line ?? 0);
    }
  }

  const branches = [];
  for (const [id, counts] of Object.entries(record.b ?? {})) {
    const entry = record.branchMap?.[id];
    counts.forEach((count, index) => {
      if (count === 0) branches.push(entry?.locations?.[index]?.start?.line ?? entry?.line ?? 0);
    });
  }

  const relative = path.relative(process.cwd(), absoluteFile).split(path.sep).join('/');
  console.log(
    `CRITICAL_COVERAGE_GAP ${relative} statements=${formatLines(statements)} functions=${formatLines(functions)} branches=${formatLines(branches)}`,
  );
}
