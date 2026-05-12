import { useEffect, type ReactNode } from 'react';
import { useAppSchemaStore } from '../store/appSchemaStore';

/** Blocks render until the engine schema is fetched. Renders a fatal panel
 *  on failure — schema is required for any meaningful UI. */
export function SchemaGate({ children }: { children: ReactNode }) {
  const loaded = useAppSchemaStore((s) => s.loaded);
  const errorText = useAppSchemaStore((s) => s.errorText);
  const loadSchema = useAppSchemaStore((s) => s.loadSchema);

  useEffect(() => { void loadSchema(); }, [loadSchema]);

  if (errorText) {
    return (
      <div style={{ padding: 24, color: '#c00', fontFamily: 'system-ui' }}>
        <h2>Cannot start — schema load failed</h2>
        <p>{errorText}</p>
        <p>Re-run <code>npm run sync-defaults</code> and reload.</p>
      </div>
    );
  }
  if (!loaded) return null;
  return <>{children}</>;
}
