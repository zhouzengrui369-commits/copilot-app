import React, { type ComponentType } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createRetryableStartupTelemetryLatch } from '../src/main/direct-performance-probe.js';
import {
  StartupAppBoundary,
  type StartupView,
} from '../src/renderer/startup-shell.js';

vi.mock('electron', () => ({ BrowserWindow: class {} }));

type Deferred<T> = {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
};

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe('r22 independent startup review fixes', () => {
  it('does not consume an unavailable telemetry recorder and retries one failed concurrent attempt', async () => {
    let recorder: (() => Promise<void>) | null = null;
    const latch = createRetryableStartupTelemetryLatch(() => recorder);

    await expect(latch.run()).resolves.toBe(false);
    expect(latch.isRecorded()).toBe(false);

    const firstLane = deferred<void>();
    const firstRecorder = vi.fn(() => firstLane.promise);
    recorder = firstRecorder;
    const firstAttempt = latch.run();
    const concurrentAttempt = latch.run();
    expect(firstAttempt).toBe(concurrentAttempt);
    expect(firstRecorder).not.toHaveBeenCalled();
    await Promise.resolve();
    expect(firstRecorder).toHaveBeenCalledTimes(1);

    const replacementBeforeFailure = vi.fn(async () => undefined);
    recorder = replacementBeforeFailure;
    firstLane.reject(new Error('contained telemetry write failure'));
    await expect(firstAttempt).resolves.toBe(false);
    await expect(concurrentAttempt).resolves.toBe(false);
    expect(latch.isRecorded()).toBe(false);
    expect(replacementBeforeFailure).not.toHaveBeenCalled();

    const retryRecorder = vi.fn(async () => undefined);
    recorder = retryRecorder;
    await expect(latch.run()).resolves.toBe(true);
    await expect(latch.run()).resolves.toBe(true);
    expect(retryRecorder).toHaveBeenCalledTimes(1);
    expect(latch.isRecorded()).toBe(true);
  });

  it('keeps all startup-shell routes keyboard usable and transfers the latest choice to App', async () => {
    const appLane = deferred<{ default: ComponentType<{ initialView?: StartupView }> }>();
    const loadApp = vi.fn(() => appLane.promise);
    render(<StartupAppBoundary loadApp={loadApp} />);

    const routeIds: StartupView[] = ['knowledge', 'ask', 'voice', 'schedule', 'settings'];
    for (const route of routeIds) {
      const button = screen.getByTestId(`startup-nav-${route}`);
      expect(button).toBeEnabled();
      button.focus();
      expect(document.activeElement).toBe(button);
    }

    fireEvent.click(screen.getByTestId('startup-nav-ask'));
    expect(screen.getByTestId('startup-nav-ask')).toHaveAttribute('aria-current', 'page');
    fireEvent.keyDown(screen.getByTestId('startup-nav-voice'), { key: 'Enter' });
    expect(screen.getByTestId('startup-nav-voice')).toHaveAttribute('aria-current', 'page');
    expect(screen.getByTestId('startup-view-voice')).toBeInTheDocument();

    const ResolvedApp = vi.fn(({ initialView }: { initialView?: StartupView }) => (
      <section data-testid="resolved-app">{initialView}</section>
    ));
    await act(async () => {
      appLane.resolve({ default: ResolvedApp });
    });
    expect(await screen.findByTestId('resolved-app')).toHaveTextContent('voice');
    expect(ResolvedApp).toHaveBeenCalled();
    expect(loadApp).toHaveBeenCalledTimes(1);
  });
});
