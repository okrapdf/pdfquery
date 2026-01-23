'use client';

import React, { useState, useRef, useCallback, useEffect } from 'react';
import { clsx } from 'clsx';
import { Inspector } from 'react-inspector';
import { ConsoleInput, ConsoleInputRef } from './ConsoleInput';
import type { ConsoleContext } from 'pdfquery/src/types/vdom';

interface ConsoleOutput {
  id: number;
  type: 'input' | 'output' | 'error';
  content: unknown;
  rawInput?: string;
  timestamp: number;
}

interface VdomConsoleProps {
  context: ConsoleContext;
  className?: string;
  theme?: 'dark' | 'light';
  initialInput?: string;
  onExecute?: (code: string) => void;
  onResult?: (result: any) => void;
  autoExecute?: boolean;
}

function executeCode(code: string, context: ConsoleContext): unknown {
  const contextKeys = Object.keys(context);
  const contextValues = Object.values(context);

  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const fn = new Function(...contextKeys, `return (${code})`);
  return fn(...contextValues);
}

const themes = {
  dark: {
    bg: 'bg-[#1e1e1e]',
    border: 'border-[#333]',
    headerBg: 'bg-[#252525]',
    text: 'text-slate-300',
    textMuted: 'text-slate-400',
    textDim: 'text-slate-500',
    textDimmer: 'text-slate-600',
    hover: 'hover:text-slate-300 hover:bg-[#2a2a2a]',
    hoverBtn: 'hover:text-slate-300 hover:bg-[#333]',
    prompt: 'text-blue-400',
    success: 'text-green-400',
    error: 'text-red-400',
    outputText: 'text-slate-400',
    placeholder: 'placeholder:text-slate-600',
  },
  light: {
    bg: 'bg-white',
    border: 'border-slate-200',
    headerBg: 'bg-slate-50',
    text: 'text-slate-800',
    textMuted: 'text-slate-600',
    textDim: 'text-slate-500',
    textDimmer: 'text-slate-400',
    hover: 'hover:text-slate-700 hover:bg-slate-100',
    hoverBtn: 'hover:text-slate-700 hover:bg-slate-100',
    prompt: 'text-blue-600',
    success: 'text-emerald-600',
    error: 'text-red-600',
    outputText: 'text-slate-600',
    placeholder: 'placeholder:text-slate-400',
  },
};

export function VdomConsole({
  context,
  className,
  theme = 'dark',
  initialInput = '',
  onExecute,
  onResult,
  autoExecute = false
}: VdomConsoleProps) {
  const t = themes[theme];
  const [outputs, setOutputs] = useState<ConsoleOutput[]>([]);
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [isCollapsed, setIsCollapsed] = useState(false);

  const inputRef = useRef<ConsoleInputRef>(null);
  const outputRef = useRef<HTMLDivElement>(null);
  const inputContainerRef = useRef<HTMLDivElement>(null);
  const idCounter = useRef(0);

  const inspectorTheme = theme === 'dark' ? 'chromeDark' : 'chromeLight';

  // Auto-scroll output to bottom when new outputs are added
  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [outputs]);

  // Ensure input is visible when component mounts or window resizes
  useEffect(() => {
    const ensureInputVisible = () => {
      if (inputContainerRef.current) {
        inputContainerRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    };

    ensureInputVisible();
    window.addEventListener('resize', ensureInputVisible);
    return () => window.removeEventListener('resize', ensureInputVisible);
  }, []);

  const execute = useCallback((code: string) => {
    if (!code.trim()) return;

    onExecute?.(code);

    const inputId = ++idCounter.current;
    const now = Date.now();

    setOutputs(prev => [...prev, {
      id: inputId,
      type: 'input',
      content: code,
      timestamp: now,
    }]);

    setHistory(prev => {
      const filtered = prev.filter(h => h !== code);
      return [...filtered, code];
    });
    setHistoryIndex(-1);

    try {
      const result = executeCode(code, context);

      onResult?.(result);

      const outputId = ++idCounter.current;
      setOutputs(prev => [...prev, {
        id: outputId,
        type: 'output',
        content: result,
        timestamp: now,
      }]);
    } catch (err) {
      const errorId = ++idCounter.current;
      setOutputs(prev => [...prev, {
        id: errorId,
        type: 'error',
        content: err instanceof Error ? err.message : String(err),
        timestamp: now,
      }]);
    }

    // Focus input after execution to maintain REPL flow
    setTimeout(() => inputRef.current?.focus(), 0);
  }, [context, onExecute, onResult]);

  // Handle auto-execute and initial input changes
  useEffect(() => {
    if (initialInput) {
      // Always update input value when initialInput changes
      inputRef.current?.setValue(initialInput);

      // Auto-execute if enabled
      if (autoExecute) {
        execute(initialInput);
      }
    }
    // We intentionally exclude 'execute' from deps to avoid loops,
    // and rely on initialInput changing to trigger this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialInput, autoExecute]);

  const handleHistoryUp = useCallback(() => {
    if (history.length === 0) return null;

    const newIndex = historyIndex === -1
      ? history.length - 1
      : Math.max(0, historyIndex - 1);

    setHistoryIndex(newIndex);
    return history[newIndex];
  }, [history, historyIndex]);

  const handleHistoryDown = useCallback(() => {
    if (historyIndex === -1) return null;

    const newIndex = historyIndex + 1;
    if (newIndex >= history.length) {
      setHistoryIndex(-1);
      return ''; // Return empty string to clear input
    } else {
      setHistoryIndex(newIndex);
      return history[newIndex];
    }
  }, [history, historyIndex]);

  const clearConsole = useCallback(() => {
    setOutputs([]);
  }, []);

  if (isCollapsed) {
    return (
      <div className={clsx(t.bg, 'border-t', t.border, className)}>
        <button
          onClick={() => setIsCollapsed(false)}
          className={clsx('w-full px-3 py-1.5 flex items-center gap-2 text-xs transition-colors', t.textMuted, t.hover)}
        >
          <span className={t.success}>▶</span>
          <span className="font-mono">VDOM Console</span>
          <span className={t.textDim}>({outputs.filter(o => o.type !== 'input').length} entries)</span>
        </button>
      </div>
    );
  }

  return (
    <div className={clsx(t.bg, 'border-t', t.border, 'flex flex-col', className)}>
      <div className={clsx('flex items-center justify-between px-3 py-1 border-b', t.border, t.headerBg)}>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setIsCollapsed(true)}
            className={clsx(t.textMuted, 'hover:opacity-70 transition-colors')}
          >
            <span className="text-xs">▼</span>
          </button>
          <span className={clsx('text-xs font-mono', t.textMuted)}>VDOM Console</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={clearConsole}
            className={clsx('px-2 py-0.5 text-[10px] rounded transition-colors', t.textDim, t.hoverBtn)}
            title="Clear console (Ctrl+L)"
          >
            Clear
          </button>
        </div>
      </div>

      <div
        ref={outputRef}
        className="flex-1 min-h-0 overflow-auto p-2 font-mono text-xs"
      >
        {outputs.length === 0 && (
          <div className={clsx('text-[11px]', t.textDim)}>
            <div>Query the document tree: $(&apos;table&apos;).texts(), $(&apos;*&apos;).countByType()</div>
            <div className={clsx('mt-1', t.textDimmer)}>
              Context: {context.doc ? `${(context.doc as { pages?: unknown[] }).pages?.length || 0} pages` : 'no doc'},
              page {context.currentPage}
            </div>
          </div>
        )}
        {outputs.map((output) => (
          <div key={output.id} className="mb-1">
            {output.type === 'input' && (
              <div className="flex items-start gap-1">
                <span className={clsx(t.prompt, 'select-none')}>&gt;</span>
                <span className={clsx(t.text, 'whitespace-pre-wrap break-all')}>{String(output.content)}</span>
              </div>
            )}
            {output.type === 'output' && (
              <div className="flex items-start gap-1 pl-3">
                <span className={clsx(t.success, 'select-none shrink-0')}>←</span>
                <div className="overflow-x-auto">
                  <Inspector table={false} data={output.content} theme={inspectorTheme} expandLevel={0} />
                </div>
              </div>
            )}
            {output.type === 'error' && (
              <div className="flex items-start gap-1 pl-3">
                <span className={clsx(t.error, 'select-none shrink-0')}>✗</span>
                <span className={clsx(t.error, 'whitespace-pre-wrap break-all')}>
                  {output.content instanceof Error ? output.content.message : String(output.content)}
                </span>
              </div>
            )}
          </div>
        ))}
      </div>

      <div
        ref={inputContainerRef}
        className={clsx('border-t p-2 flex items-start gap-2 shrink-0 sticky bottom-0', t.bg, t.border)}
      >
        <span className={clsx(t.prompt, 'font-mono text-xs select-none pt-0.5')}>&gt;</span>
        <ConsoleInput
          ref={inputRef}
          onExecute={execute}
          onHistoryUp={handleHistoryUp}
          onHistoryDown={handleHistoryDown}
          onClear={clearConsole}
          theme={theme}
        />
      </div>
    </div>
  );
}

export default VdomConsole;
