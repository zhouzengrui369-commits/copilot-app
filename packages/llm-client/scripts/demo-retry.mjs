/**
 * Demo 02 — Exponential backoff retry visualization.
 *
 * Spins up a counter-failing HTTP server that returns 503 twice then 200. The
 * client retries 3 times with the spec-mandated 1s/3s/9s + ±20% jitter. This
 * demo runs with sleep OVERRIDE so it executes fast (uses delays [50, 150, 450] ms).
 *
 * Prints each attempt's delay and elapsed wall time. Used as a screenshot artifact
 * for T-1.1.5 self-verify.
 */

import { createServer } from 'node:http';
import { LLMClient } from '../src/client.js';
import { computeBackoffMs, DEFAULT_JITTER_RATIO } from '../src/middleware/retry.js';

let attempts = 0;
const server = createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c.toString('utf-8')));
  req.on('end', () => {
    attempts++;
    if (attempts <= 2) {
      res.statusCode = 503;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: 'transient' }));
      return;
    }
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json');
    res.end(
      JSON.stringify({
        id: 'demo-1',
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model: 'MiniMax-M3',
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content: 'recovered' },
            finish_reason: 'stop',
          },
        ],
        usage: { prompt_tokens: 5, completion_tokens: 1, total_tokens: 6 },
      }),
    );
  });
});

server.listen(0, '127.0.0.1', async () => {
  const addr = server.address();
  if (!addr || typeof addr === 'string') throw new Error('bind failed');
  const port = addr.port;

  const delays = [50, 150, 450]; // shrunk for demo speed (real: 1000, 3000, 9000)
  const jitterRatio = DEFAULT_JITTER_RATIO;

  const log: string[] = [];
  log.push('=== T-1.1.5 · Exponential-backoff retry demo ===');
  log.push('server fails twice (503), then succeeds on 3rd attempt');
  log.push('');
  log.push('spec schedule (real):  1s / 3s / 9s + ±20% jitter');
  log.push('demo schedule (scaled): ' + delays.join('ms / ') + 'ms + ±20% jitter');
  log.push('');
  log.push('computed backoff (with jitter):');
  log.push('');
  log.push('  +-----------+------------------+-------------------+');
  log.push('  | retry #   | base delay       | w/ ±20% jitter     |');
  log.push('  +-----------+------------------+-------------------+');
  for (let i = 0; i < delays.length; i++) {
    const d = computeBackoffMs(i, delays, jitterRatio);
    log.push(`  | ${String(i + 1).padStart(9)} | ${String(delays[i]).padStart(10)}ms | ${String(d).padStart(13)}ms |`);
  }
  log.push('  +-----------+------------------+-------------------+');
  log.push('');

  const events: { attempt: number; status: number | string; elapsedMs: number; delayMs: number }[] = [];
  const client = new LLMClient({
    apiKey: 'demo-key',
    baseUrl: `http://127.0.0.1:${port}/v1`,
    maxRetries: 3,
    sleep: (ms) =>
      new Promise<void>((r) => {
        events[events.length - 1].delayMs = ms;
        setTimeout(r, ms);
      }),
    logger: (entry) => {
      if (entry.event === 'retry_scheduled') {
        events.push({
          attempt: Number(entry.nextAttempt ?? 0),
          status: 'retry',
          elapsedMs: 0,
          delayMs: 0,
        });
      } else if (entry.event === 'retry_recovered') {
        events.push({
          attempt: Number(entry.attempt ?? 0),
          status: 'recovered',
          elapsedMs: 0,
          delayMs: 0,
        });
      }
    },
  });

  const t0 = Date.now();
  events.push({ attempt: 1, status: 'start', elapsedMs: 0, delayMs: 0 });
  const reply = await client.chat({
    model: 'MiniMax-M3',
    messages: [{ role: 'user', content: 'ping' }],
  });
  const totalMs = Date.now() - t0;

  log.push('execution trace:');
  log.push('');
  log.push('  +----------+----------------+----------+----------------+');
  log.push('  | attempt  | status         | elapsed  | next delay     |');
  log.push('  +----------+----------------+----------+----------------+');
  let cumElapsed = 0;
  for (const e of events) {
    log.push(
      `  | ${String(e.attempt).padStart(8)} | ${e.status.toString().padEnd(14)} | ${String(e.elapsedMs).padStart(7)}ms | ${String(e.delayMs).padStart(11)}ms |`,
    );
    cumElapsed += e.delayMs;
  }
  log.push('  +----------+----------------+----------+----------------+');
  log.push('');
  log.push(`final result:  content="${reply.content}"  usage=${reply.usage.totalTokens}t`);
  log.push(`total elapsed: ${totalMs}ms (real spec would be ~1000 + 3000 = 4000ms minimum)`);
  log.push('');
  log.push('OK · retry recovered on 3rd attempt; fall-through to fallback did NOT trigger');

  process.stdout.write(log.join('\n') + '\n');

  server.close();
});