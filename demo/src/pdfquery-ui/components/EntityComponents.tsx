'use client';

import React from 'react';
import * as Collapsible from '@radix-ui/react-collapsible';
import { clsx } from 'clsx';
import { ChevronRight } from 'lucide-react';
import type { EntityProps } from 'pdfquery/src/types/vdom';

interface EntityNodeProps extends EntityProps {
  highlightedIds?: string[];
  onHighlight?: (ids: string[]) => void;
}

function EntityNode({
  id,
  type,
  page,
  bbox,
  text,
  attributes,
  className,
  onEvidenceClick,
  isSelected: propIsSelected,
  highlightedIds = [],
  onHighlight,
  children,
}: EntityNodeProps) {
  const isSelected = propIsSelected || highlightedIds.includes(id);

  const [isOpen, setIsOpen] = React.useState(false);
  const hasChildren = React.Children.count(children) > 0;
  const childCount = React.Children.count(children);
  const hasContent = hasChildren || !!text;

  const propEntries: [string, unknown][] = [
    ['id', id],
    ['page', page]
  ];
  if (className) propEntries.push(['className', className]);
  if (bbox) propEntries.push(['bbox', bbox]);
  if (attributes && Object.keys(attributes).length > 0) {
    propEntries.push(['attributes', attributes]);
  }

  const renderPropValue = (v: unknown) => {
    return typeof v === 'string' ? `"${v}"` : `{${JSON.stringify(v)}}`;
  };

  return (
    <Collapsible.Root open={isOpen} onOpenChange={setIsOpen} className="font-mono text-[11px] leading-relaxed select-text">
      <div
        className={clsx(
          'rounded cursor-pointer group',
          'hover:bg-slate-100',
          isSelected && 'bg-blue-100/70 shadow-[inset_0_0_0_1px_rgba(59,130,246,0.2)]'
        )}
        onClick={(e) => {
          e.stopPropagation();
          onHighlight?.([id]);
          onEvidenceClick?.(id, page, bbox);
        }}
      >
        {!isOpen ? (
          // Collapsed View: Single line
          <div className="flex items-center gap-1 py-0.5 px-1 whitespace-nowrap overflow-hidden">
             {hasChildren ? (
              <Collapsible.Trigger asChild onClick={(e) => e.stopPropagation()}>
                <button className="p-0.5 hover:bg-slate-200 rounded flex-shrink-0 text-slate-500">
                  <ChevronRight className="w-3 h-3" />
                </button>
              </Collapsible.Trigger>
            ) : (
              <span className="w-4 flex-shrink-0" />
            )}

            <span className="text-[#881280] font-bold">&lt;{type}</span>

            <div className="flex gap-1.5 ml-1 overflow-hidden text-ellipsis">
              {propEntries.map(([k, v]) => (
                <span key={k} className="flex items-center">
                  <span className="text-[#994500]">{k}</span>
                  <span className="text-slate-500">=</span>
                  <span className="text-[#1a1aa6]">{renderPropValue(v)}</span>
                </span>
              ))}
            </div>

            <span className="text-[#881280] font-bold flex-shrink-0">
              {hasContent ? '>' : ' />'}
            </span>

            {hasChildren && (
               <span className="text-slate-400 ml-1 italic flex-shrink-0">...</span>
            )}

            {text && (
              <span className="text-slate-600 truncate max-w-[300px] ml-2 flex-shrink-0" title={text}>
                {text}
              </span>
            )}
          </div>
        ) : (
          // Expanded View: Multiline
          <div className="py-0.5 px-1">
             <div className="flex items-center gap-1">
                {hasChildren ? (
                  <Collapsible.Trigger asChild onClick={(e) => e.stopPropagation()}>
                    <button className="p-0.5 hover:bg-slate-200 rounded flex-shrink-0 text-slate-500">
                      <ChevronRight className="w-3 h-3 rotate-90" />
                    </button>
                  </Collapsible.Trigger>
                ) : (
                  <span className="w-4 flex-shrink-0" />
                )}
                <span className="text-[#881280] font-bold">&lt;{type}</span>
             </div>

             <div className="pl-6 flex flex-col items-start gap-0.5 my-0.5">
               {propEntries.map(([k, v]) => (
                  <div key={k} className="whitespace-pre-wrap break-all">
                    <span className="text-[#994500]">{k}</span>
                    <span className="text-slate-500">=</span>
                    <span className="text-[#1a1aa6]">{renderPropValue(v)}</span>
                  </div>
               ))}
             </div>

             <div className="pl-4 text-[#881280] font-bold">&gt;</div>
          </div>
        )}
      </div>

      <Collapsible.Content className="pl-4 border-l border-slate-200/60 ml-[9px]">
        {text && isOpen && (
          <div className="py-0.5 px-1 text-slate-600 italic opacity-70 whitespace-pre-wrap">
            {text}
          </div>
        )}
        {children}
      </Collapsible.Content>

      {hasContent && isOpen && (
        <div className="flex items-center px-1 ml-4 py-0.5 hover:bg-slate-100 rounded cursor-pointer"
             onClick={(e) => {
               e.stopPropagation();
               onHighlight?.([id]);
               onEvidenceClick?.(id, page, bbox);
             }}
        >
          <span className="text-[#881280] font-bold">&lt;/{type}&gt;</span>
        </div>
      )}
    </Collapsible.Root>
  );
}

export function TableEntity(props: EntityNodeProps) {
  return <EntityNode {...props} />;
}

export function FigureEntity(props: EntityNodeProps) {
  return <EntityNode {...props} />;
}

export function FootnoteEntity(props: EntityNodeProps) {
  return <EntityNode {...props} />;
}

export function HeadingEntity(props: EntityNodeProps) {
  return <EntityNode {...props} />;
}

export function ParagraphEntity(props: EntityNodeProps) {
  return <EntityNode {...props} />;
}

export function ListEntity(props: EntityNodeProps) {
  return <EntityNode {...props} />;
}

export function SignatureEntity(props: EntityNodeProps) {
  return <EntityNode {...props} />;
}

export function SummaryEntity(props: EntityNodeProps) {
  return <EntityNode {...props} />;
}

export function FormEntity(props: EntityNodeProps) {
  return <EntityNode {...props} />;
}

export function HeaderEntity(props: EntityNodeProps) {
  return <EntityNode {...props} />;
}

export function OcrEntity(props: EntityNodeProps) {
  return <EntityNode {...props} />;
}

export function GenericEntity(props: EntityNodeProps) {
  return <EntityNode {...props} />;
}

export function DocumentEntity(props: EntityNodeProps) {
  return <EntityNode {...props} />;
}

export function PageEntity(props: EntityNodeProps) {
  return <EntityNode {...props} />;
}

export const ENTITY_COMPONENTS: Record<string, React.ComponentType<EntityNodeProps>> = {
  document: DocumentEntity,
  page: PageEntity,
  table: TableEntity,
  figure: FigureEntity,
  footnote: FootnoteEntity,
  heading: HeadingEntity,
  paragraph: ParagraphEntity,
  summary: SummaryEntity,
  signature: SignatureEntity,
  list: ListEntity,
  form: FormEntity,
  header: HeaderEntity,
  ocr: OcrEntity,
};

export function getEntityComponent(type: string): React.ComponentType<EntityNodeProps> {
  return ENTITY_COMPONENTS[type] || GenericEntity;
}

interface OcrBlockProps {
  id: string;
  text: string | null;
  bbox?: { x: number; y: number; width: number; height: number };
  className?: string;
  attributes?: Record<string, unknown>;
  isSelected?: boolean;
  highlightedIds?: string[];
  onHighlight?: (ids: string[]) => void;
  onClick?: () => void;
}

export function OcrBlockComponent({
  id,
  text,
  bbox,
  className,
  attributes,
  isSelected: propIsSelected,
  highlightedIds = [],
  onHighlight,
  onClick
}: OcrBlockProps) {
  const isSelected = propIsSelected || highlightedIds.includes(id);

  const propEntries: [string, unknown][] = [['id', id]];
  if (className) propEntries.push(['className', className]);
  if (bbox) propEntries.push(['bbox', bbox]);
  if (attributes && Object.keys(attributes).length > 0) {
    propEntries.push(['attributes', attributes]);
  }

  return (
    <div
      data-ocr-id={id}
      className={clsx(
        'font-mono text-[11px] leading-relaxed py-0.5 px-1 rounded cursor-pointer flex flex-wrap items-center gap-x-1 group',
        'hover:bg-slate-100',
        isSelected && 'bg-blue-100/70 shadow-[inset_0_0_0_1px_rgba(59,130,246,0.2)]'
      )}
      onClick={(e) => {
        e.stopPropagation();
        onHighlight?.([id]);
        onClick?.();
      }}
    >
      <span className="text-[#881280] font-bold whitespace-nowrap">&lt;ocr</span>

      {propEntries.map(([k, v]) => (
        <span key={k} className="flex items-center whitespace-nowrap">
          <span className="text-[#994500]">{k}</span>
          <span className="text-slate-500">=</span>
          <span className="text-[#1a1aa6]">
            {typeof v === 'string' ? `"${v}"` : `{${JSON.stringify(v)}}`}
          </span>
        </span>
      ))}

      <span className="text-[#881280] font-bold whitespace-nowrap">
        {text ? '>' : ' />'}
      </span>

      {text && (
        <>
          <span className="text-slate-700 mx-1 break-words min-w-0">{text}</span>
          <span className="text-[#881280] font-bold whitespace-nowrap">&lt;/ocr&gt;</span>
        </>
      )}
    </div>
  );
}

export type { EntityNodeProps };
