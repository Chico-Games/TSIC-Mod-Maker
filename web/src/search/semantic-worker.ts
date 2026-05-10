/// <reference lib="webworker" />
//
// Off-main-thread embedder for the semantic-search feature.
//
// The worker lazy-loads MiniLM-L6-v2 (quantized, ~22 MB) from the
// huggingface CDN on first use. After the first call the model is
// cached in the browser's HTTP cache, so subsequent reloads are
// fast. Embeddings are computed via mean-pooling the model's last
// hidden state, then L2-normalized so dot-product = cosine
// similarity.
//
// Messages on the wire:
//   { id, kind: 'embed', texts: string[] }
//     → { id, ok: true, vectors: number[][] }
//     | { id, ok: false, error: string }
//
// Progress / status:
//   { kind: 'progress', stage, message?, progress? }   (one-way)

import { pipeline, env, type FeatureExtractionPipeline } from '@huggingface/transformers';

// Use remote model files (HF CDN). Embeddings are tiny once the
// model is loaded; one-time download is acceptable.
env.allowLocalModels = false;
env.allowRemoteModels = true;

const MODEL_ID = 'Xenova/all-MiniLM-L6-v2';

let pipelinePromise: Promise<FeatureExtractionPipeline> | null = null;

function getPipeline(): Promise<FeatureExtractionPipeline> {
  if (!pipelinePromise) {
    self.postMessage({ kind: 'progress', stage: 'loading', message: `Loading ${MODEL_ID}…` });
    pipelinePromise = pipeline('feature-extraction', MODEL_ID, {
      progress_callback: (p: any) => {
        // p has { status, name, file, progress?, loaded?, total? }
        if (p?.status === 'progress' && typeof p.progress === 'number') {
          self.postMessage({
            kind: 'progress',
            stage: 'downloading',
            message: `${p.file ?? ''}`,
            progress: Math.round(p.progress),
          });
        } else if (p?.status === 'ready') {
          self.postMessage({ kind: 'progress', stage: 'ready' });
        } else if (p?.status === 'done' && p?.file) {
          self.postMessage({
            kind: 'progress',
            stage: 'downloading',
            message: `${p.file} done`,
            progress: 100,
          });
        }
      },
    }) as Promise<FeatureExtractionPipeline>;
    // Surface pipeline construction errors so the main thread can
    // toast them rather than hang forever in 'loading'.
    pipelinePromise.catch((e) => {
      self.postMessage({
        kind: 'progress',
        stage: 'error',
        message: e instanceof Error ? e.message : String(e),
      });
    });
  }
  return pipelinePromise;
}

self.addEventListener('message', async (e: MessageEvent) => {
  const { id, kind } = (e.data ?? {}) as { id?: number; kind?: string };
  if (kind !== 'embed' || typeof id !== 'number') return;
  const texts = ((e.data ?? {}) as { texts?: string[] }).texts ?? [];
  try {
    const pipe = await getPipeline();
    // Pass `pooling: 'mean'` so the pipeline returns a single vector
    // per input (rather than a per-token tensor), and `normalize:
    // true` so cosine similarity reduces to a dot product.
    const out = await pipe(texts, { pooling: 'mean', normalize: true });
    // The output is a `Tensor` whose .data is a Float32Array of
    // length [texts.length × dims]. Convert into one Float32Array
    // per row for cheap transfer.
    const dims = out.dims as number[];
    const totalRows = dims.length === 2 ? dims[0] : 1;
    const dim = dims.length === 2 ? dims[1] : (out.data as Float32Array).length;
    const flat = out.data as Float32Array;
    const vectors: number[][] = [];
    for (let i = 0; i < totalRows; i++) {
      const row = new Array<number>(dim);
      const offset = i * dim;
      for (let j = 0; j < dim; j++) row[j] = flat[offset + j];
      vectors.push(row);
    }
    self.postMessage({ id, ok: true, vectors });
  } catch (err) {
    self.postMessage({
      id,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
});

export {};
