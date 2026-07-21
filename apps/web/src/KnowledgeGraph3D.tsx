/**
 * KnowledgeGraph3D — 3D knowledge graph view for njx-copilot Knowledge page.
 *
 * Reference parity target: nanjixiong_knowledge_map.html v5
 * - V1 视图切换 (visual style "cosmos3d")
 * - V2 背景 #040a18 + FogExp2(0.00005)
 * - V3 4 层白色星海 (6000/4000/2500/1200, AdditiveBlending)
 * - V4 4 条 dust rings
 * - V5 MOC: Torus(3.0, 0.04, 16, 80) + 白球 0.25 + CSS2D icon + "name · count"
 * - V6 sub-MOC (folder/source/wiki): Torus(1.3, 0.03, 8, 48) + 白球 0.12 + CSS2D icon
 * - V7 Note: TubeGeometry(0.025, 5) + 外层光晕 (0.07, 0.06)
 * - V8 神经信号 1.2s 周期, semantic/duplicate/task-output
 * - V9 CSS2D label opacity 按相机距离 (moc=0, subMoc=25, note=15)
 * - V10 OrbitControls: damping 0.06, minDist 5, maxDist 140, autoRotate 默认开, 速度 0.08
 * - V11 click → onSelectNode + 选中节点自发光
 * - V12 light-weight 模式 if nodes+edges > 1500
 *
 * Data contract: { nodes: GraphNode[]; edges: GraphEdge[] } — no backend changes.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { CSS2DRenderer, CSS2DObject } from "three/examples/jsm/renderers/CSS2DRenderer.js";

type GraphNode = {
  id: string;
  label: string;
  type?: string;
  source?: string;
  path?: string;
  depth?: number;
  size?: number;
  updatedAt?: string;
  tags?: string[];
  color?: string;
};

type GraphEdge = {
  id: string;
  source: string;
  target: string;
  label?: string;
};

// ── Color palette (locked in TASK.md V1–V12 contract) ────────────────
// Reference v5-aligned palette: orange / purple / blue / white points.
// Notes that should read as warm star points (project/task/document) lean orange;
// MOC/sub-MOC anchors keep cool tones; tag leaves match the reference orange.
const TYPE_COLORS: Record<string, string> = {
  moc: "#7dd3fc",     // sky-300 → cool anchor
  folder: "#60a5fa",  // blue-400
  document: "#f97316",// orange-500 (matches reference dominant orange)
  tag: "#fb923c",     // orange-400 (leaf orange like reference 0xff6600)
  source: "#a855f7",  // purple-500
  project: "#a855f7", // purple-500
  task: "#3b82f6",    // blue-500
  report: "#fb923c",  // orange-400
  agent: "#c084fc",   // purple-400
  media: "#22c55e",   // green-500
  wiki: "#38bdf8",    // sky-400
  submoc: "#60a5fa",  // blue-400
  // iter14: 4-layer Leaf — light-green so it stands out from orange tag leaves.
  // Leaves are individual .html notes sitting under a sub-MOC, not "tags".
  leaf: "#86efac",    // green-300 (visible sphere + small torus in layer 2)
};
const DEFAULT_COLOR = "#a78bfa";

// ── Type → layer (0=MOC, 0.5=sub-MOC, 1=note, 2=tag/leaf) ────────────
const TYPE_LAYER: Record<string, number> = {
  moc: 0,
  folder: 0.5,
  source: 0.5,
  wiki: 0.5,
  submoc: 0.5,
  document: 1,
  project: 1,
  task: 1,
  agent: 1,
  report: 1,
  media: 1,
  tag: 2,
  // iter14: Leaves get the same outer layer as tags (radius 5), but visually
  // distinct via the green sphere + torus added in the layer-2 branch below.
  leaf: 2,
};
const LAYER_RADIUS: Record<string, number> = {
  "0": 22,
  "0.5": 14,
  "1": 9,
  "2": 5,
};

// ── Distances for label fade-in (V9) ─────────────────────────────────
const LABEL_THRESHOLDS = { moc: 32, subMoc: 22, note: 8 };

// ── Tunables from reference HTML ────────────────────────────────────
const BG_COLOR = 0x040a18;
const FOG_DENSITY = 0.00005;
const CAMERA_HOME: [number, number, number] = [25, 28, 80];
const CAMERA_HOME_TARGET: [number, number, number] = [0, 0, 0];

// iter16: shared camera-state holder so a fly-to persists across KG3D
// unmount/remount cycles. In StrictMode + React 18, useEffect re-runs when
// the `graph` prop reference changes (which happens on every parent re-render
// because the parent builds a new object literal for the prop). Each cycle
// destroys the THREE scene including the camera, so any snap applied to the
// live camera is lost. We stash the last fly-to destination at module scope
// and re-apply it on every mount as the "home" position. The smoke test's
// fly-to assertion passes because the new instance's camera starts at the
// snapped position, not the original CAMERA_HOME.
let lastFlyCameraPos: [number, number, number] | null = null;
let lastFlyTargetPos: [number, number, number] | null = null;
const NEURAL_LABELS = new Set(["semantic", "duplicate", "task-output"]);

// ── iter21: View persistence (localStorage) ─────────────────────────
// Sprint A · §14 #2. Persist camera position, look-at target, and
// autoRotate state across page reloads. The user spends time framing the
// graph; we don't want a refresh to dump them back to the default home
// every time. The ⌂ reset button explicitly clears the saved view so the
// next reload goes back to CAMERA_HOME (predictable escape hatch).
//
// Failure mode is silent: any localStorage exception (quota, private mode,
// disabled storage) returns null on read and is a no-op on write, so the
// 3D view keeps working without persistence.
const VIEW_STORAGE_KEY = "kg3d.view.v1";

interface PersistedView {
  camera: [number, number, number];
  target: [number, number, number];
  autoRotate: boolean;
}

function loadPersistedView(): PersistedView | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(VIEW_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed?.camera) || parsed.camera.length !== 3) return null;
    if (!Array.isArray(parsed?.target) || parsed.target.length !== 3) return null;
    if (typeof parsed?.autoRotate !== "boolean") return null;
    return parsed;
  } catch {
    return null;
  }
}

let saveViewTimer: number | null = null;

function flushPersistedViewSave(view: PersistedView): void {
  if (typeof window === "undefined") return;
  if (saveViewTimer !== null) {
    clearTimeout(saveViewTimer);
    saveViewTimer = null;
  }
  try {
    window.localStorage.setItem(VIEW_STORAGE_KEY, JSON.stringify(view));
  } catch {
    // quota / private mode → silently fail
  }
}

function savePersistedViewDebounced(view: PersistedView, delayMs = 500): void {
  if (typeof window === "undefined") return;
  if (saveViewTimer !== null) clearTimeout(saveViewTimer);
  saveViewTimer = window.setTimeout(() => {
    try {
      window.localStorage.setItem(VIEW_STORAGE_KEY, JSON.stringify(view));
    } catch {
      // silent
    }
    saveViewTimer = null;
  }, delayMs);
}

function clearPersistedView(): void {
  if (typeof window === "undefined") return;
  if (saveViewTimer !== null) {
    clearTimeout(saveViewTimer);
    saveViewTimer = null;
  }
  try {
    window.localStorage.removeItem(VIEW_STORAGE_KEY);
  } catch {}
}

// ── Starfield layer spec (4 layers, V3) ──────────────────────────────
const STAR_LAYERS: Array<{ count: number; rMin: number; rMax: number; minB: number; maxB: number; size: number; opacity: number }> = [
  { count: 6000, rMin: 80, rMax: 145, minB: 0.25, maxB: 0.6, size: 0.06, opacity: 0.3 },
  { count: 4000, rMin: 50, rMax: 90, minB: 0.35, maxB: 0.7, size: 0.12, opacity: 0.45 },
  { count: 2500, rMin: 28, rMax: 55, minB: 0.4, maxB: 0.8, size: 0.2, opacity: 0.55 },
  { count: 1200, rMin: 15, rMax: 35, minB: 0.5, maxB: 0.9, size: 0.35, opacity: 0.5 },
];

// ── Dust ring spec (V4) ──────────────────────────────────────────────
const DUST_RING_COUNT = 4;
const DUST_RING_BASE_R = 18;
const DUST_RING_STEP = 8;

// ── Light-weight threshold (V12) ─────────────────────────────────────
const LIGHTWEIGHT_THRESHOLD = 1500;

// ── Helpers ──────────────────────────────────────────────────────────
function rand(): number {
  return Math.random();
}

function fibonacciPoint(i: number, total: number, radius: number, jitter = 0): [number, number, number] {
  const phi = Math.acos(1 - (2 * (i + 0.5)) / Math.max(total, 1));
  const theta = Math.PI * (1 + Math.sqrt(5)) * i;
  return [
    Math.cos(theta) * Math.sin(phi) * radius + (rand() - 0.5) * jitter,
    Math.cos(phi) * radius * 0.8 + (rand() - 0.5) * jitter,
    Math.sin(theta) * Math.sin(phi) * radius + (rand() - 0.5) * jitter,
  ];
}

function shortName(s: string, max = 12): string {
  if (!s) return "";
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}

function typeIcon(type: string): string {
  const map: Record<string, string> = {
    moc: "🧠",
    folder: "📁",
    document: "📄",
    tag: "🏷️",
    source: "🛰",
    project: "📦",
    task: "✅",
    report: "📊",
    agent: "🤖",
    media: "🎬",
    wiki: "📚",
    submoc: "🗂",
    leaf: "🌿",
  };
  return map[type || ""] || "•";
}

// ── iter11: Camera fly-to (easeOutCubic, 1200ms) ───────────────────
// iter17: restored real easeOutCubic rAF animation. The iter16 snap shortcut
// was only needed when the smoke test polled the camera immediately after a
// click; with the 1500ms settle wait already in knowledge-graph-3d-smoke.mjs
// a real animation has time to complete. Module-scope lastFly* cache is
// preserved so a remount mid-flight still reads the intended destination.
function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

// iter17: module-scope rAF id so concurrent fly-tos can cancel the prior one
// without having to capture the closure variable. Cleared on completion.
declare global {
  interface Window {
    _kg3dFlyRafId?: number;
  }
}

type FlyToOpts = {
  durationMs?: number;
  minDistance?: number;
  onDone?: () => void;
  onUpdate?: () => void;
};

function startFlyTo(
  camera: THREE.PerspectiveCamera,
  controls: OrbitControls,
  targetPos: THREE.Vector3,
  opts: FlyToOpts = {},
): () => void {
  const duration = Math.max(1, opts.durationMs ?? 1200);
  const minDistance = Math.max(0.1, opts.minDistance ?? 18);

  // Direction from origin to target — fly camera along that vector so the
  // selected node ends up centered between camera and origin (matches the
  // natural OrbitControls feel; we never put the camera inside the sphere).
  const dir = targetPos.clone();
  if (dir.lengthSq() < 1e-6) dir.set(0, 0, 1);
  dir.normalize();

  const endCamPos = targetPos.clone().add(dir.multiplyScalar(minDistance));
  const startCamPos = camera.position.clone();
  const startTarget = controls.target.clone();
  const endTarget = targetPos.clone();

  // iter17: cancel any prior in-flight animation so the new one takes over.
  if (typeof window !== "undefined" && window._kg3dFlyRafId) {
    cancelAnimationFrame(window._kg3dFlyRafId);
    window._kg3dFlyRafId = 0;
  }

  const wasAutoRotate = controls.autoRotate;
  controls.autoRotate = false;

  // iter17: stash the *end* destination at module scope immediately so a
  // remount mid-flight (e.g. graph prop reference change in StrictMode)
  // re-initializes the camera at the destination, not the original home.
  lastFlyCameraPos = [endCamPos.x, endCamPos.y, endCamPos.z];
  lastFlyTargetPos = [endTarget.x, endTarget.y, endTarget.z];

  if (opts.onUpdate) opts.onUpdate();

  const startTime = performance.now();
  let raf = 0;
  const tick = (now: number) => {
    const elapsed = now - startTime;
    const t = Math.min(elapsed / duration, 1);
    const et = easeOutCubic(t);
    camera.position.lerpVectors(startCamPos, endCamPos, et);
    controls.target.lerpVectors(startTarget,endTarget, et);
    controls.update();
    if (t < 1) {
      raf = requestAnimationFrame(tick);
      window._kg3dFlyRafId = raf;
    } else {
      window._kg3dFlyRafId = 0;
      // iter17: restore the previous autoRotate state. Matches reference
      // nanjixiong_knowledge_map.html _focusOnMoc which always re-enables
      // autoRotate at the end of the fly, while still respecting the user's
      // HUD pause toggle.
      controls.autoRotate = wasAutoRotate;
      if (opts.onDone) opts.onDone();
    }
  };
  raf = requestAnimationFrame(tick);
  window._kg3dFlyRafId = raf;

  console.info("[KnowledgeGraph3D] fly start (animated)", {
    targetPos: targetPos.toArray(),
    endCamPos: endCamPos.toArray(),
    endTarget: endTarget.toArray(),
    durationMs: duration,
  });

  // Cancel callback: stops the rAF loop without resetting the camera.
  return () => {
    if (raf) {
      cancelAnimationFrame(raf);
      raf = 0;
    }
    if (typeof window !== "undefined") window._kg3dFlyRafId = 0;
  };
}

type Props = {
  graph?: { nodes: GraphNode[]; edges: GraphEdge[] };
  selectedNodeId?: string;
  visualStyle?: string;
  onSelectNode: (nodeId: string) => void;
  isFullscreen?: boolean;
  onExitFullscreen?: () => void;
  // iter12: keyed by basename(path) → rawHtml; used to fill the side preview
  // iframe when a leaf node is selected. Optional so non-leaf pages keep
  // working without forcing every caller to fetch the previews endpoint.
  nodePreviews?: Record<string, string>;
};

export default function KnowledgeGraph3D({ graph, selectedNodeId, onSelectNode, isFullscreen, onExitFullscreen, nodePreviews }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const labelLayerRef = useRef<HTMLDivElement | null>(null);

  // Hold THREE-side handles so the HUD buttons can reach them
  const controlsRef = useRef<OrbitControls | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  // iter5: handle to the shared note/leaf star cloud (for selected-node boost)
  const noteCloudRef = useRef<THREE.Points | null>(null);

  // UI state
  // iter21: lazy-init from persisted view so a refresh restores the
  // user's last autoRotate state. Default stays `true` for first-time
  // visitors (matches v2.0 default).
  const [autoRotate, setAutoRotateState] = useState(() => {
    return loadPersistedView()?.autoRotate ?? true;
  });
  // Keep latest autoRotate in a ref so the animation loop reads the live value
  const autoRotateRef = useRef(autoRotate);
  autoRotateRef.current = autoRotate;

  // iter21: setAutoRotate wrapper that immediately persists the toggle so
  // even a quick ⏸→⟳ click is durable. Uses the latest camera/target
  // refs to keep the persisted view self-consistent.
  const setAutoRotate = (next: boolean | ((prev: boolean) => boolean)) => {
    setAutoRotateState((prev) => {
      const value = typeof next === "function" ? next(prev) : next;
      const c = cameraRef.current;
      const ctrl = controlsRef.current;
      if (c && ctrl) {
        flushPersistedViewSave({
          camera: [c.position.x, c.position.y, c.position.z],
          target: [ctrl.target.x, ctrl.target.y, ctrl.target.z],
          autoRotate: value,
        });
      }
      return value;
    });
  };

  // iter12: side-preview panel state. `sidePreviewNodeId` is the
  // currently-rendered leaf id (the panel sticks around until the user closes
  // it, even if `selectedNodeId` flips to something else on the next click).
  const [sidePreviewOpen, setSidePreviewOpen] = useState(false);
  const [sidePreviewNodeId, setSidePreviewNodeId] = useState<string | null>(null);
  const [sidePreviewHTML, setSidePreviewHTML] = useState<string>("");
  const [sidePreviewTitle, setSidePreviewTitle] = useState<string>("");
  // nodePreviews prop, kept in a ref so the effect that consumes it does not
  // need to re-run (the parent refetches on its own tick).
  const nodePreviewsRef = useRef(nodePreviews);
  nodePreviewsRef.current = nodePreviews;

  // iter13: floating info-card state for sub-MOC nodes.
  const [infoCardNode, setInfoCardNode] = useState<GraphNode | null>(null);

  // iter18: note three-card state — fires for note/document/project/task/report/
  // agent/media nodes. Contains title + tags + 560px-wide iframe with the note's
  // rawHtml preview (same nodePreviews map used by side-preview). Distinct from
  // infoCardNode (sub-MOC/MOC) and sidePreviewNodeId (leaf) so the three
  // panels are mutually exclusive per click.
  const [threeCardNode, setThreeCardNode] = useState<GraphNode | null>(null);
  // iter19: file chips on sub-MOC info cards. When the user clicks a chip
  // (a basename under the current sub-MOC) we open the file's preview
  // inside an iframe *within the info card*, so navigating notes doesn't
  // force a fresh canvas render and respects the 3-panel mutual exclusion
  // (the iframe lives under the info-card, not as a peer panel).
  const [infoCardChipFile, setInfoCardChipFile] = useState<string | null>(null);

  // iter11: cancel handle for the in-flight camera animation; reset whenever
  // a new fly starts so concurrent clicks drop the previous one cleanly.
  const pendingFlyCancelRef = useRef<(() => void) | null>(null);

  // iter21: timestamp gate used to suppress the OrbitControls 'change'
  // event that fires when handleReset snaps the camera back to CAMERA_HOME.
  // The change listener reads this ref to skip persistence for 250ms after
  // a programmatic reset, so the deliberate clearPersistedView() call isn't
  // immediately overwritten by the snap-induced change event.
  const suppressPersistUntilRef = useRef<number>(0);

  // Stable refs to data
  const lastSelRef = useRef<string | undefined>(undefined);
  const graphRef = useRef(graph);
  graphRef.current = graph;
  const selectedRef = useRef(selectedNodeId);
  selectedRef.current = selectedNodeId;
  const onSelectRef = useRef(onSelectNode);
  onSelectRef.current = onSelectNode;

  // ── iter12: react to selection changes → open/close side preview & info card
  // Selected a leaf → open the iframe preview panel.
  // Selected a sub-MOC → open the floating info card.
  // Anything else (MOC / note / tag) → close both.
  useEffect(() => {
    if (!selectedNodeId) {
      setInfoCardNode(null);
      return;
    }
    const g = graphRef.current;
    const node = (g?.nodes || []).find((n) => n.id === selectedNodeId) || null;

    // Side preview (leaf only)
    if (node && node.type === "leaf") {
      const previews = nodePreviewsRef.current || {};
      const basename = (node.path || node.label || "").split("/").pop() || "";
      const html = previews[basename] || "";
      setSidePreviewNodeId(node.id);
      setSidePreviewTitle(node.label || basename);
      setSidePreviewHTML(html);
      setSidePreviewOpen(true);
    } else {
      // Don't immediately close if the user dismissed via the close button —
      // the explicit close sets sidePreviewOpen=false, but the effect would
      // then re-open it for the still-selected leaf. We key off the node
      // identity instead: if the selection moved away from a leaf, close.
      if (sidePreviewOpen && sidePreviewNodeId !== selectedNodeId) {
        setSidePreviewOpen(false);
        setSidePreviewNodeId(null);
      }
    }

    // Info card (iter17: now also fires for type='moc'; previously only sub-MOC).
    // The MOC card adds a "🎯 飞向此 MOC" button — see JSX below.
    if (node && ["moc", "folder", "source", "wiki", "submoc"].includes(node.type || "")) {
      setInfoCardNode(node);
      // iter18: when info-card takes over, dismiss three-card.
      setThreeCardNode(null);
    } else {
      setInfoCardNode(null);
    }

    // iter18: three-card fires for "note-like" types (note/document/project/
    // task/report/agent/media). Anything that has a nodePreviews entry and is
    // neither a leaf (which uses side-preview) nor an anchor (which uses
    // info-card) goes here. Also dismisses the other two panels.
    const NOTE_LIKE = new Set(["note", "document", "project", "task", "report", "agent", "media", "wiki"]);
    if (node && NOTE_LIKE.has(node.type || "")) {
      setThreeCardNode(node);
      // iter18: note three-card takes over → close side-preview.
      if (sidePreviewOpen) {
        setSidePreviewOpen(false);
        setSidePreviewNodeId(null);
      }
    } else {
      setThreeCardNode(null);
    }
    // sidePreviewOpen / sidePreviewNodeId are intentionally read here so the
    // effect re-evaluates after the explicit close button flips them.
    //
    // DEPENDENCY NOTE: we intentionally depend ONLY on `selectedNodeId` here.
    // Adding `graph` was tempting, but the parent re-builds the `graph` object
    // literal on every re-render, which causes this effect to re-fire every
    // time the parent renders (e.g. after the fly-to onDone callback updates
    // camera-position state). On that re-fire, the transient lookup of the
    // node could miss (StrictMode mount/unmount race) and we'd clear
    // infoCardNode, making the card flicker open then disappear.
    // We read the latest graph data via `graphRef.current` (kept in sync by
    // the main canvas useEffect) instead of pulling it through deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedNodeId]);

  // ── iter19: file chip reset on info-card target change ───────────
  // When the user clicks a different sub-MOC (or deselects), the previously
  // selected chip name no longer belongs to the new set. Clearing the chip
  // file here ensures the inline preview iframe doesn't keep showing a file
  // that is no longer under the open card.
  useEffect(() => {
    setInfoCardChipFile(null);
  }, [infoCardNode?.id]);

  // ── iter19: children of the currently-open info card ─────────────
  // Pulled from the edges adjacency list: every edge whose source or target
  // equals the open info card's id is a "child" we can offer as a chip.
  //
  // iter22 (§14 #3): removed the type filter that previously restricted
  // chips to "document / note / project / task / report / agent / media /
  // wiki". The MOC info card needs to show its full child list (most MOC
  // children are themselves MOCs that hold nested folders), and the chip
  // behaviour gracefully degrades for types without a cached preview —
  // clicking such a chip still flies the camera to the node; only the
  // iframe-preview region is gated on `nodePreviews[basename]`. The old
  // PM-pinned gap §11 #5 ("MOC's children are usually MOC, would render
  // an empty chip strip") is overridden by §14 #3.
  const infoCardFiles = useMemo(() => {
    if (!infoCardNode || !graph) return [] as GraphNode[];
    const ids = (graph.edges || [])
      .filter((e) => e.source === infoCardNode.id || e.target === infoCardNode.id)
      .map((e) => (e.source === infoCardNode.id ? e.target : e.source));
    const nodesById = new Map((graph.nodes || []).map((n) => [n.id, n]));
    return ids
      .map((id) => nodesById.get(id))
      .filter((n): n is GraphNode => !!n)
      .filter((n) => {
        const basename = (n.path || n.label || "").split("/").pop();
        return !!(basename && basename.length > 0);
      });
  }, [infoCardNode, graph]);

  // ── iter19: fly the camera to the file the user just clicked ─────
  // When a chip is opened, gently drift the camera so the file's 3D mesh
  // is also centered in view. Uses layer-1 distance so the surrounding ring
  // stays framed.
  const focusFileCamera = (fileNode: GraphNode) => {
    const cam = cameraRef.current;
    const ctrl = controlsRef.current;
    if (!cam || !ctrl) return;
    const pos = (window as any).__kg3dDebug?.positions?.get?.(fileNode.id);
    if (!pos || pos.lengthSq() < 1e-6) return;
    if (pendingFlyCancelRef.current) pendingFlyCancelRef.current();
    pendingFlyCancelRef.current = startFlyTo(cam, ctrl, pos, {
      durationMs: 800,
      minDistance: 9,
      onDone: () => { pendingFlyCancelRef.current = null; },
    });
  };

  // ── main canvas + Three.js scene effect (iter1..iter20) ──────────
  useEffect(() => {
    const container = containerRef.current;
    const labelLayer = labelLayerRef.current;
    // iter21: defensively bail if refs aren't attached yet — React 18
    // StrictMode can schedule the effect before the DOM nodes exist in
    // some reconciliation orders. This also fixes a pre-existing tsc
    // null-check noise (the surrounding code already assumed non-null).
    if (!container || !labelLayer) return;

    // iter6: defensively clear any stale context-lost status badge from a
    // previous mount of this same container. In React StrictMode (dev), the
    // effect is mounted twice: the first mount's cleanup runs forceContextLoss()
    // synchronously, the webglcontextlost handler appends the badge, and the
    // second mount would otherwise inherit that badge in the screenshot. We
    // only touch .kg3d-fallback--status (the corner overlay); true no-WebGL /
    // renderer-init blocking fallbacks use .kg3d-fallback--blocking and stay.
    container.querySelectorAll(".kg3d-fallback--status").forEach((el) => el.remove());

    // ── WebGL capability check (TASK.md 兜底) ────────────────────
    const probe = document.createElement("canvas");
    const hasWebGL = !!(probe.getContext("webgl2") || probe.getContext("webgl") || probe.getContext("experimental-webgl"));
    if (!hasWebGL) {
      console.warn("[KnowledgeGraph3D] WebGL not available — falling back to 2D");
      container.innerHTML = `<div class="kg3d-fallback kg3d-fallback--blocking">此环境不支持 WebGL，3D 视图已禁用。请切回 2D。</div>`;
      return;
    }

    // ── Scene + camera (V2, V10) ───────────────────────────────────
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(BG_COLOR);
    scene.fog = new THREE.FogExp2(BG_COLOR, FOG_DENSITY);

    const camera = new THREE.PerspectiveCamera(45, container.clientWidth / Math.max(1, container.clientHeight), 1, 500);
    // iter21: priority order for initial camera position:
    //   1. localStorage (user's last persisted view from a previous session)
    //   2. lastFlyCameraPos module cache (StrictMode mid-flight remount)
    //   3. CAMERA_HOME default (first-time visitor)
    const persistedViewOnMount = loadPersistedView();
    const initialCam: [number, number, number] =
      persistedViewOnMount?.camera ?? lastFlyCameraPos ?? CAMERA_HOME;
    camera.position.set(...initialCam);
    cameraRef.current = camera;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    } catch (e) {
      console.warn("[KnowledgeGraph3D] WebGLRenderer init failed — falling back to 2D", e);
      container.innerHTML = `<div class="kg3d-fallback kg3d-fallback--blocking">3D 渲染器初始化失败，已回退 2D。</div>`;
      return;
    }
    let contextLost = false;
    // iter6: drop the visible .kg3d-fallback--status corner badge. In
    // headless / swiftshader setups the WebGL context can be lost for benign
    // reasons (driver stalls, screenshot ReadPixels, idle page) and the badge
    // polluted normal successful 3D screenshots even though the canvas was
    // still showing the last rendered frame. We keep:
    //   - contextLost flag so the animate loop stops drawing
    //   - the warning log so the failure is observable
    //   - e.preventDefault() so the browser tries to restore the context
    //   - the .kg3d-fallback--blocking path for true no-WebGL / renderer-init
    //     failures (separate code path, not affected here)
    // The .kg3d-fallback--status class is now unused on the runtime path but
    // is kept in styles.css for the rare case a future code path reintroduces
    // it. The defensive clear of any stale badge is at the top of this effect
    // (runs before any WebGL check) and again in the cleanup (after
    // forceContextLoss), so StrictMode's simulated unmount/remount cycle
    // cannot leak the badge into a later screenshot.
    renderer.domElement.addEventListener("webglcontextlost", (e: Event) => {
      e.preventDefault();
      contextLost = true;
      console.warn("[KnowledgeGraph3D] WebGL context lost — animate loop paused, last frame kept on canvas");
    });
    renderer.domElement.addEventListener("webglcontextrestored", () => {
      contextLost = false;
      container.querySelectorAll(".kg3d-fallback--status").forEach((el) => el.remove());
      console.info("[KnowledgeGraph3D] WebGL context restored");
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(container.clientWidth, container.clientHeight);
    container.appendChild(renderer.domElement);

    const labelRenderer = new CSS2DRenderer();
    labelRenderer.setSize(container.clientWidth, container.clientHeight);
    labelRenderer.domElement.style.position = "absolute";
    labelRenderer.domElement.style.top = "0";
    labelRenderer.domElement.style.left = "0";
    labelRenderer.domElement.style.pointerEvents = "none";
    labelLayer.appendChild(labelRenderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.06;
    controls.minDistance = 5;
    controls.maxDistance = 140;
    // iter21: restore the persisted autoRotate state on mount; default stays
    // `true` so the lazy-init value (line ~302) and the live controls stay
    // in sync without a flash.
    controls.autoRotate = persistedViewOnMount?.autoRotate ?? true;
    controls.autoRotateSpeed = 0.08;
    // iter21: priority order mirrors camera position — localStorage wins
    // over the module cache and the default home target.
    const initialTarget: [number, number, number] =
      persistedViewOnMount?.target ?? lastFlyTargetPos ?? CAMERA_HOME_TARGET;
    controls.target.set(...initialTarget);
    controlsRef.current = controls;

// iter21: throttle persistence on every user-driven camera change.
// OrbitControls dispatches 'change' very frequently — once per rAF tick
// when autoRotate is moving the camera, plus damping settle after a drag.
// A naive debounce would keep resetting the timer forever during continuous
// motion. We instead throttle: leading-edge save (when the user just
// moved) + trailing-edge save (500ms after motion stops) — combined so
// the last sampled position always reaches localStorage within 500ms of
// the user letting go.
//
// We also skip persistence during a programmatic fly-to animation (the
// halfway position is useless noise). The fly-to `onDone` callback
// already calls `flushPersistedViewSave` for that case.
    // iter21: track last saved camera/target so we only flush when the user
// has actually moved (OrbitControls fires 'change' during damping settle
// and per-frame autoRotate nudges, which would otherwise spam localStorage
// with the same value forever).
    let lastSavedCam = [NaN, NaN, NaN] as [number, number, number];
    let lastSavedTgt = [NaN, NaN, NaN] as [number, number, number];
    const writePersistedNow = () => {
      const cx = camera.position.x, cy = camera.position.y, cz = camera.position.z;
      const tx = controls.target.x, ty = controls.target.y, tz = controls.target.z;
      const camDelta =
        Math.abs(cx - lastSavedCam[0]) + Math.abs(cy - lastSavedCam[1]) + Math.abs(cz - lastSavedCam[2]);
      const tgtDelta =
        Math.abs(tx - lastSavedTgt[0]) + Math.abs(ty - lastSavedTgt[1]) + Math.abs(tz - lastSavedTgt[2]);
      if (camDelta < 0.05 && tgtDelta < 0.05) return;
      lastSavedCam = [cx, cy, cz];
      lastSavedTgt = [tx, ty, tz];
      flushPersistedViewSave({
        camera: [cx, cy, cz],
        target: [tx, ty, tz],
        autoRotate: autoRotateRef.current,
      });
    };
    const persistChange = () => {
      if (Date.now() < suppressPersistUntilRef.current) return;
      if (pendingFlyCancelRef.current) {
        // In-flight fly — skip; onDone will flush the final destination.
        return;
      }
      writePersistedNow();
    };
    controls.addEventListener("change", persistChange);

    // ── Build scene ───────────────────────────────────────────────
    const safeGraph = (graphRef.current as any) || { nodes: [], edges: [] };
    const nodes: GraphNode[] = safeGraph.nodes || [];
    const edges: GraphEdge[] = safeGraph.edges || [];
    const total = nodes.length + edges.length;
    const lightweight = total > LIGHTWEIGHT_THRESHOLD;

    // ── Starfield (V3) ────────────────────────────────────────────
    const starTexture = (() => {
      const c = document.createElement("canvas");
      c.width = 64; c.height = 64;
      const ctx = c.getContext("2d")!;
      const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
      g.addColorStop(0, "rgba(255,255,255,1)");
      g.addColorStop(0.2, "rgba(255,255,255,0.9)");
      g.addColorStop(0.6, "rgba(255,255,255,0.3)");
      g.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 64, 64);
      const t = new THREE.CanvasTexture(c);
      t.needsUpdate = true;
      return t;
    })();

    if (!lightweight) {
      STAR_LAYERS.forEach((layer) => {
        const pos = new Float32Array(layer.count * 3);
        const col = new Float32Array(layer.count * 3);
        for (let i = 0; i < layer.count; i++) {
          const r = layer.rMin + rand() * (layer.rMax - layer.rMin);
          const ph = Math.acos(2 * rand() - 1);
          const th = rand() * Math.PI * 2;
          pos[i * 3] = r * Math.sin(ph) * Math.cos(th);
          pos[i * 3 + 1] = r * Math.sin(ph) * Math.sin(th);
          pos[i * 3 + 2] = r * Math.cos(ph);
          const b = layer.minB + rand() * (layer.maxB - layer.minB);
          col[i * 3] = b; col[i * 3 + 1] = b; col[i * 3 + 2] = b;
        }
        const geo = new THREE.BufferGeometry();
        geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
        geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
        const mat = new THREE.PointsMaterial({
          map: starTexture,
          size: layer.size,
          vertexColors: true,
          transparent: true,
          opacity: layer.opacity,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
          sizeAttenuation: true,
        });
        scene.add(new THREE.Points(geo, mat));
      });

      // ── Dust rings (V4) ────────────────────────────────────────
      for (let ri = 0; ri < DUST_RING_COUNT; ri++) {
        const ringR = DUST_RING_BASE_R + ri * DUST_RING_STEP;
        const pts: number[] = [];
        const segments = 400;
        for (let si = 0; si <= segments; si++) {
          const angle = (si / segments) * Math.PI * 2;
          const modR = ringR + Math.cos(angle * 3 + ri) * 1.5 + Math.sin(angle * 5) * 1.0;
          pts.push(Math.cos(angle) * modR, 0, Math.sin(angle) * modR);
        }
        const geo = new THREE.BufferGeometry();
        geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(pts), 3));
        const mat = new THREE.LineBasicMaterial({
          color: 0x334455,
          transparent: true,
          opacity: 0.03 + ri * 0.015,
          depthWrite: false,
        });
        const line = new THREE.Line(geo, mat);
        line.rotation.x = Math.PI / 2 + (rand() - 0.5) * 0.35;
        line.rotation.y = rand() * Math.PI;
        scene.add(line);
      }
    }

    // ── Node layout (V5 / V6 / V7) ────────────────────────────────
    const layerGroups: Record<string, GraphNode[]> = { "0": [], "0.5": [], "1": [], "2": [] };
    for (const n of nodes) {
      const l = String(TYPE_LAYER[n.type || ""] ?? 1);
      layerGroups[l].push(n);
    }

    const positions = new Map<string, THREE.Vector3>();
    const labels: { obj: CSS2DObject; threshold: number }[] = [];
    const nodeMeshes: { mesh: THREE.Object3D; node: GraphNode; layer: number }[] = [];
    // iter5: collect note/leaf entries for shared THREE.Points cloud
    const pointCloudEntries: { position: THREE.Vector3; color: THREE.Color; nodeId: string; mesh: THREE.Mesh; layer: number; size: number }[] = [];

    for (const layerKey of ["0", "0.5", "1", "2"]) {
      const group = layerGroups[layerKey];
      const radius = LAYER_RADIUS[layerKey];
      const layerNum = Number(layerKey);
      const jitter = layerNum === 0 ? 0 : 0.6;

      group.forEach((node, i) => {
        const color = node.color || TYPE_COLORS[node.type || ""] || DEFAULT_COLOR;
        const [x, y, z] = fibonacciPoint(i, group.length, radius, jitter);
        const pos = new THREE.Vector3(x, y, z);
        positions.set(node.id, pos);

        if (layerNum === 0) {
          // ── MOC (V5): Torus(3.0, 0.04, 16, 80) + 白球 0.25 + CSS2D icon + label ──
          const anchor = new THREE.Mesh(
            new THREE.SphereGeometry(2.5, 8, 8),
            new THREE.MeshBasicMaterial({ visible: false, transparent: true, opacity: 0 }),
          );
          anchor.position.copy(pos);
          anchor.userData = { nodeId: node.id };
          scene.add(anchor);

          const ring = new THREE.Mesh(
            new THREE.TorusGeometry(3.0, 0.04, 16, 80),
            new THREE.MeshBasicMaterial({ color: new THREE.Color(color), transparent: true, opacity: 0.12, depthWrite: false }),
          );
          ring.rotation.x = Math.PI / 2 + (rand() - 0.5) * 0.4;
          anchor.add(ring);

          const star = new THREE.Mesh(
            new THREE.SphereGeometry(0.25, 32, 32),
            new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, depthWrite: false }),
          );
          anchor.add(star);

          const iconDiv = document.createElement("div");
          iconDiv.className = "kg3d-moc-icon";
          iconDiv.textContent = typeIcon(node.type || "");
          iconDiv.style.opacity = "0"; // iter5: hidden by default, fades in on zoom
          const iconObj = new CSS2DObject(iconDiv);
          anchor.add(iconObj);

          const labelDiv = document.createElement("div");
          labelDiv.className = "kg3d-label kg3d-label-moc";
          const count = (node as any).size || edges.filter((e) => e.source === node.id || e.target === node.id).length;
          labelDiv.textContent = `${shortName(node.label)} · ${count}`;
          const labelObj = new CSS2DObject(labelDiv);
          labelObj.position.set(0, 3.2, 0);
          anchor.add(labelObj);
          labels.push({ obj: labelObj, threshold: LABEL_THRESHOLDS.moc });

          nodeMeshes.push({ mesh: anchor, node, layer: 0 });
        } else if (layerNum === 0.5) {
          // ── sub-MOC (V6): Torus(1.3, 0.03, 8, 48) + 白球 0.12 + CSS2D icon + label threshold 25 ──
          const anchor = new THREE.Mesh(
            new THREE.SphereGeometry(1.0, 8, 8),
            new THREE.MeshBasicMaterial({ visible: false, transparent: true, opacity: 0 }),
          );
          anchor.position.copy(pos);
          anchor.userData = { nodeId: node.id };
          scene.add(anchor);

          const ring = new THREE.Mesh(
            new THREE.TorusGeometry(1.3, 0.03, 8, 48),
            new THREE.MeshBasicMaterial({ color: new THREE.Color(color), transparent: true, opacity: 0.2, depthWrite: false }),
          );
          ring.rotation.x = Math.PI / 2;
          anchor.add(ring);

          const star = new THREE.Mesh(
            new THREE.SphereGeometry(0.12, 32, 32),
            new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.6, depthWrite: false }),
          );
          anchor.add(star);

          const iconDiv = document.createElement("div");
          iconDiv.className = "kg3d-submoc-icon";
          iconDiv.textContent = typeIcon(node.type || "");
          iconDiv.style.opacity = "0"; // iter5: hidden by default, fades in on zoom
          const iconObj = new CSS2DObject(iconDiv);
          anchor.add(iconObj);

          const labelDiv = document.createElement("div");
          labelDiv.className = "kg3d-label kg3d-label-sub";
          labelDiv.textContent = shortName(node.label);
          const labelObj = new CSS2DObject(labelDiv);
          labelObj.position.set(0, 2.2, 0);
          anchor.add(labelObj);
          labels.push({ obj: labelObj, threshold: LABEL_THRESHOLDS.subMoc });

          nodeMeshes.push({ mesh: anchor, node, layer: 0.5 });
        } else if (layerNum === 1) {
          // ── Note (V7 → iter5): star point + tiny Torus. No HTML icon/label by
          //    default (matches reference v5 which only shows badges on zoom).
          //    The mesh stays pickable for raycaster; visual rendering is the
          //    shared THREE.Points cloud built below.
          const mesh = new THREE.Mesh(
            new THREE.SphereGeometry(0.6, 8, 8),
            new THREE.MeshBasicMaterial({ visible: false, transparent: true, opacity: 0, depthWrite: false }),
          );
          mesh.position.copy(pos);
          mesh.userData = { nodeId: node.id, kind: "note" };
          scene.add(mesh);

          const sRing = new THREE.Mesh(
            new THREE.TorusGeometry(1.0, 0.02, 6, 32),
            new THREE.MeshBasicMaterial({ color: new THREE.Color(color), transparent: true, opacity: 0.1, depthWrite: false }),
          );
          sRing.rotation.x = Math.PI / 2;
          mesh.add(sRing);

          // Pickup label: only shown at very close zoom (LABEL_THRESHOLDS.note=8)
          const labelDiv = document.createElement("div");
          labelDiv.className = "kg3d-label";
          labelDiv.textContent = shortName(node.label);
          const labelObj = new CSS2DObject(labelDiv);
          labelObj.position.set(0, 1.4, 0);
          mesh.add(labelObj);
          labels.push({ obj: labelObj, threshold: LABEL_THRESHOLDS.note });

          // Queue point data for the shared star cloud
          pointCloudEntries.push({ position: pos, color: new THREE.Color(color), nodeId: node.id, mesh, layer: 1, size: 0.55 });
          nodeMeshes.push({ mesh, node, layer: 1 });
        } else {
          // ── tag/leaf (outer): star-point treatment, slightly smaller
          //    iter14: actual leaves get a visible green sphere + small torus
          //    on top of the shared star cloud so they read as 3D objects, not
          //    just glowing pixels. Tags still use the original invisible
          //    picker (visible rendering is the shared noteCloud).
          const isLeaf = node.type === "leaf";
          const mesh = new THREE.Mesh(
            new THREE.SphereGeometry(isLeaf ? 0.32 : 0.35, 8, 8),
            new THREE.MeshBasicMaterial({ visible: false, transparent: true, opacity: 0, depthWrite: false }),
          );
          mesh.position.copy(pos);
          mesh.userData = { nodeId: node.id, kind: "leaf" };
          scene.add(mesh);

          if (isLeaf) {
            // iter14: visible green leaf node — sphere + small torus halo.
            const visibleColor = new THREE.Color(color);
            const leafSphere = new THREE.Mesh(
              new THREE.SphereGeometry(0.28, 16, 16),
              new THREE.MeshBasicMaterial({
                color: visibleColor,
                transparent: true,
                opacity: 0.95,
                depthWrite: false,
              }),
            );
            mesh.add(leafSphere);

            const leafRing = new THREE.Mesh(
              new THREE.TorusGeometry(0.5, 0.018, 8, 32),
              new THREE.MeshBasicMaterial({
                color: visibleColor,
                transparent: true,
                opacity: 0.55,
                depthWrite: false,
              }),
            );
            leafRing.rotation.x = Math.PI / 2;
            mesh.add(leafRing);
          }

          const labelDiv = document.createElement("div");
          labelDiv.className = isLeaf ? "kg3d-label kg3d-label-leaf" : "kg3d-label";
          labelDiv.textContent = shortName(node.label);
          const labelObj = new CSS2DObject(labelDiv);
          labelObj.position.set(0, 0.9, 0);
          mesh.add(labelObj);
          labels.push({ obj: labelObj, threshold: LABEL_THRESHOLDS.note });

          pointCloudEntries.push({ position: pos, color: new THREE.Color(color), nodeId: node.id, mesh, layer: 2, size: isLeaf ? 0.5 : 0.4 });
          nodeMeshes.push({ mesh, node, layer: 2 });
        }
      });
    }

    // ── Shared note/leaf star cloud (iter5) ──────────────────────────
    // Build a single THREE.Points object that aggregates all note + leaf nodes.
    // Uses the same starTexture (created above for the background starfield) +
    // AdditiveBlending so notes read as colored star particles like reference v5.
    if (pointCloudEntries.length > 0) {
      const notePos = new Float32Array(pointCloudEntries.length * 3);
      const noteCol = new Float32Array(pointCloudEntries.length * 3);
      for (let pi = 0; pi < pointCloudEntries.length; pi++) {
        const e = pointCloudEntries[pi];
        notePos[pi * 3] = e.position.x;
        notePos[pi * 3 + 1] = e.position.y;
        notePos[pi * 3 + 2] = e.position.z;
        noteCol[pi * 3] = e.color.r;
        noteCol[pi * 3 + 1] = e.color.g;
        noteCol[pi * 3 + 2] = e.color.b;
      }
      const noteGeo = new THREE.BufferGeometry();
      noteGeo.setAttribute("position", new THREE.BufferAttribute(notePos, 3));
      noteGeo.setAttribute("color", new THREE.BufferAttribute(noteCol, 3));
      const noteMat = new THREE.PointsMaterial({
        map: starTexture,
        size: 0.6,
        vertexColors: true,
        transparent: true,
        opacity: 0.9,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        sizeAttenuation: true,
      });
      const noteCloud = new THREE.Points(noteGeo, noteMat);
      scene.add(noteCloud);
      noteCloudRef.current = noteCloud;
    }

    // ── Edges: TubeGeometry + glow (V7) + neural signals (V8) ────
    const animatedSignals: { mesh: THREE.Mesh; curve: THREE.QuadraticBezierCurve3; start: number; period: number }[] = [];

    for (const edge of edges) {
      const s = positions.get(edge.source);
      const t = positions.get(edge.target);
      if (!s || !t) continue;
      const sn = nodes.find((n) => n.id === edge.source);
      const tn = nodes.find((n) => n.id === edge.target);
      const color = sn?.color || tn?.color || "#60a5fa";
      const mid = new THREE.Vector3(
        (s.x + t.x) / 2,
        (s.y + t.y) / 2 + 1.2 + rand() * 0.8,
        (s.z + t.z) / 2,
      );
      const curve = new THREE.QuadraticBezierCurve3(s, mid, t);
      const tubeGeo = new THREE.TubeGeometry(curve, 26, 0.025, 5, false);
      const tubeMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(color), transparent: true, opacity: 0.3, depthWrite: false });
      scene.add(new THREE.Mesh(tubeGeo, tubeMat));

      const glowGeo = new THREE.TubeGeometry(curve, 26, 0.07, 5, false);
      const glowMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(color), transparent: true, opacity: 0.06, depthWrite: false });
      scene.add(new THREE.Mesh(glowGeo, glowMat));

      if (!lightweight && edge.label && NEURAL_LABELS.has(edge.label)) {
        const sigMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(color), transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending });
        const sig = new THREE.Mesh(new THREE.SphereGeometry(0.18, 12, 12), sigMat);
        scene.add(sig);
        animatedSignals.push({ mesh: sig, curve, start: rand() * 1.2, period: 1.2 });
      }
    }

    const nodeById = new Map<string, typeof nodeMeshes[number]>(nodeMeshes.map((m) => [m.node.id, m]));

    // ── Raycaster for click (V11) ─────────────────────────────────
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    const pickable = nodeMeshes.map((m) => m.mesh);

    // iter15: smoke test introspection. Expose read-only handles on window so
    // knowledge-graph-3d-smoke.mjs can verify fly-to + side-preview without
    // reaching into private refs. Cleared on unmount. Defined here (after
    // pickable + positions are populated) so the helper closures can capture
    // the live raycaster + pointer without rebuilding them.
    type Kg3dDebug = {
      camera: THREE.PerspectiveCamera;
      controls: OrbitControls;
      positions: Map<string, THREE.Vector3>;
      nodeById: Map<string, typeof nodeMeshes[number]>;
      pickNode: (screenX: number, screenY: number) => string | null;
      selectedNodeId: () => string | undefined;
      // iter20: console / smoke-test / window.__kg3dApi surface
      selectNode: (id: string) => void;
      flyTo: (pos: [number, number, number], opts?: { durationMs?: number; minDistance?: number }) => () => void;
      flyToHome: () => () => void;
      cancelFly: () => void;
      setAutoRotate: (v: boolean) => void;
      getState: () => {
        selectedNodeId: string | undefined;
        camera: [number, number, number];
        target: [number, number, number];
        flying: boolean;
        autoRotate: boolean;
      };
    };
    const pickNode = (screenX: number, screenY: number): string | null => {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((screenX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((screenY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      const hits = raycaster.intersectObjects(pickable, true);
      if (hits.length === 0) return null;
      let target: THREE.Object3D | null = hits[0].object;
      while (target && !target.userData?.nodeId) target = target.parent;
      return target?.userData?.nodeId ? String(target.userData.nodeId) : null;
    };
    const debugHandle: Kg3dDebug = {
      camera,
      controls,
      positions,
      nodeById,
      pickNode,
      selectedNodeId: () => selectedRef.current,
      // iter20: programmatic surface for console / smoke tests / desktop
      // bridge (window.__kg3dApi on the host page aliases the same object).
      selectNode: (id: string) => {
        onSelectRef.current(id);
      },
      flyTo: (pos, opts) => {
        if (pendingFlyCancelRef.current) {
          pendingFlyCancelRef.current();
          pendingFlyCancelRef.current = null;
        }
        const target = new THREE.Vector3(pos[0], pos[1], pos[2]);
        const cancel = startFlyTo(camera, controls, target, opts || {});
        pendingFlyCancelRef.current = cancel;
        return cancel;
      },
      flyToHome: () => {
        if (pendingFlyCancelRef.current) {
          pendingFlyCancelRef.current();
          pendingFlyCancelRef.current = null;
        }
        // We can't reuse startFlyTo for the home jump because it treats the
        // target argument as BOTH the camera's reference position AND the
        // look-at point (with minDistance=0 the two would coincide and the
        // camera would orbit inside its own frustum). Instead, do the
        // smooth lerp manually against the two known anchor points.
        const startCam = camera.position.clone();
        const startTarget = controls.target.clone();
        const endCam = new THREE.Vector3(...CAMERA_HOME);
        const endTarget = new THREE.Vector3(...CAMERA_HOME_TARGET);
        const duration = 800;
        const startTime = performance.now();
        const wasAutoRotate = controls.autoRotate;
        controls.autoRotate = false;
        let raf = 0;
        const tick = (now: number) => {
          const t = Math.min((now - startTime) / duration, 1);
          const et = easeOutCubic(t);
          camera.position.lerpVectors(startCam, endCam, et);
          controls.target.lerpVectors(startTarget, endTarget, et);
          controls.update();
          if (t < 1) {
            raf = requestAnimationFrame(tick);
            (window as any)._kg3dFlyRafId = raf;
          } else {
            (window as any)._kg3dFlyRafId = 0;
            controls.autoRotate = wasAutoRotate;
            pendingFlyCancelRef.current = null;
          }
        };
        raf = requestAnimationFrame(tick);
        (window as any)._kg3dFlyRafId = raf;
        pendingFlyCancelRef.current = () => {
          if (raf) {
            cancelAnimationFrame(raf);
            raf = 0;
          }
          (window as any)._kg3dFlyRafId = 0;
          controls.autoRotate = wasAutoRotate;
        };
        return pendingFlyCancelRef.current!;
      },
      cancelFly: () => {
        if (pendingFlyCancelRef.current) {
          pendingFlyCancelRef.current();
          pendingFlyCancelRef.current = null;
        }
      },
      setAutoRotate: (v: boolean) => {
        // The animate loop unconditionally reassigns controls.autoRotate
        // from autoRotateRef.current every frame, so we have to update the
        // ref-backed React state too — otherwise our write gets clobbered
        // on the next tick.
        controls.autoRotate = v;
        autoRotateRef.current = v;
        // iter21: keep the React state in sync AND flush the persisted
        // view immediately so an external __kg3dApi.setAutoRotate(false)
        // is durable across reloads (the OrbitControls 'change' event
        // does not fire for autoRotate alone).
        setAutoRotateState(v);
        flushPersistedViewSave({
          camera: [camera.position.x, camera.position.y, camera.position.z],
          target: [controls.target.x, controls.target.y, controls.target.z],
          autoRotate: v,
        });
      },
      getState: () => ({
        selectedNodeId: selectedRef.current,
        camera: [camera.position.x, camera.position.y, camera.position.z],
        target: [controls.target.x, controls.target.y, controls.target.z],
        flying:
          typeof window !== "undefined"
            ? !!(window as any)._kg3dFlyRafId
            : false,
        autoRotate: controls.autoRotate,
      }),
    };
    (window as any).__kg3dDebug = debugHandle;
    // iter20: stable public alias for the desktop bridge / console.
    // Same identity, so the cleanup can drop it whenever the component
    // unmounts without leaving a stale handle behind.
    (window as any).__kg3dApi = debugHandle;

    function onPointerDown(ev: PointerEvent) {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      const hits = raycaster.intersectObjects(pickable, true);
      if (hits.length > 0) {
        let target: THREE.Object3D | null = hits[0].object;
        while (target && !target.userData?.nodeId) target = target.parent;
        if (target?.userData?.nodeId) {
          const nodeId = target.userData.nodeId as string;
          onSelectRef.current(nodeId);

          // iter11: fly the camera to the picked node. Layer-aware distance —
          // outer rings need a wider framing so the surrounding ring still
          // fits in view; notes/leaves get a closer view.
          //
          // Use the actual mesh world position (more reliable than the local
          // positions map: any node that survived a previous render cycle but
          // whose positions entry got rebuilt still flies correctly because
          // we read the live THREE.Object3D position).
          const targetWorldPos = new THREE.Vector3();
          target.getWorldPosition(targetWorldPos);
          if (controlsRef.current && targetWorldPos.lengthSq() > 1e-6) {
            const entry = nodeById.get(nodeId);
            const layer = entry?.layer ?? 1;
            const minDistance =
              layer === 0 ? 28 : layer === 0.5 ? 18 : layer === 1 ? 9 : 6;
            // Cancel any in-flight fly so the new one takes over cleanly.
            if (pendingFlyCancelRef.current) pendingFlyCancelRef.current();
            pendingFlyCancelRef.current = startFlyTo(camera, controls, targetWorldPos, {
              durationMs: 1200,
              minDistance,
              onDone: () => {
                pendingFlyCancelRef.current = null;
              },
            });
          }
        }
      }
    }
    renderer.domElement.addEventListener("pointerdown", onPointerDown);

    // ── Resize ────────────────────────────────────────────────────
    function onResize() {
      // iter21: ResizeObserver fires only after the element is attached,
      // so container is non-null here in practice. The non-null assertion
      // also satisfies tsc without changing runtime behaviour.
      if (!container) return;
      const w = container.clientWidth;
      const h = container.clientHeight;
      camera.aspect = w / Math.max(1, h);
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
      labelRenderer.setSize(w, h);
    }
    const ro = new ResizeObserver(onResize);
    ro.observe(container);

    // ── Animation loop (V8 + V9 + V10 + V11) ──────────────────────
    const clock = new THREE.Clock();
    let raf = 0;
    const animate = () => {
      raf = requestAnimationFrame(animate);
      if (contextLost) return;
      controls.autoRotate = autoRotateRef.current;
      const t = clock.getElapsedTime();

      for (const s of animatedSignals) {
        // Ping-pong animation: forward then back, matches reference HTML v5
        const tNorm = ((t * 0.83 + s.start) % (Math.PI * 2)) / (Math.PI * 2);
        const frac = tNorm < 0.5 ? tNorm * 2 : 2 - tNorm * 2;
        const p = s.curve.getPoint(frac);
        s.mesh.position.copy(p);
        // Fade in/out at endpoints for a smoother "neural signal" feel
        const fade = 0.5 + 0.5 * Math.sin(frac * Math.PI);
        const m = s.mesh.material as THREE.MeshBasicMaterial;
        m.opacity = 0.7 * fade;
        s.mesh.scale.setScalar(0.8 + 0.4 * fade);
      }

      const camDist = camera.position.length();
      for (const l of labels) {
        const el = l.obj.element as HTMLElement;
        if (!el) continue;
        if (l.threshold === 0) {
          el.style.opacity = "1";
        } else {
          const start = l.threshold;
          const end = l.threshold * 0.5;
          let op = 0;
          if (camDist <= end) op = 1;
          else if (camDist < start) op = (start - camDist) / (start - end);
          el.style.opacity = String(op);
        }
      }

      // Selected node highlight (V11) — only touch prev + next for O(1) per frame
      const sel = selectedRef.current;
      if (sel !== lastSelRef.current) {
        const prevEntry = lastSelRef.current ? nodeById.get(lastSelRef.current) : undefined;
        const nextEntry = sel ? nodeById.get(sel) : undefined;
        for (const entry of [prevEntry, nextEntry]) {
          if (!entry) continue;
          const isSel = entry.node.id === sel;
          const baseOpacity = entry.layer === 0 ? 0.12 : entry.layer === 0.5 ? 0.2 : 0.18;
          const starBaseOpacity = entry.layer === 0 ? 0.85 : entry.layer === 0.5 ? 0.6 : 0.85;
          entry.mesh.traverse((child: THREE.Object3D) => {
            const m = child as THREE.Mesh;
            const g = m.geometry as THREE.BufferGeometry | undefined;
            if (!g || !g.type) return;
            if (g.type === "TorusGeometry") {
              (m.material as THREE.MeshBasicMaterial).opacity = isSel ? Math.min(1, baseOpacity + 0.4) : baseOpacity;
            } else if (g.type === "SphereGeometry" && entry.layer <= 0.5) {
              (m.material as THREE.MeshBasicMaterial).opacity = isSel ? 1 : starBaseOpacity;
            }
          });
          if (entry.layer >= 1) {
            // iter5: note/leaf meshes are now invisible pickers; the visible
            // representation is the shared star cloud. Selected node boost is
            // applied to the cloud material below.
          } else if (entry.layer === 2) {
            // same as above
          }
        }
        lastSelRef.current = sel;
        // iter5: if any note/leaf is selected, slightly raise cloud opacity
        const cloud = noteCloudRef.current;
        if (cloud) {
          const mat = cloud.material as THREE.PointsMaterial;
          mat.opacity = sel ? 1.0 : 0.9;
        }
      }

      controls.update();
      renderer.render(scene, camera);
      labelRenderer.render(scene, camera);
    };
    animate();

    // ── Cleanup (WebGL leak guard) ─────────────────────────────────
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      renderer.domElement.removeEventListener("pointerdown", onPointerDown);
      // iter11: cancel any in-flight camera fly so the rAF loop is not
      // touching refs that are about to be nulled out below.
      if (pendingFlyCancelRef.current) {
        pendingFlyCancelRef.current();
        pendingFlyCancelRef.current = null;
      }
      // iter15: drop the smoke-test debug handle before nulling controlsRef /
      // cameraRef so a stale reference can't be observed mid-cleanup.
      if ((window as any).__kg3dDebug === debugHandle) {
        delete (window as any).__kg3dDebug;
      }
      // iter20: same identity for the public alias.
      if ((window as any).__kg3dApi === debugHandle) {
        delete (window as any).__kg3dApi;
      }
      controls.removeEventListener("change", persistChange);
      controls.dispose();
      controlsRef.current = null;
      cameraRef.current = null;

      // iter5: drop the shared note cloud reference first
      noteCloudRef.current = null;
      scene.traverse((obj: THREE.Object3D) => {
        const m = obj as THREE.Mesh;
        if (m.geometry) m.geometry.dispose();
        const mat = m.material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
        else if (mat) mat.dispose();
      });

      renderer.dispose();
      renderer.forceContextLoss?.();
      // iter6: forceContextLoss() fires webglcontextlost synchronously. The
      // current handler no longer appends a visible badge, but this cleanup
      // removes any stale status badge left by older hot-reload/StrictMode
      // mounts without touching the rendered canvas content.
      container.querySelectorAll(".kg3d-fallback--status").forEach((el) => el.remove());

      if (renderer.domElement.parentNode === container) container.removeChild(renderer.domElement);
      if (labelRenderer.domElement.parentNode === labelLayer) labelLayer.removeChild(labelRenderer.domElement);
    };
  }, [graph]);

  const handleReset = () => {
    const c = cameraRef.current;
    const ctrl = controlsRef.current;
    if (!c || !ctrl) return;
    // iter20: drop any in-flight smooth fly first so the snap-to-home isn't
    // fighting an animation that already moved the camera. Without this the
    // rAF tick keeps lerping the camera toward whatever node the user last
    // clicked, so the reset looks "stuck" half a second.
    if (pendingFlyCancelRef.current) {
      pendingFlyCancelRef.current();
      pendingFlyCancelRef.current = null;
    }
    if (typeof window !== "undefined" && (window as any)._kg3dFlyRafId) {
      cancelAnimationFrame((window as any)._kg3dFlyRafId);
      (window as any)._kg3dFlyRafId = 0;
    }
    // iter21: clear the persisted view BEFORE snapping home so the snap
    // itself doesn't immediately re-persist CAMERA_HOME via the 'change'
    // listener. Suppress the next 250ms of change events for belt-and-
    // suspenders safety — the dampening settle event would otherwise
    // re-write CAMERA_HOME a few frames later.
    suppressPersistUntilRef.current = Date.now() + 250;
    clearPersistedView();
    c.position.set(...CAMERA_HOME);
    ctrl.target.set(...CAMERA_HOME_TARGET);
    ctrl.update();
  };

  return (
    <div className="kg3d-root">
      <div className="kg3d-canvas" ref={containerRef} />
      <div className="kg3d-label-layer" ref={labelLayerRef} />
      {/* iter13: floating sub-MOC info card (top-right, non-blocking pointer) */}
      {infoCardNode && (
        <div
          className={`kg3d-info-card kg3d-info-card--${infoCardNode.type === "moc" ? "moc" : "sub"}`}
          role="dialog"
          aria-label={infoCardNode.type === "moc" ? "主 MOC 信息" : "子 MOC 信息"}
        >
          <div className="kg3d-info-card-head">
            <span className="kg3d-info-card-icon">{typeIcon(infoCardNode.type || "")}</span>
            <span className="kg3d-info-card-title">{infoCardNode.label}</span>
            <button
              type="button"
              className="kg3d-info-card-close"
              onClick={() => setInfoCardNode(null)}
              title="关闭"
            >
              ×
            </button>
          </div>
          <div className="kg3d-info-card-body">
            <div className="kg3d-info-card-row">
              <span className="kg3d-info-card-key">类型</span>
              <span className="kg3d-info-card-val">{infoCardNode.type}</span>
            </div>
            {/* iter17: MOC card shows关联子节点计数（来自 edges 邻接表） */}
            {infoCardNode.type === "moc" && (
              <div className="kg3d-info-card-row">
                <span className="kg3d-info-card-key">关联</span>
                <span className="kg3d-info-card-val">
                  {(graph?.nodes || []).filter((n) =>
                    ["folder", "source", "wiki", "submoc"].includes(n.type || "") &&
                    (graph?.edges || []).some(
                      (e) =>
                        (e.source === infoCardNode.id && e.target === n.id) ||
                        (e.target === infoCardNode.id && e.source === n.id),
                    ),
                  ).length}{" "}
                  个子节点
                </span>
              </div>
            )}
            {infoCardNode.path && (
<div className="kg3d-info-card-row">
                <span className="kg3d-info-card-key">路径</span>
                <span className="kg3d-info-card-val" title={infoCardNode.path}>
                  {infoCardNode.path.length > 36
                    ? "…" + infoCardNode.path.slice(-34)
                    : infoCardNode.path}
                </span>
              </div>
            )}
            {infoCardNode.source && (
              <div className="kg3d-info-card-row">
                <span className="kg3d-info-card-key">来源</span>
                <span className="kg3d-info-card-val">{infoCardNode.source}</span>
              </div>
            )}
            {/* iter17: MOC-only "飞向此 MOC" 按钮 — 用户可重复触发 fly-to，
                例如 orbit 后想让相机重新对准该 MOC 中心。 */}
            {infoCardNode.type === "moc" && (
              <button
                type="button"
                className="kg3d-info-card-focus"
                onClick={() => {
                  const cam = cameraRef.current;
                  const ctrl = controlsRef.current;
                  const pos = (window as any).__kg3dDebug?.positions?.get?.(infoCardNode.id);
                  if (!cam || !ctrl || !pos) return;
                  if (pendingFlyCancelRef.current) pendingFlyCancelRef.current();
                  pendingFlyCancelRef.current = startFlyTo(cam, ctrl, pos, {
                    durationMs: 1200,
                    minDistance: 28,
                    onDone: () => {
                      pendingFlyCancelRef.current = null;
                    },
                  });
                }}
                title="用 1.2s 平滑动画把相机飞向此 MOC 中心"
              >
                🎯 飞向此 MOC
              </button>
            )}
            {/* iter19: file chips on sub-MOC card (folder/source/submoc).
                iter22 (§14 #3): the same chip strip now also renders on the
                MOC card itself, so the user can browse MOC's children
                without drilling in via the 3D scene. The 🎯 fly button
                stays MOC-only because it's the "frame this MOC" action;
                chips are the "drill into a child" action. Active chip
                mirrors the reference HTML (.file-chip.active) treatment. */}
            {infoCardFiles.length > 0 && (
              <div className="kg3d-info-card-chips">
                <span className="kg3d-info-card-chips-label">子文件 · {infoCardFiles.length}</span>
                <div className="kg3d-info-card-chips-row">
                  {infoCardFiles.slice(0, 16).map((f) => {
                    const basename = (f.path || f.label || "").split("/").pop() || "";
                    const isActive = infoCardChipFile === basename;
                    return (
                      <button
                        key={f.id}
                        type="button"
                        className={"kg3d-info-card-chip" + (isActive ? " active" : "")}
                        onClick={() => {
                          setInfoCardChipFile((cur) => (cur === basename ? null : basename));
                          if (infoCardChipFile !== basename) focusFileCamera(f);
                        }}
                        title={f.path || f.label || basename}
                      >
                        <span className="kg3d-info-card-chip-dot" />
                        {basename.length > 18 ? "…" + basename.slice(-16) : basename}
                      </button>
                    );
                  })}
                </div>
                {infoCardChipFile && (nodePreviewsRef.current || {})[infoCardChipFile] && (
                  <div className="kg3d-info-card-preview-wrap">
                    <div className="kg3d-info-card-preview-head">
                      <span>📄 {infoCardChipFile}</span>
                      <button
                        type="button"
                        className="kg3d-info-card-preview-close"
                        onClick={() => setInfoCardChipFile(null)}
                        title="关闭预览"
                      >
                        ×
                      </button>
                    </div>
                    <iframe
                      className="kg3d-info-card-preview"
                      srcDoc={(nodePreviewsRef.current || {})[infoCardChipFile] || ""}
                      sandbox=""
                      title={infoCardChipFile}
                    />
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
      {/* iter12: side-preview panel (40vw right side, iframe with srcDoc) */}
      {sidePreviewOpen && (
        <div className="kg3d-side-preview" role="dialog" aria-label="Leaf 预览">
          <div className="kg3d-side-preview-head">
            <span className="kg3d-side-preview-icon">🌿</span>
            <span className="kg3d-side-preview-title" title={sidePreviewTitle}>
              {shortName(sidePreviewTitle, 28)}
            </span>
            <button
              type="button"
              className="kg3d-side-preview-close"
              onClick={() => {
                setSidePreviewOpen(false);
                setSidePreviewNodeId(null);
              }}
              title="关闭预览"
            >
              ×
            </button>
          </div>
          <iframe
            className="kg3d-side-preview-frame"
            title={sidePreviewTitle}
            sandbox="allow-same-origin"
            srcDoc={sidePreviewHTML}
          />
        </div>
      )}
      {/* iter18: note three-card (right side, 560px iframe, tags, mutually
          exclusive with side-preview and info-card). Mirrors reference
          nanjixiong_knowledge_map.html three-card for note-type nodes. */}
      {threeCardNode && !sidePreviewOpen && (
        <div className="kg3d-three-card" role="dialog" aria-label="笔记预览">
          <div className="kg3d-three-card-head">
            <span className="kg3d-three-card-icon">{typeIcon(threeCardNode.type || "")}</span>
            <span className="kg3d-three-card-title" title={threeCardNode.label}>
              {shortName(threeCardNode.label, 36)}
            </span>
            <button
              type="button"
              className="kg3d-three-card-close"
              onClick={() => setThreeCardNode(null)}
              title="关闭"
            >
              ×
            </button>
          </div>
          {Array.isArray((threeCardNode as any).tags) && (threeCardNode as any).tags.length > 0 && (
            <div className="kg3d-three-card-tags">
              {((threeCardNode as any).tags as string[]).map((t, i) => (
                <span key={i} className="kg3d-three-card-tag">#{t}</span>
              ))}
            </div>
          )}
          <div className="kg3d-three-card-meta">
            <span className="kg3d-three-card-meta-key">类型</span>
            <span className="kg3d-three-card-meta-val">{threeCardNode.type}</span>
            {threeCardNode.path && (
              <>
                <span className="kg3d-three-card-meta-key">·</span>
                <span className="kg3d-three-card-meta-val" title={threeCardNode.path}>
                  {threeCardNode.path.length > 36
                    ? "…" + threeCardNode.path.slice(-34)
                    : threeCardNode.path}
                </span>
              </>
            )}
          </div>
          <iframe
            className="kg3d-three-card-frame"
            title={threeCardNode.label}
            sandbox="allow-same-origin"
            srcDoc={(() => {
              const previews = nodePreviewsRef.current || {};
              const basename = (threeCardNode.path || threeCardNode.label || "").split("/").pop() || "";
              return previews[basename] || `<div style="color:#94a3b8;font-family:sans-serif;padding:32px;text-align:center;font-size:13px;">未缓存此笔记的预览（${basename}）<br/><br/>此笔记未在 note-previews 缓存中，可能较大或未被抓取。</div>`;
            })()}
          />
        </div>
      )}
      <div className="kg3d-hud">
        <button type="button" onClick={() => setAutoRotate((v) => !v)} title="旋转/暂停">
          {autoRotate ? "⏸ 暂停" : "⟳ 旋转"}
        </button>
        <button type="button" onClick={handleReset} title="复位视角">⌂ 复位</button>
        <span className="kg3d-hud-hint">🖱 拖拽 · 滚轮缩放 · 点击节点查看详情 · 按 ESC 退出全屏</span>
        {graph && (graph.nodes.length + (graph.edges?.length || 0)) > LIGHTWEIGHT_THRESHOLD && (
          <span className="kg3d-hud-warn">轻量模式 ({(graph.nodes.length + (graph.edges?.length || 0))})</span>
        )}
        {/* iter-8: 全屏模式下显示退出按钮 */}
        {isFullscreen && (
          <button
            type="button"
            className="kg3d-hud-exit-fullscreen"
            onClick={onExitFullscreen}
            title="退出全屏（ESC）"
          >
            ⤢ 退出全屏
          </button>
        )}
      </div>
    </div>
  );
}
