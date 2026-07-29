import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import type {
  AssistantDock,
  AssistantPlacement,
  AssistantPlacementInput,
  GlobalAssistantContext,
} from './types.js';
import styles from './GlobalAssistant.module.css';

const VIEWPORT_MARGIN = 12;
const RESERVED_TOP = 168;
const RESERVED_BOTTOM = 46;
const DEFAULT_WIDTH = 320;
const COLLAPSED_HEIGHT = 56;
const DRAG_THRESHOLD = 4;

function intersects(
  left: number,
  top: number,
  width: number,
  height: number,
  rect: DOMRect,
) {
  const right = left + width;
  const bottom = top + height;
  return (
    Math.max(0, Math.min(right, rect.right) - Math.max(left, rect.left)) *
      Math.max(0, Math.min(bottom, rect.bottom) - Math.max(top, rect.top)) >
    0
  );
}

function clamped(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

export function findSafeAssistantPlacement(
  input: AssistantPlacementInput,
): AssistantPlacement {
  const maxX = Math.max(
    VIEWPORT_MARGIN,
    input.viewportWidth - input.assistantWidth - VIEWPORT_MARGIN,
  );
  const maxY = Math.max(
    RESERVED_TOP,
    input.viewportHeight - RESERVED_BOTTOM - input.assistantHeight,
  );
  const preferredY = clamped(input.preferredY, RESERVED_TOP, maxY);
  const slotY = [
    RESERVED_TOP,
    clamped((RESERVED_TOP + maxY) / 2, RESERVED_TOP, maxY),
    maxY,
  ];
  const orderedSlots = slotY
    .map((y, slot) => ({ y, slot, distance: Math.abs(y - preferredY) }))
    .sort((a, b) => a.distance - b.distance);
  const docks: AssistantDock[] = [
    input.preferredDock,
    input.preferredDock === 'left' ? 'right' : 'left',
  ];

  for (const dock of docks) {
    const x = dock === 'left' ? VIEWPORT_MARGIN : maxX;
    for (const candidate of orderedSlots) {
      const collision = input.avoidRects.some((rect) =>
        intersects(x, candidate.y, input.assistantWidth, input.assistantHeight, rect),
      );
      if (!collision) {
        return {
          dock,
          slot: candidate.slot,
          x,
          y: candidate.y,
          collisionFree: true,
        };
      }
    }
  }

  return {
    dock: input.preferredDock,
    slot: 0,
    x: input.preferredDock === 'left' ? VIEWPORT_MARGIN : maxX,
    y: RESERVED_TOP,
    collisionFree: false,
  };
}

function currentAvoidRects() {
  return Array.from(
    document.querySelectorAll<HTMLElement>('[data-assistant-avoid="critical"]'),
  )
    .map((element) => element.getBoundingClientRect())
    .filter((rect) => rect.width > 0 && rect.height > 0);
}

function viewportPlacement(
  preferredDock: AssistantDock,
  preferredY: number,
  assistantWidth = DEFAULT_WIDTH,
  assistantHeight = COLLAPSED_HEIGHT,
) {
  return findSafeAssistantPlacement({
    viewportWidth: window.innerWidth,
    viewportHeight: window.innerHeight,
    assistantWidth,
    assistantHeight,
    preferredDock,
    preferredY,
    avoidRects: currentAvoidRects(),
  });
}

export function GlobalAssistant({
  context,
  onOpenAsk,
  onOpenChange,
  onDockChange,
}: {
  context: GlobalAssistantContext;
  onOpenAsk(): void;
  onOpenChange?(open: boolean): void;
  onDockChange?(dock: AssistantDock): void;
}) {
  const sheetId = useId();
  const launcherRef = useRef<HTMLButtonElement>(null);
  const rootRef = useRef<HTMLElement>(null);
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
    moved: boolean;
  } | null>(null);
  const suppressClickRef = useRef(false);
  const initialPlacementRef = useRef(
    viewportPlacement('right', window.innerHeight),
  );
  const [open, setOpen] = useState(false);
  const [dock, setDock] = useState<AssistantDock>('right');
  const [slot, setSlot] = useState(2);
  const [position, setPosition] = useState(initialPlacementRef.current);
  const [placementAvailable, setPlacementAvailable] = useState(
    initialPlacementRef.current.collisionFree,
  );
  const [dragging, setDragging] = useState(false);
  const [announcement, setAnnouncement] = useState('AI 助手停靠在右侧安全位置');
  const openRef = useRef(open);
  const dockRef = useRef(dock);
  const positionRef = useRef(position);

  const applyPlacement = useCallback(
    (next: AssistantPlacement, announce = true) => {
      if (!Number.isFinite(next.x) || !Number.isFinite(next.y)) return;
      if (!next.collisionFree) {
        openRef.current = false;
        setOpen(false);
        setPlacementAvailable(false);
        onOpenChange?.(false);
        setAnnouncement('空间不足，AI 助手已隐藏；未找到无碰撞安全位置');
        return;
      }
      positionRef.current = next;
      dockRef.current = next.dock;
      setPosition((current) => (
        current.x === next.x &&
        current.y === next.y &&
        current.dock === next.dock &&
        current.slot === next.slot &&
        current.collisionFree === next.collisionFree
          ? current
          : next
      ));
      setDock(next.dock);
      setSlot(next.slot);
      setPlacementAvailable(true);
      onDockChange?.(next.dock);
      if (announce) {
        setAnnouncement(
          `AI 助手已停靠到${next.dock === 'left' ? '左侧' : '右侧'}安全位置 ${next.slot + 1}`,
        );
      }
    },
    [onDockChange, onOpenChange],
  );

  const recomputePlacement = useCallback(
    (announce = false) => {
      const rect = rootRef.current?.getBoundingClientRect();
      const width = rect?.width || DEFAULT_WIDTH;
      const preferredY = positionRef.current.y;
      const requestedHeight = openRef.current
        ? rect?.height || COLLAPSED_HEIGHT
        : COLLAPSED_HEIGHT;
      const requested = viewportPlacement(
        dockRef.current,
        preferredY,
        width,
        requestedHeight,
      );
      if (requested.collisionFree) {
        applyPlacement(requested, announce);
        return;
      }
      if (openRef.current) {
        openRef.current = false;
        setOpen(false);
        onOpenChange?.(false);
        const collapsed = viewportPlacement(
          dockRef.current,
          preferredY,
          width,
          COLLAPSED_HEIGHT,
        );
        applyPlacement(collapsed, announce);
        return;
      }
      applyPlacement(requested, announce);
    },
    [applyPlacement, onOpenChange],
  );

  const moveTo = useCallback(
    (nextDock: AssistantDock, preferredSlot = slot) => {
      const maxY = Math.max(
        RESERVED_TOP,
        window.innerHeight - RESERVED_BOTTOM - COLLAPSED_HEIGHT,
      );
      const slots = [
        RESERVED_TOP,
        (RESERVED_TOP + maxY) / 2,
        maxY,
      ];
      applyPlacement(
        viewportPlacement(nextDock, slots[clamped(preferredSlot, 0, 2)] ?? maxY),
      );
    },
    [applyPlacement, slot],
  );

  const setExpanded = useCallback(
    (next: boolean) => {
      if (!placementAvailable && next) return;
      openRef.current = next;
      setOpen(next);
      onOpenChange?.(next);
    },
    [onOpenChange, placementAvailable],
  );

  useEffect(() => {
    const handleWindowKey = (event: KeyboardEvent) => {
      if (event.altKey && event.shiftKey && event.key.toLowerCase() === 'a') {
        event.preventDefault();
        launcherRef.current?.focus();
        setAnnouncement('AI 助手启动器已聚焦');
        return;
      }
      if (event.key === 'Escape' && open) {
        event.preventDefault();
        setExpanded(false);
        launcherRef.current?.focus();
      }
    };
    window.addEventListener('keydown', handleWindowKey);
    return () => window.removeEventListener('keydown', handleWindowKey);
  }, [open, setExpanded]);

  useEffect(() => {
    let frame = 0;
    const scheduleRecompute = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => recomputePlacement(false));
    };
    const resizeObserver = typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(scheduleRecompute);
    const observedCritical = new Set<Element>();
    const observeCurrentElements = () => {
      if (!resizeObserver) return;
      if (rootRef.current) resizeObserver.observe(rootRef.current);
      for (const element of document.querySelectorAll(
        '[data-assistant-avoid="critical"]',
      )) {
        if (observedCritical.has(element)) continue;
        observedCritical.add(element);
        resizeObserver.observe(element);
      }
    };
    const mutationObserver = new MutationObserver(() => {
      observeCurrentElements();
      scheduleRecompute();
    });
    mutationObserver.observe(document.body, { childList: true, subtree: true });
    observeCurrentElements();
    window.addEventListener('resize', scheduleRecompute);
    scheduleRecompute();
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener('resize', scheduleRecompute);
      mutationObserver.disconnect();
      resizeObserver?.disconnect();
    };
  }, [recomputePlacement]);

  useEffect(() => {
    recomputePlacement(false);
  }, [context, open, recomputePlacement]);

  const handleLauncherKey = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (event.altKey && event.key === 'ArrowLeft') {
      event.preventDefault();
      moveTo('left');
      return;
    }
    if (event.altKey && event.key === 'ArrowRight') {
      event.preventDefault();
      moveTo('right');
      return;
    }
    if (event.altKey && event.key === 'ArrowUp') {
      event.preventDefault();
      moveTo(dock, slot - 1);
      return;
    }
    if (event.altKey && event.key === 'ArrowDown') {
      event.preventDefault();
      moveTo(dock, slot + 1);
      return;
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      setExpanded(!open);
    }
  };

  const handlePointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (
      !Number.isFinite(event.pointerId) ||
      !Number.isFinite(event.clientX) ||
      !Number.isFinite(event.clientY)
    ) {
      dragRef.current = null;
      setDragging(false);
      return;
    }
    const rect = rootRef.current?.getBoundingClientRect();
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: rect?.left ?? position.x,
      originY: rect?.top ?? position.y,
      moved: false,
    };
    setDragging(true);
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (!Number.isFinite(event.clientX) || !Number.isFinite(event.clientY)) return;
    const deltaX = event.clientX - drag.startX;
    const deltaY = event.clientY - drag.startY;
    if (Math.hypot(deltaX, deltaY) < DRAG_THRESHOLD && !drag.moved) return;
    drag.moved = true;
    const rect = rootRef.current?.getBoundingClientRect();
    const width = rect?.width || DEFAULT_WIDTH;
    const height = rect?.height || COLLAPSED_HEIGHT;
    const nextPosition = {
      ...positionRef.current,
      x: clamped(
        drag.originX + deltaX,
        VIEWPORT_MARGIN,
        window.innerWidth - width - VIEWPORT_MARGIN,
      ),
      y: clamped(
        drag.originY + deltaY,
        RESERVED_TOP,
        window.innerHeight - RESERVED_BOTTOM - height,
      ),
    };
    positionRef.current = nextPosition;
    setPosition((current) => ({
      ...current,
      x: nextPosition.x,
      y: nextPosition.y,
    }));
  };

  const handlePointerUp = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
    setDragging(false);
    try {
      if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
        event.currentTarget.releasePointerCapture?.(event.pointerId);
      }
    } catch {
      // The pointer can be lost between the ownership check and release.
    }
    if (!Number.isFinite(event.clientX) || !Number.isFinite(event.clientY)) return;
    if (!drag.moved) return;
    suppressClickRef.current = true;
    const rect = rootRef.current?.getBoundingClientRect();
    const preferredDock: AssistantDock =
      event.clientX < window.innerWidth / 2 ? 'left' : 'right';
    applyPlacement(
      viewportPlacement(
        preferredDock,
        positionRef.current.y,
        rect?.width || DEFAULT_WIDTH,
        rect?.height || COLLAPSED_HEIGHT,
      ),
    );
  };

  const clearDrag = (pointerId: number) => {
    const drag = dragRef.current;
    if (drag && drag.pointerId !== pointerId) return false;
    dragRef.current = null;
    suppressClickRef.current = false;
    setDragging(false);
    recomputePlacement(false);
    return true;
  };

  const handlePointerCancel = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current;
    if (!clearDrag(event.pointerId) || !drag) return;
    try {
      if (event.currentTarget.hasPointerCapture?.(drag.pointerId)) {
        event.currentTarget.releasePointerCapture?.(drag.pointerId);
      }
    } catch {
      // Cleanup already completed; a concurrent capture loss stays fail-closed.
    }
  };

  const handleLostPointerCapture = (
    event: ReactPointerEvent<HTMLButtonElement>,
  ) => {
    clearDrag(event.pointerId);
  };

  const truth = context.truth ?? 'NOT_PROBED';
  const sourceCount = context.sourceCount;
  const hasSource = (
    truth === 'READY'
    && typeof sourceCount === 'number'
    && Number.isFinite(sourceCount)
    && sourceCount > 0
  );
  const displayedTruth = truth === 'READY' && !hasSource ? 'NOT_PROBED' : truth;

  return (
    <aside
      ref={rootRef}
      className={styles.root}
      data-testid="global-assistant"
      data-dock={dock}
      data-slot={slot}
      data-open={open}
      data-dragging={dragging}
      data-placement={placementAvailable ? 'safe' : 'unavailable'}
      data-truth={displayedTruth.toLowerCase()}
      style={{ left: position.x, top: position.y }}
      aria-label="AI 助手"
      aria-hidden={!placementAvailable}
    >
      <button
        ref={launcherRef}
        type="button"
        className={styles.launcher}
        data-testid="global-assistant-launcher"
        aria-expanded={open}
        aria-controls={sheetId}
        onClick={() => {
          if (suppressClickRef.current) {
            suppressClickRef.current = false;
            return;
          }
          setExpanded(!open);
        }}
        onKeyDown={handleLauncherKey}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
        onLostPointerCapture={handleLostPointerCapture}
      >
        <span className={styles.icon} aria-hidden="true">AI</span>
        <span className={styles.launcherCopy}>
          <strong>AI 助手</strong>
          <small data-testid="global-assistant-context">{context.subtitle}</small>
        </span>
        <span
          className={styles.truth}
          data-testid="global-assistant-truth"
          data-truth={displayedTruth.toLowerCase()}
        >
          {displayedTruth}
        </span>
      </button>

      {open ? (
        <section
          id={sheetId}
          className={styles.sheet}
          data-testid="global-assistant-sheet"
          aria-label="AI 助手当前上下文"
        >
          <div className={styles.contextCard}>
            <strong>当前上下文</strong>
            <span>{context.subtitle}</span>
            {context.route === 'schedule' && context.selectedDate ? (
              <span>{context.selectedDate}</span>
            ) : null}
            {context.route === 'schedule' && Number.isFinite(context.todoCount) ? (
              <span>{context.todoCount} 项待办</span>
            ) : null}
            {context.route === 'schedule' && context.notePath ? (
              <span>{context.notePath}</span>
            ) : null}
            {context.route === 'knowledge' && context.folderPath ? (
              <span>{context.folderPath}</span>
            ) : null}
            {context.route === 'knowledge' && context.documentPath ? (
              <span>{context.documentPath}</span>
            ) : null}
            {context.route === 'knowledge' && context.wikiTruth ? (
              <span>{context.wikiTruth}</span>
            ) : null}
          </div>
          {hasSource ? (
            <p>已绑定 {context.sourceCount} 个可核对来源。</p>
          ) : (
            <div className={styles.noSource}>
              <strong>{displayedTruth === 'STALE' ? 'STALE' : 'NO_SOURCE'}</strong>
              <p>尚无经验证的回答与来源，不会显示为已就绪。</p>
            </div>
          )}
          <div className={styles.actions}>
            <button type="button" onClick={() => moveTo('left')}>停靠左侧</button>
            <button type="button" onClick={() => moveTo('right')}>停靠右侧</button>
            <button type="button" className={styles.primary} onClick={onOpenAsk}>
              进入对话
            </button>
          </div>
        </section>
      ) : null}

      <span
        className={styles.live}
        data-testid="global-assistant-live"
        aria-live="polite"
      >
        {announcement}
      </span>
    </aside>
  );
}
