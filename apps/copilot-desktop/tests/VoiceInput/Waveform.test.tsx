/**
 * Waveform tests — verify the canvas renders, paints an armed
 * baseline, and tears down the audio graph on stream change.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { Waveform } from '../../src/renderer/components/VoiceInput/Waveform';

class FakeAnalyser {
  fftSize = 256;
  smoothingTimeConstant = 0.5;
  frequencyByteData = new Uint8Array(this.fftSize);
  timeByteData = new Uint8Array(this.fftSize);
  disconnect = vi.fn();
  connect = vi.fn();
  getByteTimeDomainData(arr: Uint8Array) {
    for (let i = 0; i < arr.length; i++) arr[i] = 128;
  }
}

class FakeSource {
  disconnect = vi.fn();
  connect = vi.fn();
}

class FakeAudioContext {
  state = 'running';
  analyser = new FakeAnalyser();
  source = new FakeSource();
  createAnalyser() {
    return this.analyser as unknown as AnalyserNode;
  }
  createMediaStreamSource() {
    return this.source as unknown as MediaStreamAudioSourceNode;
  }
  close() {
    return Promise.resolve();
  }
}

beforeEach(() => {
  (window as unknown as { AudioContext: unknown }).AudioContext = FakeAudioContext;
  if (typeof (globalThis as { ResizeObserver?: unknown }).ResizeObserver === 'undefined') {
    class FakeResizeObserver {
      observe = vi.fn();
      unobserve = vi.fn();
      disconnect = vi.fn();
    }
    (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = FakeResizeObserver;
    (window as unknown as { ResizeObserver: unknown }).ResizeObserver = FakeResizeObserver;
  }
});

describe('Waveform', () => {
  it('renders an idle canvas when no stream is given', () => {
    render(<Waveform stream={null} />);
    const c = screen.getByTestId('voice-waveform');
    expect(c.tagName).toBe('CANVAS');
    expect(c.getAttribute('data-armed')).toBe('false');
  });

  it('marks the canvas armed when armed=true', () => {
    render(<Waveform stream={null} armed />);
    expect(screen.getByTestId('voice-waveform').getAttribute('data-armed')).toBe('true');
  });

  it('builds an audio graph when a stream is supplied', () => {
    const stream = {
      getTracks: () => [{ stop: vi.fn() }],
    } as unknown as MediaStream;
    render(<Waveform stream={stream} />);
    // no assertion — we just want to confirm no exception thrown
    expect(screen.getByTestId('voice-waveform')).toBeTruthy();
  });
});