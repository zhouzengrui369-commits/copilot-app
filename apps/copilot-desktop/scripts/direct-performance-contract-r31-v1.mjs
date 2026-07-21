import { validateDirectPerformanceContractDescriptor } from './direct-performance-config.mjs';

export const DIRECT_PERFORMANCE_CONTRACT_R31_V1 = validateDirectPerformanceContractDescriptor({
  contractVersion: 'r31-v1',
  candidate: 'v6.2-phase1-candidate-r31',
  rawSchemaVersion: 4,
  rawSource: 'direct-spawn-same-electron-instance-plus-authoritative-emitted-knowledgegraph-artifacts-r31-v1',
  rawBasenames: [
    'performance-raw1-r31-v1.json',
    'performance-raw2-r31-v1.json',
    'performance-raw3-r31-v1.json',
  ],
  aggregateBasename: 'performance-aggregate-r31-v1.json',
  executableBasenames: [
    'njx-copilot-v6',
    'njx-copilot-v6.exe',
  ],
  bindingMode: 'r31-v1-complete-candidate-harness-provenance',
});
