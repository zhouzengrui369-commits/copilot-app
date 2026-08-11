/**
 * KnowledgeGraph — NodeInteraction (Sprint 1.2 / T-1.2.2).
 *
 * Encapsulates the click / hover side of the KG graph. The component
 * is intentionally dumb: it receives a click callback from the
 * parent and emits semantic events; the parent (KnowledgeGraph
 * container) decides what to do (open NoteDetail, highlight
 * neighbours, etc.).
 *
 * Sigma.js itself handles drag / zoom / pan via its built-in
 * `enableHover`, `enableCamera`, `mouseEnabled` defaults — those
 * work without any wiring from us. This component just surfaces a
 * click counter + hovered-entity id for the verifier / tests.
 */

import { useCallback, useRef, useState } from 'react';
import type { Entity } from '@copilot/kg';

export interface NodeInteractionProps {
  /** Map of entity_id → Entity, used to resolve hover/click events. */
  entityIndex: ReadonlyMap<string, Entity>;
  onNodeClick?: (entity: Entity) => void;
  onNodeHover?: (entity: Entity | null) => void;
  /** Forwarded click — emitted when a node is clicked. */
  onClickNode?: (entity_id: string) => void;
  /** Forwarded hover — emitted when a node is hovered (or hover ends). */
  onHoverNode?: (entity_id: string | null) => void;
}

export interface NodeInteractionState {
  /** Number of click events emitted in this session. */
  clickCount: number;
  /** Currently hovered entity_id (null = none). */
  hoveredId: string | null;
  /** Wire sigma click events to the consumer. */
  handleClick: (entity_id: string) => void;
  /** Wire sigma hover events to the consumer. */
  handleHover: (entity_id: string | null) => void;
  /** Reset counters (used by tests). */
  reset: () => void;
}

export function useNodeInteraction({
  entityIndex,
  onNodeClick,
  onNodeHover,
  onClickNode,
  onHoverNode,
}: NodeInteractionProps): NodeInteractionState {
  const [clickCount, setClickCount] = useState<number>(0);
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  // Sigma owns long-lived event handlers. Keep their public function identity
  // stable, but resolve every event against the latest committed entity index
  // and consumer callbacks. This prevents a graph that has already rendered
  // fresh nodes from dispatching through the initial empty-index closure before
  // a passive handler-sync effect runs.
  const entityIndexRef = useRef(entityIndex);
  const onNodeClickRef = useRef(onNodeClick);
  const onNodeHoverRef = useRef(onNodeHover);
  const onClickNodeRef = useRef(onClickNode);
  const onHoverNodeRef = useRef(onHoverNode);
  entityIndexRef.current = entityIndex;
  onNodeClickRef.current = onNodeClick;
  onNodeHoverRef.current = onNodeHover;
  onClickNodeRef.current = onClickNode;
  onHoverNodeRef.current = onHoverNode;

  const handleClick = useCallback((entity_id: string) => {
    setClickCount((n) => n + 1);
    onClickNodeRef.current?.(entity_id);
    const entity = entityIndexRef.current.get(entity_id);
    if (entity) onNodeClickRef.current?.(entity);
  }, []);

  const handleHover = useCallback((entity_id: string | null) => {
    setHoveredId(entity_id);
    onHoverNodeRef.current?.(entity_id);
    const entity = entity_id ? entityIndexRef.current.get(entity_id) ?? null : null;
    onNodeHoverRef.current?.(entity);
  }, []);

  const reset = useCallback(() => {
    setClickCount(0);
    setHoveredId(null);
  }, []);

  return { clickCount, hoveredId, handleClick, handleHover, reset };
}