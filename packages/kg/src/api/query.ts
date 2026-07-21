import type {
  Entity,
  QueryRequest,
  QueryResult,
  SearchNodesOptions,
  Subgraph,
  Tag,
} from '../types.js';
import type { KgStore } from '../store/sqlite-store.js';

/** Stable local query API consumed by graph rendering and KG-assisted RAG. */
export class KgQuery {
  constructor(private readonly store: KgStore) {}

  getNode(entityId: string): {
    node: Entity;
    incoming: QueryResult['edges'];
    outgoing: QueryResult['edges'];
    notes: string[];
    tags: Tag[];
  } | null {
    const node = this.store.getEntityByIdString(entityId);
    if (!node) return null;
    const tags = new Map<string, Tag>();
    for (const note of node.source_notes) {
      for (const tag of this.store.tagsForNote(note)) tags.set(tag.name, tag);
    }
    return {
      node,
      incoming: this.store.edgesTo(entityId),
      outgoing: this.store.edgesFrom(entityId),
      notes: this.store.notesForEntity(entityId),
      tags: [...tags.values()].sort((a, b) => a.name.localeCompare(b.name)),
    };
  }

  searchNodes(query: string, options: SearchNodesOptions = {}): Entity[] {
    const normalized = query.trim().toLocaleLowerCase();
    if (!normalized) return [];
    const limit = Math.max(1, Math.min(options.limit ?? 20, 1000));
    return this.store.listNodes(options.type ? { type: options.type } : undefined)
      .filter((node) =>
        node.name.toLocaleLowerCase().includes(normalized) ||
        node.entity_id.toLocaleLowerCase().includes(normalized) ||
        node.aliases.some((alias) => alias.toLocaleLowerCase().includes(normalized)) ||
        (node.summary?.toLocaleLowerCase().includes(normalized) ?? false),
      )
      .slice(0, limit);
  }

  subgraph(request: QueryRequest): Subgraph {
    return queryKg(this.store, request);
  }

  fullGraph(maxNodes = 1000): QueryResult {
    const nodes = this.store.listNodes().slice(0, Math.max(1, Math.min(maxNodes, 10_000)));
    const ids = new Set(nodes.map((node) => node.entity_id));
    return {
      nodes,
      edges: this.store.listEdges().filter(
        (edge) => ids.has(edge.from_entity_id) && ids.has(edge.to_entity_id),
      ),
    };
  }

  stats(): { nodes: number; edges: number; tags: number } {
    return {
      nodes: this.store.countNodes(),
      edges: this.store.countEdges(),
      tags: this.store.listTags().length,
    };
  }
}

export function queryKg(store: KgStore, request: QueryRequest): Subgraph {
  const center = store.getEntityByIdString(request.center);
  if (!center) return { nodes: [], edges: [], degree: {} };
  const hops = Math.max(0, Math.min(request.hops ?? 1, 3));
  const maxNodes = Math.max(1, Math.min(request.maxNodes ?? 1000, 10_000));
  const allowedTypes = request.types ? new Set(request.types) : null;
  const visited = new Map<string, Entity>([[center.entity_id, center]]);
  const edgeMap = new Map<string, ReturnType<KgStore['listEdges']>[number]>();
  const queue: Array<{ entityId: string; depth: number }> = [
    { entityId: center.entity_id, depth: 0 },
  ];

  while (queue.length > 0 && visited.size <= maxNodes) {
    const current = queue.shift();
    if (!current || current.depth >= hops) continue;
    const incident = [...store.edgesFrom(current.entityId), ...store.edgesTo(current.entityId)];
    for (const edge of incident) {
      const otherId = edge.from_entity_id === current.entityId
        ? edge.to_entity_id
        : edge.from_entity_id;
      const other = store.getEntityByIdString(otherId);
      if (!other || (allowedTypes && !allowedTypes.has(other.type))) continue;
      edgeMap.set(`${edge.from_entity_id}\u0000${edge.to_entity_id}\u0000${edge.rel}`, edge);
      if (!visited.has(otherId) && visited.size < maxNodes) {
        visited.set(otherId, other);
        queue.push({ entityId: otherId, depth: current.depth + 1 });
      }
    }
  }

  const ids = new Set(visited.keys());
  const edges = [...edgeMap.values()].filter(
    (edge) => ids.has(edge.from_entity_id) && ids.has(edge.to_entity_id),
  );
  const degree: Record<string, number> = Object.fromEntries([...ids].map((id) => [id, 0]));
  for (const edge of edges) {
    degree[edge.from_entity_id] = (degree[edge.from_entity_id] ?? 0) + 1;
    degree[edge.to_entity_id] = (degree[edge.to_entity_id] ?? 0) + 1;
  }
  return { nodes: [...visited.values()], edges, degree };
}
