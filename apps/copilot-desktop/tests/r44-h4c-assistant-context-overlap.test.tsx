import React, { type ComponentType } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { App, type RouteLoader } from '../src/renderer/App';
import {
  GlobalAssistant,
} from '../src/renderer/components/Assistant/GlobalAssistant';
import type { GlobalAssistantContext } from '../src/renderer/components/Assistant/types';
import type { CopilotProductApi } from '../src/renderer/lib/copilot-api';
import { installBrowserPrototype } from '../src/renderer/prototype/browser-api';

function rect(left: number, top: number, width: number, height: number): DOMRect {
  return {
    left,
    top,
    right: left + width,
    bottom: top + height,
    width,
    height,
    x: left,
    y: top,
    toJSON: () => ({}),
  };
}

function intersectionArea(first: DOMRect, second: DOMRect) {
  return (
    Math.max(0, Math.min(first.right, second.right) - Math.max(first.left, second.left)) *
    Math.max(0, Math.min(first.bottom, second.bottom) - Math.max(first.top, second.top))
  );
}

function installAssistantRect(element: HTMLElement) {
  Object.defineProperty(element, 'getBoundingClientRect', {
    configurable: true,
    value: () => {
      const left = Number.parseFloat(element.style.left);
      const top = Number.parseFloat(element.style.top);
      const height = element.dataset.open === 'true' ? 280 : 56;
      return rect(left, top, 320, height);
    },
  });
}

function localDateKey(date: Date) {
  return [
    String(date.getFullYear()),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-');
}

const resizeCallbacks = new Set<ResizeObserverCallback>();

class TestResizeObserver implements ResizeObserver {
  constructor(callback: ResizeObserverCallback) {
    resizeCallbacks.add(callback);
  }

  observe() {}
  unobserve() {}
  disconnect() {}
}

function triggerObservedResize() {
  for (const callback of resizeCallbacks) {
    callback([], {} as ResizeObserver);
  }
}

const originalResizeObserver = window.ResizeObserver;
const originalPointerEvent = window.PointerEvent;

class DeterministicPointerEvent extends MouseEvent {
  readonly pointerId: number;

  constructor(type: string, init: PointerEventInit = {}) {
    super(type, init);
    this.pointerId = init.pointerId ?? 0;
  }
}

describe('R44 H4C assistant context and overlap', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_COPILOT_BROWSER_PROTOTYPE', '1');
    resizeCallbacks.clear();
    Object.defineProperty(window, 'ResizeObserver', {
      configurable: true,
      writable: true,
      value: TestResizeObserver,
    });
    Object.defineProperty(window, 'PointerEvent', {
      configurable: true,
      writable: true,
      value: DeterministicPointerEvent,
    });
    Object.defineProperty(globalThis, 'ResizeObserver', {
      configurable: true,
      writable: true,
      value: TestResizeObserver,
    });
    Object.defineProperty(window, 'innerWidth', {
      configurable: true,
      writable: true,
      value: 1440,
    });
    Object.defineProperty(window, 'innerHeight', {
      configurable: true,
      writable: true,
      value: 900,
    });
    window.__COPILOT_BROWSER_PROTOTYPE__ = {
      api: {} as CopilotProductApi,
      scenario: 'ready',
      label: 'PROTOTYPE / NOT_RUNTIME_PROOF',
    };
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    Object.defineProperty(window, 'ResizeObserver', {
      configurable: true,
      writable: true,
      value: originalResizeObserver,
    });
    Object.defineProperty(window, 'PointerEvent', {
      configurable: true,
      writable: true,
      value: originalPointerEvent,
    });
    Object.defineProperty(globalThis, 'ResizeObserver', {
      configurable: true,
      writable: true,
      value: originalResizeObserver,
    });
    window.__COPILOT_BROWSER_PROTOTYPE__ = undefined;
    window.history.replaceState(null, '', '/#today');
  });

  it('fails closed for synthetic READY context without a verified source count', () => {
    const onOpenAsk = vi.fn();
    const { rerender } = render(
      <GlobalAssistant
        context={{
          route: 'knowledge',
          subtitle: '知识 · 无已验证来源',
          truth: 'READY',
          sourceCount: 0,
        }}
        onOpenAsk={onOpenAsk}
      />,
    );

    expect(screen.getByTestId('global-assistant-truth')).toHaveTextContent('NOT_PROBED');
    expect(screen.getByTestId('global-assistant-truth')).not.toHaveAttribute(
      'data-truth',
      'ready',
    );
    expect(screen.getByTestId('global-assistant')).not.toHaveAttribute(
      'data-truth',
      'ready',
    );

    fireEvent.keyDown(screen.getByTestId('global-assistant-launcher'), { key: 'Enter' });
    expect(screen.getByTestId('global-assistant-sheet')).not.toHaveTextContent(
      /已绑定 .* 个可核对来源/u,
    );

    rerender(
      <GlobalAssistant
        context={{
          route: 'knowledge',
          subtitle: '知识 · 来源计数缺失',
          truth: 'READY',
        }}
        onOpenAsk={onOpenAsk}
      />,
    );
    expect(screen.getByTestId('global-assistant-truth')).toHaveTextContent('NOT_PROBED');
    expect(screen.getByTestId('global-assistant-truth')).not.toHaveAttribute(
      'data-truth',
      'ready',
    );

    rerender(
      <GlobalAssistant
        context={{
          route: 'knowledge',
          subtitle: '知识 · 已验证来源',
          truth: 'READY',
          sourceCount: 2,
        }}
        onOpenAsk={onOpenAsk}
      />,
    );
    expect(screen.getByTestId('global-assistant-truth')).toHaveTextContent('READY');
    expect(screen.getByTestId('global-assistant-truth')).toHaveAttribute(
      'data-truth',
      'ready',
    );
    expect(screen.getByTestId('global-assistant-sheet')).toHaveTextContent(
      '已绑定 2 个可核对来源',
    );
  });

  it('keeps the synthetic App sanitizer contract narrow without claiming real-route integration', async () => {
    let staleTodayPublisher:
      | ((context: GlobalAssistantContext) => void)
      | undefined;
    const TodayRoute = ({
      onAssistantContextChange,
    }: {
      onAssistantContextChange?(context: GlobalAssistantContext): void;
    }) => {
      React.useEffect(() => {
        staleTodayPublisher = onAssistantContextChange;
        onAssistantContextChange?.({
          route: 'schedule',
          subtitle: '今天 · 2026-07-26 · 2 项待办',
          truth: 'READY',
          sourceCount: 1,
          selectedDate: '2026-07-26',
          todoCount: 2,
          notePath: 'inbox/today-note',
          ...({ apiKey: 'must-be-stripped', credentialLength: 16 } as object),
        });
      }, [onAssistantContextChange]);
      return <div data-testid="real-today-route">today</div>;
    };
    const KnowledgeRoute = ({
      onAssistantContextChange,
    }: {
      onAssistantContextChange?(context: GlobalAssistantContext): void;
    }) => {
      React.useEffect(() => {
        onAssistantContextChange?.({
          route: 'knowledge',
          subtitle: '知识 · projects/copilot · CURRENT',
          truth: 'READY',
          sourceCount: 3,
          folderPath: 'projects/copilot',
          documentPath: 'projects/copilot/readme.md',
          wikiTruth: 'CURRENT',
        });
      }, [onAssistantContextChange]);
      return <div data-testid="real-knowledge-route">knowledge</div>;
    };
    const routeLoader = vi.fn<RouteLoader>(async (route) => ({
      default: (route === 'schedule'
        ? TodayRoute
        : route === 'knowledge'
          ? KnowledgeRoute
          : () => <div data-testid={`route-${route}`}>{route}</div>) as ComponentType<Record<string, unknown>>,
    }));

    render(<App routeLoader={routeLoader} />);

    await screen.findByTestId('real-today-route');
    await waitFor(() => {
      expect(screen.getByTestId('global-assistant-context')).toHaveTextContent(
        '今天 · 2026-07-26 · 2 项待办',
      );
    });
    fireEvent.keyDown(screen.getByTestId('global-assistant-launcher'), { key: 'Enter' });
    expect(screen.getByTestId('global-assistant-sheet')).toHaveTextContent('2026-07-26');
    expect(screen.getByTestId('global-assistant-sheet')).toHaveTextContent('2 项待办');
    expect(screen.getByTestId('global-assistant-sheet')).toHaveTextContent(
      '已绑定 1 个可核对来源',
    );
    expect(screen.getByTestId('global-assistant')).not.toHaveTextContent(
      /must-be-stripped|api.?key|credentialLength/u,
    );

    fireEvent.click(screen.getByTestId('nav-knowledge'));
    await screen.findByTestId('real-knowledge-route');
    await waitFor(() => {
      expect(screen.getByTestId('global-assistant-context')).toHaveTextContent(
        '知识 · projects/copilot · CURRENT',
      );
    });
    expect(screen.getByTestId('global-assistant-sheet')).toHaveTextContent(
      'projects/copilot/readme.md',
    );
    expect(screen.getByTestId('global-assistant-truth')).toHaveTextContent('READY');

    staleTodayPublisher?.({
      route: 'schedule',
      subtitle: '过期 Today 不得覆盖',
      truth: 'READY',
      sourceCount: 99,
    });
    expect(screen.getByTestId('global-assistant-context')).not.toHaveTextContent(
      '过期 Today 不得覆盖',
    );
  });

  it('integrates actual Today and Knowledge publishers with real critical elements and explicit fixture truth', async () => {
    window.history.replaceState(null, '', '/?prototype=ready#today');
    window.__COPILOT_BROWSER_PROTOTYPE__ = undefined;
    installBrowserPrototype();
    render(<App />);

    await screen.findByTestId('schedule-workspace');
    const assistant = screen.getByTestId('global-assistant');
    installAssistantRect(assistant);
    const todayCritical = screen.getByRole('button', { name: '+ 新增待办' });
    const todayCollision = assistant.getBoundingClientRect();
    Object.defineProperty(todayCritical, 'getBoundingClientRect', {
      configurable: true,
      value: () => rect(todayCollision.left, todayCollision.top, 260, 56),
    });
    triggerObservedResize();
    await waitFor(() => {
      expect(intersectionArea(
        assistant.getBoundingClientRect(),
        todayCritical.getBoundingClientRect(),
      )).toBe(0);
    });

    fireEvent.click(todayCritical);
    const todoDialog = screen.getByRole('dialog', { name: '新增待办' });
    fireEvent.change(within(todoDialog).getByRole('combobox', { name: '搜索关联笔记' }), {
      target: { value: 'MVP 验收' },
    });
    fireEvent.click(within(todoDialog).getByRole('option', { name: /MVP 验收清单/u }));
    fireEvent.click(within(todoDialog).getByRole('button', { name: '取消' }));

    fireEvent.keyDown(screen.getByTestId('global-assistant-launcher'), { key: 'Enter' });
    const todaySheet = await screen.findByTestId('global-assistant-sheet');
    expect(within(todaySheet).getByText(localDateKey(new Date()))).toBeInTheDocument();
    expect(within(todaySheet).getByText('1 项待办')).toBeInTheDocument();
    expect(within(todaySheet).getByText('inbox/mvp-acceptance')).toBeInTheDocument();
    expect(screen.getByTestId('global-assistant-truth')).toHaveTextContent('NOT_PROBED');
    expect(screen.getByTestId('prototype-truth-label')).toHaveTextContent(
      'NOT_RUNTIME_PROOF',
    );

    fireEvent.click(screen.getByTestId('nav-knowledge'));
    const knowledgeWorkspace = await screen.findByTestId('knowledge-workspace');
    const knowledgeCollision = assistant.getBoundingClientRect();
    Object.defineProperty(knowledgeWorkspace, 'getBoundingClientRect', {
      configurable: true,
      value: () => rect(
        knowledgeCollision.left,
        knowledgeCollision.top,
        280,
        72,
      ),
    });
    triggerObservedResize();
    await waitFor(() => {
      expect(intersectionArea(
        assistant.getBoundingClientRect(),
        knowledgeWorkspace.getBoundingClientRect(),
      )).toBe(0);
    });
    await waitFor(() => {
      expect(screen.getByTestId('global-assistant-context')).not.toHaveTextContent(
        '知识 · 当前文件夹',
      );
    });
    const knowledgeSheet = screen.getByTestId('global-assistant-sheet');
    expect(within(knowledgeSheet).getByText('inbox')).toBeInTheDocument();
    expect(within(knowledgeSheet).getByText('inbox/mvp-acceptance')).toBeInTheDocument();
    expect(within(knowledgeSheet).getByText('CURRENT')).toBeInTheDocument();
  });

  it('reflows after late critical DOM commit and observed critical resize with nonzero rectangles', async () => {
    const { container } = render(
      <GlobalAssistant
        context={{ route: 'schedule', subtitle: '今天 · 动态布局' }}
        onOpenAsk={vi.fn()}
      />,
    );
    const assistant = screen.getByTestId('global-assistant');
    installAssistantRect(assistant);
    const before = assistant.getBoundingClientRect();
    const critical = document.createElement('button');
    critical.dataset.assistantAvoid = 'critical';
    Object.defineProperty(critical, 'getBoundingClientRect', {
      configurable: true,
      value: () => rect(before.left, before.top, 320, 80),
    });
    container.append(critical);

    await waitFor(() => {
      expect(intersectionArea(
        assistant.getBoundingClientRect(),
        critical.getBoundingClientRect(),
      )).toBe(0);
    });

    let resizedCritical = rect(
      assistant.getBoundingClientRect().left,
      assistant.getBoundingClientRect().top,
      320,
      80,
    );
    Object.defineProperty(critical, 'getBoundingClientRect', {
      configurable: true,
      value: () => resizedCritical,
    });
    triggerObservedResize();
    await waitFor(() => {
      expect(intersectionArea(
        assistant.getBoundingClientRect(),
        resizedCritical,
      )).toBe(0);
    });

    fireEvent.click(screen.getByTestId('global-assistant-launcher'));
    await waitFor(() => {
      expect(assistant).toHaveAttribute('data-open', 'true');
      expect(intersectionArea(
        assistant.getBoundingClientRect(),
        resizedCritical,
      )).toBe(0);
    });

    Object.defineProperty(window, 'innerWidth', {
      configurable: true,
      writable: true,
      value: 1024,
    });
    Object.defineProperty(window, 'innerHeight', {
      configurable: true,
      writable: true,
      value: 768,
    });
    fireEvent(window, new Event('resize'));
    await waitFor(() => {
      expect(assistant.getBoundingClientRect().right).toBeLessThanOrEqual(1012);
      expect(assistant.getBoundingClientRect().bottom).toBeLessThanOrEqual(722);
      expect(intersectionArea(
        assistant.getBoundingClientRect(),
        resizedCritical,
      )).toBe(0);
    });

    const launcher = screen.getByTestId('global-assistant-launcher');
    const captured = new Set<number>();
    Object.defineProperty(launcher, 'setPointerCapture', {
      configurable: true,
      value: (pointerId: number) => captured.add(pointerId),
    });
    Object.defineProperty(launcher, 'hasPointerCapture', {
      configurable: true,
      value: (pointerId: number) => captured.has(pointerId),
    });
    Object.defineProperty(launcher, 'releasePointerCapture', {
      configurable: true,
      value: (pointerId: number) => captured.delete(pointerId),
    });
    fireEvent.pointerDown(launcher, { pointerId: 5, clientX: 820, clientY: 500 });
    fireEvent.pointerMove(launcher, { pointerId: 5, clientX: 140, clientY: 360 });
    fireEvent.pointerUp(launcher, { pointerId: 5, clientX: 140, clientY: 360 });
    await waitFor(() => {
      expect(assistant).toHaveAttribute('data-dock', 'left');
      expect(assistant).toHaveAttribute('data-dragging', 'false');
      expect(intersectionArea(
        assistant.getBoundingClientRect(),
        resizedCritical,
      )).toBe(0);
    });
  });

  it('recomputes at 1024x768 and fails closed when no dock slot is collision-free', async () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1024 });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 768 });
    const { container } = render(
      <GlobalAssistant
        context={{ route: 'knowledge', subtitle: '知识 · 无安全槽位' }}
        onOpenAsk={vi.fn()}
      />,
    );
    const assistant = screen.getByTestId('global-assistant');
    installAssistantRect(assistant);
    const leftBlocker = document.createElement('button');
    const rightBlocker = document.createElement('button');
    leftBlocker.dataset.assistantAvoid = 'critical';
    rightBlocker.dataset.assistantAvoid = 'critical';
    Object.defineProperty(leftBlocker, 'getBoundingClientRect', {
      configurable: true,
      value: () => rect(0, 0, 360, 768),
    });
    Object.defineProperty(rightBlocker, 'getBoundingClientRect', {
      configurable: true,
      value: () => rect(664, 0, 360, 768),
    });
    container.append(leftBlocker, rightBlocker);

    await waitFor(() => {
      expect(assistant).toHaveAttribute('data-placement', 'unavailable');
      expect(assistant).toHaveAttribute('data-open', 'false');
      expect(assistant).toHaveAttribute('aria-hidden', 'true');
    });
  });

  it('separates active pointercancel release from lostpointercapture cleanup without throwing', () => {
    render(
      <GlobalAssistant
        context={{ route: 'schedule', subtitle: '今天 · 拖动取消' }}
        onOpenAsk={vi.fn()}
      />,
    );
    const assistant = screen.getByTestId('global-assistant');
    const launcher = screen.getByTestId('global-assistant-launcher');
    installAssistantRect(assistant);
    const captured = new Set<number>();
    const releasePointerCapture = vi.fn((pointerId: number) => {
      if (!captured.has(pointerId)) throw new Error('NotFoundError');
      captured.delete(pointerId);
    });
    Object.defineProperty(launcher, 'setPointerCapture', {
      configurable: true,
      value: (pointerId: number) => captured.add(pointerId),
    });
    Object.defineProperty(launcher, 'hasPointerCapture', {
      configurable: true,
      value: (pointerId: number) => captured.has(pointerId),
    });
    Object.defineProperty(launcher, 'releasePointerCapture', {
      configurable: true,
      value: releasePointerCapture,
    });
    const initialDock = assistant.getAttribute('data-dock');
    fireEvent.pointerDown(launcher, { pointerId: 7, clientX: 900, clientY: 680 });
    fireEvent.pointerMove(launcher, { pointerId: 7, clientX: 120, clientY: 320 });
    fireEvent.pointerCancel(launcher, { pointerId: 7, clientX: 120, clientY: 320 });
    fireEvent.pointerUp(launcher, { pointerId: 7, clientX: 120, clientY: 320 });
    expect(assistant).toHaveAttribute('data-dock', initialDock);
    expect(assistant).toHaveAttribute('data-dragging', 'false');
    expect(assistant.style.left).not.toContain('NaN');
    expect(releasePointerCapture).toHaveBeenCalledWith(7);

    fireEvent.pointerDown(launcher, { pointerId: 8, clientX: 900, clientY: 680 });
    fireEvent.pointerMove(launcher, { pointerId: 8, clientX: 120, clientY: 320 });
    captured.delete(8);
    expect(() => {
      fireEvent.lostPointerCapture(launcher, { pointerId: 8 });
    }).not.toThrow();
    fireEvent.pointerUp(launcher, { pointerId: 8, clientX: 120, clientY: 320 });
    expect(assistant).toHaveAttribute('data-dock', initialDock);
    expect(assistant).toHaveAttribute('data-dragging', 'false');
    expect(releasePointerCapture).not.toHaveBeenCalledWith(8);
  });
});
