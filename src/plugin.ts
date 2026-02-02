/**
 * Plugin System
 *
 * Composable processing stages. Each plugin takes $ (query engine)
 * and returns tags / arbitrary data. Outputs cached per session.
 * Dependency resolution via topological sort.
 *
 * Plugins have no knowledge of VirtualDoc or other internals.
 * They only see $ and emit.
 */

import type { QueryEngine } from './query';
import type { Tag } from './tag';

// ============================================================================
// Plugin Interface
// ============================================================================

export interface PluginContext {
  /** Query engine — the only way plugins read document data */
  $: QueryEngine;
  /** Access cached result of another plugin */
  plugin: (name: string) => unknown;
  /** Fire a custom event on the session */
  emit: (event: string, data?: unknown) => void;
  /** Shared store between plugins — set by producers, read by dependents */
  artifacts: Map<string, unknown>;
}

export interface PluginResult {
  /** New tags to merge into the session */
  tags?: Tag[];
  /** Arbitrary result data (e.g. TOC tree) */
  data?: unknown;
}

export interface PDFQueryPlugin {
  name: string;
  /** Names of other plugins that must run first */
  depends?: string[];
  run: (ctx: PluginContext) => PluginResult | Promise<PluginResult>;
}

// ============================================================================
// Global Registry
// ============================================================================

const globalPlugins = new Map<string, PDFQueryPlugin>();

export function registerPlugin(plugin: PDFQueryPlugin): void {
  globalPlugins.set(plugin.name, plugin);
}

export function getGlobalPlugin(name: string): PDFQueryPlugin | undefined {
  return globalPlugins.get(name);
}

export function getGlobalPlugins(): PDFQueryPlugin[] {
  return Array.from(globalPlugins.values());
}

// ============================================================================
// Dependency Resolution (Topological Sort)
// ============================================================================

export function resolveOrder(plugins: PDFQueryPlugin[]): PDFQueryPlugin[] {
  const byName = new Map(plugins.map(p => [p.name, p]));
  const visited = new Set<string>();
  const sorted: PDFQueryPlugin[] = [];

  function visit(name: string, stack: Set<string>) {
    if (visited.has(name)) return;
    if (stack.has(name)) {
      throw new Error(`Circular plugin dependency: ${[...stack, name].join(' → ')}`);
    }

    const plugin = byName.get(name);
    if (!plugin) return;

    stack.add(name);
    for (const dep of plugin.depends || []) {
      visit(dep, stack);
    }
    stack.delete(name);

    visited.add(name);
    sorted.push(plugin);
  }

  for (const plugin of plugins) {
    visit(plugin.name, new Set());
  }

  return sorted;
}

// ============================================================================
// Plugin Runner
// ============================================================================

export interface PluginRunnerOptions {
  $: QueryEngine;
  emit: (event: string, data?: unknown) => void;
  /** Pre-existing artifacts map (e.g. from session). If omitted, a fresh Map is created. */
  artifacts?: Map<string, unknown>;
}

/**
 * Run all plugins in dependency order. Returns map of plugin results.
 * A single artifacts Map is shared across all plugins for inter-plugin data flow.
 */
export async function runPlugins(
  plugins: PDFQueryPlugin[],
  options: PluginRunnerOptions,
): Promise<Map<string, PluginResult>> {
  const ordered = resolveOrder(plugins);
  const results = new Map<string, PluginResult>();
  const artifacts = options.artifacts ?? new Map<string, unknown>();

  const ctx: PluginContext = {
    $: options.$,
    plugin: (name: string) => results.get(name)?.data,
    emit: options.emit,
    artifacts,
  };

  for (const plugin of ordered) {
    const result = await plugin.run(ctx);
    results.set(plugin.name, result);
    options.emit(plugin.name, result.data);
  }

  return results;
}
