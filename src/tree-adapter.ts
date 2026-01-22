import type {
  VirtualDoc,
  VirtualPage,
  VirtualEntity,
  BoundingBox,
  EntityType,
  EntityMeta,
} from './types';

interface InspectorBbox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface InspectorTreeNode {
  id: string;
  type: string;
  tagName: string;
  textContent: string | null;
  page: number;
  bbox?: InspectorBbox;
  children: InspectorTreeNode[];
  className?: string;
  attributes: Record<string, unknown>;
  data?: Record<string, unknown>;
}

export interface TreeAdapterOptions {
  docId?: string;
  includeOcrBlocks?: boolean;
  defaultConfidence?: number;
}

const TYPE_MAP: Record<string, EntityType> = {
  'table': 'table',
  'figure': 'figure',
  'ocr-block': 'ocr',
  'footnote': 'footnote',
  'summary': 'markdown',
  'heading': 'header',
  'paragraph': 'text',
  'signature': 'text',
  'form': 'text',
  'list': 'text',
  'header': 'header',
};

function mapType(inspectorType: string): EntityType {
  return TYPE_MAP[inspectorType] || 'unknown';
}

function convertBbox(bbox: InspectorBbox): BoundingBox {
  return {
    xmin: bbox.x,
    ymin: bbox.y,
    xmax: bbox.x + bbox.width,
    ymax: bbox.y + bbox.height,
  };
}

function createEntityMeta(
  node: InspectorTreeNode,
  defaultConfidence: number
): EntityMeta {
  const confidence = typeof node.attributes['data-confidence'] === 'number'
    ? node.attributes['data-confidence']
    : defaultConfidence;

  return {
    verified: false,
    verificationStatus: 'pending',
    confidence,
    wasCorrected: false,
    source: 'ocr',
    processorType: 'ocr',
  };
}

function flattenTree(
  node: InspectorTreeNode,
  options: TreeAdapterOptions
): VirtualEntity[] {
  const entities: VirtualEntity[] = [];
  const { includeOcrBlocks = true, defaultConfidence = 0.9 } = options;

  const traverse = (n: InspectorTreeNode) => {
    const isStructuralNode = n.type === 'document' || n.type === 'page';
    const isOcrBlock = n.type === 'ocr-block';
    
    if (!isStructuralNode && n.bbox) {
      if (isOcrBlock && !includeOcrBlocks) {
        return;
      }

      entities.push({
        id: n.id,
        type: mapType(n.type),
        text: n.textContent || '',
        bbox: convertBbox(n.bbox),
        pageIndex: n.page - 1,
        meta: createEntityMeta(n, defaultConfidence),
        _data: n.data,
      });
    }

    n.children.forEach(traverse);
  };

  traverse(node);
  return entities;
}

function groupByPage(entities: VirtualEntity[]): Map<number, VirtualEntity[]> {
  const pageMap = new Map<number, VirtualEntity[]>();
  
  entities.forEach((e) => {
    const pageIndex = e.pageIndex;
    if (!pageMap.has(pageIndex)) {
      pageMap.set(pageIndex, []);
    }
    pageMap.get(pageIndex)!.push(e);
  });

  return pageMap;
}

function createPageMeta(entities: VirtualEntity[]) {
  const total = entities.length;
  const verified = entities.filter(e => e.meta.verified).length;
  const flagged = entities.filter(e => e.meta.verificationStatus === 'flagged').length;
  const pending = entities.filter(e => e.meta.verificationStatus === 'pending').length;
  const avgConfidence = total > 0
    ? entities.reduce((sum, e) => sum + e.meta.confidence, 0) / total
    : 0;

  return {
    totalEntities: total,
    verifiedCount: verified,
    flaggedCount: flagged,
    pendingCount: pending,
    avgConfidence,
    verificationScore: total > 0 ? verified / total : 0,
  };
}

export function treeToVirtualDoc(
  tree: InspectorTreeNode,
  options: TreeAdapterOptions = {}
): VirtualDoc {
  const { docId = 'inspector-doc' } = options;
  
  const entities = flattenTree(tree, options);
  const pageMap = groupByPage(entities);

  const pages: VirtualPage[] = Array.from(pageMap.entries())
    .sort(([a], [b]) => a - b)
    .map(([pageIndex, pageEntities]) => ({
      id: `page-${pageIndex + 1}`,
      pageIndex,
      pageNumber: pageIndex + 1,
      entities: pageEntities,
      meta: createPageMeta(pageEntities),
    }));

  const totalEntities = entities.length;
  const verifiedCount = entities.filter(e => e.meta.verified).length;
  const flaggedCount = entities.filter(e => e.meta.verificationStatus === 'flagged').length;
  const pendingCount = entities.filter(e => e.meta.verificationStatus === 'pending').length;

  return {
    id: docId,
    version: 1,
    pages,
    meta: {
      totalPages: pages.length,
      totalEntities,
      verifiedCount,
      flaggedCount,
      pendingCount,
      verificationScore: totalEntities > 0 ? verifiedCount / totalEntities : 0,
      createdAt: Date.now(),
      lastModified: Date.now(),
    },
  };
}

export function getPageCount(tree: InspectorTreeNode): number {
  let maxPage = 0;
  
  const traverse = (n: InspectorTreeNode) => {
    if (n.page > maxPage) maxPage = n.page;
    n.children.forEach(traverse);
  };
  
  traverse(tree);
  return maxPage;
}
