// Embedding-based semantic search powered by Transformers.js
// (MiniLM-L6-v2 quantized, ~22 MB one-time download). All inference
// runs in a Web Worker so the model load + per-query embed don't
// block the UI thread.
//
// Public API:
//   const sem = getSemantic();
//   await sem.warmup();                    // optional: kicks model load
//   await sem.indexItems(items, getText);  // build vectors for items
//   const ranked = await sem.search(query, items, getText, k=50);
//
// State:
//   sem.status:  'cold' | 'loading' | 'ready' | 'error'
//   sem.subscribe(cb): notifies on status / progress changes
//
// Cosine ranking: vectors come back L2-normalized from the worker,
// so similarity is a plain dot-product. Items below a small
// threshold are filtered out — the model returns dense matches for
// every query and we'd otherwise show every asset.

// Vite's `?worker` import suffix returns a class that constructs a
// dedicated Web Worker pointed at the file. Casting through `any`
// because no @types exists for the `?worker` suffix.
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — virtual import provided by Vite at bundle time
import SemanticWorker from './semantic-worker?worker';

export type SemanticStatus = 'cold' | 'loading' | 'ready' | 'error';

export interface SemanticHit<T> {
  item: T;
  score: number; // cosine similarity ∈ [-1, 1]
}

interface ProgressEvent {
  stage: 'loading' | 'downloading' | 'ready' | 'error';
  message?: string;
  progress?: number;
}

interface PendingRequest {
  resolve: (vectors: number[][]) => void;
  reject: (err: Error) => void;
}

class Semantic {
  private worker: Worker | null = null;
  private nextId = 1;
  private pending = new Map<number, PendingRequest>();
  /** assetId → embedding (L2-normalized). */
  private vectors = new Map<string, Float32Array>();
  /** Subscribers for status / progress updates. */
  private listeners = new Set<(s: SemanticStatus, p?: ProgressEvent) => void>();
  private _status: SemanticStatus = 'cold';
  private _lastProgress: ProgressEvent | undefined;

  get status(): SemanticStatus { return this._status; }
  get lastProgress(): ProgressEvent | undefined { return this._lastProgress; }

  /** Number of items currently embedded; useful for UI. */
  get indexedCount(): number { return this.vectors.size; }

  subscribe(cb: (s: SemanticStatus, p?: ProgressEvent) => void): () => void {
    this.listeners.add(cb);
    return () => { this.listeners.delete(cb); };
  }

  private setStatus(s: SemanticStatus, p?: ProgressEvent) {
    this._status = s;
    if (p) this._lastProgress = p;
    for (const cb of this.listeners) cb(s, p);
  }

  private ensureWorker(): Worker {
    if (this.worker) return this.worker;
    this.setStatus('loading', { stage: 'loading' });
    const w = new SemanticWorker();
    w.addEventListener('message', (e: MessageEvent) => {
      const data = e.data ?? {};
      if (data.kind === 'progress') {
        if (data.stage === 'ready') this.setStatus('ready', data);
        else if (data.stage === 'error') this.setStatus('error', data);
        else this.setStatus(this._status === 'ready' ? 'ready' : 'loading', data);
        return;
      }
      if (typeof data.id !== 'number') return;
      const pending = this.pending.get(data.id);
      if (!pending) return;
      this.pending.delete(data.id);
      if (data.ok) {
        pending.resolve(data.vectors);
        // First successful response confirms readiness even if the
        // worker forgot to emit a 'ready' progress beat.
        if (this._status !== 'ready') this.setStatus('ready');
      } else {
        pending.reject(new Error(String(data.error || 'embed failed')));
      }
    });
    w.addEventListener('error', (e: ErrorEvent) => {
      this.setStatus('error', { stage: 'error', message: e.message });
    });
    this.worker = w;
    return w;
  }

  /** Kick the model load without indexing anything. */
  async warmup(): Promise<void> {
    await this.embedBatch(['warmup']);
  }

  private async embedBatch(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    const w = this.ensureWorker();
    const id = this.nextId++;
    return new Promise<number[][]>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      w.postMessage({ id, kind: 'embed', texts });
    });
  }

  /** Embed a query string and return its normalized vector. */
  async embedQuery(text: string): Promise<Float32Array> {
    const [vec] = await this.embedBatch([text]);
    return new Float32Array(vec);
  }

  /** Build vectors for every item that doesn't already have one.
   *  Idempotent — items keyed in `vectors` are skipped. The batch
   *  size keeps the worker queue moving and the UI responsive. */
  async indexItems<T>(
    items: readonly T[],
    keyOf: (item: T) => string,
    textOf: (item: T) => string,
    onProgress?: (done: number, total: number) => void,
  ): Promise<void> {
    const todo: { key: string; text: string }[] = [];
    for (const item of items) {
      const key = keyOf(item);
      if (!this.vectors.has(key)) todo.push({ key, text: textOf(item) });
    }
    if (todo.length === 0) {
      if (this._status === 'cold') this.ensureWorker();
      onProgress?.(0, 0);
      return;
    }
    const BATCH = 32;
    for (let i = 0; i < todo.length; i += BATCH) {
      const slice = todo.slice(i, i + BATCH);
      const vectors = await this.embedBatch(slice.map((s) => s.text));
      for (let k = 0; k < slice.length; k++) {
        this.vectors.set(slice[k].key, new Float32Array(vectors[k]));
      }
      onProgress?.(Math.min(i + BATCH, todo.length), todo.length);
    }
  }

  /** Drop cached vectors — invalidates after a dataset reload. */
  clearIndex(): void {
    this.vectors.clear();
  }

  /** Rank items by cosine similarity to `query`. The query gets
   *  embedded once per call (cheap). Items lacking a cached vector
   *  are skipped — caller is responsible for indexing first. */
  async search<T>(
    query: string,
    items: readonly T[],
    keyOf: (item: T) => string,
    options?: { limit?: number; minScore?: number },
  ): Promise<SemanticHit<T>[]> {
    const q = query.trim();
    if (!q) return [];
    const limit = options?.limit ?? 50;
    const minScore = options?.minScore ?? 0.25;
    const qvec = await this.embedQuery(q);
    const out: SemanticHit<T>[] = [];
    for (const item of items) {
      const v = this.vectors.get(keyOf(item));
      if (!v) continue;
      let dot = 0;
      const len = Math.min(qvec.length, v.length);
      for (let i = 0; i < len; i++) dot += qvec[i] * v[i];
      if (dot < minScore) continue;
      out.push({ item, score: dot });
    }
    out.sort((a, b) => b.score - a.score);
    return out.slice(0, limit);
  }
}

let singleton: Semantic | null = null;
export function getSemantic(): Semantic {
  if (!singleton) singleton = new Semantic();
  return singleton;
}
