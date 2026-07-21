/**
 * Waveform.tsx — live audio-level meter drawn on a <canvas>.
 *
 * The component takes a MediaStream (from getUserMedia) and renders a
 * horizontal bar whose width mirrors the current RMS level. No
 * external deps; uses the platform AnalyserNode.
 *
 * Sprint 1.2 / T-1.2.4.
 */

import { useEffect, useRef } from 'react';
import type { ReactElement } from 'react';

export interface WaveformProps {
  /** Active MediaStream from getUserMedia. Null = idle (no canvas paint). */
  stream: MediaStream | null;
  /** CSS width. CSS height locked to 28px for a thin meter. */
  width?: number | string;
  /** When true, paints a thin baseline only (used for the "ready" state). */
  armed?: boolean;
  /** Optional className passthrough. */
  className?: string;
}

const DEFAULT_HEIGHT = 28;

export function Waveform({
  stream,
  width = '100%',
  armed = false,
  className,
}: WaveformProps): ReactElement {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);

  // Build / tear down the audio graph when the stream changes.
  useEffect(() => {
    if (!stream) return;
    let cancelled = false;
    const audioCtor =
      typeof window !== 'undefined'
        ? (window.AudioContext ??
          (window as unknown as { webkitAudioContext?: typeof AudioContext })
            .webkitAudioContext)
        : undefined;
    if (!audioCtor) return;

    try {
      const ctx = new audioCtor();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.5;
      const source = ctx.createMediaStreamSource(stream);
      source.connect(analyser);
      if (cancelled) {
        source.disconnect();
        analyser.disconnect();
        void ctx.close();
        return;
      }
      ctxRef.current = ctx;
      analyserRef.current = analyser;
      sourceRef.current = source;
    } catch {
      // mic permission denied or AudioContext unavailable — leave canvas idle
      return;
    }

    return () => {
      cancelled = true;
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      try {
        sourceRef.current?.disconnect();
      } catch {
        /* ignore */
      }
      try {
        analyserRef.current?.disconnect();
      } catch {
        /* ignore */
      }
      sourceRef.current = null;
      analyserRef.current = null;
      if (ctxRef.current) {
        void ctxRef.current.close().catch(() => undefined);
        ctxRef.current = null;
      }
    };
  }, [stream]);

  // RAF paint loop driven by analyser levels.
  useEffect(() => {
    const canvas = canvasRef.current;
    const analyser = analyserRef.current;
    if (!canvas || !analyser) return;

    const ctx2d = canvas.getContext('2d');
    if (!ctx2d) return;

    const buf = new Uint8Array(analyser.fftSize);

    const paint = () => {
      const w = canvas.width;
      const h = canvas.height;
      analyser.getByteTimeDomainData(buf);
      let sumSquares = 0;
      for (let i = 0; i < buf.length; i++) {
        const v = ((buf[i] ?? 128) - 128) / 128;
        sumSquares += v * v;
      }
      const rms = Math.sqrt(sumSquares / buf.length);
      const level = Math.min(1, rms * 2.5);

      ctx2d.clearRect(0, 0, w, h);

      // baseline
      ctx2d.fillStyle = 'rgba(127,127,127,0.18)';
      ctx2d.fillRect(0, h - 2, w, 2);

      // bar
      const barW = Math.max(2, Math.floor(w * level));
      const grad = ctx2d.createLinearGradient(0, 0, w, 0);
      grad.addColorStop(0, '#3b82f6');
      grad.addColorStop(0.6, '#22d3ee');
      grad.addColorStop(1, '#10b981');
      ctx2d.fillStyle = grad;
      ctx2d.fillRect(0, h - 8, barW, 6);

      // peak indicator
      if (level > 0.05) {
        ctx2d.fillStyle = 'rgba(16,185,129,0.9)';
        ctx2d.fillRect(barW - 2, 0, 2, h);
      }
      rafRef.current = requestAnimationFrame(paint);
    };
    rafRef.current = requestAnimationFrame(paint);

    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [stream]);

  // Resize canvas to match CSS pixel dimensions.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (typeof ResizeObserver === 'undefined') {
      // jsdom or older environment — set a sensible default size.
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.max(1, Math.floor(300 * dpr));
      canvas.height = Math.max(1, Math.floor(DEFAULT_HEIGHT * dpr));
      const ctx = canvas.getContext('2d');
      if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      return;
    }
    const ro = new ResizeObserver(() => {
      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      canvas.width = Math.max(1, Math.floor(rect.width * dpr));
      canvas.height = Math.max(1, Math.floor(DEFAULT_HEIGHT * dpr));
      const ctx = canvas.getContext('2d');
      if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    });
    ro.observe(canvas);
    return () => ro.disconnect();
  }, []);

  return (
    <canvas
      ref={canvasRef}
      data-testid="voice-waveform"
      data-armed={armed ? 'true' : 'false'}
      className={className ?? 'voice-waveform'}
      style={{ width, height: DEFAULT_HEIGHT, display: 'block' }}
    />
  );
}