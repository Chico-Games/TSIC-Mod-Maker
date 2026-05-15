import { useState } from 'react';
import { useModIoStore } from '../../store/modIoStore';

export function SignInModal() {
  const open = useModIoStore((s) => s.signInModalOpen);
  const close = useModIoStore((s) => s.closeSignInModal);
  const flow = useModIoStore((s) => s.emailFlow);
  const busy = useModIoStore((s) => s.authBusy);
  const lastError = useModIoStore((s) => s.lastError);
  const signInRequest = useModIoStore((s) => s.signInRequest);
  const signInExchange = useModIoStore((s) => s.signInExchange);
  const env = useModIoStore((s) => s.cfg?.env ?? 'live');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [persistent, setPersistent] = useState(false);

  if (!open) return null;

  return (
    <div
      onClick={close}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 8, padding: 24, minWidth: 380 }}
      >
        <h2 style={{ margin: '0 0 12px' }}>🌐 Sign in to mod.io</h2>
        <p style={{ color: 'var(--muted)', fontSize: 12, margin: '0 0 16px' }}>
          mod.io will email you a 5-digit code. Environment: <strong>{env}</strong>
        </p>
        {flow.step !== 'awaiting-code' ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <label style={{ fontSize: 12 }}>Email address</label>
            <input
              autoFocus
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              style={{ width: '100%' }}
            />
            <button
              className="primary"
              disabled={busy !== 'idle' || !email.includes('@')}
              onClick={() => void signInRequest(email)}
            >
              {busy === 'requesting' ? 'Sending…' : 'Email me a code'}
            </button>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <label style={{ fontSize: 12 }}>5-character code sent to {flow.email}</label>
            <input
              autoFocus
              inputMode="text"
              autoComplete="one-time-code"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5))}
              placeholder="A1B2C"
              style={{ width: '100%', letterSpacing: 8, fontSize: 20, textAlign: 'center', textTransform: 'uppercase' }}
            />
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
              <input
                type="checkbox"
                checked={persistent}
                onChange={(e) => setPersistent(e.target.checked)}
              />
              Keep me signed in on this device
            </label>
            <button
              className="primary"
              disabled={busy !== 'idle' || code.length !== 5}
              onClick={() => void signInExchange(code, persistent)}
            >
              {busy === 'exchanging' ? 'Verifying…' : 'Sign in'}
            </button>
          </div>
        )}
        {lastError && (
          <div style={{ marginTop: 12, padding: 8, background: 'rgba(239,108,108,0.1)', border: '1px solid var(--error)', borderRadius: 4, color: 'var(--error)', fontSize: 12 }}>
            {lastError.message}
          </div>
        )}
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
          <button onClick={close}>Close</button>
        </div>
      </div>
    </div>
  );
}
