const KEY = 'tsic.dev.show-developer-actions';

export function getShowDeveloperActions(): boolean {
  try { return localStorage.getItem(KEY) === '1'; } catch { return false; }
}
export function setShowDeveloperActions(on: boolean): void {
  try {
    if (on) localStorage.setItem(KEY, '1');
    else localStorage.removeItem(KEY);
  } catch { /* noop */ }
}
