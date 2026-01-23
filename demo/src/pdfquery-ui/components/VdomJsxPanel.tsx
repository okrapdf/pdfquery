'use client';

import React, { useMemo } from 'react';
import { getEntityComponent, OcrBlockComponent } from './EntityComponents';
import { clsx } from 'clsx';
import type { VdomTreeNode } from 'pdfquery/src/types/vdom';

interface VdomJsxPanelProps {
  vdomTree: VdomTreeNode | null;
  selectedId: string | null;
  highlightedIds?: string[];
  onNodeClick: (id: string, page: number, bbox?: VdomTreeNode['bbox']) => void;
  onHighlight?: (ids: string[]) => void;
  renderMode?: 'spatial' | 'list';
  pageAspectRatio?: number;
  overlay?: boolean;
  showPageNumbers?: boolean;
  currentPage?: number;
}

function NodeData({ data }: { data?: Record<string, unknown> }) {
  if (!data || Object.keys(data).length === 0) return null;

  return (
    <div className="mt-1 space-y-1">
      {Object.entries(data).map(([key, value]) => (
        <div key={key} className="p-2 bg-green-50 border border-green-200 rounded text-xs">
          <div className="flex items-center gap-1 text-green-700 font-medium mb-1">
            <span className="w-1.5 h-1.5 bg-green-500 rounded-full" />
            _data.{key}
          </div>
          <pre className="text-[10px] text-green-800 whitespace-pre-wrap overflow-auto max-h-32">
            {typeof value === 'string' ? value : JSON.stringify(value, null, 2)}
          </pre>
        </div>
      ))}
    </div>
  );
}

function VdomNodeRenderer({
  node,
  selectedId,
  highlightedIds = [],
  onNodeClick,
  onHighlight,
  depth = 0,
}: {
  node: VdomTreeNode;
  selectedId: string | null;
  highlightedIds?: string[];
  onNodeClick: (id: string, page: number, bbox?: VdomTreeNode['bbox']) => void;
  onHighlight?: (ids: string[]) => void;
  depth?: number;
}) {
  const isSelected = selectedId === node.id;

  if (node.type === 'ocr') {
    return (
      <div>
        <OcrBlockComponent
          id={node.id}
          text={node.textContent}
          bbox={node.bbox}
          className={node.className}
          attributes={node.attributes}
          isSelected={isSelected}
          highlightedIds={highlightedIds}
          onHighlight={onHighlight}
          onClick={() => onNodeClick(node.id, node.page, node.bbox)}
        />
        <NodeData data={node.data} />
      </div>
    );
  }

  const Component = getEntityComponent(node.type);

  const childrenJsx = (
    <>
      {node.children.length > 0 && (
        <div className="entity-children space-y-0.5">
          {node.children.map((child) => (
            <VdomNodeRenderer
              key={child.id}
              node={child}
              selectedId={selectedId}
              highlightedIds={highlightedIds}
              onNodeClick={onNodeClick}
              onHighlight={onHighlight}
              depth={depth + 1}
            />
          ))}
        </div>
      )}
      <NodeData data={node.data} />
    </>
  );

  return (
    <Component
      id={node.id}
      type={node.type}
      text={node.textContent}
      page={node.page}
      bbox={node.bbox}
      className={node.className}
      attributes={node.attributes}
      isSelected={isSelected}
      highlightedIds={highlightedIds}
      onHighlight={onHighlight}
      onEvidenceClick={onNodeClick}
    >
      {childrenJsx}
    </Component>
  );
}

function SpatialPageRenderer({
  pageNode,
  selectedId,
  highlightedIds = [],
  onNodeClick,
  aspectRatio,
  overlay = false,
  showPageNumbers = true,
}: {
  pageNode: VdomTreeNode;
  selectedId: string | null;
  highlightedIds?: string[];
  onNodeClick: (id: string, page: number, bbox?: VdomTreeNode['bbox']) => void;
  aspectRatio: number;
  overlay?: boolean;
  showPageNumbers?: boolean;
}) {
  const pageNum = pageNode.page;

  return (
    <div className={clsx(!overlay && "mb-8")}>
      {showPageNumbers && !overlay && (
        <div className="sticky top-0 z-10 bg-white/90 backdrop-blur-sm py-2 mb-2 border-b border-slate-200">
          <h3 className="text-sm font-semibold text-slate-600">Page {pageNum}</h3>
        </div>
      )}

      <div
        className={clsx(
          "relative overflow-hidden",
          !overlay && "bg-slate-50 border border-slate-200 rounded-lg"
        )}
        style={{ paddingBottom: `${100 / aspectRatio}%` }}
      >
        <div className={clsx("absolute inset-0", overlay && "pointer-events-none")}>
          {pageNode.children.map((node) => {
            if (!node.bbox) return null;

            const style: React.CSSProperties = {
              position: 'absolute',
              left: `${node.bbox.x * 100}%`,
              top: `${node.bbox.y * 100}%`,
              width: `${node.bbox.width * 100}%`,
              height: `${node.bbox.height * 100}%`,
              pointerEvents: 'auto',
            };

            const isSelected = selectedId === node.id;
            const isHighlighted = highlightedIds.includes(node.id);

            return (
              <div
                key={node.id}
                style={style}
                className={clsx(
                  'cursor-pointer transition-all overflow-hidden border-2',
                  isSelected
                    ? 'border-blue-500 bg-blue-500/20 z-30 ring-4 ring-blue-500/20'
                    : isHighlighted
                    ? 'border-emerald-500 bg-emerald-500/20 z-20 animate-pulse'
                    : 'border-transparent hover:border-blue-400/50 hover:bg-blue-400/5 z-10',
                  !overlay && node.type !== 'ocr' && 'bg-white/80 backdrop-blur-sm shadow-sm border border-slate-200/50',
                )}
                onClick={(e) => {
                  e.stopPropagation();
                  onNodeClick(node.id, pageNum, node.bbox);
                }}
                title={node.textContent || node.type}
              >
                {!overlay && (
                  <div className="p-1 h-full overflow-hidden">
                    <div className="text-[10px] font-medium text-slate-500 uppercase tracking-wide">
                      {node.type}
                    </div>
                    {node.textContent && (
                      <div className="text-[9px] text-slate-600 line-clamp-3 leading-tight">
                        {node.textContent}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function ListPageRenderer({
  pageNode,
  selectedId,
  highlightedIds = [],
  onNodeClick,
  onHighlight,
}: {
  pageNode: VdomTreeNode;
  selectedId: string | null;
  highlightedIds?: string[];
  onNodeClick: (id: string, page: number, bbox?: VdomTreeNode['bbox']) => void;
  onHighlight?: (ids: string[]) => void;
}) {
  return (
    <VdomNodeRenderer
      node={pageNode}
      selectedId={selectedId}
      highlightedIds={highlightedIds}
      onNodeClick={onNodeClick}
      onHighlight={onHighlight}
    />
  );
}

export function VdomJsxPanel({
  vdomTree,
  selectedId,
  highlightedIds = [],
  onNodeClick,
  onHighlight,
  renderMode = 'list',
  pageAspectRatio = 8.5 / 11,
  overlay = false,
  showPageNumbers = true,
  currentPage,
}: VdomJsxPanelProps) {
  const pageNodes = useMemo(() => {
    if (!vdomTree) return [];
    const allPages = vdomTree.children.filter(node => node.type === 'page');
    if (overlay && currentPage !== undefined) {
      return allPages.filter(p => p.page === currentPage);
    }
    return allPages;
  }, [vdomTree, overlay, currentPage]);

  if (!vdomTree || pageNodes.length === 0) {
    if (overlay) return null;
    return (
      <div className="h-full flex items-center justify-center text-slate-400 text-sm">
        No entities extracted yet
      </div>
    );
  }

  if (renderMode === 'spatial') {
    return (
      <div className={clsx("h-full overflow-auto", !overlay && "p-4 bg-white")}>
        {pageNodes.map((pageNode) => (
          <SpatialPageRenderer
            key={pageNode.id}
            pageNode={pageNode}
            selectedId={selectedId}
            highlightedIds={highlightedIds}
            onNodeClick={onNodeClick}
            aspectRatio={pageAspectRatio}
            overlay={overlay}
            showPageNumbers={showPageNumbers}
          />
        ))}
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto p-4 bg-white">
      <VdomNodeRenderer
        node={vdomTree}
        selectedId={selectedId}
        highlightedIds={highlightedIds}
        onNodeClick={onNodeClick}
        onHighlight={onHighlight}
      />
    </div>
  );
}
