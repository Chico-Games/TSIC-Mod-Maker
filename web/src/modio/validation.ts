import type { ModioSidecar } from './types';
import type { PackedMod } from './packer';

export type IssueSeverity = 'error' | 'warning';
export interface PublishIssue {
  field: 'name' | 'summary' | 'description' | 'logo' | 'tags' | 'modfile' | 'version' | 'general';
  severity: IssueSeverity;
  message: string;
}

const MAX_NAME = 80;
const MAX_SUMMARY = 250;

/** Pure: validate the publishable state of a sidecar (plus an optional packed
 *  modfile). Returns ordered issues; an empty array means "good to ship". */
export function validatePublish(args: {
  sidecar: ModioSidecar;
  /** True when the mod has not yet been created on mod.io — logo is then required. */
  isNew: boolean;
  /** The current packed delta, if any. */
  lastPack?: PackedMod | null;
  /** Whether the user is about to push a modfile in this flow. */
  willPushModfile?: boolean;
  /** Pending version string entered in the modfile step (if any). */
  pendingVersion?: string;
}): PublishIssue[] {
  const out: PublishIssue[] = [];
  const draft = args.sidecar.draft;

  if (!draft.name.trim()) out.push({ field: 'name', severity: 'error', message: 'Name is required.' });
  else if (draft.name.length > MAX_NAME) out.push({ field: 'name', severity: 'error', message: `Name is ${draft.name.length}/${MAX_NAME} characters.` });

  if (!draft.summary.trim()) out.push({ field: 'summary', severity: 'error', message: 'Summary is required.' });
  else if (draft.summary.length > MAX_SUMMARY) out.push({ field: 'summary', severity: 'error', message: `Summary is ${draft.summary.length}/${MAX_SUMMARY} characters.` });
  else if (draft.summary.length < 20) out.push({ field: 'summary', severity: 'warning', message: 'Summary is very short — consider explaining what the mod does.' });

  if (args.isNew && !draft.logo_path) {
    out.push({ field: 'logo', severity: 'error', message: 'Logo is required when creating a mod (mod.io needs ≥512×288).' });
  }

  if (draft.tags.length === 0) {
    out.push({ field: 'tags', severity: 'warning', message: 'No tags selected — adding tags helps discovery.' });
  }

  if (args.willPushModfile) {
    if (!args.lastPack) {
      out.push({ field: 'modfile', severity: 'error', message: 'Pack the project first to compute the modfile.' });
    } else if (args.lastPack.files.length === 0) {
      out.push({ field: 'modfile', severity: 'error', message: 'No changes since the default project — nothing to publish.' });
    }
    const v = (args.pendingVersion ?? '').trim();
    if (!v) out.push({ field: 'version', severity: 'error', message: 'Version is required.' });
    else if (!/^\d+\.\d+\.\d+([-+.].*)?$/.test(v)) out.push({ field: 'version', severity: 'warning', message: 'Version doesn’t look semver-y (e.g. 0.1.0).' });
  }

  return out;
}

/** mod.io's logo requirement: PNG/JPG/GIF, ≥512×288. We auto-upscale-or-pad to
 *  ≥512×288 if the user picks something smaller, leaving big images as-is so
 *  mod.io's own thumbnailer can produce the standard variants. Returns the
 *  original file when no rewrite is necessary. */
export async function normalizeLogoFile(file: File): Promise<{ blob: Blob; width: number; height: number; resized: boolean }> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error('Could not decode the image.'));
      i.src = url;
    });
    if (img.naturalWidth >= 512 && img.naturalHeight >= 288) {
      return { blob: file, width: img.naturalWidth, height: img.naturalHeight, resized: false };
    }
    // Need to upscale. Maintain aspect ratio; whatever side hits the minimum
    // first dictates scale.
    const scale = Math.max(512 / img.naturalWidth, 288 / img.naturalHeight);
    const w = Math.ceil(img.naturalWidth * scale);
    const h = Math.ceil(img.naturalHeight * scale);
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('canvas 2d context unavailable');
    // Smooth scale; pad nothing — just upscale.
    ctx.imageSmoothingEnabled = true;
    (ctx as CanvasRenderingContext2D & { imageSmoothingQuality?: ImageSmoothingQuality }).imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, w, h);
    const blob: Blob = await new Promise((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/png'),
    );
    return { blob, width: w, height: h, resized: true };
  } finally {
    URL.revokeObjectURL(url);
  }
}
