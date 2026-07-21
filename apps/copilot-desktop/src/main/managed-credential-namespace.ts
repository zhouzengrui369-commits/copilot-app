const MANAGED_PROFILE_NAMESPACE = /^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$/;

export function managedCredentialService(
  kind: 'backup' | 'remote',
  namespace?: string,
): string {
  if (namespace === undefined) return `ai.njx.copilot.v6.${kind}`;
  if (!MANAGED_PROFILE_NAMESPACE.test(namespace)) throw new Error('managed credential namespace is invalid');
  return `ai.njx.copilot.v6.${namespace}.${kind}`;
}

/** Main-only environment parsing. Missing/blank preserves production defaults. */
export function readManagedCredentialNamespace(env: NodeJS.ProcessEnv): string | undefined {
  const raw = env.COPILOT_MANAGED_PROFILE_NAMESPACE;
  if (raw === undefined || raw === '') return undefined;
  if (raw !== raw.trim() || !MANAGED_PROFILE_NAMESPACE.test(raw)) {
    throw new Error('managed credential namespace is invalid');
  }
  return raw;
}
