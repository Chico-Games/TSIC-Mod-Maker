import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import { useDefinitionsStore } from './store/definitionsStore';
import './store/validationStore';
import './styles.css';
import './styles-new.css';

// The static #tsic-boot spinner in index.html is up before any JS runs.
// Tear it down as soon as the first load completes (definitions populated
// AND loading flipped back to false) — or on any user gate so the modal
// underneath is interactable.
function removeBootSpinner() {
  const el = document.getElementById('tsic-boot');
  if (el && el.parentNode) el.parentNode.removeChild(el);
}
const unsubBoot = useDefinitionsStore.subscribe((s, prev) => {
  const definitionsReady = !s.loading && s.definitions.size > 0;
  const gateOpen = Boolean(s.loadGate || s.restoreDraftPrompt || s.futureVersionBlock);
  if (definitionsReady || gateOpen) {
    removeBootSpinner();
    unsubBoot();
  }
  // Reference prev so eslint/no-unused-vars never trips on the signature.
  void prev;
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
