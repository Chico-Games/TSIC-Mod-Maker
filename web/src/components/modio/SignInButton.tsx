import { useState } from 'react';
import { useModIoStore } from '../../store/modIoStore';
import { SignInModal } from './SignInModal';

export function SignInButton() {
  const cfg = useModIoStore((s) => s.cfg);
  const user = useModIoStore((s) => s.user);
  const token = useModIoStore((s) => s.token);
  const env = useModIoStore((s) => s.cfg?.env);
  const signOut = useModIoStore((s) => s.signOut);
  const setEnv = useModIoStore((s) => s.setEnv);
  const open = useModIoStore((s) => s.openSignInModal);
  const [menuOpen, setMenuOpen] = useState(false);

  if (!cfg) return null;

  if (!token) {
    return (
      <>
        <button onClick={open} title="Sign in to mod.io">🌐 Sign in</button>
        <SignInModal />
      </>
    );
  }

  const label = user?.username ?? 'mod.io';
  return (
    <div style={{ position: 'relative' }}>
      <button onClick={() => setMenuOpen((v) => !v)} title="mod.io account">
        🌐 {label} ▾
      </button>
      {menuOpen && (
        <div
          onMouseLeave={() => setMenuOpen(false)}
          style={{
            position: 'absolute',
            top: '100%',
            right: 0,
            marginTop: 4,
            background: 'var(--panel)',
            border: '1px solid var(--border)',
            borderRadius: 6,
            minWidth: 200,
            padding: 6,
            zIndex: 50,
          }}
        >
          <div style={{ padding: '4px 8px', color: 'var(--muted)', fontSize: 11 }}>
            Signed in as <strong>{label}</strong>
          </div>
          <div style={{ padding: '4px 8px', color: 'var(--muted)', fontSize: 11 }}>
            Env:{' '}
            <button
              style={{ padding: '0 4px', fontSize: 11 }}
              onClick={() => { setEnv(env === 'live' ? 'test' : 'live'); setMenuOpen(false); }}
            >
              {env} ↻
            </button>
          </div>
          <button
            style={{ width: '100%', marginTop: 4 }}
            className="danger"
            onClick={() => { setMenuOpen(false); void signOut(); }}
          >
            Sign out
          </button>
        </div>
      )}
      <SignInModal />
    </div>
  );
}
