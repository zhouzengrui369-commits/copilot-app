'use strict';

const path = require('node:path');
const Module = require('node:module');
const realWorkerThreads = require('node:worker_threads');

const runtimeRoot = path.resolve(__dirname);
const exactWorkerTarget = path.join(
    runtimeRoot, 'sherpa-onnx-wasm-nodejs.js');
const allowedRuntimeModules = new Set([
  path.join(runtimeRoot, 'sherpa-onnx-asr.js'),
  exactWorkerTarget,
]);
const builtins = new Set(
    Module.builtinModules.map((name) =>
      name.startsWith('node:') ? name.slice(5) : name));

const state = {
  schemaVersion: 1,
  workerConstructionAttempts: 0,
  workerConstructions: 0,
  unauthorizedWorkerAttempts: 0,
  networkAttempts: 0,
  childProcessAttempts: 0,
  nativeLoads: 0,
  helperLoads: 0,
};
globalThis.__LOCAL_ASR_NO_EGRESS_STATE__ = state;

function deny(kind, surface) {
  if (kind === 'network') {
    state.networkAttempts += 1;
  } else if (kind === 'child-process') {
    state.childProcessAttempts += 1;
  } else if (kind === 'native') {
    state.nativeLoads += 1;
  } else if (kind === 'helper') {
    state.helperLoads += 1;
  } else if (kind === 'worker-boundary') {
    state.unauthorizedWorkerAttempts += 1;
  }
  throw new Error(
      `LOCAL_ASR_NO_EGRESS_${kind.toUpperCase().replace('-', '_')}: ` +
      surface);
}

class GuardedWorker extends realWorkerThreads.Worker {
  constructor(filename, options) {
    state.workerConstructionAttempts += 1;

    if (typeof filename !== 'string' ||
        filename.startsWith('file:') ||
        path.resolve(filename) !== exactWorkerTarget) {
      deny('worker-boundary', 'worker-script-target');
    }
    if (!options || typeof options !== 'object' ||
        Array.isArray(options)) {
      deny('worker-boundary', 'worker-options-object');
    }

    const optionKeys = Object.keys(options).sort();
    if (JSON.stringify(optionKeys) !==
        JSON.stringify(['name', 'workerData'])) {
      deny('worker-boundary', 'worker-options-keys');
    }
    const normalizedEval = options.eval === undefined ? false : options.eval;
    if (options.workerData !== 'em-pthread' ||
        options.name !== 'em-pthread' ||
        normalizedEval !== false) {
      deny('worker-boundary', 'worker-options-values');
    }
    if (state.workerConstructions >= 4) {
      deny('worker-boundary', 'fifth-worker');
    }

    state.workerConstructions += 1;
    super(filename, options);
  }
}

const wrappedWorkerThreads = new Proxy(realWorkerThreads, {
  get(target, property, receiver) {
    if (property === 'Worker') {
      return GuardedWorker;
    }
    return Reflect.get(target, property, receiver);
  },
});

const bannedModules = new Map([
  ['http', 'network'],
  ['https', 'network'],
  ['http2', 'network'],
  ['net', 'network'],
  ['tls', 'network'],
  ['dns', 'network'],
  ['dgram', 'network'],
  ['undici', 'network'],
  ['child_process', 'child-process'],
  ['cluster', 'child-process'],
]);

const originalModuleLoad = Module._load;
Module._load = function guardedModuleLoad(request, parent, isMain) {
  const normalized = request.startsWith('node:') ? request.slice(5) : request;
  const bannedKind = bannedModules.get(normalized);
  if (bannedKind) {
    deny(bannedKind, `module:${normalized}`);
  }
  if (normalized === 'worker_threads') {
    return wrappedWorkerThreads;
  }

  if (!builtins.has(normalized)) {
    const resolved = Module._resolveFilename(request, parent, isMain);
    if (typeof resolved !== 'string' ||
        !path.isAbsolute(resolved) ||
        !allowedRuntimeModules.has(resolved)) {
      deny('helper', 'module-outside-staged-runtime');
    }
    if (resolved.endsWith('.node')) {
      deny('native', 'native-addon-module');
    }
  }
  return originalModuleLoad.call(this, request, parent, isMain);
};

function installGlobalNetworkDeny(name) {
  Object.defineProperty(globalThis, name, {
    configurable: true,
    enumerable: false,
    writable: false,
    value: function deniedGlobalNetworkSurface() {
      deny('network', `global:${name}`);
    },
  });
}

installGlobalNetworkDeny('fetch');
installGlobalNetworkDeny('WebSocket');
installGlobalNetworkDeny('XMLHttpRequest');
installGlobalNetworkDeny('EventSource');

process.dlopen = function deniedDlopen() {
  deny('native', 'process.dlopen');
};
