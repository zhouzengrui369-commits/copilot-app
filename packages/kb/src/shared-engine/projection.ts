import {
  type CanonicalObject,
  type PermissionScope,
  type PrivacyClass,
  type SharedObjectType,
  validateCanonicalObject,
} from './contract.js';
import { contentHash, receiptId } from './identity.js';

export type ProjectionKind =
  | 'CARD_2D'
  | 'WIKI'
  | 'FULL_TEXT'
  | 'VECTOR'
  | 'GRAPH'
  | 'DIALOGUE_CONTEXT';

export interface ProjectionRecipe {
  recipe_id: string;
  recipe_version: string;
}

export interface ProjectionRecord {
  projection_id: string;
  projection_kind: ProjectionKind;
  canonical_object_id: string;
  canonical_object_type: SharedObjectType;
  canonical_content_hash: string;
  canonical_revision: number;
  namespace: string;
  source_refs: readonly string[];
  privacy_class: PrivacyClass;
  permission_fingerprint: string;
  projection_payload_hash: string;
  recipe_id: string;
  recipe_version: string;
  authoritative: false;
  rebuildable: true;
}

export type ProjectionStaleReason =
  | 'OBJECT_ID_MISMATCH'
  | 'OBJECT_TYPE_MISMATCH'
  | 'CONTENT_HASH_MISMATCH'
  | 'REVISION_MISMATCH'
  | 'NAMESPACE_MISMATCH'
  | 'SOURCE_REFS_MISMATCH'
  | 'PRIVACY_MISMATCH'
  | 'PERMISSION_MISMATCH';

export interface ProjectionFreshness {
  fresh: boolean;
  reasons: readonly ProjectionStaleReason[];
}

export class ProjectionContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProjectionContractError';
  }
}

function requireText(value: string, field: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new ProjectionContractError(`${field} is required`);
  return trimmed;
}

function normalizedPermissionScope(scope: PermissionScope): PermissionScope {
  return {
    purposes: [...new Set(scope.purposes)].sort(),
    allowed_consumers: [...new Set(scope.allowed_consumers)].sort(),
    cloud_egress: scope.cloud_egress,
  };
}

function normalizedSourceRefs(sourceRefs: readonly string[]): string[] {
  return [...new Set(sourceRefs)].sort();
}

export function permissionFingerprint(object: CanonicalObject): string {
  validateCanonicalObject(object);
  return contentHash({
    namespace: object.namespace,
    privacy_class: object.privacy_class,
    permission_scope: normalizedPermissionScope(object.permission_scope),
  });
}

export function createProjection(
  object: CanonicalObject,
  kind: ProjectionKind,
  payload: unknown,
  recipe: ProjectionRecipe,
): ProjectionRecord {
  validateCanonicalObject(object);
  const recipeId = requireText(recipe.recipe_id, 'recipe_id');
  const recipeVersion = requireText(recipe.recipe_version, 'recipe_version');
  const payloadHash = contentHash(payload);
  const sourceRefs = normalizedSourceRefs(object.source_refs);
  const permission = permissionFingerprint(object);

  return {
    projection_id: receiptId('projection', {
      projection_kind: kind,
      canonical_object_id: object.object_id,
      canonical_content_hash: object.content_hash,
      canonical_revision: object.revision,
      recipe_id: recipeId,
      recipe_version: recipeVersion,
      projection_payload_hash: payloadHash,
    }),
    projection_kind: kind,
    canonical_object_id: object.object_id,
    canonical_object_type: object.object_type,
    canonical_content_hash: object.content_hash,
    canonical_revision: object.revision,
    namespace: object.namespace,
    source_refs: sourceRefs,
    privacy_class: object.privacy_class,
    permission_fingerprint: permission,
    projection_payload_hash: payloadHash,
    recipe_id: recipeId,
    recipe_version: recipeVersion,
    authoritative: false,
    rebuildable: true,
  };
}

function sameStringSet(left: readonly string[], right: readonly string[]): boolean {
  const a = normalizedSourceRefs(left);
  const b = normalizedSourceRefs(right);
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

export function checkProjectionFreshness(
  projection: ProjectionRecord,
  object: CanonicalObject,
): ProjectionFreshness {
  validateCanonicalObject(object);
  const reasons: ProjectionStaleReason[] = [];
  if (projection.canonical_object_id !== object.object_id) reasons.push('OBJECT_ID_MISMATCH');
  if (projection.canonical_object_type !== object.object_type) reasons.push('OBJECT_TYPE_MISMATCH');
  if (projection.canonical_content_hash !== object.content_hash) reasons.push('CONTENT_HASH_MISMATCH');
  if (projection.canonical_revision !== object.revision) reasons.push('REVISION_MISMATCH');
  if (projection.namespace !== object.namespace) reasons.push('NAMESPACE_MISMATCH');
  if (!sameStringSet(projection.source_refs, object.source_refs)) reasons.push('SOURCE_REFS_MISMATCH');
  if (projection.privacy_class !== object.privacy_class) reasons.push('PRIVACY_MISMATCH');
  if (projection.permission_fingerprint !== permissionFingerprint(object)) reasons.push('PERMISSION_MISMATCH');
  return { fresh: reasons.length === 0, reasons };
}