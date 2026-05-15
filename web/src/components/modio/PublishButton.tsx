import { useModIoStore } from '../../store/modIoStore';
import { useDefinitionsStore } from '../../store/definitionsStore';
import { PublishWizard } from './PublishWizard';

export function PublishButton() {
  const cfg = useModIoStore((s) => s.cfg);
  const token = useModIoStore((s) => s.token);
  const ds = useDefinitionsStore((s) => s.dataSource);
  const openWizard = useModIoStore((s) => s.openPublishWizard);
  const state = useModIoStore((s) => s.syncState);

  if (!cfg) return null;
  const enabled = !!ds && ds.kind === 'fsa' && !!token;
  const title = !ds
    ? 'Open a project first'
    : ds.kind !== 'fsa'
    ? 'Save the project to a folder first'
    : !token
    ? 'Sign in to mod.io to publish'
    : state === 'clean'
    ? 'Up to date'
    : 'Publish to mod.io';

  return (
    <>
      <button disabled={!enabled} onClick={() => openWizard('bind')} title={title}>
        📤 Publish
      </button>
      <PublishWizard />
    </>
  );
}
