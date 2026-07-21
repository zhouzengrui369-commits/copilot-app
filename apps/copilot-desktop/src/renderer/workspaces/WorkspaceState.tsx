import type { ReactElement, ReactNode } from 'react';

interface WorkspaceStateProps {
  kind: 'loading' | 'empty' | 'error' | 'offline' | 'success';
  title: string;
  detail?: string;
  action?: ReactNode;
}

export function WorkspaceState({
  kind,
  title,
  detail,
  action,
}: WorkspaceStateProps): ReactElement {
  return (
    <section
      className={`workspace-state workspace-state--${kind}`}
      data-testid={`workspace-state-${kind}`}
      aria-live={kind === 'error' || kind === 'offline' ? 'assertive' : 'polite'}
    >
      <strong>{title}</strong>
      {detail ? <p>{detail}</p> : null}
      {action ? <div className="workspace-state__action">{action}</div> : null}
    </section>
  );
}
