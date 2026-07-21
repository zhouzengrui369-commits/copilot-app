/**
 * NoteDetail — shared types.
 *
 * Sprint 1.2 / T-1.2.3. Designed for Sprint 1.2 T-1.2.1 KG builder
 * integration: the data layer (`useNoteData`) is the single seam
 * to swap between an in-memory mock and the real `@copilot/kg` API.
 *
 * Renderer-layer types stay independent from the KG package so the
 * component compiles even before T-1.2.1-v2 is merged into main.
 */

export interface NoteContent {
  /** Stable id from the KG (matches `note_entities.note_path` shape). */
  id: string;
  /** Human title (basename of the path, no `.md`). */
  title: string;
  /** Absolute path used by `[[wikilink]]` resolution. */
  path: string;
  /** Raw markdown body. */
  body: string;
  /** Tags extracted by KG builder. */
  tags: ReadonlyArray<string>;
  /** Last modification timestamp (epoch ms). */
  updatedAt: number;
}

export interface BacklinkRef {
  /** The source note that links to this note. */
  sourceId: string;
  sourceTitle: string;
  sourcePath: string;
  /** Optional excerpt showing where the link appears. */
  excerpt: string;
}

export interface NoteDetailData {
  note: NoteContent | null;
  backlinks: ReadonlyArray<BacklinkRef>;
  loading: boolean;
  error: string | null;
}

export interface NoteDetailProps {
  /** id of the note to preview; null closes the panel. */
  noteId: string | null;
  /** Called when the user clicks a `[[wikilink]]`. */
  onNavigate?: (targetPath: string) => void;
  /** Called when the user closes the panel. */
  onClose?: () => void;
  /**
   * Optional data injection seam for tests and SSR. When omitted, the
   * component falls back to the in-memory mock fixtures in
   * `useNoteData`.
   */
  dataSource?: NoteDataSource;
}

export interface NoteDataSource {
  /** Async fetch the full note content. */
  getNote(noteId: string): Promise<NoteContent | null>;
  /** Async fetch all notes that link TO this note. */
  getBacklinks(noteId: string): Promise<ReadonlyArray<BacklinkRef>>;
}
