'use client';

import React, { useEffect, useRef, useImperativeHandle, forwardRef } from 'react';
import { EditorState } from '@codemirror/state';
import { EditorView, keymap, placeholder as placeholderExt, KeyBinding, drawSelection } from '@codemirror/view';
import { javascript, javascriptLanguage } from '@codemirror/lang-javascript';
import { history, historyKeymap, standardKeymap } from '@codemirror/commands';
import { completionKeymap, autocompletion, completeFromList } from '@codemirror/autocomplete';
import { clsx } from 'clsx';

const vdomCompletions = [
  { label: "$", type: "function", detail: "Query selector", apply: "$()" },
  { label: "$$", type: "function", detail: "Query selector all", apply: "$$()" },
  { label: "page", type: "function", detail: "Select page", apply: "page()" },
  { label: "doc", type: "variable", detail: "Current document" },
  { label: "texts", type: "function", detail: "Get text content", apply: "texts()" },
  { label: "count", type: "function", detail: "Count elements", apply: "count()" },
  { label: "countByType", type: "function", detail: "Count by type", apply: "countByType()" },
  { label: "attr", type: "function", detail: "Get attribute", apply: "attr()" },
  { label: "map", type: "function", detail: "Map elements", apply: "map()" },
  { label: "filter", type: "function", detail: "Filter elements", apply: "filter()" },
  { label: "find", type: "function", detail: "Find descendants", apply: "find()" },
  { label: "parent", type: "function", detail: "Get parent", apply: "parent()" },
  { label: "children", type: "function", detail: "Get children", apply: "children()" },
  { label: "next", type: "function", detail: "Get next sibling", apply: "next()" },
  { label: "prev", type: "function", detail: "Get previous sibling", apply: "prev()" },
];

export interface ConsoleInputProps {
  onExecute: (code: string) => void;
  onHistoryUp: () => string | null;
  onHistoryDown: () => string | null;
  onClear: () => void;
  theme: 'dark' | 'light';
  placeholder?: string;
  className?: string;
}

export interface ConsoleInputRef {
  setValue: (value: string) => void;
  focus: () => void;
}

export const ConsoleInput = forwardRef<ConsoleInputRef, ConsoleInputProps>(({
  onExecute,
  onHistoryUp,
  onHistoryDown,
  onClear,
  theme,
  placeholder = '$(\'table\').texts()',
  className
}, ref) => {
  const editorRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);

  const onExecuteRef = useRef(onExecute);
  const onHistoryUpRef = useRef(onHistoryUp);
  const onHistoryDownRef = useRef(onHistoryDown);
  const onClearRef = useRef(onClear);

  useEffect(() => {
    onExecuteRef.current = onExecute;
    onHistoryUpRef.current = onHistoryUp;
    onHistoryDownRef.current = onHistoryDown;
    onClearRef.current = onClear;
  }, [onExecute, onHistoryUp, onHistoryDown, onClear]);

  useImperativeHandle(ref, () => ({
    setValue: (value: string) => {
      if (!viewRef.current) return;
      viewRef.current.dispatch({
        changes: {
          from: 0,
          to: viewRef.current.state.doc.length,
          insert: value
        }
      });
    },
    focus: () => {
      viewRef.current?.focus();
    }
  }));

  useEffect(() => {
    if (!editorRef.current) return;

    const executeCommand = (view: EditorView) => {
      const code = view.state.doc.toString();
      if (code.trim()) {
        onExecuteRef.current(code);
        view.dispatch({
          changes: { from: 0, to: view.state.doc.length, insert: '' }
        });
      }
      return true;
    };

    const historyUpCommand = (view: EditorView) => {
      const { head } = view.state.selection.main;
      const docLength = view.state.doc.length;
      const isFirstLine = view.state.doc.lineAt(head).number === 1;

      if (isFirstLine) {
        const val = onHistoryUpRef.current();
        if (val !== null) {
          view.dispatch({
            changes: { from: 0, to: docLength, insert: val },
            selection: { anchor: val.length }
          });
          return true;
        }
      }
      return false;
    };

    const historyDownCommand = (view: EditorView) => {
      const { head } = view.state.selection.main;
      const docLength = view.state.doc.length;
      const isLastLine = view.state.doc.lineAt(head).number === view.state.doc.lines;

      if (isLastLine) {
        const val = onHistoryDownRef.current();
        if (val !== null) {
          view.dispatch({
            changes: { from: 0, to: docLength, insert: val },
            selection: { anchor: val.length }
          });
          return true;
        }
      }
      return false;
    };

    const clearCommand = () => {
      onClearRef.current();
      return true;
    };

    const themeExtension = EditorView.theme({
      "&": {
        backgroundColor: "transparent !important",
        height: "auto",
        minHeight: "20px",
      },
      ".cm-content": {
        caretColor: theme === 'dark' ? "#fff" : "#1e293b",
        color: theme === 'dark' ? "#cbd5e1" : "#1e293b",
        fontFamily: "monospace",
        fontSize: "12px",
        padding: "0",
      },
      ".cm-cursor": {
        borderLeftColor: theme === 'dark' ? "#fff" : "#1e293b",
        borderLeftWidth: "2px",
      },
      ".cm-line": {
        padding: "0",
      },
      ".cm-scroller": {
        fontFamily: "inherit",
        lineHeight: "inherit",
        overflow: "hidden"
      },
      "&.cm-focused": {
        outline: "none"
      },
      "&.cm-focused .cm-cursor": {
        display: "block !important",
      }
    });

    const state = EditorState.create({
      doc: '',
      extensions: [
        keymap.of([
          { key: "Enter", run: executeCommand },
          { key: "ArrowUp", run: historyUpCommand },
          { key: "ArrowDown", run: historyDownCommand },
          { key: "Mod-l", run: clearCommand },
          ...standardKeymap,
          ...historyKeymap,
          ...completionKeymap,
        ] as unknown as KeyBinding[]),
        history(),
        javascript(),
        javascriptLanguage.data.of({
          autocomplete: completeFromList(vdomCompletions)
        }),
        autocompletion(),
        placeholderExt(placeholder),
        themeExtension,
        EditorView.lineWrapping,
        drawSelection(),
      ]
    });

    const view = new EditorView({
      state,
      parent: editorRef.current
    });

    viewRef.current = view;

    // Auto-focus input on mount for immediate typing (REPL UX pattern)
    requestAnimationFrame(() => {
      view.focus();
    });

    return () => {
      view.destroy();
    };
  }, [theme, placeholder]);

  return (
    <div
      ref={editorRef}
      className={clsx("flex-1 overflow-hidden", className)}
      style={{
        fontSize: '12px',
        lineHeight: '1.5',
      }}
    />
  );
});

ConsoleInput.displayName = 'ConsoleInput';
