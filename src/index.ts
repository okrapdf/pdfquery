/**
 * Virtual DOM Query Layer (Read-Only)
 *
 * jQuery for documents. Scriptable query layer for document entities.
 *
 * Structure: Document → Page[] → Entity[] (flat, no nesting)
 *
 * @example
 * const doc = compileDocument(tables, entities);
 * const $$ = createQueryEngine(doc);
 *
 * // Query like jQuery
 * $$('.currency').stats();
 * $$('[confidence>0.9]').texts();
 * $$('*').onPage(2).countByType();
 */

// Types
export type {
  VirtualDoc,
  VirtualPage,
  VirtualEntity,
  EntityType,
  EntityMeta,
  BoundingBox,
  PageMeta,
  DocumentMeta,
  VerificationStatus,
  Selector,
  QueryStats,
  // Source types (from DB/API)
  SourceTable,
  SourceEntity,
  SourceExtractedEntity,  // Unified: table, figure, footnote, summary
  SourceOcr,
  SourceMarkdown,
  EntityCounts,
  CompilerOptions,
  // Consumer interfaces (for CLI/API/Search)
  QueryConfig,
  QueryResponse,
  QueryResultItem,
  DocumentInfo,
} from './types';

// Compiler
export { DocCompiler, createCompiler, compileDocument } from './compiler';

// Query layer
export {
  QueryResult,
  createQueryEngine,
  queryPage,
  queryPages,
  // Config-based query (for CLI/API/Search consumers)
  executeQuery,
  formatQueryResponse,
} from './query';
export type {
  QueryEngine,
  RenderOptions,
  // Mutation tracking types
  EntityChange,
  MutationLog,
} from './query';

// Source adapters (normalize API responses → compiler input)
export {
  fromEntitiesApi,
  fromPageApiBlocks,
  fromPageApiMarkdown,
  fromPageApiTables,
  fetchEntities,
  fetchPage,
  fetchPages,
  loadEntitiesFromFile,
  loadPageFromFile,
} from './sources';
export type {
  EntitiesApiResponse,
  PageApiResponse,
  ApiEntity,
  ApiBlock,
} from './sources';

// Tree adapter (Inspector tree → VirtualDoc)
export { treeToVirtualDoc, getPageCount } from './tree-adapter';
export type { InspectorTreeNode, TreeAdapterOptions } from './tree-adapter';

// Sample fixtures (zero-dependency demos)
export {
  fixtures,
  loadFixture,
  compileFixture,
  listFixtures,
  getFixture,
} from './fixtures';
export type { FixtureData, FixtureName } from './fixtures';
