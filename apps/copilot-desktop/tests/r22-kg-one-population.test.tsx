import '@testing-library/jest-dom/vitest';

import { render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildFixtureGraph } from '../src/renderer/components/KnowledgeGraph/fixtureData.js';
import { SigmaCanvas } from '../src/renderer/components/KnowledgeGraph/SigmaCanvas.js';
import {
  toGraphEdge,
  toGraphNode,
} from '../src/renderer/components/KnowledgeGraph/types.js';

type Attributes = Record<string, unknown>;

const captures = vi.hoisted(() => ({
  graphConstructions: [] as Array<{ options: unknown; graph: unknown }>,
  sigmaConstructions: [] as Array<{
    graph: {
      nodes(): string[];
      edges(): string[];
      getNodeAttributes(id: string): Attributes;
      getEdgeAttributes(id: string): Attributes;
    };
    options: Attributes;
    nodeCountAtConstruction: number;
    edgeCountAtConstruction: number;
    nodesAtConstruction: Array<{ id: string; attrs: Attributes }>;
    edgesAtConstruction: Array<{ id: string; source: string; target: string; attrs: Attributes }>;
    handlers: Map<string, (payload?: unknown) => void>;
  }>,
  refreshSnapshots: [] as Array<{
    nodes: number;
    edges: number;
    nodeAttributes: Map<string, Attributes>;
    edgeAttributes: Map<string, Attributes>;
  }>,
}));

vi.mock('graphology', () => {
  class FakeGraph {
    readonly nodeAttributes = new Map<string, Attributes>();
    readonly edgeAttributes = new Map<string, { source: string; target: string; attrs: Attributes }>();

    constructor(options?: unknown) {
      captures.graphConstructions.push({ options, graph: this });
    }

    addNode(id: string, attrs: Attributes = {}): void {
      this.nodeAttributes.set(id, { ...attrs });
    }

    hasNode(id: string): boolean {
      return this.nodeAttributes.has(id);
    }

    nodes(): string[] {
      return [...this.nodeAttributes.keys()];
    }

    getNodeAttributes(id: string): Attributes {
      return this.nodeAttributes.get(id) ?? {};
    }

    setNodeAttribute(id: string, key: string, value: unknown): void {
      const attrs = this.nodeAttributes.get(id);
      if (attrs) attrs[key] = value;
    }

    forEachNode(callback: (id: string, attrs: Attributes) => void): void {
      for (const [id, attrs] of this.nodeAttributes) callback(id, attrs);
    }

    addEdgeWithKey(key: string, source: string, target: string, attrs: Attributes = {}): void {
      this.edgeAttributes.set(key, { source, target, attrs: { ...attrs } });
    }

    hasEdge(key: string): boolean {
      return this.edgeAttributes.has(key);
    }

    edges(): string[] {
      return [...this.edgeAttributes.keys()];
    }

    getEdgeAttributes(key: string): Attributes {
      return this.edgeAttributes.get(key)?.attrs ?? {};
    }

    source(key: string): string {
      return this.edgeAttributes.get(key)?.source ?? '';
    }

    target(key: string): string {
      return this.edgeAttributes.get(key)?.target ?? '';
    }

    dropEdge(key: string): void {
      this.edgeAttributes.delete(key);
    }

    dropNode(id: string): void {
      this.nodeAttributes.delete(id);
      for (const [key, edge] of this.edgeAttributes) {
        if (edge.source === id || edge.target === id) this.edgeAttributes.delete(key);
      }
    }

    replaceNodeAttributes(id: string, attrs: Attributes): void {
      if (this.nodeAttributes.has(id)) this.nodeAttributes.set(id, { ...attrs });
    }

    replaceEdgeAttributes(key: string, attrs: Attributes): void {
      const edge = this.edgeAttributes.get(key);
      if (edge) edge.attrs = { ...attrs };
    }

    setEdgeAttribute(key: string, name: string, value: unknown): void {
      const edge = this.edgeAttributes.get(key);
      if (edge) edge.attrs[name] = value;
    }

    forEachEdge(callback: (key: string, attrs: Attributes) => void): void {
      for (const [key, edge] of this.edgeAttributes) callback(key, edge.attrs);
    }
  }

  return { default: FakeGraph };
});

vi.mock('graphology-layout', () => ({
  circular: {
    assign(graph: {
      nodes(): string[];
      setNodeAttribute(id: string, key: string, value: unknown): void;
    }, options?: { scale?: number }): void {
      const ids = graph.nodes();
      const scale = options?.scale ?? 100;
      ids.forEach((id, index) => {
        const angle = ids.length === 0 ? 0 : index / ids.length * Math.PI * 2;
        graph.setNodeAttribute(id, 'x', Math.cos(angle) * scale);
        graph.setNodeAttribute(id, 'y', Math.sin(angle) * scale);
      });
    },
  },
}));

vi.mock('sigma', () => ({
  default: class FakeSigma {
    private readonly graph: {
      nodes(): string[];
      edges(): string[];
      getNodeAttributes(id: string): Attributes;
      getEdgeAttributes(id: string): Attributes;
      source(id: string): string;
      target(id: string): string;
    };
    private readonly handlers = new Map<string, (payload?: unknown) => void>();

    constructor(graph: FakeSigma['graph'], _container: HTMLElement, options: Attributes = {}) {
      this.graph = graph;
      captures.sigmaConstructions.push({
        graph,
        options,
        nodeCountAtConstruction: graph.nodes().length,
        edgeCountAtConstruction: graph.edges().length,
        nodesAtConstruction: graph.nodes().map((id) => ({
          id,
          attrs: { ...graph.getNodeAttributes(id) },
        })),
        edgesAtConstruction: graph.edges().map((id) => ({
          id,
          source: graph.source(id),
          target: graph.target(id),
          attrs: { ...graph.getEdgeAttributes(id) },
        })),
        handlers: this.handlers,
      });
    }

    on(event: string, handler: (payload?: unknown) => void): void {
      this.handlers.set(event, handler);
    }

    off(event: string, handler: (payload?: unknown) => void): void {
      if (this.handlers.get(event) === handler) this.handlers.delete(event);
    }
    kill(): void {}

    refresh(): void {
      captures.refreshSnapshots.push({
        nodes: this.graph.nodes().length,
        edges: this.graph.edges().length,
        nodeAttributes: new Map(this.graph.nodes().map((id) => [
          id,
          { ...this.graph.getNodeAttributes(id) },
        ])),
        edgeAttributes: new Map(this.graph.edges().map((id) => [
          id,
          { ...this.graph.getEdgeAttributes(id) },
        ])),
      });
    }
  },
}));

const fixture = buildFixtureGraph(100);
const nodes = fixture.nodes.map(toGraphNode);
const edges = fixture.edges.map(toGraphEdge);
const edgeKeys = fixture.edges.map((edge) => `${edge.from_entity_id}|${edge.to_entity_id}`);
const visibleNodeIds = new Set(nodes.map((node) => node.entity_id));
const visibleEdgeKeys = new Set(edgeKeys);

afterEach(() => {
  captures.graphConstructions.splice(0);
  captures.sigmaConstructions.splice(0);
  captures.refreshSnapshots.splice(0);
});

describe('r22 RED-4 one-population Sigma construction', () => {
  it('passes the already-populated 100-node/157-arrow-edge graph to the first Sigma constructor', () => {
    expect(fixture.nodes).toHaveLength(100);
    expect(fixture.edges).toHaveLength(157);

    render(
      <SigmaCanvas
        nodes={nodes}
        edges={edges}
        edgeKeys={edgeKeys}
        visibleNodeIds={visibleNodeIds}
        visibleEdgeKeys={visibleEdgeKeys}
      />,
    );

    expect(captures.sigmaConstructions).toHaveLength(1);
    const first = captures.sigmaConstructions[0]!;
    const expectedExtremities = new Map(fixture.edges.map((edge) => [
      `${edge.from_entity_id}|${edge.to_entity_id}`,
      [edge.from_entity_id, edge.to_entity_id],
    ]));
    expect({
      nodeCount: first.nodeCountAtConstruction,
      edgeCount: first.edgeCountAtConstruction,
      defaultEdgeType: first.options.defaultEdgeType,
      everyEdgeDirectedAndArrow: first.edgesAtConstruction.every(({ id, source, target, attrs }) => (
        attrs.type === 'arrow'
        && JSON.stringify([source, target]) === JSON.stringify(expectedExtremities.get(id))
      )),
      everyNodeReady: first.nodesAtConstruction.every(({ attrs }) => (
        Number.isFinite(attrs.x) && Number.isFinite(attrs.y) && typeof attrs.label === 'string'
      )),
    }).toEqual({
      nodeCount: 100,
      edgeCount: 157,
      defaultEdgeType: 'arrow',
      everyEdgeDirectedAndArrow: true,
      everyNodeReady: true,
    });
  });

  it('uses deterministic coordinates without a throwaway graph or empty refresh wave', () => {
    const firstMount = render(
      <SigmaCanvas
        nodes={nodes}
        edges={edges}
        edgeKeys={edgeKeys}
        visibleNodeIds={visibleNodeIds}
        visibleEdgeKeys={visibleEdgeKeys}
      />,
    );
    const firstPositions = captures.sigmaConstructions[0]?.nodesAtConstruction.map(({ id, attrs }) => ({
      id,
      x: attrs.x,
      y: attrs.y,
    }));
    firstMount.unmount();
    render(
      <SigmaCanvas
        nodes={nodes}
        edges={edges}
        edgeKeys={edgeKeys}
        visibleNodeIds={visibleNodeIds}
        visibleEdgeKeys={visibleEdgeKeys}
      />,
    );
    const secondPositions = captures.sigmaConstructions[1]?.nodesAtConstruction.map(({ id, attrs }) => ({
      id,
      x: attrs.x,
      y: attrs.y,
    }));

    expect({
      graphConstructionCount: captures.graphConstructions.length,
      firstPositionCount: firstPositions?.length,
      positionsEqual: JSON.stringify(firstPositions) === JSON.stringify(secondPositions),
      refreshOccurred: captures.refreshSnapshots.length > 0,
      everyRefreshComplete: captures.refreshSnapshots.every(({ nodes: nodeCount, edges: edgeCount }) => (
        nodeCount === 100 && edgeCount === 157
      )),
    }).toEqual({
      graphConstructionCount: 2,
      firstPositionCount: 100,
      positionsEqual: true,
      refreshOccurred: true,
      everyRefreshComplete: true,
    });
  });

  it('places every stable-order node at its exact radius-100 circular coordinate', () => {
    render(
      <SigmaCanvas
        nodes={nodes}
        edges={edges}
        edgeKeys={edgeKeys}
        visibleNodeIds={visibleNodeIds}
        visibleEdgeKeys={visibleEdgeKeys}
      />,
    );
    const constructedNodes = captures.sigmaConstructions[0]?.nodesAtConstruction ?? [];
    expect(constructedNodes).toHaveLength(nodes.length);
    expect(constructedNodes.map(({ id }) => id)).toEqual(nodes.map(({ entity_id }) => entity_id));
    for (let index = 0; index < nodes.length; index += 1) {
      const angle = index / nodes.length * Math.PI * 2;
      expect(Number(constructedNodes[index]!.attrs.x)).toBeCloseTo(Math.cos(angle) * 100, 10);
      expect(Number(constructedNodes[index]!.attrs.y)).toBeCloseTo(Math.sin(angle) * 100, 10);
    }
    expect(constructedNodes.some(({ attrs }) => Number(attrs.x) !== 0 || Number(attrs.y) !== 0)).toBe(true);
  });

  it('retains interactions, camera zoom and original attributes across filtering', () => {
    const firstClick = vi.fn();
    const latestClick = vi.fn();
    const firstHover = vi.fn();
    const latestHover = vi.fn();
    const rendered = render(
      <SigmaCanvas
        nodes={nodes}
        edges={edges}
        edgeKeys={edgeKeys}
        visibleNodeIds={visibleNodeIds}
        visibleEdgeKeys={visibleEdgeKeys}
        onNodeClick={firstClick}
        onNodeHover={firstHover}
      />,
    );
    const sigma = captures.sigmaConstructions[0]!;
    const firstNode = nodes[0]!;
    const firstEdgeKey = edgeKeys[0]!;
    const originalNode = { ...sigma.graph.getNodeAttributes(firstNode.entity_id) };
    const originalEdge = { ...sigma.graph.getEdgeAttributes(firstEdgeKey) };
    const hiddenNodes = new Set(visibleNodeIds);
    const hiddenEdges = new Set(visibleEdgeKeys);
    hiddenNodes.delete(firstNode.entity_id);
    hiddenEdges.delete(firstEdgeKey);
    rendered.rerender(
      <SigmaCanvas
        nodes={nodes}
        edges={edges}
        edgeKeys={edgeKeys}
        visibleNodeIds={hiddenNodes}
        visibleEdgeKeys={hiddenEdges}
        onNodeClick={latestClick}
        onNodeHover={latestHover}
      />,
    );
    expect(sigma.graph.getNodeAttributes(firstNode.entity_id)).toMatchObject({
      color: '#e2e8f0', label: '', size: 1,
    });
    expect(sigma.graph.getEdgeAttributes(firstEdgeKey)).toMatchObject({
      color: '#f1f5f9', size: 0.5,
    });
    rendered.rerender(
      <SigmaCanvas
        nodes={nodes}
        edges={edges}
        edgeKeys={edgeKeys}
        visibleNodeIds={visibleNodeIds}
        visibleEdgeKeys={visibleEdgeKeys}
        onNodeClick={latestClick}
        onNodeHover={latestHover}
      />,
    );
    sigma.handlers.get('clickNode')?.({ node: firstNode.entity_id });
    sigma.handlers.get('enterNode')?.({ node: firstNode.entity_id });
    sigma.handlers.get('leaveNode')?.();

    expect(captures.sigmaConstructions).toHaveLength(1);
    expect(sigma.options).toMatchObject({ minCameraRatio: 0.1, maxCameraRatio: 10 });
    expect(firstClick).not.toHaveBeenCalled();
    expect(firstHover).not.toHaveBeenCalled();
    expect(latestClick).toHaveBeenCalledWith(firstNode.entity_id);
    expect(latestHover).toHaveBeenNthCalledWith(1, firstNode.entity_id);
    expect(latestHover).toHaveBeenNthCalledWith(2, null);
    expect(sigma.graph.getNodeAttributes(firstNode.entity_id)).toMatchObject({
      color: originalNode.color,
      label: originalNode.label,
      size: originalNode.size,
    });
    expect(sigma.graph.getEdgeAttributes(firstEdgeKey)).toMatchObject({
      color: originalEdge.color,
      size: originalEdge.size,
      type: 'arrow',
    });
  });

  it('applies substantive node/edge prop updates without recreating Sigma', () => {
    const rendered = render(
      <SigmaCanvas
        nodes={nodes}
        edges={edges}
        edgeKeys={edgeKeys}
        visibleNodeIds={visibleNodeIds}
        visibleEdgeKeys={visibleEdgeKeys}
      />,
    );
    const keptIds = new Set(nodes.slice(0, 20).map((node) => node.entity_id));
    const keptEdgeIndexes = edgeKeys
      .map((key, index) => ({ key, index, endpoints: key.split('|') }))
      .filter(({ endpoints }) => keptIds.has(endpoints[0]!) && keptIds.has(endpoints[1]!));
    const updatedNodes = nodes.slice(0, 20).map((node, index) => (
      index === 0 ? { ...node, name: 'Updated node', color: '#123456', size: 42 } : node
    ));
    const updatedEdges = keptEdgeIndexes.map(({ index }, keptIndex) => (
      keptIndex === 0
        ? { ...edges[index]!, weight: 0.91, color: '#654321' }
        : edges[index]!
    ));
    const updatedEdgeKeys = keptEdgeIndexes.map(({ key }) => key);
    rendered.rerender(
      <SigmaCanvas
        nodes={updatedNodes}
        edges={updatedEdges}
        edgeKeys={updatedEdgeKeys}
        visibleNodeIds={keptIds}
        visibleEdgeKeys={new Set(updatedEdgeKeys)}
      />,
    );

    const graph = captures.sigmaConstructions[0]!.graph;
    expect({
      sigmaConstructionCount: captures.sigmaConstructions.length,
      nodeCount: graph.nodes().length,
      edgeCount: graph.edges().length,
      updatedNode: graph.getNodeAttributes(updatedNodes[0]!.entity_id),
      updatedEdge: graph.getEdgeAttributes(updatedEdgeKeys[0]!),
    }).toEqual({
      sigmaConstructionCount: 1,
      nodeCount: 20,
      edgeCount: updatedEdgeKeys.length,
      updatedNode: expect.objectContaining({
        label: 'Updated node', color: '#123456', size: 42,
      }),
      updatedEdge: expect.objectContaining({
        color: '#654321', size: 1 + 0.91 * 2, type: 'arrow',
      }),
    });
  });
});
