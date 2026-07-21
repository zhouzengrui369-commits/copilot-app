import { describe, expect, it } from 'vitest';

import { validateRelayUrl } from '../../src/main/remote/pairing.js';

describe('G1 Pairing exact loopback relay policy', () => {
  it.each([
    'ws://127.0.0.1:43125/v1/remote/ws',
    'ws://[::1]:43125/v1/remote/ws',
    'wss://relay.example.test/remote',
    'wss://relay.example.test:443/remote',
  ])('accepts an allowed relay URL: %s', (value) => {
    expect(() => validateRelayUrl(value)).not.toThrow();
  });

  it.each([
    'ws://localhost:43125/v1/remote/ws',
    'ws://relay.example.test:43125/v1/remote/ws',
    'ws://127.0.0.1/v1/remote/ws',
    'ws://user@127.0.0.1:43125/v1/remote/ws',
    'ws://127.0.0.1:43125/remote',
    'ws://127.0.0.1:43125/v1/remote/ws?token=secret',
    'ws://127.0.0.1:43125/v1/remote/ws#fragment',
    'wss://relay.example.test:444/remote',
  ])('rejects an unsafe relay URL: %s', (value) => {
    expect(() => validateRelayUrl(value))
      .toThrowError(expect.objectContaining({ code: 'INVALID_SCHEMA' }));
  });
});
