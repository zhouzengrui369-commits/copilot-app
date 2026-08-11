import { type CanonicalObject, type SourcePayload, validateCanonicalObject } from './contract.js';
import { receiptId, toIsoTime } from './identity.js';

export type IngestionStatus =
  | 'INGESTED'
  | 'UNCHANGED'
  | 'REVISED'
  | 'PARTIAL'
  | 'FAILED'
  | 'STALE';

export type IngestionRequestedOutcome = 'SUCCESS' | 'PARTIAL' | 'FAILED';

export interface IngestionPreviousState {
  object_id: string;
  content_hash: string;
  revision: number;
  observed_at: string;
}

export interface IngestionFailure {
  code: string;
  stage: string;
}

export interface IngestionAttemptInput {
  source: CanonicalObject<SourcePayload>;
  recipe_id: string;
  recipe_version: string;
  requested_outcome?: IngestionRequestedOutcome;
  failure?: IngestionFailure;
  previous?: IngestionPreviousState;
  completed_at?: number | string | Date;
}

export interface IngestionReceipt {
  receipt_id: string;
  ingestion_id: string;
  source_object_id: string;
  source_content_hash: string;
  source_revision: number;
  recipe_id: string;
  recipe_version: string;
  status: IngestionStatus;
  canonical_commit_allowed: boolean;
  previous_content_hash: string | null;
  previous_revision: number | null;
  error_code: string | null;
  error_stage: string | null;
  observed_at: string;
  completed_at: string;
}

export interface IngestionResult {
  receipt: IngestionReceipt;
  canonical_source: CanonicalObject<SourcePayload> | null;
}

export class IngestionContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IngestionContractError';
  }
}

function requireNonEmpty(value: string, label: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new IngestionContractError(`${label} is required`);
  return trimmed;
}

function validatePrevious(source: CanonicalObject<SourcePayload>, previous: IngestionPreviousState): void {
  if (previous.object_id !== source.object_id) {
    throw new IngestionContractError('previous object_id does not match source object identity');
  }
  if (!/^sha256:[a-f0-9]{64}$/.test(previous.content_hash)) {
    throw new IngestionContractError('previous content_hash is invalid');
  }
  if (!Number.isInteger(previous.revision) || previous.revision < 1) {
    throw new IngestionContractError('previous revision must be a positive integer');
  }
  if (Number.isNaN(Date.parse(previous.observed_at))) {
    throw new IngestionContractError('previous observed_at is invalid');
  }
}

function deriveStatus(
  source: CanonicalObject<SourcePayload>,
  previous: IngestionPreviousState | undefined,
  requested: IngestionRequestedOutcome,
): IngestionStatus {
  if (requested === 'FAILED') return 'FAILED';
  if (requested === 'PARTIAL') return 'PARTIAL';
  if (!previous) return 'INGESTED';

  if (Date.parse(source.observed_at) < Date.parse(previous.observed_at)) return 'STALE';
  if (source.content_hash === previous.content_hash) return 'UNCHANGED';
  return 'REVISED';
}

export function recordIngestionAttempt(input: IngestionAttemptInput): IngestionResult {
  validateCanonicalObject(input.source);
  if (input.source.object_type !== 'Source') {
    throw new IngestionContractError('ingestion input must be a Source canonical object');
  }
  if (Number.isNaN(Date.parse(input.source.observed_at))) {
    throw new IngestionContractError('source observed_at is invalid');
  }

  const recipeId = requireNonEmpty(input.recipe_id, 'recipe_id');
  const recipeVersion = requireNonEmpty(input.recipe_version, 'recipe_version');
  const requested = input.requested_outcome ?? 'SUCCESS';
  if (input.previous) validatePrevious(input.source, input.previous);

  if ((requested === 'FAILED' || requested === 'PARTIAL') && !input.failure) {
    throw new IngestionContractError(`${requested} ingestion requires bounded failure metadata`);
  }
  if (requested === 'SUCCESS' && input.failure) {
    throw new IngestionContractError('successful ingestion cannot carry failure metadata');
  }
  if (input.failure) {
    requireNonEmpty(input.failure.code, 'failure.code');
    requireNonEmpty(input.failure.stage, 'failure.stage');
  }

  const completedAt = toIsoTime(input.completed_at ?? new Date());
  const status = deriveStatus(input.source, input.previous, requested);
  const canonicalCommitAllowed = status === 'INGESTED' || status === 'UNCHANGED' || status === 'REVISED';
  const ingestionId = receiptId('ingestion', {
    source_object_id: input.source.object_id,
    source_content_hash: input.source.content_hash,
    source_revision: input.source.revision,
    recipe_id: recipeId,
    recipe_version: recipeVersion,
  });
  const receipt: IngestionReceipt = {
    receipt_id: receiptId('ingestion-result', {
      ingestion_id: ingestionId,
      status,
      previous_content_hash: input.previous?.content_hash ?? null,
      previous_revision: input.previous?.revision ?? null,
      error_code: input.failure?.code ?? null,
      error_stage: input.failure?.stage ?? null,
      completed_at: completedAt,
    }),
    ingestion_id: ingestionId,
    source_object_id: input.source.object_id,
    source_content_hash: input.source.content_hash,
    source_revision: input.source.revision,
    recipe_id: recipeId,
    recipe_version: recipeVersion,
    status,
    canonical_commit_allowed: canonicalCommitAllowed,
    previous_content_hash: input.previous?.content_hash ?? null,
    previous_revision: input.previous?.revision ?? null,
    error_code: input.failure?.code ?? null,
    error_stage: input.failure?.stage ?? null,
    observed_at: input.source.observed_at,
    completed_at: completedAt,
  };

  return {
    receipt,
    canonical_source: canonicalCommitAllowed ? input.source : null,
  };
}