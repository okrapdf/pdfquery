/**
 * Virtual DOM tree node representing a document element
 * Used by pdfquery for tree-based document querying
 */
export interface VdomTreeNode {
  id: string;
  type: string;
  tagName: string;
  textContent: string | null;
  page: number;
  bbox?: Bbox;
  children: VdomTreeNode[];
  className?: string;
  attributes: Record<string, unknown>;
  /** Generic data store for plugins/transformations (like jQuery .data()) */
  data?: Record<string, unknown>;
}

/**
 * Bounding box coordinates (normalized 0-1)
 */
export interface Bbox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Context passed to VDOM console for query execution
 */
export interface ConsoleContext {
  $: (selector: string) => unknown;
  $$: (selector: string) => unknown;
  doc: unknown;
  currentPage: number;
  page: (n: number) => unknown;
}

/**
 * Props for entity components in the VDOM tree
 */
export interface EntityProps {
  id: string;
  type: string;
  text?: string | null;
  page: number;
  bbox?: Bbox;
  confidence?: number;
  status?: 'pending' | 'verified' | 'flagged';
  attributes?: Record<string, unknown>;
  className?: string;
  children?: React.ReactNode;
  onEvidenceClick?: (id: string, page: number, bbox?: Bbox) => void;
  isSelected?: boolean;
}
