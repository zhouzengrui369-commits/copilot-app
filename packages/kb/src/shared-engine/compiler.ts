import { type CanonicalObject, validateCanonicalObject } from './contract.js';
import { receiptId, toIsoTime } from './identity.js';

export type CompilationOutcome = 'SUCCESS' | 'PARTIAL' | 'FAILED';

export interface CompilationRecipe {
  recipe_id: string;
  recipe_version: string;
  model_id: string | null;
  parameters_hash: string;
}

export interface CompilationFailure {
  code: string;
  stage: string;
}

export interface CompilationInput {
  input_objects: readonly CanonicalObject[];
  proposed_outputs: readonly CanonicalObject[];
  recipe: CompilationRecipe;
  outcome: CompilationOutcome;
  failure?: CompilationFailure;
  completed_at?: number | string | Date;
}

export interface CompilationReceipt {
  receipt_id: string;
  compilation_id: string;
  outcome: CompilationOutcome;
  recipe_id: string;
  recipe_version: string;
  model_id: string | null;
  parameters_hash: string;
  input_object_ids: readonly string[];
  input_content_hashes: readonly string[];
  output_object_ids: readonly string[];
  output_content_hashes: readonly string[];
  accepted_canonical_write: false;
  error_code: string | null;
  error_stage: string | null;
  completed_at: string;
}

export interface CompilationResult {
  receipt: CompilationReceipt;
  proposed_outputs: CanonicalObject[];
}

export class CompilationContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CompilationContractError';
  }
}

function requireText(value: string, field: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new CompilationContractError(`${field} is required`);
  return trimmed;
}

function requireCode(value: string, field: string): string {
  const trimmed = requireText(value, field);
  if (!/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,79}$/.test(trimmed)) {
    throw new CompilationContractError(`${field} must be a bounded machine code`);
  }
  return trimmed;
}

function validateRecipe(recipe: CompilationRecipe): CompilationRecipe {
  const recipeId = requireText(recipe.recipe_id, 'recipe_id');
  const recipeVersion = requireText(recipe.recipe_version, 'recipe_version');
  if (!/^sha256:[a-f0-9]{64}$/.test(recipe.parameters_hash)) {
    throw new CompilationContractError('parameters_hash must be a sha256 digest');
  }
  if (recipe.model_id !== null && !recipe.model_id.trim()) {
    throw new CompilationContractError('model_id must be null or non-empty');
  }
  return { ...recipe, recipe_id: recipeId, recipe_version: recipeVersion, model_id: recipe.model_id?.trim() ?? null };
}

function validateDerivedOutput(output: CanonicalObject, inputIds: Set<string>): void {
  validateCanonicalObject(output);
  if (output.object_type === 'Source') {
    throw new CompilationContractError('compiler cannot create Source objects');
  }
  if (output.review_state !== 'PROPOSED') {
    throw new CompilationContractError('compiler outputs must remain PROPOSED');
  }
  if (output.assertion_type !== 'SYSTEM_INFERENCE' && output.assertion_type !== 'TEMPORARY_HYPOTHESIS') {
    throw new CompilationContractError('compiler outputs must be inference or hypothesis assertions');
  }
  if (output.source_refs.length === 0) {
    throw new CompilationContractError('compiler output requires source_refs');
  }
  for (const sourceRef of output.source_refs) {
    if (!inputIds.has(sourceRef)) {
      throw new CompilationContractError('compiler output source_ref is not present in input_objects');
    }
  }
}

export function recordCompilation(input: CompilationInput): CompilationResult {
  if (input.input_objects.length === 0) {
    throw new CompilationContractError('compiler requires at least one input object');
  }
  for (const object of input.input_objects) validateCanonicalObject(object);

  const recipe = validateRecipe(input.recipe);
  const inputIds = new Set(input.input_objects.map((object) => object.object_id));
  const uniqueInputIds = [...inputIds].sort();
  if (uniqueInputIds.length !== input.input_objects.length) {
    throw new CompilationContractError('input_objects must not contain duplicate object identities');
  }

  if ((input.outcome === 'FAILED' || input.outcome === 'PARTIAL') && !input.failure) {
    throw new CompilationContractError(`${input.outcome} compilation requires bounded failure metadata`);
  }
  if (input.outcome === 'SUCCESS' && input.failure) {
    throw new CompilationContractError('successful compilation cannot carry failure metadata');
  }
  const errorCode = input.failure ? requireCode(input.failure.code, 'failure.code') : null;
  const errorStage = input.failure ? requireCode(input.failure.stage, 'failure.stage') : null;
  if (input.outcome === 'FAILED' && input.proposed_outputs.length > 0) {
    throw new CompilationContractError('failed compilation cannot emit proposed outputs');
  }

  for (const output of input.proposed_outputs) validateDerivedOutput(output, inputIds);
  if (input.outcome === 'SUCCESS' && input.proposed_outputs.length === 0) {
    throw new CompilationContractError('successful compilation requires at least one proposed output');
  }

  const sortedInputs = [...input.input_objects].sort((a, b) => a.object_id.localeCompare(b.object_id));
  const sortedOutputs = [...input.proposed_outputs].sort((a, b) => a.object_id.localeCompare(b.object_id));
  const compilationId = receiptId('compilation', {
    recipe_id: recipe.recipe_id,
    recipe_version: recipe.recipe_version,
    model_id: recipe.model_id,
    parameters_hash: recipe.parameters_hash,
    inputs: sortedInputs.map((object) => ({ object_id: object.object_id, content_hash: object.content_hash })),
  });
  const completedAt = toIsoTime(input.completed_at ?? new Date());
  const receipt: CompilationReceipt = {
    receipt_id: receiptId('compilation-result', {
      compilation_id: compilationId,
      outcome: input.outcome,
      output_object_ids: sortedOutputs.map((object) => object.object_id),
      output_content_hashes: sortedOutputs.map((object) => object.content_hash),
      error_code: errorCode,
      error_stage: errorStage,
      completed_at: completedAt,
    }),
    compilation_id: compilationId,
    outcome: input.outcome,
    recipe_id: recipe.recipe_id,
    recipe_version: recipe.recipe_version,
    model_id: recipe.model_id,
    parameters_hash: recipe.parameters_hash,
    input_object_ids: sortedInputs.map((object) => object.object_id),
    input_content_hashes: sortedInputs.map((object) => object.content_hash),
    output_object_ids: sortedOutputs.map((object) => object.object_id),
    output_content_hashes: sortedOutputs.map((object) => object.content_hash),
    accepted_canonical_write: false,
    error_code: errorCode,
    error_stage: errorStage,
    completed_at: completedAt,
  };

  return {
    receipt,
    proposed_outputs: sortedOutputs,
  };
}