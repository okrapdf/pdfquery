/**
 * PDFQuerySession — `pdfquery()` entry point
 *
 * Event-driven lifecycle for document queries. Feed tags in,
 * listen to events, query with $. jQuery-inspired: $ returns
 * empty QueryResult before data arrives (no throw).
 *
 * pdfquery has NO knowledge of vendor pipelines, job IDs, or API endpoints.
 * It only receives Tags + Pages.
 *
 * @example
 * // Reactive
 * const doc = pdfquery();
 * doc.on('tags', ($) => $('table').count());
 * doc.addTags(myTags);
 *
 * // Imperative
 * const doc = pdfquery.ready({ tags: myTags });
 * doc.$('table').count();
 */

import { createQueryEngine } from './query';
import type { QueryEngine } from './query';
import type { VirtualDoc, VirtualEntity, VerificationStatus } from './types';
// VirtualDoc/VirtualEntity are internal plumbing only — QueryEngine requires them.
// Nothing in the public API exposes these types.
import type { Tag, PageData } from './tag';
import { enrichTag, expandTableTag } from './tag-utils';
import { PDFEventEmitter } from './events';
import type { PDFQueryPlugin } from './plugin';
import { runPlugins, getGlobalPlugins, registerPlugin as globalRegisterPlugin } from './plugin';

// ============================================================================
// Tag → VirtualEntity (internal plumbing — QueryEngine needs VirtualDoc)
// ============================================================================

function tagToVirtualEntity(tag: Tag): VirtualEntity {
  const a = tag.attrs ?? {};
  const status = (a.verificationStatus as VerificationStatus) ?? 'pending';

  return {
    id: tag.id,
    type: tag.type as VirtualEntity['type'],
    text: tag.text ?? '',
    value: a.value as string | number | undefined,
    bbox: {
      xmin: tag.bbox.x,
      ymin: tag.bbox.y,
      xmax: tag.bbox.x + tag.bbox.width,
      ymax: tag.bbox.y + tag.bbox.height,
    },
    meta: {
      verified: status === 'verified',
      verificationStatus: status,
      verifiedBy: a.verifiedBy as string | undefined,
      verifiedAt: a.verifiedAt as number | undefined,
      confidence: (a.confidence as number) ?? 1,
      wasCorrected: (a.wasCorrected as boolean) ?? false,
      source: (a.source as VirtualEntity['meta']['source']) ?? 'system',
      processorType: a.processorType as VirtualEntity['meta']['processorType'],
      flagReason: a.flagReason as string | undefined,
      flaggedBy: a.flaggedBy as string | undefined,
      flaggedAt: a.flaggedAt as number | undefined,
    },
    pageIndex: tag.page - 1,
    tableId: a.tableId as string | undefined,
    rowIndex: a.rowIndex as number | undefined,
    colIndex: a.colIndex as number | undefined,
    attrs: Object.keys(a).length > 0 ? a : undefined,
  };
}

/**
 * Pre-process tags before compilation: enrich generic types and expand
 * table markdown into cell tags. This gives the Tag path feature parity
 * with what DocCompiler used to do.
 */
function preprocessTags(tags: Tag[], options?: { expandTables?: boolean; autoDetectTypes?: boolean }): Tag[] {
  const { expandTables = false, autoDetectTypes = true } = options ?? {};
  const result: Tag[] = [];

  for (const tag of tags) {
    const enriched = autoDetectTypes ? enrichTag(tag) : tag;
    result.push(enriched);

    // Optionally expand table tags into cell tags
    if (expandTables && enriched.type === 'table' && enriched.text) {
      result.push(...expandTableTag(enriched, { autoDetectTypes }));
    }
  }

  return result;
}

// ============================================================================
// Empty Engine (pre-data)
// ============================================================================

const EMPTY_DOC: VirtualDoc = {
  id: 'empty',
  version: 0,
  pages: [],
  meta: {
    totalPages: 0,
    totalEntities: 0,
    verifiedCount: 0,
    flaggedCount: 0,
    pendingCount: 0,
    verificationScore: 0,
    createdAt: 0,
    lastModified: 0,
  },
};

function createEmptyEngine(): QueryEngine {
  return createQueryEngine(EMPTY_DOC);
}

// ============================================================================
// PDFQuerySession
// ============================================================================

export class PDFQuerySession {
  private doc: VirtualDoc | null = null;
  private engine: QueryEngine;
  private emitter = new PDFEventEmitter();
  private plugins: PDFQueryPlugin[] = [];
  private tags: Tag[] = [];
  private pages: PageData[] = [];
  /** Shared artifact store for inter-plugin data flow */
  readonly artifacts = new Map<string, unknown>();
  /** When true, skip fire-and-forget pipeline — plugins only run via load() */
  private _loadMode = false;

  constructor() {
    this.engine = createEmptyEngine();
  }

  /**
   * Enable load mode — suppresses fire-and-forget plugin pipeline so that
   * plugins are only run via the awaited `load()` method.
   */
  enableLoadMode(): this {
    this._loadMode = true;
    return this;
  }

  // --------------------------------------------------------------------------
  // Query — always available, returns empty before data
  // --------------------------------------------------------------------------

  get $(): QueryEngine {
    return this.engine;
  }

  /**
   * Access the compiled VirtualDoc. Returns null before any data is fed.
   * Primarily for interop with code that needs the raw doc (e.g. loadFixture).
   */
  get document(): VirtualDoc | null {
    return this.doc;
  }

  // --------------------------------------------------------------------------
  // Feed Data
  // --------------------------------------------------------------------------

  addTags(tags: Tag[]): this {
    this.tags.push(...tags);
    this.recompile();
    this.emitter.emit('tags', this.engine);
    this.runPluginsPipeline();
    return this;
  }

  addPages(pages: PageData[]): this {
    this.pages.push(...pages);
    this.recompile();
    this.emitter.emit('pages', this.engine);
    return this;
  }


  // --------------------------------------------------------------------------
  // Events
  // --------------------------------------------------------------------------

  on(event: string, fn: (engine: QueryEngine, data?: unknown) => void): this {
    this.emitter.on(event, fn as (...args: unknown[]) => void);
    return this;
  }

  once(event: string, fn: (engine: QueryEngine, data?: unknown) => void): this {
    this.emitter.once(event, fn as (...args: unknown[]) => void);
    return this;
  }

  trigger(event: string, data?: unknown): this {
    this.emitter.emit(event, this.engine, data);
    return this;
  }

  // --------------------------------------------------------------------------
  // Plugins
  // --------------------------------------------------------------------------

  use(plugin: PDFQueryPlugin): this {
    this.plugins.push(plugin);
    if (this.doc) {
      this.runPluginsPipeline();
    }
    return this;
  }

  // --------------------------------------------------------------------------
  // Async Load (for I/O plugins)
  // --------------------------------------------------------------------------

  /**
   * Run all registered plugins sequentially (in dependency order), await each,
   * and merge produced tags into the session. Unlike addTags→runPluginsPipeline
   * (fire-and-forget), this awaits the full pipeline.
   */
  async load(): Promise<this> {
    this._loadMode = true;

    // Register add:tags callback so plugins/query methods can inject tags post-load
    this.artifacts.set('add:tags', (newTags: Tag[]) => {
      this.tags.push(...newTags);
      this.recompile();
    });

    const allPlugins = [...getGlobalPlugins(), ...this.plugins];
    if (allPlugins.length === 0) return this;

    const emit = (event: string, data?: unknown) => {
      this.emitter.emit(event, this.engine, data);
    };

    const results = await runPlugins(allPlugins, {
      $: this.engine,
      emit,
      artifacts: this.artifacts,
    });

    let hasNewTags = false;
    for (const [, result] of results) {
      if (result.tags && result.tags.length > 0) {
        this.tags.push(...result.tags);
        hasNewTags = true;
      }
    }
    if (hasNewTags) {
      this.recompile();
    }

    return this;
  }

  // --------------------------------------------------------------------------
  // Internals
  // --------------------------------------------------------------------------

  private recompile(): void {
    const entities = this.tags.map(tagToVirtualEntity);

    // Group by page
    const pageMap = new Map<number, VirtualEntity[]>();
    for (const entity of entities) {
      const pageNum = entity.pageIndex + 1;
      const arr = pageMap.get(pageNum) || [];
      arr.push(entity);
      pageMap.set(pageNum, arr);
    }

    // Include pages from addPages that have no tags
    for (const p of this.pages) {
      if (!pageMap.has(p.pageNumber)) {
        pageMap.set(p.pageNumber, []);
      }
    }

    const pageDataMap = new Map(this.pages.map(p => [p.pageNumber, p]));
    const sortedPages = Array.from(pageMap.keys()).sort((a, b) => a - b);

    const now = Date.now();
    const virtualPages = sortedPages.map(pageNum => {
      const pageEntities = pageMap.get(pageNum) || [];

      // Synthesize a page-level entity so $('page') works
      const pageEntity: VirtualEntity = {
        id: `page-${pageNum}`,
        type: 'page',
        text: '',
        bbox: { xmin: 0, ymin: 0, xmax: 1, ymax: 1 },
        meta: {
          verified: false,
          verificationStatus: 'pending',
          confidence: 1,
          wasCorrected: false,
          source: 'system',
        },
        pageIndex: pageNum - 1,
      };

      const allPageEntities = [pageEntity, ...pageEntities];

      const pd = pageDataMap.get(pageNum);
      let verified = 0, flagged = 0, pending = 0, confSum = 0;
      for (const e of pageEntities) {
        confSum += e.meta.confidence;
        if (e.meta.verificationStatus === 'verified') verified++;
        else if (e.meta.verificationStatus === 'flagged') flagged++;
        else if (e.meta.verificationStatus === 'pending') pending++;
      }
      const total = pageEntities.length;
      return {
        id: `p_${pageNum - 1}`,
        pageIndex: pageNum - 1,
        pageNumber: pageNum,
        entities: allPageEntities,
        meta: {
          totalEntities: total,
          verifiedCount: verified,
          flaggedCount: flagged,
          pendingCount: pending,
          avgConfidence: total > 0 ? confSum / total : 0,
          verificationScore: total > 0 ? verified / total : 0,
        },
        ...(pd?.markdown && { markdown: pd.markdown }),
        ...(pd?.width && { width: pd.width }),
        ...(pd?.height && { height: pd.height }),
      };
    });

    let totalEntities = 0, totalVerified = 0, totalFlagged = 0, totalPending = 0;
    for (const p of virtualPages) {
      totalEntities += p.meta.totalEntities;
      totalVerified += p.meta.verifiedCount;
      totalFlagged += p.meta.flaggedCount;
      totalPending += p.meta.pendingCount;
    }

    this.doc = {
      id: 'session',
      version: (this.doc?.version ?? 0) + 1,
      pages: virtualPages,
      meta: {
        totalPages: virtualPages.length,
        totalEntities,
        verifiedCount: totalVerified,
        flaggedCount: totalFlagged,
        pendingCount: totalPending,
        verificationScore: totalEntities > 0 ? totalVerified / totalEntities : 0,
        createdAt: this.doc?.meta.createdAt ?? now,
        lastModified: now,
      },
    };

    this.doc._artifacts = this.artifacts;
    this.engine = createQueryEngine(this.doc);
  }

  private runPluginsPipeline(): void {
    if (!this.doc || this._loadMode) return;

    const allPlugins = [...getGlobalPlugins(), ...this.plugins];
    if (allPlugins.length === 0) return;

    const emit = (event: string, data?: unknown) => {
      this.emitter.emit(event, this.engine, data);
    };

    runPlugins(allPlugins, {
      $: this.engine,
      emit,
      artifacts: this.artifacts,
    }).then(results => {
      let hasNewTags = false;
      for (const [, result] of results) {
        if (result.tags && result.tags.length > 0) {
          this.tags.push(...result.tags);
          hasNewTags = true;
        }
      }
      if (hasNewTags) {
        this.recompile();
      }
    }).catch(err => {
      this.emitter.emit('error', err);
    });
  }
}

// ============================================================================
// Factory
// ============================================================================

interface PdfqueryFactory {
  (): PDFQuerySession;
  ready: (data: { tags: Tag[]; pages?: PageData[] }) => PDFQuerySession;
  load: (plugins: PDFQueryPlugin[], data?: { tags?: Tag[]; pages?: PageData[] }) => Promise<PDFQuerySession>;
  registerPlugin: (plugin: PDFQueryPlugin) => void;
}

function pdfquery(): PDFQuerySession {
  return new PDFQuerySession();
}

pdfquery.ready = function ready(data: { tags: Tag[]; pages?: PageData[] }): PDFQuerySession {
  const session = new PDFQuerySession();
  if (data.pages) session.addPages(data.pages);
  session.addTags(data.tags);
  return session;
};

pdfquery.load = async function load(
  plugins: PDFQueryPlugin[],
  data?: { tags?: Tag[]; pages?: PageData[] },
): Promise<PDFQuerySession> {
  const session = new PDFQuerySession();
  session.enableLoadMode();
  for (const p of plugins) session.use(p);
  if (data?.pages) session.addPages(data.pages);
  if (data?.tags) session.addTags(data.tags);
  // Run all plugins once, awaited.
  await session.load();
  return session;
};

pdfquery.registerPlugin = globalRegisterPlugin;

export default pdfquery as PdfqueryFactory;
