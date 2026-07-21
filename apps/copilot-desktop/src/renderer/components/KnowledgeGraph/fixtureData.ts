/**
 * KnowledgeGraph — in-memory fixture data source (Sprint 1.2 / T-1.2.2).
 *
 * Lets the renderer exercise a 100-node graph without spinning up
 * the Electron preload bridge or @copilot/kg SQLite store. Used in
 * tests, in the headless screenshot harness, and as the default
 * `dataSource` when no other source is supplied.
 *
 * Deterministic seed: same data every time so screenshots are stable.
 */

import type { Entity, Relation, Subgraph } from '@copilot/kg';
import type { KgDataSource } from './types.js';

const TYPES = [
  'person',
  'org',
  'concept',
  'event',
  'place',
  'product',
  'document',
  'topic',
  'other',
] as const;

const FIRST = [
  'alice', 'bob', 'carol', 'david', 'eve', 'frank', 'grace', 'henry',
  'iris', 'jack', 'kate', 'liam', 'mona', 'nick', 'olivia', 'peter',
  'quinn', 'rachel', 'sam', 'tina',
];
const LAST = [
  'smith', 'jones', 'brown', 'wilson', 'taylor', 'clark', 'hall',
  'lee', 'walker', 'king', 'wright', 'lopez', 'hill', 'green',
];

const ORG = [
  'OpenClaw', 'NJX-Copilot', 'AeroMaint', '航材云', 'KnowledgeBase',
  'Atlas', 'Pioneer', 'Beacon', 'Helios', 'Voyager',
];
const CONCEPT = [
  'Knowledge Graph', 'RAG', 'LLM', 'Embedding', 'Vector Search',
  'Entity Extraction', 'Relation Mining', 'Tagging', 'Summarization',
  'Note Linking',
];
const PLACE = ['Shanghai', 'Beijing', 'Shenzhen', 'Hangzhou', 'Chengdu'];
const EVENT = [
  'Sprint 1.2 Review', 'T-1.2.1 Kickoff', 'Beta Release',
  'Open House 2026', 'Conf Day',
];
const DOC = [
  'README.md', 'goal.md', 'plan.md', 'rules.md', 'delivery.md',
  'AGENTS.md', 'SELF-VERIFY.md',
];
const PRODUCT = ['Copilot Desktop', 'Copilot Cloud', 'Mavis', 'OpenClaw'];

/**
 * `mulberry32` — tiny deterministic PRNG so the same seed produces
 * the same 100-node graph every call. Stable screenshots require this.
 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(rng: () => number, list: ReadonlyArray<T>, idx?: number): T {
  if (idx !== undefined) return list[idx % list.length] as T;
  return list[Math.floor(rng() * list.length)] as T;
}

function makeEntity(rng: () => number, idx: number): Entity {
  const typeRoll = idx % TYPES.length;
  const type = TYPES[typeRoll];
  let name: string;
  switch (type) {
    case 'person':
      name = `${pick(rng, FIRST, idx)}${pick(rng, LAST, idx * 7)}`;
      break;
    case 'org':
      name = pick(rng, ORG, idx);
      break;
    case 'concept':
      name = pick(rng, CONCEPT, idx);
      break;
    case 'event':
      name = pick(rng, EVENT, idx);
      break;
    case 'place':
      name = pick(rng, PLACE, idx);
      break;
    case 'product':
      name = pick(rng, PRODUCT, idx);
      break;
    case 'document':
      name = pick(rng, DOC, idx);
      break;
    case 'topic':
      name = `${pick(rng, CONCEPT, idx)} topic`;
      break;
    default:
      name = `Misc ${idx}`;
  }
  const id = `${type}:${name.toLowerCase().replace(/\s+/g, '_')}-${idx}`;
  const noteCount = 1 + Math.floor(rng() * 5);
  const source_notes: string[] = [];
  for (let i = 0; i < noteCount; i += 1) {
    source_notes.push(`notes/${pick(rng, DOC, i)}.md`);
  }
  return {
    id: idx + 1,
    entity_id: id,
    type,
    name,
    aliases: [],
    summary: `${type} named ${name}`,
    confidence: 0.6 + rng() * 0.4,
    source_notes,
    created_at: 1700000000000 + idx * 1000,
    updated_at: 1700000000000 + idx * 1000,
  };
}

function makeRelations(
  rng: () => number,
  nodes: ReadonlyArray<Entity>,
  density = 1.5,
): Relation[] {
  const edges: Relation[] = [];
  const N = nodes.length;
  const targetEdges = Math.floor(N * density);
  let nextId = 1;
  const seen = new Set<string>();
  for (let i = 0; i < targetEdges; i += 1) {
    const a = nodes[Math.floor(rng() * N)];
    const b = nodes[Math.floor(rng() * N)];
    if (!a || !b || a.entity_id === b.entity_id) continue;
    const key = `${a.entity_id}|${b.entity_id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    edges.push({
      id: nextId++,
      from_entity_id: a.entity_id,
      to_entity_id: b.entity_id,
      rel: 'related_to',
      weight: 0.3 + rng() * 0.7,
      evidence: [`notes/${pick(rng, DOC, i)}.md`],
      created_at: 1700000000000 + i * 1000,
    });
  }
  return edges;
}

/**
 * Build a deterministic 100-node graph. Default size matches the PM
 * acceptance signal "100 节点流畅渲染 ≥ 30 FPS".
 */
export function buildFixtureGraph(size = 100, seed = 42): Subgraph {
  const rng = mulberry32(seed);
  const nodes: Entity[] = [];
  for (let i = 0; i < size; i += 1) {
    nodes.push(makeEntity(rng, i));
  }
  const edges = makeRelations(rng, nodes, 1.6);
  const degree: Record<string, number> = {};
  for (const n of nodes) degree[n.entity_id] = 0;
  for (const e of edges) {
    degree[e.from_entity_id] = (degree[e.from_entity_id] ?? 0) + 1;
    degree[e.to_entity_id] = (degree[e.to_entity_id] ?? 0) + 1;
  }
  return { nodes, edges, degree };
}

/**
 * `FixtureKgDataSource` — minimal `KgDataSource` that resolves with
 * a deterministic 100-node graph. Tests pass a custom `size` to keep
 * their snapshots small.
 */
export class FixtureKgDataSource implements KgDataSource {
  private readonly size: number;

  constructor(size = 100) {
    this.size = size;
  }

  async getSubgraph(): Promise<Subgraph> {
    return buildFixtureGraph(this.size);
  }
}