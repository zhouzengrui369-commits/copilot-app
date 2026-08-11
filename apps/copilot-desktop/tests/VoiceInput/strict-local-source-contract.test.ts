import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  evaluateAsrCorpus,
  normalizeAsrGateText,
} from './local-asr-quality';

const voiceRoot = join(process.cwd(), 'src/renderer/components/VoiceInput');
const workspacePaths = [
  join(process.cwd(), 'src/renderer/workspaces/ScheduleWorkspace.tsx'),
  join(process.cwd(), 'src/renderer/workspaces/VoiceWorkspace.tsx'),
];
const deletedPaths = [
  join(voiceRoot, 'CloudAsrProvider.ts'),
  join(voiceRoot, 'WebSpeechProvider.ts'),
  join(voiceRoot, 'useTranscriber.ts'),
];

function sourceFiles(root: string): string[] {
  return readdirSync(root).flatMap((name) => {
    const path = join(root, name);
    return statSync(path).isDirectory() ? sourceFiles(path) : [path];
  }).filter((path) => /\.(?:ts|tsx)$/u.test(path));
}

describe('strict-local ASR source contract', () => {
  it('contains no legacy provider, endpoint, fetch or fallback in production capture source', () => {
    const files = [...sourceFiles(voiceRoot), ...workspacePaths];
    const source = files.map((path) => readFileSync(path, 'utf8')).join('\n');
    expect(source).not.toMatch(
      /fetch|SpeechRecognition|webkitSpeechRecognition|CloudAsr|\/api\/asr|useTranscriber|WebSpeechProvider|CloudAsrProvider|cloudFetchImpl|serverBaseUrl|speechRecognitionCtor/u,
    );
    const voiceSource = sourceFiles(voiceRoot)
      .map((path) => readFileSync(path, 'utf8'))
      .join('\n');
    expect(voiceSource).not.toMatch(/notes\.|kg\.|reindexNote|todos\.|rag\.|llm/u);
    for (const path of deletedPaths) expect(existsSync(path)).toBe(false);
  });

  it('uses frozen test-only NFC and Levenshtein quality truth', () => {
    expect(normalizeAsrGateText(' cafe\u0301， 下午 3 点！')).toBe('café下午3点');
    const result = evaluateAsrCorpus([
      {
        id: 'critical-token',
        reference: '下午三点提醒我开会',
        transcript: '下午四点提醒我开会',
        criticalTokens: ['三点'],
      },
    ], 0.8);
    expect(result.accuracy).toBeCloseTo(8 / 9);
    expect(result.criticalTokensPass).toBe(false);
    expect(result.pass).toBe(false);
  });

  it('owns explicit microphone and speech-recognition purpose strings', () => {
    const config = readFileSync(join(process.cwd(), 'electron-builder.yml'), 'utf8');
    expect(config).toContain('NSMicrophoneUsageDescription:');
    expect(config).toContain('NSSpeechRecognitionUsageDescription:');
    expect(config).toContain('不会自动上传音频');
  });
});
