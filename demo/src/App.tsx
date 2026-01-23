import React, { useState, useMemo } from 'react';
import { VdomJsxPanel, VdomConsole } from './pdfquery-ui';
import type { VdomTreeNode, ConsoleContext } from './pdfquery-ui';
import { createQueryEngine, treeToVirtualDoc } from 'pdfquery';
import fixtureData from '../../fixtures/amazon-2019-10k.json';

// Convert fixture data to VDOM tree
function fixtureToVdomTree(fixture: any): VdomTreeNode {
  const pages = fixture.pages.map((page: any, idx: number) => {
    const pageNum = idx + 1;
    const children: VdomTreeNode[] = [];

    // Add page content as OCR blocks
    if (page.content) {
      const lines = page.content.split('\n');
      lines.forEach((line: string, lineIdx: number) => {
        if (line.trim()) {
          children.push({
            id: `ocr-${pageNum}-${lineIdx}`,
            type: 'ocr',
            tagName: 'ocr',
            textContent: line,
            page: pageNum,
            children: [],
            attributes: {},
          });
        }
      });
    }

    return {
      id: `page-${pageNum}`,
      type: 'page',
      tagName: 'page',
      textContent: null,
      page: pageNum,
      children,
      attributes: { pageNumber: pageNum },
    };
  });

  return {
    id: 'document',
    type: 'document',
    tagName: 'document',
    textContent: null,
    page: 0,
    children: pages,
    attributes: {},
  };
}

export default function App() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [highlightedIds, setHighlightedIds] = useState<string[]>([]);
  const [currentPage] = useState(1);

  const vdomTree = useMemo(() => fixtureToVdomTree(fixtureData), []);

  const pdfQuery = useMemo(() => {
    if (!vdomTree) return null;
    const virtualDoc = treeToVirtualDoc(vdomTree as any, { docId: 'demo', includeOcrBlocks: true });
    return createQueryEngine(virtualDoc);
  }, [vdomTree]);

  const consoleContext: ConsoleContext = useMemo(() => ({
    $: (selector: string) => pdfQuery?.(selector),
    $$: (selector: string) => pdfQuery?.(selector),
    doc: vdomTree,
    currentPage,
    page: (n: number) => {
      return pdfQuery?.(selector => selector).onPage(n);
    },
  }), [pdfQuery, vdomTree, currentPage]);

  const handleNodeClick = (id: string, page: number, bbox?: any) => {
    setSelectedId(id);
    setHighlightedIds([id]);
  };

  const handleHighlight = (ids: string[]) => {
    setHighlightedIds(ids);
  };

  return (
    <div className="h-screen flex flex-col bg-slate-50">
      <header className="bg-white border-b border-slate-200 px-6 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">PDFQuery Demo</h1>
            <p className="text-sm text-slate-600 mt-1">
              jQuery for PDFs - Query documents with CSS-like selectors
            </p>
          </div>
          <a
            href="https://github.com/okrapdf/pdfquery"
            className="px-4 py-2 bg-slate-900 text-white rounded-lg hover:bg-slate-800 transition-colors text-sm font-medium"
            target="_blank"
            rel="noopener noreferrer"
          >
            View on GitHub
          </a>
        </div>
      </header>

      <div className="flex-1 grid grid-cols-2 gap-0 min-h-0">
        <div className="border-r border-slate-200 bg-white overflow-hidden">
          <div className="h-full flex flex-col">
            <div className="px-4 py-3 border-b border-slate-200 bg-slate-50">
              <h2 className="text-sm font-semibold text-slate-700">Document Tree</h2>
            </div>
            <div className="flex-1 overflow-auto">
              <VdomJsxPanel
                vdomTree={vdomTree}
                selectedId={selectedId}
                highlightedIds={highlightedIds}
                onNodeClick={handleNodeClick}
                onHighlight={handleHighlight}
                renderMode="list"
              />
            </div>
          </div>
        </div>

        <div className="bg-white overflow-hidden flex flex-col">
          <div className="px-4 py-3 border-b border-slate-200 bg-slate-50">
            <h2 className="text-sm font-semibold text-slate-700">Query Console</h2>
            <p className="text-xs text-slate-500 mt-1">
              Try: <code className="bg-slate-200 px-1 rounded">$('ocr').texts()</code>
            </p>
          </div>
          <div className="flex-1 min-h-0">
            <VdomConsole
              context={consoleContext}
              theme="light"
              className="h-full"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
