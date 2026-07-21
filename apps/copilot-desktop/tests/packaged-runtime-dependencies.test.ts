import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const EXPECTED_RUNTIME_PACKAGES = [
  '@copilot/kb',
  '@copilot/kg',
  '@copilot/llm-client',
  '@copilot/rag',
] as const;

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const desktopRoot = path.resolve(testDirectory, '..');

function productionFactoryRuntimePackages(sourceText: string): string[] {
  const sourceFile = ts.createSourceFile(
    'local-knowledge-service.ts',
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const factories = sourceFile.statements.filter(
    (statement): statement is ts.FunctionDeclaration =>
      ts.isFunctionDeclaration(statement) &&
      statement.name?.text === 'createProductionKnowledgeService',
  );

  if (factories.length !== 1 || !factories[0].body) {
    throw new Error('expected exactly one createProductionKnowledgeService factory');
  }

  const specifiers: string[] = [];
  let invalidLoadCall = false;
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'loadPackage'
    ) {
      if (node.arguments.length !== 1 || !ts.isStringLiteral(node.arguments[0])) {
        invalidLoadCall = true;
      } else {
        specifiers.push(node.arguments[0].text);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(factories[0].body);

  if (invalidLoadCall || specifiers.length === 0 || new Set(specifiers).size !== specifiers.length) {
    throw new Error('production package loads must be unique string literals');
  }
  return specifiers.sort();
}

describe('packaged runtime dependency closure', () => {
  it('declares every workspace package loaded directly by the production factory', () => {
    const source = fs.readFileSync(
      path.join(desktopRoot, 'src/main/local-knowledge-service.ts'),
      'utf8',
    );
    const packageJson = JSON.parse(
      fs.readFileSync(path.join(desktopRoot, 'package.json'), 'utf8'),
    ) as { dependencies?: Record<string, string> };
    const runtimePackages = productionFactoryRuntimePackages(source);

    expect(runtimePackages).toEqual([...EXPECTED_RUNTIME_PACKAGES].sort());
    expect(
      Object.fromEntries(runtimePackages.map((name) => [name, packageJson.dependencies?.[name]])),
    ).toEqual(Object.fromEntries(EXPECTED_RUNTIME_PACKAGES.map((name) => [name, '0.1.0'])));
  });

  it('fails closed when a production package load is not a string literal', () => {
    expect(() => productionFactoryRuntimePackages(`
      async function createProductionKnowledgeService() {
        const packageName = '@copilot/rag';
        return loadPackage(packageName);
      }
    `)).toThrow('production package loads must be unique string literals');
  });
});
