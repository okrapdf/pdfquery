// Components
export { VdomJsxPanel } from './components/VdomJsxPanel';
export { VdomConsole } from './components/VdomConsole';
export { ConsoleInput, type ConsoleInputRef, type ConsoleInputProps } from './components/ConsoleInput';
export {
  TableEntity,
  FigureEntity,
  FootnoteEntity,
  HeadingEntity,
  ParagraphEntity,
  ListEntity,
  SignatureEntity,
  SummaryEntity,
  FormEntity,
  HeaderEntity,
  OcrEntity,
  GenericEntity,
  DocumentEntity,
  PageEntity,
  OcrBlockComponent,
  getEntityComponent,
  ENTITY_COMPONENTS,
  type EntityNodeProps,
} from './components/EntityComponents';

// Re-export types from pdfquery
export type { VdomTreeNode, Bbox, ConsoleContext, EntityProps } from 'pdfquery/src/types/vdom';
