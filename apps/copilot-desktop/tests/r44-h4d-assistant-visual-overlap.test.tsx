import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { App } from '../src/renderer/App';
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

function setViewport(width: number, height: number) {
  Object.defineProperty(window, 'innerWidth', {
    configurable: true,
    writable: true,
    value: width,
  });
  Object.defineProperty(window, 'innerHeight', {
    configurable: true,
    writable: true,
    value: height,
  });
  fireEvent(window, new Event('resize'));
  triggerObservedResize();
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

describe('R44 H4D assistant visual overlap', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_COPILOT_BROWSER_PROTOTYPE', '1');
    resizeCallbacks.clear();
    Object.defineProperty(window, 'ResizeObserver', {
      configurable: true,
      writable: true,
      value: TestResizeObserver,
    });
    Object.defineProperty(globalThis, 'ResizeObserver', {
      configurable: true,
      writable: true,
      value: TestResizeObserver,
    });
    Object.defineProperty(window, 'PointerEvent', {
      configurable: true,
      writable: true,
      value: DeterministicPointerEvent,
    });
    setViewport(1280, 720);
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
    Object.defineProperty(globalThis, 'ResizeObserver', {
      configurable: true,
      writable: true,
      value: originalResizeObserver,
    });
    Object.defineProperty(window, 'PointerEvent', {
      configurable: true,
      writable: true,
      value: originalPointerEvent,
    });
    window.__COPILOT_BROWSER_PROTOTYPE__ = undefined;
    window.history.replaceState(null, '', '/#today');
  });

  it('keeps the actual Today header actions clear at every supported geometry transition', async () => {
    window.history.replaceState(null, '', '/?prototype=ready#today');
    window.__COPILOT_BROWSER_PROTOTYPE__ = undefined;
    installBrowserPrototype();
    render(<App />);

    const workspace = await screen.findByTestId('schedule-workspace');
    const assistant = screen.getByTestId('global-assistant');
    const launcher = screen.getByTestId('global-assistant-launcher');
    const captureCard = screen.getByTestId('today-capture-card');
    const headerActions = screen.getByRole('button', { name: '快速记录' })
      .parentElement as HTMLElement;
    expect(headerActions).not.toBeNull();

    installAssistantRect(assistant);
    Object.defineProperty(headerActions, 'getBoundingClientRect', {
      configurable: true,
      value: () => rect(window.innerWidth - 280, 190, 250, 44),
    });
    Object.defineProperty(captureCard, 'getBoundingClientRect', {
      configurable: true,
      value: () => rect(360, 344, window.innerWidth - 400, 316),
    });

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
    const initial = assistant.getBoundingClientRect();
    fireEvent.pointerDown(launcher, {
      pointerId: 43,
      clientX: initial.left + 20,
      clientY: initial.top + 20,
    });
    fireEvent.pointerMove(launcher, { pointerId: 43, clientX: 1240, clientY: 190 });
    fireEvent.pointerUp(launcher, { pointerId: 43, clientX: 1240, clientY: 190 });
    triggerObservedResize();
    await waitFor(() => {
      expect(intersectionArea(
        assistant.getBoundingClientRect(),
        headerActions.getBoundingClientRect(),
      )).toBe(0);
    });
    expect(headerActions).toHaveAttribute('data-assistant-avoid', 'critical');

    for (const [width, height] of [
      [1280, 720],
      [1440, 900],
      [1024, 768],
    ] as const) {
      setViewport(width, height);
      await waitFor(() => {
        expect(assistant).toHaveAttribute('data-open', 'false');
        expect(assistant.getBoundingClientRect().left).toBeGreaterThanOrEqual(12);
        expect(assistant.getBoundingClientRect().right).toBeLessThanOrEqual(width - 12);
        expect(assistant.getBoundingClientRect().top).toBeGreaterThanOrEqual(168);
        expect(assistant.getBoundingClientRect().bottom).toBeLessThanOrEqual(height - 46);
        expect(intersectionArea(
          assistant.getBoundingClientRect(),
          headerActions.getBoundingClientRect(),
        )).toBe(0);
        expect(intersectionArea(
          assistant.getBoundingClientRect(),
          captureCard.getBoundingClientRect(),
        )).toBe(0);
      });

      fireEvent.keyDown(launcher, { key: 'Enter' });
      await waitFor(() => {
        expect(assistant).toHaveAttribute('data-open', 'true');
        expect(intersectionArea(
          assistant.getBoundingClientRect(),
          headerActions.getBoundingClientRect(),
        )).toBe(0);
        expect(intersectionArea(
          assistant.getBoundingClientRect(),
          captureCard.getBoundingClientRect(),
        )).toBe(0);
      });
      fireEvent.keyDown(launcher, { key: 'Enter' });
      await waitFor(() => {
        expect(assistant).toHaveAttribute('data-open', 'false');
      });
    }

    fireEvent.pointerDown(launcher, { pointerId: 44, clientX: 100, clientY: 180 });
    fireEvent.pointerMove(launcher, { pointerId: 44, clientX: 900, clientY: 190 });
    fireEvent.pointerUp(launcher, { pointerId: 44, clientX: 900, clientY: 190 });
    await waitFor(() => {
      expect(assistant).toHaveAttribute('data-dragging', 'false');
      expect(intersectionArea(
        assistant.getBoundingClientRect(),
        headerActions.getBoundingClientRect(),
      )).toBe(0);
      expect(intersectionArea(
        assistant.getBoundingClientRect(),
        captureCard.getBoundingClientRect(),
      )).toBe(0);
    });

    const occupied = assistant.getBoundingClientRect();
    const lateCritical = document.createElement('button');
    lateCritical.dataset.assistantAvoid = 'critical';
    lateCritical.textContent = 'late Today action';
    Object.defineProperty(lateCritical, 'getBoundingClientRect', {
      configurable: true,
      value: () => occupied,
    });
    workspace.append(lateCritical);
    await waitFor(() => {
      expect(assistant).toHaveAttribute('data-placement', 'safe');
      expect(assistant).toHaveAttribute('aria-hidden', 'false');
      expect(intersectionArea(
        assistant.getBoundingClientRect(),
        lateCritical.getBoundingClientRect(),
      )).toBe(0);
      expect(intersectionArea(
        assistant.getBoundingClientRect(),
        headerActions.getBoundingClientRect(),
      )).toBe(0);
    });
  });
});
