import type { DefinitionRecord, DefinitionsKey } from '../../store/definitionsStore';

export type ColumnKind = 'string' | 'number' | 'bool' | 'tag' | 'ref' | 'count';

export interface Column {
  key: string;
  label: string;
  path: string[];                 // path WITHIN record.json (no leading 'json' or 'properties' — relative to root)
  kind: ColumnKind;
  width?: number;
}

export type WarningSeverity = 'info' | 'warn' | 'error';

export interface WarningCtx {
  records: Map<DefinitionsKey, DefinitionRecord>;
  findKeyById: (id: string) => DefinitionsKey | null;
  createDefinitionForClass: (className: string, id: string) => DefinitionsKey | null;
  updateValueAtPath: (k: DefinitionsKey, path: (string | number)[], value: any) => void;
}

export interface WarningRule {
  id: string;
  severity: WarningSeverity;
  test: (rec: DefinitionRecord, ctx: WarningCtx) => string | null;
  fix?: (rec: DefinitionRecord, ctx: WarningCtx) => void;
}

export interface ClassBrowserConfig {
  label: string;
  emoji: string;
  sortWeight?: number;
  columns: Column[];
  warnings?: WarningRule[];
  paletteFolders?: string[];
  hasStaticPartner?: boolean;
  newRecordClass: string;
  idTemplate?: (n: number) => string;
}
