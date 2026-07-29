import React, { type ComponentType } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import ts from 'typescript';

// @ts-ignore The JavaScript startup contract is exercised directly by Vitest.
import * as performanceConfig from '../scripts/performance-config.mjs';
import * as directProbeModule from '../src/main/direct-performance-probe.js';
import * as appModule from '../src/renderer/App.js';

const rendererMocks = vi.hoisted(() => ({
  hydrate: vi.fn<() => Promise<void>>(() => Promise.resolve()),
}));

vi.mock('electron', () => ({ BrowserWindow: class {} }));
vi.mock('../src/renderer/stores/settings.js', () => ({
  useSettingsStore: (selector: (state: Record<string, unknown>) => unknown) => selector({
    hydrate: rendererMocks.hydrate,
    theme: 'auto',
  }),
}));
vi.mock('../src/renderer/lib/copilot-api.js', () => ({
  resolveCopilotProductApi: () => ({ api: {}, error: null }),
}));
vi.mock('../src/renderer/components/SettingsPanel.js', () => ({ SettingsPanel: () => null }));
vi.mock('../src/renderer/workspaces/KnowledgeWorkspace.js', () => ({ KnowledgeWorkspace: () => null }));
vi.mock('../src/renderer/workspaces/AskWorkspace.js', () => ({ AskWorkspace: () => null }));
vi.mock('../src/renderer/workspaces/VoiceWorkspace.js', () => ({ VoiceWorkspace: () => null }));
vi.mock('../src/renderer/workspaces/ScheduleWorkspace.js', () => ({ ScheduleWorkspace: () => null }));
vi.mock('../src/renderer/workspaces/WorkspaceState.js', () => ({ WorkspaceState: () => null }));

type StartupContractApi = {
  STARTUP_MILESTONE_NAMES?: readonly string[];
  createStartupMilestoneReport?: (input: Record<string, unknown>) => unknown;
};

const api = performanceConfig as StartupContractApi;
const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const expectedMilestones = [
  'processStart',
  'appWhenReady',
  'releaseIdentityStart',
  'releaseIdentityEnd',
  'directProbeInitStart',
  'directProbeInitEnd',
  'windowCreateStart',
  'windowCreated',
  'rendererLoadStart',
  'domReady',
  'readyToShow',
  'rendererShellCommit',
  'appRootVisible',
  'terminalReady',
] as const;

type Deferred<T> = {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
};

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

type TerminalState = {
  nativeWindowVisible: boolean;
  rendererShellCommit: boolean;
  rendererAppRootVisible: boolean;
};

type StartupCoordinator = {
  start(): Promise<void>;
  reportTerminal(update: Partial<TerminalState>): void;
};

type StartupCoordinatorFactory = (options: {
  directMode: boolean;
  startWindow: () => Promise<void>;
  loadReleaseIdentity: () => Promise<unknown>;
  prepareDirectProbe: () => Promise<{ reportTerminal(state: TerminalState): void }>;
  loadSettings: () => Promise<unknown>;
  applySettings: (settings: unknown) => void | Promise<void>;
  onTerminalReady: (state: TerminalState) => void;
  recordDefaultTelemetry: () => void;
  failClosed: (code: string) => void;
}) => StartupCoordinator;

type RouteId = 'knowledge' | 'ask' | 'voice' | 'schedule' | 'settings';
type RouteModule = { default: ComponentType<Record<string, unknown>> };
type RouteLoader = (route: RouteId) => Promise<RouteModule>;

function validMilestones(): Record<(typeof expectedMilestones)[number], {
  offsetMs: number | null;
  reason: string | null;
}> {
  return {
    processStart: { offsetMs: 0, reason: null },
    appWhenReady: { offsetMs: 10, reason: null },
    releaseIdentityStart: { offsetMs: 11, reason: null },
    releaseIdentityEnd: { offsetMs: 52, reason: null },
    directProbeInitStart: { offsetMs: 12, reason: null },
    directProbeInitEnd: { offsetMs: 45, reason: null },
    windowCreateStart: { offsetMs: 11.5, reason: null },
    windowCreated: { offsetMs: 20, reason: null },
    rendererLoadStart: { offsetMs: 21, reason: null },
    domReady: { offsetMs: 30, reason: null },
    readyToShow: { offsetMs: 36, reason: null },
    rendererShellCommit: { offsetMs: 32, reason: null },
    appRootVisible: { offsetMs: 35, reason: null },
    terminalReady: { offsetMs: 53, reason: null },
  };
}

function mutateMilestones(
  mutate: (input: ReturnType<typeof validMilestones>) => void,
): ReturnType<typeof validMilestones> {
  const input = structuredClone(validMilestones());
  mutate(input);
  return input;
}

function propertyName(node: ts.ObjectLiteralElementLike): string | null {
  if (!('name' in node) || !node.name) return null;
  return ts.isIdentifier(node.name) || ts.isStringLiteral(node.name) ? node.name.text : null;
}

function findWhenReadyCallback(sourceFile: ts.SourceFile): ts.ArrowFunction | ts.FunctionExpression | null {
  let result: ts.ArrowFunction | ts.FunctionExpression | null = null;
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node)
      && ts.isPropertyAccessExpression(node.expression)
      && node.expression.name.text === 'then'
      && ts.isCallExpression(node.expression.expression)
      && ts.isPropertyAccessExpression(node.expression.expression.expression)
      && node.expression.expression.expression.name.text === 'whenReady'
    ) {
      const callback = node.arguments[0];
      if (callback && (ts.isArrowFunction(callback) || ts.isFunctionExpression(callback))) result = callback;
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return result;
}

function reachableCallbackStatements(block: ts.Block): ts.Statement[] {
  const result: ts.Statement[] = [];
  const collect = (statements: ts.NodeArray<ts.Statement>): void => {
    for (const statement of statements) {
      result.push(statement);
      if (ts.isBlock(statement)) {
        collect(statement.statements);
      } else if (ts.isTryStatement(statement)) {
        collect(statement.tryBlock.statements);
        if (statement.catchClause) collect(statement.catchClause.block.statements);
        if (statement.finallyBlock) collect(statement.finallyBlock.statements);
      }
      // Deliberately do not descend into if/switch/loops/functions/classes.
      // This prevents a dead/static-false or nested-function fake integration.
      if (ts.isReturnStatement(statement) || ts.isThrowStatement(statement)) break;
    }
  };
  collect(block.statements);
  return result;
}

function bindingIdentifiers(name: ts.BindingName | undefined): ts.Identifier[] {
  if (!name) return [];
  if (ts.isIdentifier(name)) return [name];
  return name.elements.flatMap((element) => (
    ts.isOmittedExpression(element) ? [] : bindingIdentifiers(element.name)
  ));
}

function localValueBindings(root: ts.Node): ts.Identifier[] {
  const result: ts.Identifier[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) || ts.isParameter(node) || ts.isBindingElement(node)) {
      result.push(...bindingIdentifiers(node.name));
    } else if (
      (ts.isFunctionDeclaration(node)
        || ts.isFunctionExpression(node)
        || ts.isClassDeclaration(node)
        || ts.isClassExpression(node))
      && node.name
    ) {
      result.push(node.name);
    }
    ts.forEachChild(node, visit);
  };
  visit(root);
  return result;
}

describe('r22 RED-1..RED-3 startup and lazy-shell contract', () => {
  it('uses the exact privacy-safe milestone schema while allowing parallel pairs to overlap', () => {
    expect(api.STARTUP_MILESTONE_NAMES).toEqual(expectedMilestones);
    expect(typeof api.createStartupMilestoneReport).toBe('function');

    const report = api.createStartupMilestoneReport!(validMilestones());
    expect(report).toEqual({
      clock: 'candidate-process-monotonic-diagnostic-only',
      milestones: validMilestones(),
    });
    expect(JSON.stringify(report)).not.toMatch(/\/Users\/|file:\/\/|api[_-]?key|note content/i);

    expect(() => api.createStartupMilestoneReport!({
      ...validMilestones(),
      privatePath: '/Users/private/notes',
    })).toThrow(/privacy|unknown|schema/i);
    expect(() => api.createStartupMilestoneReport!({
      ...validMilestones(),
      releaseIdentityEnd: { offsetMs: 9, reason: null },
    })).toThrow(/causal|pair|milestone/i);
    expect(() => api.createStartupMilestoneReport!({
      ...validMilestones(),
      directProbeInitEnd: { offsetMs: Number.POSITIVE_INFINITY, reason: null },
    })).toThrow(/finite|invalid|milestone/i);
    expect(() => api.createStartupMilestoneReport!({
      ...validMilestones(),
      readyToShow: { offsetMs: null, reason: '/Users/private/window' },
    })).toThrow(/reason|privacy|milestone/i);
  });

  it.each([
    ['negative offset', mutateMilestones((input) => { input.domReady.offsetMs = -0.01; }), /BLOCKED_STARTUP_MILESTONES_INVALID/],
    ['NaN offset', mutateMilestones((input) => { input.rendererLoadStart.offsetMs = Number.NaN; }), /BLOCKED_STARTUP_MILESTONES_INVALID/],
    ['infinite offset', mutateMilestones((input) => { input.directProbeInitEnd.offsetMs = Number.POSITIVE_INFINITY; }), /BLOCKED_STARTUP_MILESTONES_INVALID/],
    ['illegal ready-to-show reason', mutateMilestones((input) => {
      input.readyToShow = { offsetMs: null, reason: 'private-window-path' };
    }), /BLOCKED_STARTUP_MILESTONES_NULL_REASON/],
    ['inner unknown key', mutateMilestones((input) => {
      Object.assign(input.windowCreated, { detail: 'forbidden' });
    }), /BLOCKED_STARTUP_MILESTONES_PRIVACY/],
    ['inner missing field', mutateMilestones((input) => {
      delete (input.appRootVisible as { reason?: string | null }).reason;
    }), /BLOCKED_STARTUP_MILESTONES_PRIVACY/],
    ['release causal pair', mutateMilestones((input) => { input.releaseIdentityEnd.offsetMs = 10; }), /BLOCKED_STARTUP_MILESTONES_CAUSAL/],
    ['probe causal pair', mutateMilestones((input) => { input.directProbeInitEnd.offsetMs = 11; }), /BLOCKED_STARTUP_MILESTONES_CAUSAL/],
    ['window causal pair', mutateMilestones((input) => { input.windowCreated.offsetMs = 11; }), /BLOCKED_STARTUP_MILESTONES_CAUSAL/],
    ['renderer causal pair', mutateMilestones((input) => { input.domReady.offsetMs = 20; }), /BLOCKED_STARTUP_MILESTONES_CAUSAL/],
    ['app-root causal pair', mutateMilestones((input) => { input.appRootVisible.offsetMs = 31; }), /BLOCKED_STARTUP_MILESTONES_CAUSAL/],
  ] as const)('rejects %s', (_name, input, expectedCode) => {
    expect(() => api.createStartupMilestoneReport!(input)).toThrow(expectedCode);
  });

  it('accepts only the fixed ready-to-show null reason', () => {
    const input = mutateMilestones((milestones) => {
      milestones.readyToShow = {
        offsetMs: null,
        reason: 'ready-to-show-event-not-observed',
      };
    });
    expect(api.createStartupMilestoneReport!(input)).toMatchObject({
      milestones: {
        readyToShow: { offsetMs: null, reason: 'ready-to-show-event-not-observed' },
      },
    });
  });

  it('drives four deferred startup lanes through a write-once terminal latch', async () => {
    const createStartupCoordinator = (directProbeModule as unknown as {
      createStartupCoordinator?: StartupCoordinatorFactory;
    }).createStartupCoordinator;
    expect(typeof createStartupCoordinator).toBe('function');

    const windowLane = deferred<void>();
    const identityLane = deferred<unknown>();
    const probeLane = deferred<{ reportTerminal(state: TerminalState): void }>();
    const settingsLane = deferred<unknown>();
    const starts: string[] = [];
    const probeTerminal = vi.fn();
    const applySettings = vi.fn();
    const onTerminalReady = vi.fn();
    const recordDefaultTelemetry = vi.fn();
    const failClosed = vi.fn();
    const coordinator = createStartupCoordinator!({
      directMode: true,
      startWindow: () => { starts.push('window'); return windowLane.promise; },
      loadReleaseIdentity: () => { starts.push('identity'); return identityLane.promise; },
      prepareDirectProbe: () => { starts.push('probe'); return probeLane.promise; },
      loadSettings: () => { starts.push('settings'); return settingsLane.promise; },
      applySettings,
      onTerminalReady,
      recordDefaultTelemetry,
      failClosed,
    });

    let completed = false;
    const completion = coordinator.start().then(() => { completed = true; });
    expect(starts).toEqual(['window', 'identity', 'probe', 'settings']);
    coordinator.reportTerminal({ nativeWindowVisible: true });
    coordinator.reportTerminal({ rendererShellCommit: true });
    coordinator.reportTerminal({ rendererAppRootVisible: true });
    expect(onTerminalReady).not.toHaveBeenCalled();

    windowLane.resolve();
    probeLane.resolve({ reportTerminal: probeTerminal });
    await Promise.resolve();
    expect(onTerminalReady).not.toHaveBeenCalled();
    expect(probeTerminal).not.toHaveBeenCalled();
    identityLane.resolve({ candidate: 'r22' });
    await waitFor(() => expect(onTerminalReady).toHaveBeenCalledTimes(1));
    expect(probeTerminal).toHaveBeenCalledTimes(1);
    expect(probeTerminal).toHaveBeenLastCalledWith({
      nativeWindowVisible: true,
      rendererShellCommit: true,
      rendererAppRootVisible: true,
    });
    expect(completed).toBe(false);

    settingsLane.resolve({ theme: 'dark' });
    await completion;
    expect(applySettings).toHaveBeenCalledTimes(1);
    expect(applySettings).toHaveBeenLastCalledWith({ theme: 'dark' });
    coordinator.reportTerminal({ nativeWindowVisible: true });
    coordinator.reportTerminal({ rendererShellCommit: true });
    coordinator.reportTerminal({ rendererAppRootVisible: true });
    expect(onTerminalReady).toHaveBeenCalledTimes(1);
    expect(probeTerminal).toHaveBeenCalledTimes(1);
    expect(failClosed).not.toHaveBeenCalled();
    expect(recordDefaultTelemetry).not.toHaveBeenCalled();

    const directFailure = deferred<{ reportTerminal(state: TerminalState): void }>();
    const directFailClosed = vi.fn();
    const failingDirect = createStartupCoordinator!({
      directMode: true,
      startWindow: async () => undefined,
      loadReleaseIdentity: async () => ({}),
      prepareDirectProbe: () => directFailure.promise,
      loadSettings: async () => ({}),
      applySettings: vi.fn(),
      onTerminalReady: vi.fn(),
      recordDefaultTelemetry: vi.fn(),
      failClosed: directFailClosed,
    });
    const failedStart = failingDirect.start();
    directFailure.reject(new Error('probe invalid'));
    await expect(failedStart).rejects.toThrow(/probe|direct|ancillary/i);
    expect(directFailClosed).toHaveBeenCalledTimes(1);

    const defaultTelemetry = vi.fn();
    const defaultFailClosed = vi.fn();
    const defaultStartWindow = vi.fn(async () => undefined);
    const defaultLoadIdentity = vi.fn(async () => ({}));
    const defaultPrepareProbe = vi.fn(async () => ({ reportTerminal: vi.fn() }));
    const defaultLoadSettings = vi.fn(async () => ({ theme: 'auto' }));
    const defaultApplySettings = vi.fn();
    const defaultTerminalReady = vi.fn();
    const defaultCoordinator = createStartupCoordinator!({
      directMode: false,
      startWindow: defaultStartWindow,
      loadReleaseIdentity: defaultLoadIdentity,
      prepareDirectProbe: defaultPrepareProbe,
      loadSettings: defaultLoadSettings,
      applySettings: defaultApplySettings,
      onTerminalReady: defaultTerminalReady,
      recordDefaultTelemetry: defaultTelemetry,
      failClosed: defaultFailClosed,
    });
    const defaultStart = defaultCoordinator.start();
    defaultCoordinator.reportTerminal({
      nativeWindowVisible: true,
      rendererShellCommit: true,
      rendererAppRootVisible: true,
    });
    await expect(defaultStart).resolves.toBeUndefined();
    expect(defaultFailClosed).not.toHaveBeenCalled();
    expect(defaultStartWindow).toHaveBeenCalledTimes(1);
    expect(defaultLoadIdentity).toHaveBeenCalledTimes(1);
    expect(defaultPrepareProbe).not.toHaveBeenCalled();
    expect(defaultLoadSettings).toHaveBeenCalledTimes(1);
    expect(defaultApplySettings).toHaveBeenCalledTimes(1);
    expect(defaultTerminalReady).toHaveBeenCalledTimes(1);
    expect(defaultTelemetry).toHaveBeenCalledTimes(1);
  });

  it('marks app-root visibility before the IPC handler can publish terminal readiness', async () => {
    const main = await readFile(path.join(desktopRoot, 'src/main/main.ts'), 'utf8');
    const sourceFile = ts.createSourceFile(
      'main.ts',
      main,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS,
    );
    const registerIpc = sourceFile.statements.find((statement): statement is ts.FunctionDeclaration => (
      ts.isFunctionDeclaration(statement)
      && statement.name?.text === 'registerIpc'
      && statement.body !== undefined
    ));
    expect(registerIpc?.body).toBeDefined();

    const appRootListener = registerIpc!.body!.statements.find((statement) => {
      if (!ts.isExpressionStatement(statement) || !ts.isCallExpression(statement.expression)) return false;
      const call = statement.expression;
      if (
        !ts.isPropertyAccessExpression(call.expression)
        || !ts.isIdentifier(call.expression.expression)
        || call.expression.expression.text !== 'ipcMain'
        || call.expression.name.text !== 'on'
      ) return false;
      const channel = call.arguments[0];
      return Boolean(
        channel
        && ts.isPropertyAccessExpression(channel)
        && ts.isIdentifier(channel.expression)
        && channel.expression.text === 'IPC_CHANNELS'
        && channel.name.text === 'STARTUP_APP_ROOT_VISIBLE',
      );
    });
    expect(appRootListener && ts.isExpressionStatement(appRootListener)).toBe(true);
    const listenerCall = (appRootListener as ts.ExpressionStatement).expression as ts.CallExpression;
    const callback = listenerCall.arguments[1];
    expect(callback && (ts.isArrowFunction(callback) || ts.isFunctionExpression(callback))).toBe(true);
    if (!callback || (!ts.isArrowFunction(callback) && !ts.isFunctionExpression(callback))) {
      throw new Error('STARTUP_APP_ROOT_VISIBLE listener callback is missing');
    }
    expect(ts.isBlock(callback.body)).toBe(true);
    if (!ts.isBlock(callback.body)) throw new Error('STARTUP_APP_ROOT_VISIBLE listener must use a block');
    const guardedBody = callback.body.statements.find(ts.isIfStatement)?.thenStatement;
    expect(guardedBody && ts.isBlock(guardedBody)).toBe(true);
    const statements = (guardedBody as ts.Block).statements;

    const appRootMarkIndex = statements.findIndex((statement) => (
      ts.isExpressionStatement(statement)
      && ts.isCallExpression(statement.expression)
      && ts.isIdentifier(statement.expression.expression)
      && statement.expression.expression.text === 'markAppRootVisibleIfComplete'
    ));
    const explicitTerminalReportIndex = statements.findIndex((statement) => (
      ts.isExpressionStatement(statement)
      && ts.isCallExpression(statement.expression)
      && ts.isPropertyAccessExpression(statement.expression.expression)
      && statement.expression.expression.name.text === 'reportTerminal'
      && ts.isIdentifier(statement.expression.expression.expression)
      && statement.expression.expression.expression.text === 'startupCoordinator'
    ));
    expect(appRootMarkIndex).toBeGreaterThanOrEqual(0);
    expect(explicitTerminalReportIndex).toBeGreaterThanOrEqual(0);
    expect(appRootMarkIndex).toBeLessThan(explicitTerminalReportIndex);

    const createStartupCoordinator = (directProbeModule as unknown as {
      createStartupCoordinator: StartupCoordinatorFactory;
    }).createStartupCoordinator;
    let appRootMilestoneMarked = false;
    const onTerminalReady = vi.fn(() => {
      expect(appRootMilestoneMarked).toBe(true);
    });
    const coordinator = createStartupCoordinator({
      directMode: true,
      startWindow: async () => undefined,
      loadReleaseIdentity: async () => ({}),
      prepareDirectProbe: async () => ({ reportTerminal: vi.fn() }),
      loadSettings: async () => ({}),
      applySettings: vi.fn(),
      onTerminalReady,
      recordDefaultTelemetry: vi.fn(),
      failClosed: vi.fn(),
    });
    const completion = coordinator.start();
    coordinator.reportTerminal({ nativeWindowVisible: true });
    coordinator.reportTerminal({ rendererShellCommit: true });
    appRootMilestoneMarked = true;
    coordinator.reportTerminal({ rendererAppRootVisible: true });
    await completion;
    expect(onTerminalReady).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['window', 'BLOCKED_DIRECT_PERF_STARTUP_WINDOW'],
    ['releaseIdentity', 'BLOCKED_DIRECT_PERF_STARTUP_RELEASE_IDENTITY'],
    ['probe', 'BLOCKED_DIRECT_PERF_STARTUP_PROBE'],
    ['settingsLoad', 'BLOCKED_DIRECT_PERF_STARTUP_SETTINGS_LOAD'],
    ['settingsApply', 'BLOCKED_DIRECT_PERF_STARTUP_SETTINGS_APPLY'],
  ] as const)(
    'attributes synchronous and asynchronous %s lane failures without exposing raw errors',
    async (failingLane, expectedCode) => {
      const createStartupCoordinator = (directProbeModule as unknown as {
        createStartupCoordinator: StartupCoordinatorFactory;
      }).createStartupCoordinator;

      for (const failureKind of ['sync', 'async'] as const) {
        const starts: string[] = [];
        const rawError = new TypeError(`sensitive-${failingLane}-${failureKind}`);
        const fail = <T,>(): T | Promise<T> => {
          if (failureKind === 'sync') throw rawError;
          return Promise.reject(rawError);
        };
        const run = <T,>(lane: typeof failingLane, value: T): T | Promise<T> => (
          lane === failingLane ? fail<T>() : value
        );
        const failClosed = vi.fn();
        const coordinator = createStartupCoordinator({
          directMode: true,
          startWindow: () => {
            starts.push('window');
            return run('window', Promise.resolve()) as Promise<void>;
          },
          loadReleaseIdentity: () => {
            starts.push('releaseIdentity');
            return run('releaseIdentity', Promise.resolve({})) as Promise<unknown>;
          },
          prepareDirectProbe: () => {
            starts.push('probe');
            return run('probe', Promise.resolve({ reportTerminal: vi.fn() })) as Promise<{
              reportTerminal(state: TerminalState): void;
            }>;
          },
          loadSettings: () => {
            starts.push('settingsLoad');
            return run('settingsLoad', Promise.resolve({ theme: 'auto' })) as Promise<unknown>;
          },
          applySettings: () => {
            starts.push('settingsApply');
            return run('settingsApply', Promise.resolve()) as Promise<void>;
          },
          onTerminalReady: vi.fn(),
          recordDefaultTelemetry: vi.fn(),
          failClosed,
        });

        const completion = coordinator.start();
        coordinator.reportTerminal({ rendererShellCommit: true });
        await expect(completion).rejects.toMatchObject({
          code: expectedCode,
          message: expectedCode,
        });
        expect(starts.slice(0, 4)).toEqual([
          'window',
          'releaseIdentity',
          'probe',
          'settingsLoad',
        ]);
        expect(failClosed).toHaveBeenCalledTimes(1);
        expect(failClosed).toHaveBeenCalledWith(expectedCode);
        expect(JSON.stringify(failClosed.mock.calls)).not.toContain('sensitive-');
      }
    },
  );

  it('preserves existing blocker codes and leaves normal-mode errors untouched', async () => {
    const createStartupCoordinator = (directProbeModule as unknown as {
      createStartupCoordinator: StartupCoordinatorFactory;
    }).createStartupCoordinator;
    const namedError = Object.assign(new Error('BLOCKED_EXISTING_STARTUP_LANE'), {
      code: 'BLOCKED_EXISTING_STARTUP_LANE',
    });
    const directFailClosed = vi.fn();
    const direct = createStartupCoordinator({
      directMode: true,
      startWindow: () => { throw namedError; },
      loadReleaseIdentity: async () => ({}),
      prepareDirectProbe: async () => ({ reportTerminal: vi.fn() }),
      loadSettings: async () => ({}),
      applySettings: vi.fn(),
      onTerminalReady: vi.fn(),
      recordDefaultTelemetry: vi.fn(),
      failClosed: directFailClosed,
    });
    await expect(direct.start()).rejects.toMatchObject({
      code: 'BLOCKED_EXISTING_STARTUP_LANE',
      message: 'BLOCKED_EXISTING_STARTUP_LANE',
    });
    expect(directFailClosed).toHaveBeenCalledWith('BLOCKED_EXISTING_STARTUP_LANE');

    const normalError = new TypeError('normal-mode-error');
    const normalFailClosed = vi.fn();
    const normal = createStartupCoordinator({
      directMode: false,
      startWindow: () => { throw normalError; },
      loadReleaseIdentity: async () => ({}),
      prepareDirectProbe: async () => ({ reportTerminal: vi.fn() }),
      loadSettings: async () => ({}),
      applySettings: vi.fn(),
      onTerminalReady: vi.fn(),
      recordDefaultTelemetry: vi.fn(),
      failClosed: normalFailClosed,
    });
    await expect(normal.start()).rejects.toBe(normalError);
    expect(normalFailClosed).not.toHaveBeenCalled();
  });

  it('AST-binds an unshadowed named import to reachable app.whenReady coordinator statements', async () => {
    const main = await readFile(path.join(desktopRoot, 'src/main/main.ts'), 'utf8');
    const sourceFile = ts.createSourceFile(
      'main.ts',
      main,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS,
    );
    const callback = findWhenReadyCallback(sourceFile);
    expect(callback).not.toBeNull();
    expect(callback?.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.AsyncKeyword)).toBe(true);

    const coordinatorImports = sourceFile.statements.flatMap((statement) => {
      if (
        !ts.isImportDeclaration(statement)
        || !ts.isStringLiteral(statement.moduleSpecifier)
        || statement.moduleSpecifier.text !== './direct-performance-probe.js'
        || statement.importClause?.isTypeOnly === true
        || !statement.importClause?.namedBindings
        || !ts.isNamedImports(statement.importClause.namedBindings)
      ) return [];
      return statement.importClause.namedBindings.elements.filter((specifier) => (
        specifier.isTypeOnly !== true
        &&
        (specifier.propertyName ?? specifier.name).text === 'createStartupCoordinator'
      ));
    });
    expect(coordinatorImports).toHaveLength(1);
    const importedCoordinatorName = coordinatorImports[0]!.name.text;
    expect(localValueBindings(callback!).filter((binding) => (
      binding.text === importedCoordinatorName
    ))).toEqual([]);

    expect(ts.isBlock(callback!.body)).toBe(true);
    const reachableStatements = reachableCallbackStatements(callback!.body as ts.Block);
    let coordinatorDeclaration: ts.VariableDeclaration | null = null;
    let declarationStatementIndex = -1;
    for (const [statementIndex, statement] of reachableStatements.entries()) {
      if (!ts.isVariableStatement(statement)) continue;
      for (const declaration of statement.declarationList.declarations) {
        if (
          declaration.initializer
          && ts.isCallExpression(declaration.initializer)
          && ts.isIdentifier(declaration.initializer.expression)
          && declaration.initializer.expression.text === importedCoordinatorName
        ) {
          coordinatorDeclaration = declaration;
          declarationStatementIndex = statementIndex;
        }
      }
    }
    expect(coordinatorDeclaration).not.toBeNull();

    const declaration = coordinatorDeclaration as unknown as ts.VariableDeclaration;
    expect(ts.isIdentifier(declaration.name)).toBe(true);
    const coordinatorName = (declaration.name as ts.Identifier).text;
    const initializer = declaration.initializer as ts.CallExpression;
    const options = initializer.arguments[0];
    expect(options && ts.isObjectLiteralExpression(options)).toBe(true);
    const properties = new Map(
      (options as ts.ObjectLiteralExpression).properties.map((property) => [propertyName(property), property]),
    );
    for (const [name, realBinding] of [
      ['startWindow', /createMainWindow/],
      ['loadReleaseIdentity', /loadPackagedReleaseIdentity/],
      ['prepareDirectProbe', /createDirectPerformanceProbe/],
      ['loadSettings', /getStorage|createSettingsStore/],
    ] as const) {
      const property = properties.get(name);
      expect(property, `${name} must be an AST object property`).toBeDefined();
      expect(ts.isPropertyAssignment(property!)).toBe(true);
      const value = (property as ts.PropertyAssignment).initializer;
      expect(ts.isStringLiteral(value) || ts.isNoSubstitutionTemplateLiteral(value)).toBe(false);
      expect(value.getText(sourceFile)).toMatch(realBinding);
    }

    const awaitedStartIndexes = reachableStatements.flatMap((statement, statementIndex) => {
      const candidates: ts.Expression[] = [];
      if (ts.isExpressionStatement(statement)) candidates.push(statement.expression);
      if (ts.isReturnStatement(statement) && statement.expression) candidates.push(statement.expression);
      if (ts.isVariableStatement(statement)) {
        for (const item of statement.declarationList.declarations) {
          if (item.initializer) candidates.push(item.initializer);
        }
      }
      return candidates.some((candidate) => (
        ts.isAwaitExpression(candidate)
        && ts.isCallExpression(candidate.expression)
        && ts.isPropertyAccessExpression(candidate.expression.expression)
        && ts.isIdentifier(candidate.expression.expression.expression)
        && candidate.expression.expression.expression.text === coordinatorName
        && candidate.expression.expression.name.text === 'start'
      )) ? [statementIndex] : [];
    });
    expect(awaitedStartIndexes).toHaveLength(1);
    expect(awaitedStartIndexes[0]).toBeGreaterThan(declarationStatementIndex);
  });

  it('keeps the real shell eager but defers every feature workspace and heavy graph owner', async () => {
    const [appSource, entrySource, settingsSource] = await Promise.all([
      readFile(path.join(desktopRoot, 'src/renderer/App.tsx'), 'utf8'),
      readFile(path.join(desktopRoot, 'src/renderer/main.tsx'), 'utf8'),
      readFile(path.join(desktopRoot, 'src/renderer/stores/settings.ts'), 'utf8'),
    ]);

    expect(appSource).toContain('routeLoader');
    for (const eagerImport of [
      "from './components/SettingsPanel.js'",
      "from './workspaces/KnowledgeWorkspace.js'",
      "from './workspaces/AskWorkspace.js'",
      "from './workspaces/VoiceWorkspace.js'",
      "from './workspaces/ScheduleWorkspace.js'",
    ]) {
      expect(appSource).not.toContain(eagerImport);
    }
    for (const deferredModule of [
      './components/SettingsPanel.js',
      './workspaces/KnowledgeWorkspace.js',
      './workspaces/AskWorkspace.js',
      './workspaces/VoiceWorkspace.js',
      './workspaces/ScheduleWorkspace.js',
    ]) {
      expect(appSource).toContain(`import('${deferredModule}')`);
    }
    expect(appSource).toMatch(/Suspense|route-loading|workspace-loading/i);
    expect(appSource).toContain('data-testid="app-root"');
    expect(appSource).toContain('aria-label="Primary"');
    expect(appSource).toContain('app__statusbar');
    expect(appSource).toContain('void hydrate();');
    expect(settingsSource).toMatch(/catch \(err\)[\s\S]*hydrated: true/);

    expect(entrySource.indexOf('ReactDOM.createRoot(rootEl).render(')).toBeGreaterThanOrEqual(0);
    expect(entrySource.indexOf("'[data-testid=\"app-root\"]'")).toBeGreaterThan(
      entrySource.indexOf('ReactDOM.createRoot(rootEl).render('),
    );
    expect(`${entrySource}\n${appSource}`).not.toMatch(
      /from ['"](?:sigma|graphology|react-markdown)|from ['"].*KnowledgeGraph|from ['"].*VoiceWorkspace/,
    );

    const hydrateLane = deferred<void>();
    rendererMocks.hydrate.mockImplementationOnce(() => hydrateLane.promise);
    const lanes = Object.fromEntries(
      (['knowledge', 'ask', 'voice', 'schedule', 'settings'] as RouteId[])
        .map((route) => [route, deferred<RouteModule>()]),
    ) as Record<RouteId, Deferred<RouteModule>>;
    const routeLoader = vi.fn<RouteLoader>((route) => lanes[route].promise);
    const App = appModule.App as ComponentType<{ routeLoader: RouteLoader }>;
    render(React.createElement(App, { routeLoader }));

    expect(screen.getByTestId('app-root')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Copilot' })).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Primary' })).toBeInTheDocument();
    expect(screen.getByTestId('status-theme')).toBeInTheDocument();
    expect(screen.getByTestId('workspace-loading')).toHaveAttribute('role', 'status');
    const scheduleButton = screen.getByTestId('nav-schedule');
    scheduleButton.focus();
    expect(document.activeElement).toBe(scheduleButton);
    expect(screen.queryByTestId('nav-voice')).not.toBeInTheDocument();
    expect(rendererMocks.hydrate).toHaveBeenCalledTimes(1);

    const component = (route: RouteId): RouteModule => ({
      default: () => React.createElement('section', { 'data-testid': `feature-${route}` }, route),
    });
    await act(async () => { lanes.schedule.resolve(component('schedule')); });
    expect(await screen.findByTestId('feature-schedule')).toBeInTheDocument();
    for (const route of ['knowledge', 'ask', 'settings'] as RouteId[]) {
      fireEvent.click(screen.getByTestId(`nav-${route}`));
      expect(screen.getByTestId('workspace-loading')).toBeInTheDocument();
      await act(async () => { lanes[route].resolve(component(route)); });
      expect(await screen.findByTestId(`feature-${route}`)).toBeInTheDocument();
    }
    expect(routeLoader.mock.calls.map(([route]) => route)).toEqual([
      'schedule', 'knowledge', 'ask', 'settings',
    ]);
    hydrateLane.resolve();
  });

});
