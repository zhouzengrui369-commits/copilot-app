#!/usr/bin/env node
import path from 'node:path';
import { createPmReplayAttestation } from './private-replay-evidence.mjs';

export async function runPmReplayAttestation(args = process.argv.slice(2)) {
  try {
    const options = parseArgs(args);
    const result = await createPmReplayAttestation({
      bundleManifestPath: options.bundle,
      outputPath: options.output,
      replayedAt: options.replayedAt,
      sourcePaths: options.sourcePaths,
      embeddingBaseUrl: options.embeddingBaseUrl,
      embeddingModel: options.embeddingModel,
      fetchImpl: globalThis.fetch,
      timeoutMs: 15_000,
      runnerId: options.runnerId,
      privateKeyPath: options.privateKey,
      candidateRoot: options.candidateRoot,
    });
    process.stdout.write(`${JSON.stringify({
      status: result.document.status,
      attestation: { path: result.path, sha256: result.sha256, bytes: result.bytes },
    })}\n`);
    if (result.document.status !== 'PASS') process.exitCode = 2;
  } catch (error) {
    if (error instanceof Error && /private replay|PM replay|overwrite|exists|missing .*argument/i.test(error.message)) {
      process.stdout.write(`${JSON.stringify({ status: 'BLOCKED', blocker: 'BLOCKED_PRIVATE_REPLAY_EVIDENCE' })}\n`);
      process.exitCode = 2;
      return;
    }
    throw error;
  }
}

function parseArgs(args) {
  const parsed = {};
  const names = new Map([
    ['--bundle', 'bundle'], ['--output', 'output'], ['--replayed-at', 'replayedAt'],
    ['--telemetry-source', 'telemetry'], ['--kb-source', 'kb'], ['--kg-source', 'kg'],
    ['--rag-source', 'rag'], ['--question-set-source', 'questionSet'],
    ['--owner-acceptance-source', 'ownerAcceptance'],
    ['--embedding-base-url', 'embeddingBaseUrl'], ['--embedding-model', 'embeddingModel'],
    ['--runner-id', 'runnerId'], ['--private-key', 'privateKey'],
    ['--candidate-root', 'candidateRoot'],
  ]);
  for (let index = 0; index < args.length; index += 1) {
    const key = names.get(args[index]);
    if (!key) throw new Error(`unknown PM replay argument: ${args[index]}`);
    const value = args[++index];
    if (!value || value.startsWith('--')) throw new Error('missing PM replay argument value');
    parsed[key] = value;
  }
  for (const key of ['bundle', 'output', 'telemetry', 'kb', 'kg', 'rag', 'questionSet', 'ownerAcceptance', 'runnerId', 'privateKey', 'candidateRoot']) {
    if (!parsed[key]) throw new Error(`missing PM replay required argument: ${key}`);
  }
  parsed.bundle = path.resolve(parsed.bundle);
  parsed.output = path.resolve(parsed.output);
  parsed.privateKey = path.resolve(parsed.privateKey);
  parsed.candidateRoot = path.resolve(parsed.candidateRoot);
  parsed.embeddingBaseUrl ??= 'http://127.0.0.1:11434';
  parsed.embeddingModel ??= 'bge-m3:latest';
  parsed.sourcePaths = Object.fromEntries(
    ['telemetry', 'kb', 'kg', 'rag', 'questionSet', 'ownerAcceptance']
      .map((key) => [key, path.resolve(parsed[key])]),
  );
  parsed.replayedAt ??= new Date().toISOString();
  return parsed;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  await runPmReplayAttestation();
}
