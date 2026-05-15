import { useModIoToastStore } from '../../store/modIoToastStore';

export function ToastStack() {
  const toasts = useModIoToastStore((s) => s.toasts);
  const dismiss = useModIoToastStore((s) => s.dismiss);
  if (toasts.length === 0) return null;
  return (
    <div
      style={{
        position: 'fixed',
        bottom: 16,
        right: 16,
        zIndex: 1000,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        maxWidth: 360,
      }}
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          onClick={() => dismiss(t.id)}
          style={{
            background: t.kind === 'error' ? 'rgba(239,108,108,0.15)' : t.kind === 'success' ? 'rgba(54,198,155,0.15)' : 'rgba(95,179,255,0.15)',
            border: `1px solid ${t.kind === 'error' ? 'var(--error)' : t.kind === 'success' ? 'var(--accent-2)' : 'var(--accent)'}`,
            color: t.kind === 'error' ? 'var(--error)' : t.kind === 'success' ? 'var(--accent-2)' : 'var(--accent)',
            borderRadius: 6,
            padding: '8px 12px',
            fontSize: 12,
            cursor: 'pointer',
            display: 'flex',
            gap: 8,
            alignItems: 'flex-start',
            backdropFilter: 'blur(4px)',
          }}
          title="Click to dismiss"
        >
          <span aria-hidden="true">
            {t.kind === 'error' ? '⚠' : t.kind === 'success' ? '✓' : 'ℹ'}
          </span>
          <span style={{ flex: 1 }}>{t.text}</span>
        </div>
      ))}
    </div>
  );
}
