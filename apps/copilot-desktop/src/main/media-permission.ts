import type { Session, WebContents } from 'electron';

type WebContentsIdentity = Pick<WebContents, 'id'>;
type PermissionSession = Pick<
  Session,
  'setPermissionCheckHandler' | 'setPermissionRequestHandler'
>;

export interface AudioMediaPermissionInput {
  trustedWebContents: WebContentsIdentity;
  requestingWebContents: WebContentsIdentity | null;
  trustedRendererUrl: string;
  permission: string;
  requestingUrl?: string;
  isMainFrame: boolean;
  mediaTypes?: readonly string[];
  mediaType?: string;
}

/**
 * Fail-closed permission policy for the single Copilot renderer.
 *
 * A shared Electron session can serve DevTools or future WebContents, so the
 * URL alone is not authority. Both the exact WebContents object and the main
 * frame renderer location must match, and every requested media type must be
 * audio. All other Electron permissions are denied.
 */
export function isAllowedAudioMediaPermission(input: AudioMediaPermissionInput): boolean {
  if (input.permission !== 'media') return false;
  if (input.requestingWebContents !== input.trustedWebContents) return false;
  if (input.isMainFrame !== true) return false;
  if (!isTrustedRendererLocation(input.requestingUrl, input.trustedRendererUrl)) return false;

  const requestedMediaTypes = [
    ...(input.mediaTypes ?? []),
    ...(input.mediaType ? [input.mediaType] : []),
  ];
  return requestedMediaTypes.length > 0
    && requestedMediaTypes.every((mediaType) => mediaType === 'audio');
}

export function registerAudioMediaPermissionHandlers(
  session: PermissionSession,
  trustedWebContents: WebContentsIdentity,
  trustedRendererUrl: string,
): void {
  session.setPermissionRequestHandler((requestingWebContents, permission, callback, details) => {
    callback(isAllowedAudioMediaPermission({
      trustedWebContents,
      requestingWebContents,
      trustedRendererUrl,
      permission,
      requestingUrl: details.requestingUrl,
      isMainFrame: details.isMainFrame,
      mediaTypes: 'mediaTypes' in details ? details.mediaTypes : undefined,
    }));
  });

  session.setPermissionCheckHandler((requestingWebContents, permission, requestingOrigin, details) => (
    isAllowedAudioMediaPermission({
      trustedWebContents,
      requestingWebContents,
      trustedRendererUrl,
      permission,
      requestingUrl: details.requestingUrl ?? details.securityOrigin ?? requestingOrigin,
      isMainFrame: details.isMainFrame,
      mediaType: details.mediaType,
    })
  ));
}

function isTrustedRendererLocation(candidate: string | undefined, trusted: string): boolean {
  if (!candidate) return false;
  try {
    const actual = new URL(candidate);
    const expected = new URL(trusted);
    if (expected.protocol === 'file:') {
      if (actual.protocol !== 'file:' || actual.host !== expected.host) return false;
      actual.hash = '';
      actual.search = '';
      expected.hash = '';
      expected.search = '';
      return actual.href === expected.href;
    }
    if (expected.protocol !== 'http:' && expected.protocol !== 'https:') return false;
    return actual.origin === expected.origin;
  } catch {
    return false;
  }
}
