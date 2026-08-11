import { type ComponentType } from 'react';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { App, type RouteLoader } from '../src/renderer/App';
import {
  GlobalAssistant,
  findSafeAssistantPlacement,
} from '../src/renderer/components/Assistant/GlobalAssistant';

const originalPointerEvent = window.PointerEvent;

class DeterministicPointerEvent extends MouseEvent {
  readonly pointerId: number;

  constructor(type: string, init: PointerEventInit = {}) {
    super(type, init);
    this.pointerId = init.pointerId ?? 0;
  }
}

describe('R44 H4 global AI assistant', () => {
  beforeAll(() => {
    Object.defineProperty(window, 'PointerEvent', {
      configurable: true,
      writable: true,
      value: DeterministicPointerEvent,
    });
  });

  afterAll(() => {
    Object.defineProperty(window, 'PointerEvent', {
      configurable: true,
      writable: true,
      value: originalPointerEvent,
    });
  });

  it('keeps one App-root assistant instance while route context changes', async () => {
    const routeLoader = vi.fn<RouteLoader>(async (route) => ({
      default: (() => <div data-testid={`route-${route}`}>{route}</div>) as ComponentType<Record<string, unknown>>,
    }));

    render(<App routeLoader={routeLoader} />);
    const assistant = screen.getByTestId('global-assistant');
    expect(screen.getAllByText('AI 助手')).toHaveLength(1);
    expect(screen.queryByText('今日 AI 助手')).not.toBeInTheDocument();
    expect(screen.queryByText('知识 AI 助手')).not.toBeInTheDocument();
    expect(screen.getByTestId('global-assistant-context')).toHaveTextContent('今天');
    expect(screen.getByTestId('global-assistant-truth')).toHaveTextContent('NOT_PROBED');
    expect(screen.getByTestId('global-assistant-truth')).not.toHaveAttribute('data-truth', 'ready');

    fireEvent.click(screen.getByTestId('nav-settings'));
    await screen.findByTestId('route-settings');
    expect(screen.getByTestId('global-assistant')).toBe(assistant);
    expect(screen.getByTestId('global-assistant-context')).toHaveTextContent('设置 · 模型与 AI');
  });

  it('supports pointer dock, viewport-safe placement, collision avoidance and resize recovery', () => {
    const critical = {
      left: 880,
      right: 1012,
      top: 640,
      bottom: 756,
      width: 132,
      height: 116,
      x: 880,
      y: 640,
      toJSON: () => ({}),
    } satisfies DOMRect;
    const placement = findSafeAssistantPlacement({
      viewportWidth: 1024,
      viewportHeight: 768,
      assistantWidth: 320,
      assistantHeight: 56,
      preferredDock: 'right',
      preferredY: 680,
      avoidRects: [critical],
    });
    expect(placement.x).toBeGreaterThanOrEqual(12);
    expect(placement.y).toBeGreaterThanOrEqual(168);
    expect(placement.x + 320).toBeLessThanOrEqual(1012);
    expect(placement.y + 56).toBeLessThanOrEqual(722);
    const intersectionWidth = Math.max(
      0,
      Math.min(placement.x + 320, critical.right) - Math.max(placement.x, critical.left),
    );
    const intersectionHeight = Math.max(
      0,
      Math.min(placement.y + 56, critical.bottom) - Math.max(placement.y, critical.top),
    );
    expect(intersectionWidth * intersectionHeight).toBe(0);

    render(
      <>
        <button
          type="button"
          data-assistant-avoid="critical"
          data-testid="critical-action"
        >
          保存
        </button>
        <GlobalAssistant
          context={{ route: 'schedule', subtitle: '今天 · 当前日期' }}
          onOpenAsk={vi.fn()}
        />
      </>,
    );
    const root = screen.getByTestId('global-assistant');
    const launcher = screen.getByTestId('global-assistant-launcher');
    Object.defineProperty(root, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({
        left: 680,
        right: 1000,
        top: 650,
        bottom: 706,
        width: 320,
        height: 56,
        x: 680,
        y: 650,
        toJSON: () => ({}),
      }),
    });
    fireEvent.pointerDown(launcher, { pointerId: 1, clientX: 900, clientY: 680 });
    fireEvent.pointerMove(launcher, { pointerId: 1, clientX: 120, clientY: 320 });
    fireEvent.pointerUp(launcher, { pointerId: 1, clientX: 120, clientY: 320 });
    expect(root).toHaveAttribute('data-dock', 'left');
    expect(root.style.left).not.toContain('NaN');
    expect(root.style.top).not.toContain('NaN');

    const dockBeforeInvalidEvent = root.getAttribute('data-dock');
    fireEvent(launcher, new Event('pointerdown', { bubbles: true }));
    fireEvent(launcher, new Event('pointermove', { bubbles: true }));
    fireEvent(launcher, new Event('pointerup', { bubbles: true }));
    expect(root).toHaveAttribute('data-dock', dockBeforeInvalidEvent);
    expect(root.style.left).not.toContain('NaN');
    expect(root.style.top).not.toContain('NaN');

    fireEvent(window, new Event('resize'));
    expect(Number.parseFloat(root.style.left)).toBeGreaterThanOrEqual(12);
    expect(Number.parseFloat(root.style.top)).toBeGreaterThanOrEqual(168);
  });

  it('provides keyboard focus, open/close, dock and focus-return paths', () => {
    render(
      <GlobalAssistant
        context={{ route: 'settings', subtitle: '设置 · 模型与 AI' }}
        onOpenAsk={vi.fn()}
      />,
    );
    const launcher = screen.getByTestId('global-assistant-launcher');
    const root = screen.getByTestId('global-assistant');

    fireEvent.keyDown(window, { key: 'A', altKey: true, shiftKey: true });
    expect(launcher).toHaveFocus();

    fireEvent.keyDown(launcher, { key: 'Enter' });
    expect(launcher).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByTestId('global-assistant-sheet')).toBeInTheDocument();

    fireEvent.keyDown(launcher, { key: 'ArrowLeft', altKey: true });
    expect(root).toHaveAttribute('data-dock', 'left');
    fireEvent.keyDown(launcher, { key: 'ArrowDown', altKey: true });
    expect(screen.getByTestId('global-assistant-live')).toHaveTextContent(/安全位置/u);

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(launcher).toHaveAttribute('aria-expanded', 'false');
    expect(launcher).toHaveFocus();
  });

  it('keeps Settings context free from credential keys and derived metadata', () => {
    render(
      <GlobalAssistant
        context={{ route: 'settings', subtitle: '设置 · 模型与 AI' }}
        onOpenAsk={vi.fn()}
      />,
    );
    const serialized = screen.getByTestId('global-assistant').textContent ?? '';
    expect(serialized).not.toMatch(/api.?key|credential|密码长度|密钥/u);
  });
});
