import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { lstat, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';

type ManifestFile = {
  path: string;
  bytes: number;
  sha256: string;
};

type BundleManifest = {
  self: {
    path: string;
    excluded: boolean;
  };
  files: ManifestFile[];
};

type FileRecord = {
  path: string;
  bytes: number;
  sha256: string;
  isFile: boolean;
  isSymbolicLink: boolean;
  nlink: number;
};

type BuilderFileSet = {
  from?: string;
  to?: string;
  filter?: string[];
};

const appRoot = resolveAppRoot();
const asrRoot = path.join(appRoot, 'resources/local-asr');
const manifestPath = path.join(asrRoot, 'BUNDLE-MANIFEST.json');
const manifestSha256 = 'ea1748ebba0f6d46ca4ca206d2a5c60d4a4f90c0d4657445b4a04ef20a3cece2';

const protectedSha256 = {
  'package.json': '368100e3fd208ff3bd122b1263abb275e8df8abfd772eb852bde20585d0e8541',
  'tsconfig.main.json': '8fc41bd089b801d716f6cfbae5510cb6d06e01afa8b2043b8abdec7a58cb4d1b',
  'vite.config.ts': '8c44fb5ea0a59125563cfa6a5da4c773012dc52535db26cfd39d4805e74f6021',
  'src/main/local-asr-manager.ts':
    '6d98fae3c79438172e5419b277a47cc0db48413665d63bd4a894a080cb3bee38',
  'src/main/local-asr-worker.ts':
    'b5da89ec849ef02f5e4bb759e770e86a198523c0b28c98ef703339f15bfd8a1d',
  'scripts/build-canonical-release.mjs':
    '654f73d2b575d578605adf11cf6a70386acf1146db2c627fff2833f3b557d4c3',
  'scripts/finalize-canonical-release.mjs':
    '02d4e1a7e8d1db10f6cb819928c753f9b24b52482ba801ff2f17e1ff2ec69561',
  'scripts/release-macos-signing.mjs':
    '1fb175cbd693d43f1f8b4807ff6723dc188c9489701c20c3f6b7ffa5b20ba1a0',
  'scripts/release-signing-evidence.mjs':
    '71b317ee0dab8d3c405f215740a5f92cd267b78f92d31dbc01df5efd27510766',
  'scripts/release-windows-signing.mjs':
    'f92623edd175a7195e6c5dac7b8117315f236cfddf841f02c267d3333549dd7c',
} as const;

describe('local ASR static package contract', () => {
  it('binds dev to the relative Worker and packaged runtime to its external URL', async () => {
    const viteConfigPath = path.join(appRoot, 'vite.config.ts');
    const viteConfigSource = await readFile(viteConfigPath, 'utf8');
    const sourceFile = ts.createSourceFile(
      viteConfigPath,
      viteConfigSource,
      ts.ScriptTarget.ES2022,
      true,
      ts.ScriptKind.TS,
    );
    const entries = collectPropertyAssignments(sourceFile, 'entry');

    expect(entries).toHaveLength(1);
    const entry = entries[0]?.initializer;
    expect(entry && ts.isObjectLiteralExpression(entry)).toBe(true);
    if (!entry || !ts.isObjectLiteralExpression(entry)) {
      throw new Error('main entry must be an object literal');
    }

    const actualEntries = Object.fromEntries(entry.properties.map((property) => {
      if (!ts.isPropertyAssignment(property)) {
        throw new Error('main entry may contain only explicit property assignments');
      }
      return [
        propertyName(property.name),
        pathResolveTarget(property.initializer, sourceFile),
      ];
    }));
    expect(actualEntries).toEqual({
      main: 'src/main/main.ts',
      'local-asr-worker': 'src/main/local-asr-worker.ts',
    });

    const managerSource = await readFile(
      path.join(appRoot, 'src/main/local-asr-manager.ts'),
      'utf8',
    );
    expect(managerSource).toContain(
      'function resolveDefaultWorkerEntryUrl(moduleUrl: string): URL',
    );
    expect(managerSource).toContain(
      "return new URL('./local-asr-worker.js', moduleUrl);",
    );
    expect(managerSource).toContain(
      'resolveDefaultWorkerEntryUrl(import.meta.url)',
    );
    expect(managerSource).not.toContain(
      "new URL('./local-asr-worker.js', import.meta.url)",
    );
    expect(managerSource).not.toContain('data:video/mp2t;base64');

    const mainSource = await readFile(
      path.join(appRoot, 'src/main/main.ts'),
      'utf8',
    );
    expect(mainSource).toContain(
      "pathToFileURL(path.join(assetRoot, 'worker', 'local-asr-worker.js'))",
    );
    expect(mainSource).toContain(
      '...(workerEntryUrl ? { workerEntryUrl } : {})',
    );
    expect(mainSource).not.toContain('data:video/mp2t;base64');

    const packageJson = JSON.parse(
      await readFile(path.join(appRoot, 'package.json'), 'utf8'),
    ) as { main?: unknown };
    expect(packageJson.main).toBe('dist/main/main.js');

    const installedPluginRoot = path.resolve(appRoot, '../../node_modules/vite-plugin-electron');
    const installedPluginPackage = JSON.parse(
      await readFile(path.join(installedPluginRoot, 'package.json'), 'utf8'),
    ) as { version?: unknown };
    const installedPluginSource = await readFile(
      path.join(installedPluginRoot, 'dist/index.mjs'),
      'utf8',
    );
    expect(installedPluginPackage.version).toBe('0.28.8');
    expect(installedPluginSource).toContain('fileName: () => "[name].js"');
  });

  it('maps the exact 14 assets plus adjacent external Worker files on macOS only', async () => {
    const manifest = await readManifest();
    const expectedFilter = [manifest.self.path, ...manifest.files.map((file) => file.path)];
    expect(manifest.self).toEqual({
      path: 'BUNDLE-MANIFEST.json',
      excluded: true,
    });
    expect(expectedFilter).toHaveLength(14);

    const builder = parseYaml(
      await readFile(path.join(appRoot, 'electron-builder.yml'), 'utf8'),
    ) as Record<string, any>;
    expect(builder.extraResources).toBeUndefined();
    expect(builder.win?.extraResources).toBeUndefined();
    expect(builder.mac?.extraResources).toEqual([
      {
        from: 'resources/local-asr',
        to: 'local-asr',
        filter: expectedFilter,
      },
      {
        from: 'dist/main',
        to: 'local-asr/worker',
        filter: ['local-asr-*.js'],
      },
    ]);
    expect(builder.asarUnpack).toBeUndefined();
    expect(builder.mac?.asarUnpack).toBeUndefined();
  });

  it('closes every built main relative ESM import in ASAR and every external Worker import', async () => {
    const builder = parseYaml(
      await readFile(path.join(appRoot, 'electron-builder.yml'), 'utf8'),
    ) as Record<string, any>;
    const fileSets = builder.files as Array<string | BuilderFileSet>;
    const mainClosureSet = fileSets.find(
      (entry): entry is BuilderFileSet =>
        typeof entry === 'object'
        && entry.from === 'dist/main'
        && entry.to === 'dist/main',
    );
    expect(mainClosureSet).toEqual({
      from: 'dist/main',
      to: 'dist/main',
      filter: ['**/*.{js,mjs,cjs}'],
    });

    const mainOutputRoot = path.join(appRoot, 'dist/main');
    const mainClosure = await collectRelativeEsmClosure(mainOutputRoot, 'main.js');
    expect(mainClosure[0]).toBe('main.js');
    expect(mainClosure.length).toBeGreaterThan(1);
    for (const relativePath of mainClosure) {
      expect(['.js', '.mjs', '.cjs'], relativePath).toContain(path.extname(relativePath));
    }

    const workerClosure = await collectRelativeEsmClosure(
      mainOutputRoot,
      'local-asr-worker.js',
    );
    expect(workerClosure[0]).toBe('local-asr-worker.js');
    expect(workerClosure.length).toBeGreaterThan(1);
    for (const relativePath of workerClosure) {
      expect(relativePath, 'external Worker closure must remain a flat local-asr JS graph')
        .toMatch(/^local-asr-[A-Za-z0-9_-]+\.js$/);
    }

    const workerResource = builder.mac?.extraResources?.find(
      (entry: BuilderFileSet) =>
        entry.from === 'dist/main'
        && entry.to === 'local-asr/worker',
    ) as BuilderFileSet | undefined;
    expect(workerResource).toEqual({
      from: 'dist/main',
      to: 'local-asr/worker',
      filter: ['local-asr-*.js'],
    });
  });

  it('pins the complete staged 14-file regular single-link inventory', async () => {
    const manifestBytes = await readFile(manifestPath);
    expect(manifestBytes.byteLength).toBe(3_315);
    expect(sha256(manifestBytes)).toBe(manifestSha256);

    const manifest = JSON.parse(manifestBytes.toString('utf8')) as BundleManifest;
    expect(manifest.files).toHaveLength(13);
    expect(manifest.files.reduce((total, file) => total + file.bytes, 0))
      .toBe(46_632_117);

    const { directories, files } = await inventory(asrRoot);
    const expectedPaths = [manifest.self.path, ...manifest.files.map((file) => file.path)]
      .sort((left, right) => left.localeCompare(right));
    expect(directories).toEqual(['licenses', 'model', 'runtime']);
    expect(files.map((file) => file.path)).toEqual(expectedPaths);
    expect(files).toHaveLength(14);
    expect(files.reduce((total, file) => total + file.bytes, 0)).toBe(46_635_432);

    const expectedByPath = new Map<string, { bytes: number; sha256: string }>([
      [
        manifest.self.path,
        { bytes: manifestBytes.byteLength, sha256: manifestSha256 },
      ],
      ...manifest.files.map((file) => [
        file.path,
        { bytes: file.bytes, sha256: file.sha256 },
      ] as const),
    ]);

    for (const file of files) {
      expect(file.isFile, file.path).toBe(true);
      expect(file.isSymbolicLink, file.path).toBe(false);
      expect(file.nlink, file.path).toBe(1);
      expect(
        { bytes: file.bytes, sha256: file.sha256 },
        file.path,
      ).toEqual(expectedByPath.get(file.path));
    }

    // This source-only contract does not close the lstat/readFile pathname race.
  });

  it('preserves unsigned mac, release and Windows configuration semantics', async () => {
    const builder = parseYaml(
      await readFile(path.join(appRoot, 'electron-builder.yml'), 'utf8'),
    ) as Record<string, any>;

    expect(builder.asar).toBe(true);
    expect(builder.files).toEqual([
      'dist/**/*',
      'package.json',
      '!**/*.map',
      '!**/__tests__/**',
      '!**/*.test.*',
      '!**/coverage/**',
      {
        from: 'dist/main',
        to: 'dist/main',
        filter: ['**/*.{js,mjs,cjs}'],
      },
    ]);
    expect(builder.electronVersion).toBe('38.8.6');
    expect(builder.npmRebuild).toBe(false);
    expect(builder.mac).toEqual({
      category: 'public.app-category.productivity',
      target: [
        { target: 'dmg', arch: ['arm64', 'x64'] },
        { target: 'zip', arch: ['arm64', 'x64'] },
      ],
      hardenedRuntime: true,
      gatekeeperAssess: false,
      extraResources: [
        {
          from: 'resources/local-asr',
          to: 'local-asr',
          filter: [
            'BUNDLE-MANIFEST.json',
            'THIRD-PARTY-NOTICES.md',
            'licenses/Apache-2.0.txt',
            'model/README.md',
            'model/decoder-epoch-99-avg-1.int8.onnx',
            'model/encoder-epoch-99-avg-1.int8.onnx',
            'model/joiner-epoch-99-avg-1.int8.onnx',
            'model/tokens.txt',
            'runtime/README.md',
            'runtime/local-asr-no-egress-preload.cjs',
            'runtime/package.json',
            'runtime/sherpa-onnx-asr.js',
            'runtime/sherpa-onnx-wasm-nodejs.js',
            'runtime/sherpa-onnx-wasm-nodejs.wasm',
          ],
        },
        {
          from: 'dist/main',
          to: 'local-asr/worker',
          filter: ['local-asr-*.js'],
        },
      ],
      identity: null,
      extendInfo: {
        CFBundleName: 'njx-copilot-v6',
        CFBundleDisplayName: 'njx-copilot-v6',
        LSApplicationCategoryType: 'public.app-category.productivity',
        NSHumanReadableCopyright: 'Copilot App v6.1 — njx-copilot-v6 © 2026',
        NSMicrophoneUsageDescription: '用于用户主动发起的语音录入，并仅在设备上生成本地证据。',
        NSSpeechRecognitionUsageDescription:
          '用于在设备明确支持时执行严格本地语音识别，不会自动上传音频。',
      },
      artifactName: '${productName}-${version}-${arch}.${ext}',
    });
    expect(builder.dmg).toEqual({
      writeUpdateInfo: false,
      icon: null,
    });
    expect(builder.win).toEqual({
      publisherName: 'njx',
      icon: 'build/icon.ico',
      certificateFile: 'build/dev-cert.pfx',
      certificatePassword: null,
      certificateSubjectName: null,
      signingHashAlgorithms: ['sha256'],
      target: [
        { target: 'nsis', arch: ['x64', 'arm64'] },
        { target: 'portable', arch: ['x64', 'arm64'] },
      ],
      artifactName: '${productName}-${version}-${arch}.${ext}',
    });
    expect(builder.nsis).toEqual({
      oneClick: false,
      perMachine: false,
      allowToChangeInstallationDirectory: true,
      createDesktopShortcut: true,
      createStartMenuShortcut: true,
      shortcutName: 'njx-copilot-v6',
      artifactName: '${productName}-${version}-${arch}-setup.${ext}',
    });
    expect(builder.portable).toEqual({
      artifactName: '${productName}-${version}-${arch}-portable.${ext}',
    });
    expect(builder.publish).toBeNull();
    expect(builder.asarUnpack).toBeUndefined();

    for (const [relativePath, expectedSha256] of Object.entries(protectedSha256)) {
      expect(
        sha256(await readFile(path.join(appRoot, relativePath))),
        relativePath,
      ).toBe(expectedSha256);
    }
  });
});

function resolveAppRoot(cwd = process.cwd()): string {
  const workspaceAppRoot = path.join(cwd, 'apps/copilot-desktop');
  return existsSync(workspaceAppRoot) ? workspaceAppRoot : cwd;
}

function collectPropertyAssignments(
  root: ts.Node,
  name: string,
): ts.PropertyAssignment[] {
  const matches: ts.PropertyAssignment[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isPropertyAssignment(node) && propertyName(node.name) === name) {
      matches.push(node);
    }
    ts.forEachChild(node, visit);
  };
  visit(root);
  return matches;
}

function propertyName(name: ts.PropertyName): string {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) {
    return name.text;
  }
  throw new Error('computed property names are not allowed in package config');
}

function pathResolveTarget(
  initializer: ts.Expression,
  sourceFile: ts.SourceFile,
): string {
  if (
    !ts.isCallExpression(initializer)
    || initializer.expression.getText(sourceFile) !== 'path.resolve'
    || initializer.arguments.length !== 2
    || initializer.arguments[0]?.getText(sourceFile) !== '__dirname'
    || !ts.isStringLiteral(initializer.arguments[1])
  ) {
    throw new Error('entry must be path.resolve(__dirname, <literal>)');
  }
  return initializer.arguments[1].text;
}

async function collectRelativeEsmClosure(
  root: string,
  entryPath: string,
): Promise<string[]> {
  const pending = [entryPath];
  const visited = new Set<string>();

  while (pending.length > 0) {
    const current = pending.shift();
    if (!current || visited.has(current)) continue;
    if (
      path.posix.isAbsolute(current)
      || current === '..'
      || current.startsWith('../')
    ) {
      throw new Error(`relative ESM closure escapes output root: ${current}`);
    }

    const source = await readFile(path.join(root, current), 'utf8');
    visited.add(current);
    const specifiers = staticRelativeEsmSpecifiers(source, current);
    for (const specifier of specifiers) {
      const resolved = path.posix.normalize(path.posix.join(
        path.posix.dirname(current),
        specifier,
      ));
      if (
        path.posix.isAbsolute(resolved)
        || resolved === '..'
        || resolved.startsWith('../')
      ) {
        throw new Error(`relative ESM import escapes output root: ${current} -> ${specifier}`);
      }
      if (!path.posix.extname(resolved)) {
        throw new Error(`built relative ESM import must include an extension: ${current} -> ${specifier}`);
      }
      if (!visited.has(resolved)) pending.push(resolved);
    }
  }

  return [...visited].sort((left, right) => {
    if (left === entryPath) return -1;
    if (right === entryPath) return 1;
    return left.localeCompare(right);
  });
}

function staticRelativeEsmSpecifiers(source: string, fileName: string): string[] {
  const sourceFile = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.ES2022,
    true,
    ts.ScriptKind.JS,
  );
  const specifiers = new Set<string>();
  const add = (value: ts.Expression | undefined): void => {
    if (
      value
      && ts.isStringLiteralLike(value)
      && (value.text.startsWith('./') || value.text.startsWith('../'))
    ) {
      specifiers.add(value.text);
    }
  };
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      add(node.moduleSpecifier);
    } else if (
      ts.isCallExpression(node)
      && node.expression.kind === ts.SyntaxKind.ImportKeyword
      && node.arguments.length === 1
    ) {
      add(node.arguments[0]);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return [...specifiers].sort((left, right) => left.localeCompare(right));
}

async function readManifest(): Promise<BundleManifest> {
  const bytes = await readFile(manifestPath);
  expect(sha256(bytes)).toBe(manifestSha256);
  return JSON.parse(bytes.toString('utf8')) as BundleManifest;
}

async function inventory(root: string): Promise<{
  directories: string[];
  files: FileRecord[];
}> {
  const directories: string[] = [];
  const files: FileRecord[] = [];

  const walk = async (relativeDirectory = ''): Promise<void> => {
    const entries = await readdir(path.join(root, relativeDirectory));
    entries.sort((left, right) => left.localeCompare(right));
    for (const name of entries) {
      const relativePath = path.posix.join(relativeDirectory, name);
      const absolutePath = path.join(root, relativePath);
      const metadata = await lstat(absolutePath);
      if (metadata.isDirectory()) {
        directories.push(relativePath);
        await walk(relativePath);
        continue;
      }
      const bytes = await readFile(absolutePath);
      files.push({
        path: relativePath,
        bytes: bytes.byteLength,
        sha256: sha256(bytes),
        isFile: metadata.isFile(),
        isSymbolicLink: metadata.isSymbolicLink(),
        nlink: metadata.nlink,
      });
    }
  };

  await walk();
  directories.sort((left, right) => left.localeCompare(right));
  files.sort((left, right) => left.path.localeCompare(right.path));
  return { directories, files };
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}
