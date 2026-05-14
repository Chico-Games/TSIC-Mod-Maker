import {
  DndContext,
  DragOverlay,
  PointerSensor,
  pointerWithin,
  rectIntersection,
  useSensor,
  useSensors,
  type Active,
  type CollisionDetection,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { useEffect, useState } from 'react';
import { followCursor } from './dragModifiers';
import { DragGhost } from './components/DragGhost';
import { Header } from './components/Header';
import { LoadGate } from './components/LoadGate';
import { RestoreDraftPrompt } from './components/RestoreDraftPrompt';
import { SchemaGate } from './components/SchemaGate';
import { CommandPalette } from './components/CommandPalette';
import { DefinitionsTab } from './components/DefinitionsTab';
import { RecipesAndLootTab } from './components/RecipesAndLootTab';
import { ValidationsTab } from './components/ValidationsTab';
import { ItemsTab } from './components/ItemsTab';
import { FurnitureTab } from './components/FurnitureTab';
import { LayoutsTab } from './components/layouts/LayoutsTab';
import { useAppStore, type AppTab } from './store/appStore';
import { useDefinitionsStore } from './store/definitionsStore';
import { useModIoStore } from './store/modIoStore';
import { ToastStack } from './components/modio/ToastStack';
import { dispatchDnD, type DragSource, type DropTarget } from './dnd/dispatch';
import { copyCurrentSelection, pasteCurrentSelection } from './clipboard';
import { getSemantic } from './search/semantic';
import { semanticTextFor } from './search/semanticText';

function LoadingOverlay() {
  const loading = useDefinitionsStore((s) => s.loading);
  if (!loading) return null;
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0, 0, 0, 0.55)',
        backdropFilter: 'blur(2px)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '1rem',
        zIndex: 9999,
        cursor: 'wait',
      }}
      onClick={(e) => e.preventDefault()}
      onPointerDown={(e) => e.preventDefault()}
    >
      <div
        style={{
          width: 48,
          height: 48,
          border: '4px solid rgba(255, 255, 255, 0.18)',
          borderTopColor: 'rgba(255, 255, 255, 0.85)',
          borderRadius: '50%',
          animation: 'tsic-spin 0.9s linear infinite',
        }}
      />
      <div style={{ color: 'rgba(255, 255, 255, 0.85)', fontSize: '0.95rem' }}>
        Loading project…
      </div>
      <style>{`@keyframes tsic-spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

export function App() {
  const tab = useAppStore((s) => s.tab);
  const setTab = useAppStore((s) => s.setTab);
  const searchOpen = useAppStore((s) => s.searchOpen);
  const setSearchOpen = useAppStore((s) => s.setSearchOpen);
  const [activeDrag, setActiveDrag] = useState<DragSource | null>(null);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  const collisionDetection: CollisionDetection = (args) => {
    const a = args.active as Active | undefined;
    const dragType = (a?.data?.current as any)?.type as string | undefined;
    if (dragType === 'palette-item' || dragType === 'recipe-card' || dragType === 'slot') {
      const ptr = pointerWithin(args);
      if (ptr.length > 0) return ptr;
    }
    return rectIntersection(args);
  };

  // Toast: bridges definitionsStore.toast onto a top-level toast widget.
  const defToast = useDefinitionsStore((s) => s.toast);
  const setDefToast = useDefinitionsStore((s) => s.setToast);
  const [toastText, setToastText] = useState<{ kind: 'info' | 'error'; text: string } | null>(null);
  useEffect(() => {
    if (defToast) {
      setToastText(defToast);
      setDefToast(null);
    }
  }, [defToast, setDefToast]);
  useEffect(() => {
    if (toastText) {
      const t = setTimeout(() => setToastText(null), 3500);
      return () => clearTimeout(t);
    }
  }, [toastText]);

  // Bootstrap: load saved handle or fall back to bundled defaults.
  useEffect(() => {
    void useDefinitionsStore.getState().bootstrap();
    // Boot the mod.io store as well: probes any stored token + lazy-loads
    // the starter catalog for diffing.
    void useModIoStore.getState().bootstrap();
  }, []);

  // When the loaded project changes, reload the mod.io sidecar from the new
  // data source. Subscribing by reference (dataSource identity) — every
  // open/save-as builds a fresh DataSource so the reference is sufficient.
  const dataSource = useDefinitionsStore((s) => s.dataSource);
  useEffect(() => {
    void useModIoStore.getState().loadSidecar();
  }, [dataSource]);

  // Periodic remote-event polling while the publish wizard is open AND the
  // project is bound to a mod. Lightweight (one request per 60s) and bails
  // when the wizard closes. The store no-ops when not bound.
  const wizardOpen = useModIoStore((s) => s.publishWizardOpen);
  const boundModId = useModIoStore((s) => s.sidecar?.mod_id ?? null);
  useEffect(() => {
    if (!wizardOpen || !boundModId) return;
    const t = setInterval(() => { void useModIoStore.getState().pollRemoteEvents(); }, 60_000);
    // Fire immediately too so the wizard is up-to-date when opened.
    void useModIoStore.getState().pollRemoteEvents();
    return () => clearInterval(t);
  }, [wizardOpen, boundModId]);

  // Auto-warm the semantic index in the background after definitions
  // load. The model download happens once per browser, embeddings are
  // computed in batches, and every search box hooks into the same
  // cached vectors via useHybridSearch. While indexing, fuzzy
  // matches still work; once the index is ready every filter
  // appends concept matches automatically.
  const definitions = useDefinitionsStore((s) => s.definitions);
  useEffect(() => {
    if (definitions.size === 0) return;
    let cancelled = false;
    void (async () => {
      const sem = getSemantic();
      try {
        // warmup is a no-op when the worker is already loaded.
        await sem.warmup();
        if (cancelled) return;
        await sem.indexItems(
          [...definitions.entries()],
          ([k]) => k,
          ([, rec]) => semanticTextFor(rec),
        );
      } catch (e) {
        // The semantic store surfaces errors via subscribe; nothing
        // else needs to fail because the model couldn't load.
        console.warn('[semantic] background index failed', e);
      }
    })();
    return () => { cancelled = true; };
  }, [definitions]);

  // Keyboard shortcuts.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName?.toLowerCase();
      const inField = tag === 'input' || tag === 'textarea' || tag === 'select';
      const k = e.key.toLowerCase();
      if ((e.ctrlKey || e.metaKey) && k === 'k') {
        e.preventDefault();
        setSearchOpen(true);
        return;
      }
      if (inField) return;
      // Universal copy / paste — routes through clipboard.ts using
      // whatever the user has selected (slot, array/map header, recipe).
      if ((e.ctrlKey || e.metaKey) && k === 'c') {
        const cb = copyCurrentSelection();
        if (cb) {
          e.preventDefault();
          useDefinitionsStore.getState().setToast({
            kind: 'info',
            text: `Copied ${cb.kind === 'recipe' ? 'recipe' : cb.kind}.`,
          });
        }
        return;
      }
      if ((e.ctrlKey || e.metaKey) && k === 'v') {
        const res = pasteCurrentSelection();
        if (res.ok) {
          e.preventDefault();
          useDefinitionsStore.getState().setToast({ kind: 'info', text: 'Pasted.' });
        } else if (res.reason) {
          useDefinitionsStore.getState().setToast({ kind: 'error', text: `Paste: ${res.reason}` });
        }
        return;
      }
      if (e.key === 'Escape') {
        setSearchOpen(false);
        // Clear selection on Escape so the next keypress doesn't
        // accidentally hit the previously selected slot.
        useAppStore.getState().selectPath(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setSearchOpen]);

  const onDragStart = (e: DragStartEvent) => {
    const data = e.active.data.current as DragSource | undefined;
    if (!data) return;
    setActiveDrag(data);
  };

  const onDragEnd = (e: DragEndEvent) => {
    setActiveDrag(null);
    const src = e.active.data.current as DragSource | undefined;
    const tgt = e.over?.data.current as DropTarget | undefined;
    if (!src || !tgt) return;
    dispatchDnD(src, tgt);
  };

  const renderTab = (t: AppTab) => {
    switch (t) {
      case 'recipes-loot': return <RecipesAndLootTab />;
      case 'items': return <ItemsTab />;
      case 'furniture': return <FurnitureTab />;
      case 'definitions': return <DefinitionsTab />;
      case 'layouts': return <LayoutsTab />;
      case 'validations': return <ValidationsTab />;
    }
  };

  return (
    <SchemaGate>
      <DndContext
        sensors={sensors}
        collisionDetection={collisionDetection}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        onDragCancel={() => setActiveDrag(null)}
      >
        <div className="app">
          <Header />
          <div className="main">{renderTab(tab)}</div>
          <CommandPalette open={searchOpen} onClose={() => setSearchOpen(false)} onJump={(t) => { setTab(t); setSearchOpen(false); }} />
          <LoadGate />
          <RestoreDraftPrompt />
          <LoadingOverlay />
          {toastText && <div className={`toast ${toastText.kind}`}>{toastText.text}</div>}
          <ToastStack />
        </div>
        <DragOverlay
          dropAnimation={null}
          modifiers={[followCursor]}
          style={{ width: 'auto', height: 'auto', pointerEvents: 'none' }}
        >
          {activeDrag ? <DragGhost source={activeDrag} /> : null}
        </DragOverlay>
      </DndContext>
    </SchemaGate>
  );
}
