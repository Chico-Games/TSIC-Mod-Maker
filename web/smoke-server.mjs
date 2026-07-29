// Shared teardown for the Playwright smokes.
//
// Every smoke spawns `npx vite preview` with `shell: true` and then calls
// `process.exit()` from inside a try/catch. Two things went wrong with that:
//
//   1. `process.exit()` skips the `finally` block, so the kill never ran.
//   2. Even when it ran, `proc.kill()` kills the *shell*, not the vite process
//      it spawned.
//
// The orphan then holds the smoke's `--strictPort` port, so the NEXT run's
// preview fails to bind, the page is served by the stale build, and the smoke
// fails for a completely invented reason. That is what made the suite look
// broken long after the real breakage was fixed.
//
// Registering on 'exit' covers `process.exit()`, a thrown error, and a clean
// return alike; the kill has to be synchronous because that hook cannot await.
import { spawnSync } from 'node:child_process';

/** Tree-kill a spawned shell child. Safe to call more than once. */
export function killTree(proc) {
  if (!proc || proc.killed || proc.pid == null) return;
  try {
    if (process.platform === 'win32') {
      spawnSync('taskkill', ['/pid', String(proc.pid), '/T', '/F'], { stdio: 'ignore' });
    } else {
      process.kill(-proc.pid, 'SIGKILL');
    }
  } catch {
    /* already gone */
  }
  try {
    proc.kill();
  } catch {
    /* already gone */
  }
}

/** Guarantees the preview server dies with this process, however it exits. */
export function autoStopOnExit(proc) {
  const stop = () => killTree(proc);
  process.on('exit', stop);
  process.on('SIGINT', () => {
    stop();
    process.exit(130);
  });
  process.on('SIGTERM', () => {
    stop();
    process.exit(143);
  });
  return stop;
}
