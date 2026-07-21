import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parse } from 'acorn';

const APP_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const DEFAULT_RENDERER_ROOT = path.join(APP_ROOT, 'dist/renderer');
const JAVASCRIPT_EXTENSIONS = new Set(['.js', '.mjs', '.cjs']);

function isAstNode(value) {
  return Boolean(value && typeof value === 'object' && typeof value.type === 'string');
}

function isRequireReference(parent, parentKey) {
  if (!parent) return true;
  if (
    (parent.type === 'MemberExpression' || parent.type === 'OptionalMemberExpression')
    && parentKey === 'property'
    && !parent.computed
  ) return false;
  if (
    (parent.type === 'Property' || parent.type === 'PropertyDefinition' || parent.type === 'MethodDefinition')
    && parentKey === 'key'
    && !parent.computed
  ) return false;
  if (parent.type === 'VariableDeclarator' && parentKey === 'id') return false;
  if (
    ['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression'].includes(parent.type)
    && (parentKey === 'id' || parentKey === 'params')
  ) return false;
  if ((parent.type === 'ClassDeclaration' || parent.type === 'ClassExpression') && parentKey === 'id') {
    return false;
  }
  if (parent.type === 'CatchClause' && parentKey === 'param') return false;
  if (parent.type.startsWith('Import')) return false;
  if (parent.type === 'LabeledStatement' || parent.type === 'BreakStatement' || parent.type === 'ContinueStatement') {
    return false;
  }
  return true;
}

export function findBareRequireReferences(source, filePath = '<renderer-source>') {
  let ast;
  try {
    ast = parse(source, {
      ecmaVersion: 'latest',
      sourceType: 'module',
      allowHashBang: true,
      locations: true,
    });
  } catch (error) {
    const cause = error instanceof Error ? error.message : String(error);
    throw new Error(`BLOCKED_RENDERER_BUNDLE_PARSE_FAILED: ${JSON.stringify({ filePath, cause })}`);
  }

  const findings = [];
  const visit = (node, parent = null, parentKey = null) => {
    if (node.type === 'Identifier' && node.name === 'require' && isRequireReference(parent, parentKey)) {
      findings.push({
        filePath,
        line: node.loc?.start.line ?? null,
        column: node.loc?.start.column ?? null,
      });
    }
    for (const [key, value] of Object.entries(node)) {
      if (key === 'loc' || key === 'start' || key === 'end') continue;
      if (isAstNode(value)) visit(value, node, key);
      else if (Array.isArray(value)) {
        for (const item of value) {
          if (isAstNode(item)) visit(item, node, key);
        }
      }
    }
  };
  visit(ast);
  return findings;
}

async function listJavaScriptFiles(root) {
  const entries = await readdir(root, { withFileTypes: true });
  const files = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const absolute = path.join(root, entry.name);
    if (entry.isDirectory()) files.push(...await listJavaScriptFiles(absolute));
    else if (entry.isFile() && JAVASCRIPT_EXTENSIONS.has(path.extname(entry.name))) files.push(absolute);
  }
  return files;
}

export async function verifyRendererBundle(rendererRoot = DEFAULT_RENDERER_ROOT) {
  let files;
  try {
    files = await listJavaScriptFiles(rendererRoot);
  } catch (error) {
    const cause = error instanceof Error ? error.message : String(error);
    throw new Error(`BLOCKED_RENDERER_BUNDLE_MISSING: ${JSON.stringify({ rendererRoot, cause })}`);
  }
  if (files.length === 0) {
    throw new Error(`BLOCKED_RENDERER_BUNDLE_EMPTY: ${rendererRoot}`);
  }
  const findings = [];
  for (const filePath of files) {
    findings.push(...findBareRequireReferences(await readFile(filePath, 'utf8'), filePath));
  }
  if (findings.length > 0) {
    throw new Error(`BLOCKED_RENDERER_BUNDLE_REQUIRE_REFERENCE: ${JSON.stringify(findings)}`);
  }
  return { rendererRoot, files: files.length };
}

async function main() {
  const rendererRoot = process.argv[2] ? path.resolve(process.argv[2]) : DEFAULT_RENDERER_ROOT;
  const result = await verifyRendererBundle(rendererRoot);
  console.log(`RENDERER_BUNDLE_VERIFIED: files=${result.files} root=${result.rendererRoot}`);
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
