/**
 * pdfquery — jQuery for PDFs
 *
 * Scriptable query layer for document entities.
 * Feed Tags in, query with $.
 *
 * Structure: Document → Page[] → Entity[] (flat, no nesting)
 *
 * @example
 * import { pdfquery } from 'pdfquery';
 *
 * const tags = [{ id: 't1', type: 'table', page: 1, bbox: { x: 0, y: 0, width: 1, height: 1 }, text: '...' }];
 * const session = pdfquery.ready({ tags });
 * session.$('.table').count();
 */

// Types (public)
export type {
  EntityType,
  VerificationStatus,
  Selector,
  QueryStats,
  QueryConfig,
  QueryResponse,
  QueryResultItem,
  DocumentInfo,
  PDFInput,
  PageImage,
} from './types';

// Types (internal plumbing — needed by tree-adapter consumers & interop)
export type {
  VirtualDoc,
  VirtualPage,
  VirtualEntity,
  BoundingBox,
  EntityMeta,
  PageMeta,
  DocumentMeta,
} from './types';

// Query layer
export {
  QueryResult,
  createQueryEngine,
  queryPage,
  queryPages,
  executeQuery,
  formatQueryResponse,
} from './query';
export type {
  QueryEngine,
  RenderOptions,
  EntityChange,
  MutationLog,
  VLMCallHandler,
  VLMImage,
} from './query';

// Tree adapter (Inspector tree → Tags / VirtualDoc)
export { treeToTags, treeToVirtualDoc, getPageCount } from './tree-adapter';
export type { InspectorTreeNode, TreeAdapterOptions } from './tree-adapter';

// Sample fixtures (zero-dependency demos)
export {
  fixtures,
  loadFixture,
  loadFixtureTags,
  compileFixture,
  listFixtures,
  getFixture,
} from './fixtures';
export type { FixtureData, FixtureName } from './fixtures';

// Vendor adapters (normalize OCR vendor output → AdapterResult)
export * from './adapters';

// Session API (jQuery-like lifecycle — primary entry point)
export { default as pdfquery, PDFQuerySession } from './session';

// Tag model
export { buildTagTree, computeCoverage, findOrphans, normalizeBbox, clampBbox } from './tag';
export type { Tag, BBox, RawBBox, TagTreeNode, PageData } from './tag';

// Tag utilities (type detection, value parsing, table expansion)
export {
  detectEntityType,
  parseValue,
  parseMarkdownTable,
  enrichTag,
  expandTableTag,
} from './tag-utils';

// Plugin system
export { registerPlugin, resolveOrder, runPlugins } from './plugin';
export type { PDFQueryPlugin, PluginContext, PluginResult, PluginRunnerOptions } from './plugin';

// Event emitter
export { PDFEventEmitter } from './events';
