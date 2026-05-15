import { useValidationStore, type ValidationIssue } from '../store/validationStore';
import { useDefinitionsStore, type DefinitionsKey } from '../store/definitionsStore';
import { useAppStore } from '../store/appStore';

function describe(i: ValidationIssue): string {
  switch (i.kind) {
    case 'unknown-class':
      return `Unknown class: ${i.className}`;
    case 'unknown-property':
      return `Unknown property: ${i.parentType}.${i.propertyName}`;
    case 'missing-asset-ref':
      return `Missing ${i.assetClass} at ${i.path}`;
    case 'asset-ref-guid-mismatch':
      return `Asset GUID mismatch at ${i.path}`;
    case 'dangling-definition-ref':
      return `Reference does not resolve: ${i.assetClass} → ${i.targetId}`;
  }
}

export function summarizeIssues(issues: ValidationIssue[]): string {
  if (issues.length === 0) return '';
  const lines = issues.slice(0, 8).map(describe);
  if (issues.length > 8) lines.push(`…and ${issues.length - 8} more`);
  return lines.join('\n');
}

const EMPTY: ValidationIssue[] = [];
export function useIssuesForKey(key: string | null | undefined): ValidationIssue[] {
  const issuesByKey = useValidationStore((s) => s.issuesByKey);
  return key ? issuesByKey.get(key) ?? EMPTY : EMPTY;
}

/** Jump to the definition that's the source of the first issue (or
 *  the issue's recordKey when it's a same-record drift). */
function useJumpToIssueSource() {
  const setTab = useAppStore((s) => s.setTab);
  const findKeyById = useDefinitionsStore((s) => s.findKeyById);
  const selectFolder = useDefinitionsStore((s) => s.selectFolder);
  const selectDefinition = useDefinitionsStore((s) => s.selectDefinition);
  const definitions = useDefinitionsStore((s) => s.definitions);
  return (issues: ValidationIssue[]) => {
    if (issues.length === 0) return;
    const first = issues[0];
    // For dangling-definition-ref, jumping to the host record (where the
    // bad reference lives) is more useful than jumping to a non-existent
    // target. Same for asset-ref issues. unknown-class/property always
    // points at the host record.
    let targetKey: DefinitionsKey | null = first.recordKey;
    if (!targetKey && first.kind === 'dangling-definition-ref') {
      targetKey = findKeyById(first.targetId);
    }
    if (!targetKey) return;
    const rec = definitions.get(targetKey);
    if (!rec) return;
    setTab('definitions');
    selectFolder(rec.folder);
    selectDefinition(targetKey);
  };
}

export function IssueDot({ issues, className }: { issues: ValidationIssue[]; className?: string }) {
  const jump = useJumpToIssueSource();
  if (issues.length === 0) return null;
  return (
    <span
      role="button"
      tabIndex={0}
      className={`issue-dot ${className ?? ''}`}
      title={summarizeIssues(issues) + '\n\n(click to jump)'}
      data-count={issues.length}
      onClick={(e) => { e.stopPropagation(); jump(issues); }}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); jump(issues); } }}
    />
  );
}
