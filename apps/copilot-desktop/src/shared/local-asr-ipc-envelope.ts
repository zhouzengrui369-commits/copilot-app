import type { LocalAsrErrorCode } from './local-asr.js';

export const LOCAL_ASR_ERROR_CODES = [
  'ASSETS_UNAVAILABLE',
  'ASSETS_TAMPERED',
  'INVALID_REQUEST',
  'INVALID_AUDIO',
  'BUSY',
  'TIMEOUT',
  'CANCELLED',
  'WORKER_FAILURE',
  'DECODE_FAILURE',
  'INVALID_WORKER_REPLY',
] as const satisfies readonly LocalAsrErrorCode[];

export type LocalAsrIpcEnvelope<T> =
  | { ok: true; value: T }
  | { ok: false; error: { code: LocalAsrErrorCode } };

export function localAsrIpcSuccess<T>(value: T): LocalAsrIpcEnvelope<T> {
  return { ok: true, value };
}

export function localAsrIpcFailure(
  code: LocalAsrErrorCode,
): LocalAsrIpcEnvelope<never> {
  return { ok: false, error: { code } };
}

export function isKnownLocalAsrErrorCode(
  value: unknown,
): value is LocalAsrErrorCode {
  return typeof value === 'string'
    && (LOCAL_ASR_ERROR_CODES as readonly string[]).includes(value);
}

export function isExactPlainRecord(
  value: unknown,
  keys: readonly string[],
): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  try {
    if (Object.getPrototypeOf(value) !== Object.prototype) return false;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const ownKeys = Reflect.ownKeys(value);
    if (ownKeys.some((key) => typeof key !== 'string')) return false;
    const actual = (ownKeys as string[]).sort();
    const expected = [...keys].sort();
    return actual.length === expected.length
      && actual.every((key, index) => {
        const descriptor = descriptors[key];
        return key === expected[index]
          && descriptor !== undefined
          && 'value' in descriptor
          && descriptor.enumerable === true;
      });
  } catch {
    return false;
  }
}

export function isExactLocalAsrIpcEnvelope(
  value: unknown,
): value is LocalAsrIpcEnvelope<unknown> {
  if (isExactPlainRecord(value, ['ok', 'value'])) return value.ok === true;
  if (!isExactPlainRecord(value, ['error', 'ok'])) return false;
  try {
    return value.ok === false
      && isExactPlainRecord(value.error, ['code'])
      && isKnownLocalAsrErrorCode(value.error.code);
  } catch {
    return false;
  }
}
