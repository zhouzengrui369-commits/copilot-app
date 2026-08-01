/**
 * KnowledgeGraph — vitest coverage (Sprint 1.2 / T-1.2.2).
 *
 * Tests the public surface of the KnowledgeGraph family:
 *   1. FixtureKgDataSource returns a deterministic 100-node graph.
 *   2. toGraphNode projects Entity → KgGraphNode with sane sizing / colour.
 *   3. toGraphEdge projects Relation → KgGraphEdge.
 *   4. passesFilter honours type, search, and tag predicates.
 *   5. countVisible matches passesFilter enumeration.
 *   6. <KnowledgeGraph /> without a source fails closed with the existing
 *      chrome/canvas and zero nodes, never the implicit fixture.
 *   7. An explicitly injected fixture renders sigma canvas, filter/search
 *      chrome, and interaction counters.
 *   8. Clicking a filter chip toggles `data-active` and reduces the
 *      visible node count.
 *   9. Typing in SearchBox debounce-commits into the filter.
 *  10. Clicking a chip + searching together narrow the result.
 *  11. SigmaCanvas renders 100 explicitly injected fixture nodes.
 */

import '@testing-library/jest-dom/vitest';

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { KnowledgeGraph } from '../src/renderer/components/KnowledgeGraph/index.js';
import { normalizeSourceNotes } from '../src/renderer/components/KnowledgeGraph/useKgData.js';
import {
  FixtureKgDataSource,
  buildFixtureGraph,
} from '../src/renderer/components/KnowledgeGraph/fixtureData.js';
import {
  countVisible,
  ENTITY_PALETTE,
  passesFilter,
  toGraphEdge,
  toGraphNode,
  EMPTY_FILTER,
} from '../src/renderer/components/KnowledgeGraph/types.js';
import type { Entity, Relation } from '@copilot/kg';

const sigmaHarness = vi.hoisted(() => {
  const handlers = new Map<string, (payload: unknown) => void>();
  let mounts = 0;
  let kills = 0;
  return {
    mounted(): void {
      mounts += 1;
    },
    killed(): void {
      kills += 1;
    },
    mountCount(): number {
      return mounts;
    },
    killCount(): number {
      return kills;
    },
    on(event: string, handler: (payload: unknown) => void): void {
      handlers.set(event, handler);
    },
    off(event: string, handler: (payload: unknown) => void): void {
      if (handlers.get(event) === handler) handlers.delete(event);
    },
    dispatch(event: string, payload: unknown): void {
      const handler = handlers.get(event);
      if (!handler) throw new Error(`FakeSigma handler not registered: ${event}`);
      handler(payload);
    },
    clear(): void {
      handlers.clear();
      mounts = 0;
      kills = 0;
    },
  };
});

const graphHarness = vi.hoisted(() => {
  let sequence = 0;
  let latest = 0;
  const nodes = new Map<number, Set<string>>();
  const edges = new Map<number, Set<string>>();
  return {
    create(): number {
      sequence += 1;
      latest = sequence;
      nodes.set(latest, new Set());
      edges.set(latest, new Set());
      return latest;
    },
    addNode(instance: number, id: string): void {
      nodes.get(instance)?.add(id);
    },
    dropNode(instance: number, id: string): void {
      nodes.get(instance)?.delete(id);
    },
    addEdge(instance: number, key: string): void {
      edges.get(instance)?.add(key);
    },
    dropEdge(instance: number, key: string): void {
      edges.get(instance)?.delete(key);
    },
    latestNodeIds(): string[] {
      return [...(nodes.get(latest) ?? [])];
    },
    latestEdgeKeys(): string[] {
      return [...(edges.get(latest) ?? [])];
    },
    clear(): void {
      sequence = 0;
      latest = 0;
      nodes.clear();
      edges.clear();
    },
  };
});

// jsdom doesn't provide WebGL2RenderingContext; sigma.js's WebGL renderer
// crashes at module-evaluation time if it's pulled in via the canvas
// component. The component itself wraps sigma in a useEffect + ref, so a
// lightweight stub that satisfies the constructor + method surface is
// enough — the test exercises data hooks / filter / search, not pixels.
vi.mock('sigma', () => {
  class FakeSigma {
    public killed = false;
    constructor(_graph: unknown, _container: HTMLElement, _opts?: unknown) {
      sigmaHarness.mounted();
    }
    kill(): void {
      this.killed = true;
      sigmaHarness.killed();
    }
    on(event: string, handler: (payload: unknown) => void): void {
      sigmaHarness.on(event, handler);
    }
    off(event: string, handler: (payload: unknown) => void): void {
      sigmaHarness.off(event, handler);
    }
    refresh(): void {
      /* no-op */
    }
  }
  return { default: FakeSigma };
});

afterEach(() => {
  cleanup();
  sigmaHarness.clear();
  graphHarness.clear();
  vi.restoreAllMocks();
});

// graphology also pulls in heavy graph data structures that jsdom doesn't
// have to support. The component only uses Graph for the side effect of
// creating an instance + addNode / nodes() / getNodeAttributes, so a
// minimal stub that records calls is sufficient for the test surface.
vi.mock('graphology', () => {
  class FakeGraph {
    private nodeAttrs = new Map<string, Record<string, unknown>>();
    private edgeAttrs = new Map<string, Record<string, unknown>>();
    private readonly harnessId = graphHarness.create();
    constructor(_opts?: unknown) {
      /* no-op */
    }
    addNode(id: string, attrs?: Record<string, unknown>): void {
      this.nodeAttrs.set(id, attrs ?? {});
      graphHarness.addNode(this.harnessId, id);
    }
    hasNode(id: string): boolean {
      return this.nodeAttrs.has(id);
    }
    nodes(): string[] {
      return [...this.nodeAttrs.keys()];
    }
    getNodeAttributes(id: string): Record<string, unknown> {
      return this.nodeAttrs.get(id) ?? {};
    }
    forEachNode(cb: (id: string, attrs: Record<string, unknown>) => void): void {
      for (const [id, attrs] of this.nodeAttrs) cb(id, attrs);
    }
    dropNode(id: string): void {
      this.nodeAttrs.delete(id);
      graphHarness.dropNode(this.harnessId, id);
    }
    edges(): string[] {
      return [...this.edgeAttrs.keys()];
    }
    hasEdge(key: string): boolean {
      return this.edgeAttrs.has(key);
    }
    addEdgeWithKey(
      key: string,
      _from: string,
      _to: string,
      attrs?: Record<string, unknown>,
    ): void {
      this.edgeAttrs.set(key, attrs ?? {});
      graphHarness.addEdge(this.harnessId, key);
    }
    dropEdge(key: string): void {
      this.edgeAttrs.delete(key);
      graphHarness.dropEdge(this.harnessId, key);
    }
    forEachEdge(cb: (key: string) => void): void {
      for (const key of this.edgeAttrs.keys()) cb(key);
    }
    setNodeAttribute(id: string, key: string, val: unknown): void {
      const a = this.nodeAttrs.get(id);
      if (a) a[key] = val;
    }
    setEdgeAttribute(): void {
      /* no-op */
    }
  }
  return { default: FakeGraph };
});

vi.mock('graphology-layout', () => ({
  circular: {
    assign(graph: { nodes: () => string[]; setNodeAttribute: (id: string, k: string, v: unknown) => void }, _opts?: unknown): void {
      const ids = graph.nodes();
      const scale = (_opts as { scale?: number } | undefined)?.scale ?? 100;
      ids.forEach((id, i) => {
        const a = (i / ids.length) * Math.PI * 2;
        graph.setNodeAttribute(id, 'x', Math.cos(a) * scale);
        graph.setNodeAttribute(id, 'y', Math.sin(a) * scale);
      });
    },
  },
}));

describe('KnowledgeGraph · data shape', () => {
  it('FixtureKgDataSource returns a deterministic 100-node graph', async () => {
    const ds = new FixtureKgDataSource(100);
    const a = await ds.getSubgraph();
    const b = await ds.getSubgraph();
    expect(a.nodes).toHaveLength(100);
    expect(a.edges.length).toBeGreaterThan(0);
    // Determinism: identical inputs → identical node IDs / edge tuples.
    expect(a.nodes.map((n) => n.entity_id)).toEqual(
      b.nodes.map((n) => n.entity_id),
    );
    expect(a.edges.length).toBe(b.edges.length);
  });

  it('buildFixtureGraph respects size', () => {
    const tiny = buildFixtureGraph(10);
    expect(tiny.nodes).toHaveLength(10);
    expect(Object.keys(tiny.degree)).toHaveLength(10);
  });

  it('toGraphNode projects Entity → KgGraphNode with sane size + colour', () => {
    const entity: Entity = {
      id: 1,
      entity_id: 'person:alice',
      type: 'person',
      name: 'Alice',
      aliases: [],
      summary: 'A person',
      confidence: 0.9,
      source_notes: ['a.md', 'b.md'],
      created_at: 0,
      updated_at: 0,
    };
    const node = toGraphNode(entity);
    expect(node.entity_id).toBe('person:alice');
    expect(node.type).toBe('person');
    expect(node.name).toBe('Alice');
    expect(node.sourceCount).toBe(2);
    expect(node.color).toBe(ENTITY_PALETTE.person);
    expect(node.size).toBeGreaterThan(4);
  });

  it('toGraphEdge projects Relation → KgGraphEdge', () => {
    const rel: Relation = {
      id: 1,
      from_entity_id: 'person:a',
      to_entity_id: 'org:b',
      rel: 'works_at',
      weight: 0.7,
      evidence: ['a.md'],
      created_at: 0,
    };
    const edge = toGraphEdge(rel);
    expect(edge.rel).toBe('works_at');
    expect(edge.weight).toBe(0.7);
    expect(edge.color).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it('passesFilter honours type, search, and empty filter', () => {
    const node = toGraphNode({
      id: 1,
      entity_id: 'person:alice',
      type: 'person',
      name: 'Alice',
      aliases: [],
      summary: null,
      confidence: null,
      source_notes: [],
      created_at: 0,
      updated_at: 0,
    });
    expect(passesFilter(node, EMPTY_FILTER)).toBe(true);
    expect(passesFilter(node, { ...EMPTY_FILTER, types: new Set(['person']) })).toBe(true);
    expect(passesFilter(node, { ...EMPTY_FILTER, types: new Set(['org']) })).toBe(false);
    expect(passesFilter(node, { ...EMPTY_FILTER, search: 'ali' })).toBe(true);
    expect(passesFilter(node, { ...EMPTY_FILTER, search: 'bob' })).toBe(false);
    expect(passesFilter(node, { ...EMPTY_FILTER, search: 'ALI' })).toBe(true); // case-insensitive
  });

  it('countVisible matches passesFilter enumeration', () => {
    const nodes = [
      toGraphNode({ id: 1, entity_id: 'person:a', type: 'person', name: 'Alice', aliases: [], summary: null, confidence: null, source_notes: [], created_at: 0, updated_at: 0 }),
      toGraphNode({ id: 2, entity_id: 'org:b', type: 'org', name: 'Bob Inc', aliases: [], summary: null, confidence: null, source_notes: [], created_at: 0, updated_at: 0 }),
      toGraphNode({ id: 3, entity_id: 'concept:c', type: 'concept', name: 'Cog', aliases: [], summary: null, confidence: null, source_notes: [], created_at: 0, updated_at: 0 }),
    ];
    expect(countVisible(nodes, EMPTY_FILTER)).toBe(3);
    expect(countVisible(nodes, { ...EMPTY_FILTER, types: new Set(['person']) })).toBe(1);
    expect(countVisible(nodes, { ...EMPTY_FILTER, search: 'bob' })).toBe(1);
  });
});

describe('KnowledgeGraph · render', () => {
  it('fails closed with zero nodes and never reads fixture data when dataSource is absent', async () => {
    const fixtureRead = vi.spyOn(FixtureKgDataSource.prototype, 'getSubgraph');
    render(<KnowledgeGraph />);
    const root = screen.getByTestId('kg-root');
    expect(root).toHaveAttribute('data-source-state', 'unavailable');
    expect(root).toHaveAttribute('data-error', 'KG_DATA_SOURCE_UNAVAILABLE');
    expect(root).toHaveAttribute('data-visible-count', '0');
    expect(screen.getByTestId('kg-root')).toBeInTheDocument();
    expect(screen.getByTestId('kg-toolbar')).toBeInTheDocument();
    expect(screen.getByTestId('kg-filter-panel')).toBeInTheDocument();
    expect(screen.getByTestId('kg-sigma-canvas')).toBeInTheDocument();
    expect(screen.getByTestId('kg-status')).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByTestId('kg-toolbar-meta')).toHaveTextContent('Unavailable · 0 / 0 nodes');
    });
    expect(fixtureRead).not.toHaveBeenCalled();
  });

  it('mounts the existing chrome with an explicitly injected fixture', async () => {
    render(<KnowledgeGraph dataSource={new FixtureKgDataSource(100)} />);
    expect(screen.getByTestId('kg-root')).toHaveAttribute('data-source-state', 'available');
    expect(screen.getByTestId('kg-toolbar')).toBeInTheDocument();
    expect(screen.getByTestId('kg-filter-panel')).toBeInTheDocument();
    expect(screen.getByTestId('kg-sigma-canvas')).toBeInTheDocument();
    expect(screen.getByTestId('kg-status')).toBeInTheDocument();
    await screen.findByText(/100 \/ 100 nodes/, {}, { timeout: 10000 });
  });

  it('synchronously clears a loaded graph and all old interaction state when its source becomes absent', async () => {
    const fixtureRead = vi.spyOn(FixtureKgDataSource.prototype, 'getSubgraph');
    const onNodeClick = vi.fn();
    const onNodeHover = vi.fn();
    const fixture = new FixtureKgDataSource(100);
    const first = buildFixtureGraph(100).nodes[0]!;
    const { rerender } = render(
      <KnowledgeGraph
        dataSource={fixture}
        onNodeClick={onNodeClick}
        onNodeHover={onNodeHover}
      />,
    );

    await screen.findByText(/100 \/ 100 nodes/, {}, { timeout: 10000 });
    await waitFor(
      () => {
        expect(graphHarness.latestNodeIds()).toHaveLength(100);
      },
      { timeout: 10000 },
    );
    expect(graphHarness.latestEdgeKeys().length).toBeGreaterThan(0);
    expect(fixtureRead).toHaveBeenCalledTimes(1);
    act(() => {
      sigmaHarness.dispatch('clickNode', { node: first.entity_id });
      sigmaHarness.dispatch('enterNode', { node: first.entity_id });
    });
    expect(onNodeClick).toHaveBeenCalledTimes(1);
    expect(onNodeHover).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('kg-status-clicks')).toHaveTextContent('Clicks: 1');
    expect(screen.getByTestId('kg-status-hover')).toHaveTextContent(first.entity_id);
    const priorMounts = sigmaHarness.mountCount();

    rerender(
      <KnowledgeGraph
        onNodeClick={onNodeClick}
        onNodeHover={onNodeHover}
      />,
    );

    const root = screen.getByTestId('kg-root');
    expect(root).toHaveAttribute('data-source-state', 'unavailable');
    expect(root).toHaveAttribute('data-loading', 'false');
    expect(root).toHaveAttribute('data-error', 'KG_DATA_SOURCE_UNAVAILABLE');
    expect(root).toHaveAttribute('data-visible-count', '0');
    expect(screen.getByTestId('kg-toolbar-meta')).toHaveTextContent('Unavailable · 0 / 0 nodes');
    expect(screen.getByTestId('kg-filter-summary')).toHaveTextContent('Showing all 0 nodes');
    expect(screen.getByTestId('kg-status-clicks')).toHaveTextContent('Clicks: 0');
    expect(screen.getByTestId('kg-status-hover')).toHaveTextContent('Hover: —');
    expect(graphHarness.latestNodeIds()).toEqual([]);
    expect(graphHarness.latestEdgeKeys()).toEqual([]);
    expect(sigmaHarness.mountCount()).toBe(priorMounts + 1);
    expect(sigmaHarness.killCount()).toBeGreaterThanOrEqual(1);

    act(() => {
      sigmaHarness.dispatch('clickNode', { node: first.entity_id });
      sigmaHarness.dispatch('enterNode', { node: first.entity_id });
    });
    expect(onNodeClick).toHaveBeenCalledTimes(1);
    expect(onNodeHover).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('kg-status-clicks')).toHaveTextContent('Clicks: 0');
    expect(screen.getByTestId('kg-status-hover')).toHaveTextContent('Hover: —');
    expect(fixtureRead).toHaveBeenCalledTimes(1);
  });

  it('shows 100 / 100 nodes after the fixture load settles', async () => {
    render(<KnowledgeGraph dataSource={new FixtureKgDataSource(100)} />);
    await waitFor(() => {
      const meta = screen.getByTestId('kg-toolbar-meta');
      expect(meta.textContent).toMatch(/100 \/ 100 nodes/);
    });
  });

  it('clicking a filter chip toggles data-active and narrows visible count', async () => {
    render(<KnowledgeGraph dataSource={new FixtureKgDataSource(100)} />);
    // Wait for fixture load to settle (then toolbar shows "X / 100 nodes").
    await screen.findByText(/\/ 100 nodes/, {}, { timeout: 10000 });
    const personChip = screen.getByTestId('kg-chip-person');
    fireEvent.click(personChip);
    await waitFor(
      () => {
        expect(personChip.getAttribute('data-active')).toBe('true');
      },
      { timeout: 5000 },
    );
    // Visible count drops below 100.
    await waitFor(
      () => {
        const meta = screen.getByTestId('kg-toolbar-meta').textContent ?? '';
        const m = meta.match(/(\d+) \/ 100 nodes/);
        expect(m).not.toBeNull();
        expect(Number(m![1])).toBeLessThan(100);
      },
      { timeout: 5000 },
    );
  });

  it('typing in SearchBox debounce-commits into the filter', async () => {
    render(<KnowledgeGraph dataSource={new FixtureKgDataSource(100)} />);
    await screen.findByText(/\/ 100 nodes/, {}, { timeout: 10000 });
    const input = screen.getByTestId('kg-search-input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'alice' } });
    // Real-time debounce — wait long enough for the 120ms timer.
    await waitFor(
      () => {
        const meta = screen.getByTestId('kg-toolbar-meta').textContent ?? '';
        const m = meta.match(/(\d+) \/ 100 nodes/);
        expect(m).not.toBeNull();
        expect(Number(m![1])).toBeLessThan(100);
      },
      { timeout: 5000 },
    );
  });

  it('clearing the filter brings the visible count back to 100', async () => {
    render(<KnowledgeGraph dataSource={new FixtureKgDataSource(100)} />);
    await screen.findByText(/\/ 100 nodes/, {}, { timeout: 10000 });
    const personChip = screen.getByTestId('kg-chip-person');
    fireEvent.click(personChip);
    await waitFor(
      () => {
        expect(personChip.getAttribute('data-active')).toBe('true');
      },
      { timeout: 5000 },
    );
    fireEvent.click(screen.getByTestId('kg-filter-clear'));
    await waitFor(
      () => {
        const meta = screen.getByTestId('kg-toolbar-meta').textContent ?? '';
        expect(meta).toMatch(/100 \/ 100 nodes/);
      },
      { timeout: 5000 },
    );
  });
});

describe('KnowledgeGraph · click callback contract', () => {
  it('fires onNodeClick through the registered Sigma clickNode handler', async () => {
    const onNodeClick = vi.fn();
    render(
      <KnowledgeGraph
        dataSource={new FixtureKgDataSource(100)}
        onNodeClick={onNodeClick}
      />,
    );
    await screen.findByText(/\/ 100 nodes/, {}, { timeout: 10000 });
    const first = buildFixtureGraph(100).nodes[0]!;

    act(() => {
      sigmaHarness.dispatch('clickNode', { node: first.entity_id });
    });

    await waitFor(() => expect(onNodeClick).toHaveBeenCalledTimes(1));
    expect(onNodeClick.mock.calls[0]![0]).toMatchObject({
      entity_id: first.entity_id,
      id: first.id,
    });
    expect(screen.getByTestId('kg-status-clicks')).toHaveTextContent('Clicks: 1');
  });
});

describe('KnowledgeGraph · 2D source navigation R2', () => {
  function makeRealDataSource(): {
    dataSource: import('../src/renderer/components/KnowledgeGraph/types.js').KgDataSource;
    aliceId: string;
    invalidId: string;
  } {
    const nodes: Entity[] = [
      {
        id: 11,
        entity_id: 'person:alice-0',
        type: 'person',
        name: 'Alice',
        aliases: ['A'],
        summary: 'canonical summary',
        confidence: 0.91,
        source_notes: [
          ' notes/goal.md ',
          'notes/README.md',
          'notes/AGENTS.md',
          'notes/README.md ',
          '   ',
          ' UNKNOWN:missing.md ',
        ],
        created_at: 1700000000000,
        updated_at: 1700000001000,
      },
      {
        id: 12,
        entity_id: 'concept:invalid-1',
        type: 'concept',
        name: 'Invalid sources',
        aliases: [],
        summary: null,
        confidence: null,
        source_notes: [' ', 'unknown:missing.md', ' UNKNOWN:other.md '],
        created_at: 1700000002000,
        updated_at: 1700000003000,
      },
    ];
    return {
      dataSource: {
        async getSubgraph() {
          return {
            nodes: nodes.map((entity) => ({ ...entity, source_notes: [...entity.source_notes] })),
            edges: [],
            degree: Object.fromEntries(nodes.map((entity) => [entity.entity_id, 0])),
          };
        },
      },
      aliceId: nodes[0]!.entity_id,
      invalidId: nodes[1]!.entity_id,
    };
  }

  it('normalizes paths with binary ordering and projects the true source count', () => {
    const sources = normalizeSourceNotes([
      ' notes/goal.md ',
      'notes/README.md',
      'notes/AGENTS.md',
      'notes/README.md ',
      '',
      ' UNKNOWN:missing.md ',
    ]);
    expect(sources).toEqual([
      'notes/AGENTS.md',
      'notes/README.md',
      'notes/goal.md',
    ]);
    const node = toGraphNode({
      id: 1,
      entity_id: 'topic:one',
      type: 'topic',
      name: 'One',
      aliases: [],
      summary: null,
      confidence: null,
      source_notes: [...sources],
      created_at: 0,
      updated_at: 0,
    });
    expect(node.sourceCount).toBe(3);
  });

  it('dispatches a real Sigma node click with the canonical Entity and no duplicate center UI', async () => {
    const onNodeClick = vi.fn();
    const { dataSource, aliceId } = makeRealDataSource();
    render(<KnowledgeGraph dataSource={dataSource} onNodeClick={onNodeClick} />);
    await screen.findByText(/2 \/ 2 nodes/, {}, { timeout: 10000 });

    expect(screen.queryByTestId('kg-node-list')).not.toBeInTheDocument();
    expect(screen.queryByTestId('kg-node-detail')).not.toBeInTheDocument();
    act(() => {
      sigmaHarness.dispatch('clickNode', { node: aliceId });
    });

    await waitFor(() => expect(onNodeClick).toHaveBeenCalledTimes(1));
    const entity = onNodeClick.mock.calls[0]![0] as Entity;
    expect(entity).toMatchObject({
      id: 11,
      entity_id: aliceId,
      aliases: ['A'],
      summary: 'canonical summary',
      confidence: 0.91,
      created_at: 1700000000000,
      updated_at: 1700000001000,
    });
    expect(entity.source_notes).toEqual([
      'notes/AGENTS.md',
      'notes/README.md',
      'notes/goal.md',
    ]);
    expect(screen.getByTestId('kg-status-clicks')).toHaveTextContent('Clicks: 1');
  });

  it('fails closed for empty and unknown sources through the same Sigma path', async () => {
    const onNodeClick = vi.fn();
    const { dataSource, invalidId } = makeRealDataSource();
    render(<KnowledgeGraph dataSource={dataSource} onNodeClick={onNodeClick} />);
    await screen.findByText(/2 \/ 2 nodes/, {}, { timeout: 10000 });

    act(() => {
      sigmaHarness.dispatch('clickNode', { node: invalidId });
    });

    await waitFor(() => expect(onNodeClick).toHaveBeenCalledTimes(1));
    const entity = onNodeClick.mock.calls[0]![0] as Entity;
    expect(entity.entity_id).toBe(invalidId);
    expect(entity.source_notes).toEqual([]);
    expect(screen.queryByTestId('kg-node-list')).not.toBeInTheDocument();
    expect(screen.queryByTestId('kg-node-detail')).not.toBeInTheDocument();
  });
});
