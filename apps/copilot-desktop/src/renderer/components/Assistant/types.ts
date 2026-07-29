export type AssistantRoute = 'schedule' | 'knowledge' | 'ask' | 'voice' | 'settings';
export type AssistantDock = 'left' | 'right';
export type AssistantTruth =
  | 'IDLE'
  | 'NOT_PROBED'
  | 'CHECKING'
  | 'READY'
  | 'NO_SOURCE'
  | 'STALE'
  | 'ERROR';

export interface GlobalAssistantContext {
  route: AssistantRoute;
  subtitle: string;
  truth?: AssistantTruth;
  sourceCount?: number;
  selectedDate?: string;
  todoCount?: number;
  notePath?: string | null;
  folderPath?: string | null;
  documentPath?: string | null;
  wikiTruth?: 'CURRENT' | 'STALE' | 'NOT_READY' | 'FAILED' | 'MISSING';
}

export interface AssistantPlacement {
  dock: AssistantDock;
  slot: number;
  x: number;
  y: number;
  collisionFree: boolean;
}

export interface AssistantPlacementInput {
  viewportWidth: number;
  viewportHeight: number;
  assistantWidth: number;
  assistantHeight: number;
  preferredDock: AssistantDock;
  preferredY: number;
  avoidRects: ReadonlyArray<DOMRect>;
}
